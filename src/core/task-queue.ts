/**
 * task-queue.ts — Task queue backed by Cloudflare KV
 *
 * Tasks flow:  pending → running → done / failed
 *
 * KV key layout:
 *   task:pending:<taskId>   — JSON Task, TTL 7 days
 *   task:running:<taskId>   — JSON Task, TTL 2 days
 *   task:done:<taskId>      — JSON Task, TTL 30 days
 *   task:failed:<taskId>    — JSON Task, TTL 30 days
 *   task:index              — JSON string[] of all known task IDs
 */

export type TaskStatus = "pending" | "running" | "done" | "failed";
export type AgentRole = "manager" | "researcher" | "developer";

export interface Task {
  id: string;
  status: TaskStatus;
  assignedTo: AgentRole;
  title: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  result?: string;
  error?: string;
  /** Optional reference to a Kaggle kernel slug */
  kaggleKernelRef?: string;
}

function kvKey(status: TaskStatus, id: string): string {
  return `task:${status}:${id}`;
}

/** Generate a short unique ID. */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────

export async function createTask(
  kv: KVNamespace,
  assignedTo: AgentRole,
  title: string,
  description: string,
): Promise<Task> {
  const task: Task = {
    id: generateId(),
    status: "pending",
    assignedTo,
    title,
    description,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await kv.put(kvKey("pending", task.id), JSON.stringify(task), {
    expirationTtl: 60 * 60 * 24 * 7,
  });
  await _addToIndex(kv, task.id);
  return task;
}

export async function getTask(kv: KVNamespace, taskId: string): Promise<Task | null> {
  for (const status of ["pending", "running", "done", "failed"] as TaskStatus[]) {
    const raw = await kv.get(kvKey(status, taskId));
    if (raw) return JSON.parse(raw) as Task;
  }
  return null;
}

export async function updateTaskStatus(
  kv: KVNamespace,
  taskId: string,
  newStatus: TaskStatus,
  extra?: Partial<Pick<Task, "result" | "error" | "kaggleKernelRef">>,
): Promise<Task | null> {
  const task = await getTask(kv, taskId);
  if (!task) return null;

  const oldStatus = task.status;
  if (oldStatus !== newStatus) {
    await kv.delete(kvKey(oldStatus, taskId));
  }

  const updated: Task = {
    ...task,
    ...extra,
    status: newStatus,
    updatedAt: Date.now(),
  };

  const ttl =
    newStatus === "done" || newStatus === "failed"
      ? 60 * 60 * 24 * 30
      : newStatus === "running"
        ? 60 * 60 * 24 * 2
        : 60 * 60 * 24 * 7;

  await kv.put(kvKey(newStatus, taskId), JSON.stringify(updated), { expirationTtl: ttl });
  return updated;
}

export async function listTasksByStatus(
  kv: KVNamespace,
  status: TaskStatus,
): Promise<Task[]> {
  const { keys } = await kv.list({ prefix: `task:${status}:` });
  const tasks: Task[] = [];
  for (const key of keys) {
    const raw = await kv.get(key.name);
    if (raw) tasks.push(JSON.parse(raw) as Task);
  }
  return tasks.sort((a, b) => a.createdAt - b.createdAt);
}

export async function listAllTasks(kv: KVNamespace): Promise<Task[]> {
  const all: Task[] = [];
  for (const status of ["pending", "running", "done", "failed"] as TaskStatus[]) {
    all.push(...(await listTasksByStatus(kv, status)));
  }
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

async function _addToIndex(kv: KVNamespace, taskId: string): Promise<void> {
  const raw = await kv.get("task:index");
  const index: string[] = raw ? (JSON.parse(raw) as string[]) : [];
  if (!index.includes(taskId)) {
    index.push(taskId);
    await kv.put("task:index", JSON.stringify(index));
  }
}
