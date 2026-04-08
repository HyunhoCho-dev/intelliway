/**
 * memory.ts — Agent long-term memory backed by Cloudflare KV
 *
 * Each agent has a simple key-value store namespaced by role:
 *   mem:<role>:<key>  — arbitrary string value
 *
 * Typical usage: store research summaries, code snippets, context
 * that needs to survive across invocations.
 */

import type { AgentRole } from "./task-queue.js";

/** Write a value to an agent's memory. */
export async function memSet(
  kv: KVNamespace,
  agent: AgentRole,
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<void> {
  const opts = ttlSeconds ? { expirationTtl: ttlSeconds } : undefined;
  await kv.put(`mem:${agent}:${key}`, value, opts);
}

/** Read a value from an agent's memory. Returns null if not found. */
export async function memGet(
  kv: KVNamespace,
  agent: AgentRole,
  key: string,
): Promise<string | null> {
  return kv.get(`mem:${agent}:${key}`);
}

/** Delete a value from an agent's memory. */
export async function memDelete(kv: KVNamespace, agent: AgentRole, key: string): Promise<void> {
  await kv.delete(`mem:${agent}:${key}`);
}

/** List all keys currently stored for an agent (no values). */
export async function memListKeys(kv: KVNamespace, agent: AgentRole): Promise<string[]> {
  const prefix = `mem:${agent}:`;
  const { keys } = await kv.list({ prefix });
  return keys.map((k) => k.name.slice(prefix.length));
}

/** Read all key-value pairs for an agent as a plain object. */
export async function memGetAll(
  kv: KVNamespace,
  agent: AgentRole,
): Promise<Record<string, string>> {
  const keys = await memListKeys(kv, agent);
  const entries = await Promise.all(
    keys.map(async (k) => {
      const v = await memGet(kv, agent, k);
      return [k, v ?? ""] as [string, string];
    }),
  );
  return Object.fromEntries(entries);
}
