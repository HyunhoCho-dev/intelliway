/**
 * developer.ts — Developer agent
 *
 * Responsibilities:
 *   - Read task assignments from the message bus.
 *   - Use GitHub Copilot to write code, review pull requests, and
 *     design software architectures.
 *   - Post results (code snippets, implementation plans) back to the
 *     manager via the message bus.
 */

import { copilotChat, type ChatMessage } from "../integrations/copilot.js";
import { drainInbox, sendMessage } from "../core/message-bus.js";
import { updateTaskStatus } from "../core/task-queue.js";
import { memGet, memSet } from "../core/memory.js";
import type { Env } from "./manager.js";

const SYSTEM_PROMPT = `You are the Developer at Intelliway, an autonomous AI company.
Your expertise covers:
- AI/ML model implementation (PyTorch, TensorFlow, JAX, Hugging Face).
- Full-stack web development (TypeScript, React, Cloudflare Workers).
- DevOps and CI/CD pipelines (GitHub Actions, Cloudflare, Docker).
- Code review, refactoring, and performance optimisation.
- Clean, well-documented, production-ready code.

When asked to complete a coding task:
1. Understand the requirements thoroughly.
2. Plan the implementation before writing code.
3. Write clean, typed, documented code.
4. Include usage examples or test cases where appropriate.
5. Note any potential issues, edge cases, or follow-up tasks.

Always format code blocks with the appropriate language tag.`;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main developer loop — called on every scheduled or triggered invocation.
 */
export async function runDeveloper(env: Env): Promise<void> {
  const messages = await drainInbox(env.MESSAGE_BUS, "developer");

  await Promise.all(
    messages
      .filter((m) => m.type === "task_assignment")
      .map((m) => handleTask(env, m.payload, m.taskId)),
  );
}

async function handleTask(
  env: Env,
  payloadJson: string,
  taskId: string | undefined,
): Promise<void> {
  if (!taskId) return;

  let task: { title: string; description: string };
  try {
    task = JSON.parse(payloadJson) as { title: string; description: string };
  } catch {
    await sendMessage(
      env.MESSAGE_BUS,
      "developer",
      "manager",
      "task_error",
      "Invalid task payload",
      taskId,
    );
    return;
  }

  await updateTaskStatus(env.TASK_QUEUE, taskId, "running");

  try {
    const result = await develop(env, task.title, task.description);
    await memSet(
      env.AGENT_MEMORY,
      "developer",
      `result:${taskId}`,
      result,
      60 * 60 * 24 * 30,
    );
    await sendMessage(
      env.MESSAGE_BUS,
      "developer",
      "manager",
      "task_result",
      result,
      taskId,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await sendMessage(
      env.MESSAGE_BUS,
      "developer",
      "manager",
      "task_error",
      errMsg,
      taskId,
    );
  }
}

/**
 * Core development function:
 *   1. Retrieve past context from memory.
 *   2. Call Copilot to generate code / implementation plan.
 *   3. Persist key outputs to memory.
 */
async function develop(env: Env, title: string, description: string): Promise<string> {
  const pastContext = (await memGet(env.AGENT_MEMORY, "developer", "context")) ?? "";

  const userPrompt = `Development task: ${title}

${description}

${pastContext ? `Previous context:\n${pastContext}` : ""}

Produce a complete implementation with explanations.`;

  const history: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];

  const response = await copilotChat(env.AGENT_MEMORY, history);

  // Update developer context with latest work.
  await memSet(
    env.AGENT_MEMORY,
    "developer",
    "context",
    `[${new Date().toISOString()}] ${title}: ${response.content.slice(0, 500)}`,
    60 * 60 * 24 * 7,
  );

  return response.content;
}
