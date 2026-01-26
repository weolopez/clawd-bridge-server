import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const PORT = 8082;
const CLAWDBOT_URL = "http://localhost:3000/v1/messages"; // Placeholder for actual Clawdbot internal API

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Clawd-Token",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (url.pathname === "/message" && request.method === "POST") {
    try {
      const body = await request.json();
      const { message, sessionId } = body;

      console.log(`[Bridge Server] Message for session ${sessionId}: ${message}`);

      // Here we will eventually call the Clawdbot API
      // For now, we simulate a response
      return new Response(JSON.stringify({
        reply: `Archie received your message: "${message}". The bridge is almost complete!`,
        sessionId: sessionId
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }

  return new Response("Not Found", { status: 404, headers: corsHeaders });
}

console.log(`Archie Bridge Server running on http://localhost:${PORT}`);
serve(handleRequest, { port: PORT });
