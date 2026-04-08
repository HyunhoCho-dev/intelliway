/**
 * manager.ts — Manager agent
 *
 * Responsibilities:
 *   1. Receive owner commands and decompose them into sub-tasks.
 *   2. Assign sub-tasks to researcher / developer.
 *   3. Collect results and generate a consolidated report for the owner.
 *   4. Answer direct chat questions from the owner using Copilot.
 */

import { copilotChat, type ChatMessage } from "../integrations/copilot.js";
import { sendMessage, drainInbox } from "../core/message-bus.js";
import {
  createTask,
  updateTaskStatus,
  listAllTasks,
  type Task,
} from "../core/task-queue.js";
import { memGet, memSet } from "../core/memory.js";

export interface Env {
  TASK_QUEUE: KVNamespace;
  AGENT_MEMORY: KVNamespace;
  MESSAGE_BUS: KVNamespace;
  COPILOT_TOKEN?: string;
  KAGGLE_USERNAME?: string;
  KAGGLE_KEY?: string;
  OWNER_API_SECRET?: string;
}

const SYSTEM_PROMPT = `You are the Manager of Intelliway, an autonomous AI company.
Your team consists of:
- researcher: conducts AI research, analyses papers, and designs experiments.
- developer: writes code, builds systems, and manages GitHub repositories.

Your responsibilities:
1. Understand the owner's request and break it into concrete tasks.
2. Decide which agent (researcher / developer) should handle each task.
3. Return a JSON action plan so the system can create tasks automatically.
4. Summarise completed work and report back to the owner clearly and concisely.
5. Answer direct questions from the owner when no sub-task is required.

When creating an action plan, reply ONLY with valid JSON in this shape:
{
  "tasks": [
    { "assignedTo": "researcher" | "developer", "title": "...", "description": "..." }
  ],
  "summary": "Brief explanation of the plan"
}
If the owner is just asking a question (no action needed), reply in plain text.`;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process an owner command:
 *  - Consult Copilot to create a task plan.
 *  - Persist tasks to the queue.
 *  - Send assignment messages to agents.
 *  - Return a human-readable summary.
 */
export async function handleOwnerCommand(
  env: Env,
  command: string,
): Promise<string> {
  const historyRaw = await memGet(env.AGENT_MEMORY, "manager", "chat_history");
  const history: ChatMessage[] = historyRaw ? (JSON.parse(historyRaw) as ChatMessage[]) : [];

  history.push({ role: "user", content: command });

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.slice(-20), // keep last 20 turns for context
  ];

  const response = await copilotChat(env.AGENT_MEMORY, messages);
  const reply = response.content;

  history.push({ role: "assistant", content: reply });
  await memSet(
    env.AGENT_MEMORY,
    "manager",
    "chat_history",
    JSON.stringify(history),
    60 * 60 * 24 * 7,
  );

  // Try to parse as action plan.
  try {
    const plan = JSON.parse(reply) as {
      tasks: { assignedTo: "researcher" | "developer"; title: string; description: string }[];
      summary: string;
    };

    if (Array.isArray(plan.tasks)) {
      for (const t of plan.tasks) {
        const task = await createTask(env.TASK_QUEUE, t.assignedTo, t.title, t.description);
        await sendMessage(
          env.MESSAGE_BUS,
          "manager",
          t.assignedTo,
          "task_assignment",
          JSON.stringify(task),
          task.id,
        );
      }
      return plan.summary;
    }
  } catch {
    // Not JSON — plain text answer, return as-is.
  }

  return reply;
}

/**
 * Drain the manager's inbox, process results from agents, and compose
 * a status report.  Called by the Cron trigger and by GET /report.
 */
/** Maximum number of characters shown per update entry in the inbox report. */
const MAX_UPDATE_PREVIEW_LENGTH = 120;
/** Maximum number of characters for a status update preview. */
const MAX_STATUS_PREVIEW_LENGTH = 200;

export async function processInbox(env: Env): Promise<string> {
  const messages = await drainInbox(env.MESSAGE_BUS, "manager");
  const updates: string[] = [];

  for (const msg of messages) {
    if (msg.type === "task_result" && msg.taskId) {
      await updateTaskStatus(env.TASK_QUEUE, msg.taskId, "done", { result: msg.payload });
      updates.push(`✅ [${msg.from}] Task ${msg.taskId} complete: ${msg.payload.slice(0, MAX_UPDATE_PREVIEW_LENGTH)}`);
    } else if (msg.type === "task_error" && msg.taskId) {
      await updateTaskStatus(env.TASK_QUEUE, msg.taskId, "failed", { error: msg.payload });
      updates.push(`❌ [${msg.from}] Task ${msg.taskId} failed: ${msg.payload.slice(0, MAX_UPDATE_PREVIEW_LENGTH)}`);
    } else if (msg.type === "status_update") {
      updates.push(`ℹ️ [${msg.from}]: ${msg.payload.slice(0, MAX_STATUS_PREVIEW_LENGTH)}`);
    }
  }

  return updates.length > 0 ? updates.join("\n") : "No new updates.";
}

/**
 * Generate a summary report of all tasks using Copilot.
 */
export async function generateReport(env: Env): Promise<string> {
  const tasks = await listAllTasks(env.TASK_QUEUE);

  const taskSummary = tasks
    .slice(0, 50) // limit context size
    .map(
      (t: Task) =>
        `- [${t.status.toUpperCase()}] (${t.assignedTo}) ${t.title}: ${t.result ?? t.error ?? "in progress"}`,
    )
    .join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Please summarise the following task list for the owner in a clear, concise report:\n\n${taskSummary}`,
    },
  ];

  const response = await copilotChat(env.AGENT_MEMORY, messages);
  return response.content;
}
