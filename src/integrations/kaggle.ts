/**
 * kaggle.ts — Kaggle API integration
 *
 * Provides helpers to:
 *   - Search / list datasets
 *   - Push a kernel (notebook) to Kaggle and poll for completion
 *   - Retrieve kernel output
 *
 * Kaggle's public REST API: https://www.kaggle.com/api/v1
 * Auth: HTTP Basic (username + API key).
 */

const KAGGLE_API = "https://www.kaggle.com/api/v1";

export interface KaggleConfig {
  username: string;
  apiKey: string;
}

export interface KaggleDataset {
  ref: string;
  title: string;
  size: string;
  lastUpdated: string;
  downloadCount: number;
  voteCount: number;
  usabilityRating: number;
}

export interface KernelPushRequest {
  /** Slug for the kernel, e.g. "my-experiment" */
  slug: string;
  /** Display title */
  title: string;
  /** Python source code to execute */
  code: string;
  /** Language: "python" | "r" | "rmarkdown" */
  language?: string;
  /** Kernel type: "script" | "notebook" */
  kernelType?: string;
  /** Whether to enable internet access */
  enableInternet?: boolean;
  /** List of dataset references to attach, e.g. ["owner/dataset-name"] */
  datasetDataSources?: string[];
  /** GPU or CPU */
  accelerator?: "gpu" | "cpu" | "tpu";
}

export interface KernelStatus {
  ref: string;
  title: string;
  status: "queued" | "running" | "complete" | "error" | "cancel_requested" | "cancelled";
  failureMessage?: string;
}

export interface KernelOutput {
  files: { name: string; size: number; url: string }[];
  log: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function authHeader(config: KaggleConfig): string {
  const encoded = btoa(`${config.username}:${config.apiKey}`);
  return `Basic ${encoded}`;
}

async function kaggleFetch(
  config: KaggleConfig,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(`${KAGGLE_API}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(config),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// Datasets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Search for public Kaggle datasets.
 * Returns up to `maxItems` (default 10) results.
 */
export async function searchDatasets(
  config: KaggleConfig,
  query: string,
  maxItems = 10,
): Promise<KaggleDataset[]> {
  const params = new URLSearchParams({ search: query, page: "1", pageSize: String(maxItems) });
  const res = await kaggleFetch(config, `/datasets/list?${params}`);
  if (!res.ok) {
    throw new Error(`Kaggle dataset search failed: ${res.status} ${await res.text()}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json<any[]>();
  return data.map((d) => ({
    ref: d.ref as string,
    title: d.title as string,
    size: d.totalBytes ? `${Math.round(d.totalBytes / 1024 / 1024)} MB` : "unknown",
    lastUpdated: d.lastUpdated as string,
    downloadCount: d.downloadCount as number,
    voteCount: d.voteCount as number,
    usabilityRating: d.usabilityRating as number,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Kernels
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Push a Python script as a Kaggle kernel.
 * Returns the full slug (`{username}/{slug}`) that can be used for polling.
 */
export async function pushKernel(
  config: KaggleConfig,
  req: KernelPushRequest,
): Promise<string> {
  const payload = {
    newTitle: req.title,
    text: req.code,
    language: req.language ?? "python",
    kernelType: req.kernelType ?? "script",
    isPrivate: true,
    enableGpu: req.accelerator === "gpu",
    enableTpu: req.accelerator === "tpu",
    enableInternet: req.enableInternet ?? true,
    datasetDataSources: req.datasetDataSources ?? [],
    competitionDataSources: [],
    kernelDataSources: [],
    categoryIds: [],
  };

  const res = await kaggleFetch(config, "/kernels/push", {
    method: "POST",
    body: JSON.stringify({
      slug: req.slug,
      new_script: payload,
    }),
  });

  if (!res.ok) {
    throw new Error(`Kaggle kernel push failed: ${res.status} ${await res.text()}`);
  }

  return `${config.username}/${req.slug}`;
}

/**
 * Get the current execution status of a kernel.
 */
export async function getKernelStatus(
  config: KaggleConfig,
  kernelRef: string,
): Promise<KernelStatus> {
  const [owner, slug] = kernelRef.split("/");
  const res = await kaggleFetch(config, `/kernels/${owner}/${slug}/status`);
  if (!res.ok) {
    throw new Error(`Kaggle kernel status failed: ${res.status} ${await res.text()}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json<any>();
  return {
    ref: kernelRef,
    title: data.title as string,
    status: data.status as KernelStatus["status"],
    failureMessage: data.failureMessage as string | undefined,
  };
}

/**
 * Poll a kernel until it reaches a terminal state (complete / error / cancelled).
 * `intervalMs` defaults to 10 000 (10 s); `maxAttempts` defaults to 60 (10 min).
 *
 * Note: Cloudflare Workers have a maximum CPU time per request; use this only
 * inside a Durable Object or from a Cron trigger, never in a hot-path handler.
 */
export async function waitForKernel(
  config: KaggleConfig,
  kernelRef: string,
  intervalMs = 10_000,
  maxAttempts = 60,
): Promise<KernelStatus> {
  const terminal: KernelStatus["status"][] = ["complete", "error", "cancelled"];
  for (let i = 0; i < maxAttempts; i++) {
    const status = await getKernelStatus(config, kernelRef);
    if (terminal.includes(status.status)) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return getKernelStatus(config, kernelRef);
}

/**
 * Retrieve the output files and log of a completed kernel.
 */
export async function getKernelOutput(
  config: KaggleConfig,
  kernelRef: string,
): Promise<KernelOutput> {
  const [owner, slug] = kernelRef.split("/");
  const res = await kaggleFetch(config, `/kernels/${owner}/${slug}/output`);
  if (!res.ok) {
    throw new Error(`Kaggle kernel output failed: ${res.status} ${await res.text()}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json<any>();
  return {
    files: (data.files ?? []) as KernelOutput["files"],
    log: (data.log ?? "") as string,
  };
}
