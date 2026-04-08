/**
 * researcher.ts — Researcher agent
 *
 * Responsibilities:
 *   - Read task assignments from the message bus.
 *   - Use GitHub Copilot to research AI topics, summarise papers, and
 *     design experiments.
 *   - Optionally launch Kaggle kernels for data exploration.
 *   - Post results back to the manager via the message bus.
 */

import { copilotChat, type ChatMessage } from "../integrations/copilot.js";
import { drainInbox, sendMessage } from "../core/message-bus.js";
import { updateTaskStatus } from "../core/task-queue.js";
import { memGet, memSet } from "../core/memory.js";
import {
  searchDatasets,
  pushKernel,
  waitForKernel,
  getKernelOutput,
} from "../integrations/kaggle.js";
import type { Env } from "./manager.js";

const SYSTEM_PROMPT = `You are the Researcher at Intelliway, an autonomous AI company.
Your expertise covers:
- State-of-the-art AI/ML research (papers, benchmarks, architectures).
- Dataset discovery and analysis using Kaggle.
- Experiment design and hypothesis formulation.
- Writing clear, actionable technical reports.

When asked to complete a task:
1. Think step-by-step about what information is needed.
2. Produce a thorough but concise written report.
3. If code is required for analysis, write clean, documented Python.
4. Cite sources or datasets when possible.

Always end your response with a brief SUMMARY section.`;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main researcher loop — called on every scheduled or triggered invocation.
 */
export async function runResearcher(env: Env): Promise<void> {
  const messages = await drainInbox(env.MESSAGE_BUS, "researcher");

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
      "researcher",
      "manager",
      "task_error",
      "Invalid task payload",
      taskId,
    );
    return;
  }

  // Mark task as running.
  await updateTaskStatus(env.TASK_QUEUE, taskId, "running");

  try {
    const result = await research(env, task.title, task.description);
    await memSet(
      env.AGENT_MEMORY,
      "researcher",
      `result:${taskId}`,
      result,
      60 * 60 * 24 * 30,
    );
    await sendMessage(
      env.MESSAGE_BUS,
      "researcher",
      "manager",
      "task_result",
      result,
      taskId,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await sendMessage(
      env.MESSAGE_BUS,
      "researcher",
      "manager",
      "task_error",
      errMsg,
      taskId,
    );
  }
}

/**
 * Core research function:
 *   1. Fetch relevant memory/context.
 *   2. Optionally search Kaggle datasets.
 *   3. Call Copilot to generate the research report.
 */
async function research(env: Env, title: string, description: string): Promise<string> {
  // Build context from past memory.
  const pastContext = (await memGet(env.AGENT_MEMORY, "researcher", "context")) ?? "";

  // If Kaggle credentials are available, search for relevant datasets.
  let datasetInfo = "";
  if (env.KAGGLE_USERNAME && env.KAGGLE_KEY) {
    try {
      const datasets = await searchDatasets(
        { username: env.KAGGLE_USERNAME, apiKey: env.KAGGLE_KEY },
        title,
        5,
      );
      if (datasets.length > 0) {
        datasetInfo = `\n\nRelevant Kaggle datasets:\n${datasets
          .map((d) => `- ${d.title} (${d.ref}) — ${d.size}, ⬇${d.downloadCount}`)
          .join("\n")}`;
      }
    } catch {
      // Kaggle search failure is non-fatal.
    }
  }

  const userPrompt = `Research task: ${title}

${description}${datasetInfo}

${pastContext ? `Previous context:\n${pastContext}` : ""}

Produce a comprehensive research report.`;

  const history: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];

  const response = await copilotChat(env.TASK_QUEUE, history);

  // Update researcher context with key findings.
  await memSet(
    env.AGENT_MEMORY,
    "researcher",
    "context",
    `[${new Date().toISOString()}] ${title}: ${response.content.slice(0, 500)}`,
    60 * 60 * 24 * 7,
  );

  return response.content;
}

/**
 * Helper to run a Python experiment on Kaggle and return the output.
 * Exposed for the developer agent to call when needed.
 */
export async function runKaggleExperiment(
  env: Env,
  slug: string,
  title: string,
  code: string,
  datasets: string[] = [],
): Promise<string> {
  if (!env.KAGGLE_USERNAME || !env.KAGGLE_KEY) {
    throw new Error("Kaggle credentials not configured.");
  }
  const config = { username: env.KAGGLE_USERNAME, apiKey: env.KAGGLE_KEY };

  const kernelRef = await pushKernel(config, {
    slug,
    title,
    code,
    datasetDataSources: datasets,
  });

  const status = await waitForKernel(config, kernelRef);
  if (status.status !== "complete") {
    throw new Error(`Kaggle kernel ${kernelRef} ended with status: ${status.status} — ${status.failureMessage ?? ""}`);
  }

  const output = await getKernelOutput(config, kernelRef);
  return output.log || "(no log output)";
}
