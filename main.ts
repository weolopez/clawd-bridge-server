import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const PORT = 8082;
const CLAWDBOT_URL = "http://127.0.0.1:18789/v1/sessions/agent:main:main/send";
const CLAWDBOT_TOKEN = "3dbbfdf728d955818203dd43754916909269f11f4ad80ede";

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
      const { message } = body;

      console.log(`[Bridge Server] Forwarding message to Clawdbot: ${message}`);

      const response = await fetch(CLAWDBOT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${CLAWDBOT_TOKEN}`
        },
        body: JSON.stringify({ message })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Bridge Server] Clawdbot API error: ${errorText}`);
        return new Response(JSON.stringify({ error: "Failed to communicate with Archie" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const result = await response.json();
      return new Response(JSON.stringify({
        status: "success",
        result
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (err) {
      console.error("[Bridge Server] Internal Error:", err);
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }

  return new Response("Not Found", { status: 404, headers: corsHeaders });
}

console.log(`Archie Bridge Server running on http://localhost:${PORT}`);
serve(handleRequest, { port: PORT });
