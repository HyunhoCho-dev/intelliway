/**
 * owner.ts — Owner API route handlers
 *
 * Routes:
 *   POST /task    — submit a new task / command to the manager
 *   GET  /status  — list all tasks and their current status
 *   GET  /report  — ask the manager to generate a summary report
 *   POST /chat    — direct conversational chat with the manager
 *
 * All routes require the `X-Owner-Secret` header to match the
 * `OWNER_API_SECRET` environment variable (or OWNER_API_SECRET KV
 * value).  If OWNER_API_SECRET is not set, auth is disabled (dev mode).
 */

import {
  handleOwnerCommand,
  processInbox,
  generateReport,
  type Env,
} from "../agents/manager.js";
import { listAllTasks } from "../core/task-queue.js";
import {
  requestDeviceCode,
  pollForAccessToken,
  storeGitHubToken,
  storePendingDeviceCode,
  getPendingDeviceCode,
} from "../integrations/copilot.js";

// ─────────────────────────────────────────────────────────────────────────────
// Auth middleware
// ─────────────────────────────────────────────────────────────────────────────

function isAuthorized(req: Request, env: Env): boolean {
  if (!env.OWNER_API_SECRET) return true; // dev mode — no auth
  const secret = req.headers.get("X-Owner-Secret");
  return secret === env.OWNER_API_SECRET;
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handlers
// ─────────────────────────────────────────────────────────────────────────────

/** POST /task — submit a command to the manager agent. */
export async function handlePostTask(req: Request, env: Env): Promise<Response> {
  if (!isAuthorized(req, env)) return unauthorized();

  const body = await req.json<{ command?: string }>().catch(() => ({ command: undefined }));
  if (!body.command) {
    return json({ error: "Missing 'command' field in request body." }, 400);
  }

  const summary = await handleOwnerCommand(env, body.command);
  return json({ ok: true, summary });
}

/** GET /status — return all tasks with their current status. */
export async function handleGetStatus(_req: Request, env: Env): Promise<Response> {
  if (!isAuthorized(_req, env)) return unauthorized();

  const tasks = await listAllTasks(env.TASK_QUEUE);
  return json({ tasks });
}

/** GET /report — generate a narrative report of recent work. */
export async function handleGetReport(_req: Request, env: Env): Promise<Response> {
  if (!isAuthorized(_req, env)) return unauthorized();

  // First drain the manager's inbox so the report is up to date.
  const updates = await processInbox(env);
  const report = await generateReport(env);
  return json({ updates, report });
}

/** POST /chat — real-time conversational chat with the manager. */
export async function handlePostChat(req: Request, env: Env): Promise<Response> {
  if (!isAuthorized(req, env)) return unauthorized();

  const body = await req.json<{ message?: string }>().catch(() => ({ message: undefined }));
  if (!body.message) {
    return json({ error: "Missing 'message' field in request body." }, 400);
  }

  const reply = await handleOwnerCommand(env, body.message);
  return json({ reply });
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth setup routes (Device Login Flow)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /auth/start — initiate GitHub Copilot Device Login.
 *
 * Uses GitHub's public CLI Client ID (no OAuth App required).
 * Returns the user_code and verification URL to display to the operator.
 * The device_code is stored in KV so /auth/status can poll it.
 */
export async function handleAuthStart(_req: Request, env: Env): Promise<Response> {
  const deviceCode = await requestDeviceCode();
  await storePendingDeviceCode(env.AGENT_MEMORY, deviceCode.device_code, deviceCode.expires_in);
  return json({
    code: deviceCode.user_code,
    url: deviceCode.verification_uri,
    instructions: `브라우저에서 ${deviceCode.verification_uri} 접속 후 코드 ${deviceCode.user_code} 입력하세요`,
  });
}

/**
 * GET /auth/status — poll whether the user has completed authentication.
 *
 * Returns { authenticated: true } once the GitHub token is obtained and
 * stored.  Returns { authenticated: false, pending: true } while still
 * waiting.
 */
export async function handleAuthStatus(_req: Request, env: Env): Promise<Response> {
  const deviceCode = await getPendingDeviceCode(env.AGENT_MEMORY);
  if (!deviceCode) {
    return json({ authenticated: false, message: "No pending auth session.  Call /auth/start first." });
  }

  const token = await pollForAccessToken(deviceCode);
  if (!token) {
    return json({ authenticated: false, pending: true, message: "Waiting for user to enter code in browser." });
  }

  await storeGitHubToken(env.AGENT_MEMORY, token);
  return json({ authenticated: true, message: "GitHub Copilot authenticated successfully." });
}
