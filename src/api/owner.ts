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
} from "../integrations/copilot.js";

// ─────────────────────────────────────────────────────────────────────────────
// Auth middleware
// ─────────────────────────────────────────────────────────────────────────────

function isAuthorised(req: Request, env: Env): boolean {
  if (!env.OWNER_API_SECRET) return true; // dev mode — no auth
  const secret = req.headers.get("X-Owner-Secret");
  return secret === env.OWNER_API_SECRET;
}

function unauthorised(): Response {
  return new Response(JSON.stringify({ error: "Unauthorised" }), {
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
  if (!isAuthorised(req, env)) return unauthorised();

  const body = await req.json<{ command?: string }>().catch(() => ({ command: undefined }));
  if (!body.command) {
    return json({ error: "Missing 'command' field in request body." }, 400);
  }

  const summary = await handleOwnerCommand(env, body.command);
  return json({ ok: true, summary });
}

/** GET /status — return all tasks with their current status. */
export async function handleGetStatus(_req: Request, env: Env): Promise<Response> {
  if (!isAuthorised(_req, env)) return unauthorised();

  const tasks = await listAllTasks(env.TASK_QUEUE);
  return json({ tasks });
}

/** GET /report — generate a narrative report of recent work. */
export async function handleGetReport(_req: Request, env: Env): Promise<Response> {
  if (!isAuthorised(_req, env)) return unauthorised();

  // First drain the manager's inbox so the report is up to date.
  const updates = await processInbox(env);
  const report = await generateReport(env);
  return json({ updates, report });
}

/** POST /chat — real-time conversational chat with the manager. */
export async function handlePostChat(req: Request, env: Env): Promise<Response> {
  if (!isAuthorised(req, env)) return unauthorised();

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

/** POST /auth/device — initiate GitHub Copilot Device Login. */
export async function handleAuthDevice(_req: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID) {
    return json({ error: "GITHUB_CLIENT_ID is not configured." }, 500);
  }
  const deviceCode = await requestDeviceCode(env.GITHUB_CLIENT_ID);
  return json({
    user_code: deviceCode.user_code,
    verification_uri: deviceCode.verification_uri,
    device_code: deviceCode.device_code,
    expires_in: deviceCode.expires_in,
    interval: deviceCode.interval,
    instructions: `Open ${deviceCode.verification_uri} and enter code: ${deviceCode.user_code}`,
  });
}

/** POST /auth/device/complete — exchange device code for GitHub token. */
export async function handleAuthDeviceComplete(req: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID) {
    return json({ error: "GITHUB_CLIENT_ID is not configured." }, 500);
  }
  const body = await req.json<{ device_code?: string }>().catch(() => ({ device_code: undefined }));
  if (!body.device_code) {
    return json({ error: "Missing 'device_code' field." }, 400);
  }

  const token = await pollForAccessToken(env.GITHUB_CLIENT_ID, body.device_code);
  if (!token) {
    return json({ ok: false, message: "Still pending — please try again shortly." });
  }

  await storeGitHubToken(env.TASK_QUEUE, token);
  return json({ ok: true, message: "GitHub Copilot authenticated successfully." });
}
