/**
 * message-bus.ts — Inter-agent message bus backed by Cloudflare KV
 *
 * Messages are stored per recipient mailbox:
 *   msg:<recipient>:<msgId>  — JSON Message, TTL 24 h
 *
 * Agents poll their inbox (or it is drained by the Worker on each
 * scheduled invocation).
 */

import type { AgentRole } from "./task-queue.js";

export type MessageType =
  | "task_assignment"
  | "task_result"
  | "task_error"
  | "status_update"
  | "owner_command"
  | "owner_reply";

export interface AgentMessage {
  id: string;
  from: AgentRole | "owner";
  to: AgentRole | "owner";
  type: MessageType;
  taskId?: string;
  payload: string;
  createdAt: number;
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Send a message to an agent's (or owner's) inbox. */
export async function sendMessage(
  kv: KVNamespace,
  from: AgentMessage["from"],
  to: AgentMessage["to"],
  type: MessageType,
  payload: string,
  taskId?: string,
): Promise<AgentMessage> {
  const msg: AgentMessage = {
    id: generateId(),
    from,
    to,
    type,
    taskId,
    payload,
    createdAt: Date.now(),
  };
  await kv.put(`msg:${to}:${msg.id}`, JSON.stringify(msg), {
    expirationTtl: 60 * 60 * 24,
  });
  return msg;
}

/** Read all messages in a recipient's inbox (oldest first). */
export async function readMessages(
  kv: KVNamespace,
  recipient: AgentMessage["to"],
): Promise<AgentMessage[]> {
  const { keys } = await kv.list({ prefix: `msg:${recipient}:` });
  const messages: AgentMessage[] = [];
  for (const key of keys) {
    const raw = await kv.get(key.name);
    if (raw) messages.push(JSON.parse(raw) as AgentMessage);
  }
  return messages.sort((a, b) => a.createdAt - b.createdAt);
}

/** Delete a message once it has been processed. */
export async function ackMessage(
  kv: KVNamespace,
  recipient: AgentMessage["to"],
  messageId: string,
): Promise<void> {
  await kv.delete(`msg:${recipient}:${messageId}`);
}

/** Drain all messages for a recipient and return them. */
export async function drainInbox(
  kv: KVNamespace,
  recipient: AgentMessage["to"],
): Promise<AgentMessage[]> {
  const msgs = await readMessages(kv, recipient);
  await Promise.all(msgs.map((m) => ackMessage(kv, recipient, m.id)));
  return msgs;
}
