import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { jwtVerify, createRemoteJWKSet } from "https://deno.land/x/jose@v4.14.4/index.ts";

const PORT = 8083;
const CLAWDBOT_URL = "http://127.0.0.1:18789/tools/invoke";
const CLAWDBOT_TOKEN = Deno.env.get("CLAWDBOT_TOKEN");

if (!CLAWDBOT_TOKEN) {
  console.error("FATAL: CLAWDBOT_TOKEN environment variable is not set.");
  Deno.exit(1);
}

// Google OAuth2 JWKS
const googleJWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") || "671385367166-4118tll0ntluovkdm5agd85arvl1ml9h.apps.googleusercontent.com";

/**
 * Verifies Google JWT and returns user info
 */
async function verifyGoogleJWT(token: string) {
  try {
    const { payload } = await jwtVerify(token, googleJWKS, {
      issuer: "https://accounts.google.com",
      audience: GOOGLE_CLIENT_ID,
    });
    return payload;
  } catch (error) {
    console.error("[Bridge Auth] JWT verification failed:", error);
    return null;
  }
}

// Map to track active mobile/web sessions for Server-Sent Events
const clients = new Map<string, (msg: string) => void>();

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Clawd-Token",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // --- Security Helper ---
  const checkAuth = async (req: Request) => {
    // Check Authorization header or query param (for SSE)
    const authHeader = req.headers.get("Authorization");
    let token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
    
    if (!token) {
      token = new URL(req.url).searchParams.get("token");
    }

    if (!token) return null;
    const user = await verifyGoogleJWT(token);
    if (!user || user.email !== "weolopez@gmail.com") return null;
    return user;
  };

  // --- 1. Client Events (SSE) ---
  if (url.pathname === "/events" && request.method === "GET") {
    const user = await checkAuth(request);
    if (!user) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    const clientId = crypto.randomUUID();
    const body = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (msg: string) => {
          try {
            controller.enqueue(encoder.encode(`data: ${msg}\n\n`));
          } catch (e) {
            console.error("[Bridge] SSE send error", e);
          }
        };
        clients.set(clientId, send);
        console.log(`[Bridge] ${user.email} connected: ${clientId} (Total: ${clients.size})`);
        
        const keepAlive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            clearInterval(keepAlive);
          }
        }, 15000);
      },
      cancel() {
        clients.delete(clientId);
        console.log(`[Bridge] Client disconnected: ${clientId}`);
      },
    });

    return new Response(body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  // --- 2. Inbound Messages from UI ---
  if (url.pathname === "/message" && request.method === "POST") {
    const user = await checkAuth(request);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    try {
      const body = await request.json();
      const { message } = body;

      console.log(`[Bridge Server] Forwarding message from ${user.email}: ${message}`);

      const response = await fetch(CLAWDBOT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${CLAWDBOT_TOKEN}`
        },
        body: JSON.stringify({ 
          tool: "sessions_send",
          args: {
            sessionKey: "agent:main:main",
            message: message
          }
        })
      });

      if (!response.ok) {
        return new Response(JSON.stringify({ error: "Archie is busy" }), { status: 500, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ status: "success" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400, headers: corsHeaders });
    }
  }

  // --- 3. Outbound Hook (Internal Only) ---
  if (url.pathname === "/push" && request.method === "POST") {
    // This is called internally by the agent workspace
    try {
      const body = await request.json();
      const { message } = body;
      
      console.log(`[Bridge Server] Pushing message to ${clients.size} clients`);
      
      const payload = JSON.stringify({ message, timestamp: new Date().toISOString() });
      for (const send of clients.values()) {
        send(payload);
      }

      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Push failed" }), { status: 400, headers: corsHeaders });
    }
  }

  return new Response("Not Found", { status: 404, headers: corsHeaders });
}

console.log(`Archie Secure Bridge Server running on http://localhost:${PORT}`);
serve(handleRequest, { port: PORT });
