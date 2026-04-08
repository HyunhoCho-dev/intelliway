/**
 * index.ts — Cloudflare Worker entry point
 *
 * Handles:
 *   - HTTP requests routed to the owner API
 *   - Scheduled (Cron) invocations that run agent loops
 */

import {
  handlePostTask,
  handleGetStatus,
  handleGetReport,
  handlePostChat,
  handleAuthDevice,
  handleAuthDeviceComplete,
} from "./api/owner.js";
import { runResearcher } from "./agents/researcher.js";
import { runDeveloper } from "./agents/developer.js";
import { processInbox } from "./agents/manager.js";
import type { Env } from "./agents/manager.js";

export type { Env };

// ─────────────────────────────────────────────────────────────────────────────
// HTTP handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  let response: Response;

  try {
    if (method === "POST" && path === "/task") {
      response = await handlePostTask(request, env);
    } else if (method === "GET" && path === "/status") {
      response = await handleGetStatus(request, env);
    } else if (method === "GET" && path === "/report") {
      response = await handleGetReport(request, env);
    } else if (method === "POST" && path === "/chat") {
      response = await handlePostChat(request, env);
    } else if (method === "POST" && path === "/auth/device") {
      response = await handleAuthDevice(request, env);
    } else if (method === "POST" && path === "/auth/device/complete") {
      response = await handleAuthDeviceComplete(request, env);
    } else if (method === "GET" && path === "/") {
      response = new Response(
        JSON.stringify({
          name: "Intelliway",
          version: "1.0.0",
          description: "LLM-based autonomous AI agent company",
          endpoints: [
            "POST /task",
            "GET  /status",
            "GET  /report",
            "POST /chat",
            "POST /auth/device",
            "POST /auth/device/complete",
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } else {
      response = new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    response = new Response(JSON.stringify({ error: "Internal Server Error", message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Attach CORS headers to every real response.
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders())) {
    headers.set(k, v);
  }
  return new Response(response.body, { status: response.status, headers });
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled handler (Cron Triggers)
// ─────────────────────────────────────────────────────────────────────────────

async function handleScheduled(_event: ScheduledController, env: Env): Promise<void> {
  // Run all three agent loops concurrently.
  await Promise.all([
    processInbox(env),   // manager collects results from agents
    runResearcher(env),  // researcher processes its inbox
    runDeveloper(env),   // developer processes its inbox
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker export
// ─────────────────────────────────────────────────────────────────────────────

const worker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    return handleScheduled(event, env);
  },
};

export default worker;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Owner-Secret",
  };
}
