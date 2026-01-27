import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const PORT = 8083;
const CLAWDBOT_URL = "http://127.0.0.1:18789/tools/invoke";
const CLAWDBOT_TOKEN = Deno.env.get("CLAWDBOT_TOKEN");

if (!CLAWDBOT_TOKEN) {
  console.error("FATAL: CLAWDBOT_TOKEN environment variable is not set.");
  Deno.exit(1);
}

// Map to track active mobile/web sessions for Server-Sent Events
const clients = new Map<string, (msg: string) => void>();

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Clawd-Token",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // --- 1. Client Events (SSE) ---
  // Clients connect here to receive "pushed" messages from Archie
  if (url.pathname === "/events" && request.method === "GET") {
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
        console.log(`[Bridge] Client connected: ${clientId} (Total: ${clients.size})`);
        
        // Keep-alive heartbeat
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
    try {
      const body = await request.json();
      const { message } = body;

      console.log(`[Bridge Server] Forwarding UI message to Archie: ${message}`);

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
        const errorText = await response.text();
        console.error(`[Bridge Server] Clawdbot API error: ${errorText}`);
        return new Response(JSON.stringify({ error: "Archie is busy" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ status: "success" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }

  // --- 3. Outbound Hook (From Clawdbot/Archie to UI) ---
  // This is where Archie "pushes" data to the bridge
  if (url.pathname === "/push" && request.method === "POST") {
    try {
      const body = await request.json();
      const { message } = body;
      
      console.log(`[Bridge Server] Pushing message to ${clients.size} clients: ${message}`);
      
      const payload = JSON.stringify({ message, timestamp: new Date().toISOString() });
      for (const send of clients.values()) {
        send(payload);
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Push failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }

  return new Response("Not Found", { status: 404, headers: corsHeaders });
}

console.log(`Archie Bridge Server running on http://localhost:${PORT}`);
serve(handleRequest, { port: PORT });
