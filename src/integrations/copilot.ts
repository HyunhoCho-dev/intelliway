/**
 * copilot.ts — GitHub Copilot API integration
 *
 * Implements the same Device Authorization Grant (OAuth 2.0) flow
 * used by OpenClaw to authenticate with GitHub and obtain a
 * GitHub Copilot API token.  Supports concurrent requests from
 * all three agents via a single shared token that is automatically
 * refreshed before expiry.
 */

export interface CopilotConfig {
  githubClientId: string;
  /** Pre-existing token stored in KV; may be empty on first boot. */
  storedToken?: string;
  /** Cloudflare KV namespace used to persist the token. */
  kv: KVNamespace;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CopilotResponse {
  content: string;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface AccessTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface CopilotTokenResponse {
  token: string;
  expires_at: number;
}

const GITHUB_API = "https://api.github.com";
const COPILOT_API = "https://api.githubcopilot.com";
const KV_KEY_GITHUB_TOKEN = "copilot:github_token";
const KV_KEY_COPILOT_TOKEN = "copilot:copilot_token";
const KV_KEY_COPILOT_EXPIRES = "copilot:copilot_token_expires";

/**
 * Primary models tried in order.  Falls back to the next if the
 * previous returns an error.
 */
const MODEL_PRIORITY = [
  "github-copilot/gpt-4o",
  "github-copilot/claude-sonnet-4.5",
  "github-copilot/claude-opus-4.5",
  "gpt-4o",
];

// ─────────────────────────────────────────────────────────────────────────────
// Device Login Flow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Step 1 — Request a device code from GitHub.
 * Returns the object the caller should display to the user (user_code +
 * verification_uri) and the opaque device_code needed for polling.
 */
export async function requestDeviceCode(clientId: string): Promise<DeviceCodeResponse> {
  const res = await fetch(`${GITHUB_API}/login/device/code`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, scope: "read:user" }),
  });
  if (!res.ok) {
    throw new Error(`GitHub device code request failed: ${res.status} ${await res.text()}`);
  }
  return res.json<DeviceCodeResponse>();
}

/**
 * Step 2 — Poll for the access token after the user has authenticated.
 * Returns null if still pending, or the token string on success.
 */
export async function pollForAccessToken(
  clientId: string,
  deviceCode: string,
): Promise<string | null> {
  const res = await fetch(`${GITHUB_API}/login/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub token poll failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json<AccessTokenResponse>();
  if (data.error === "authorization_pending" || data.error === "slow_down") {
    return null;
  }
  if (data.error) {
    throw new Error(`GitHub token error: ${data.error} — ${data.error_description}`);
  }
  if (!data.access_token) {
    throw new Error("GitHub returned no access_token");
  }
  return data.access_token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Copilot token exchange
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exchange a GitHub OAuth token for a short-lived GitHub Copilot API token.
 */
async function exchangeForCopilotToken(githubToken: string): Promise<CopilotTokenResponse> {
  const res = await fetch(`${GITHUB_API}/copilot_internal/v2/token`, {
    headers: {
      Authorization: `token ${githubToken}`,
      "Editor-Version": "intelliway/1.0",
      "Editor-Plugin-Version": "intelliway-agent/1.0",
    },
  });
  if (!res.ok) {
    throw new Error(`Copilot token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json<CopilotTokenResponse>();
}

// ─────────────────────────────────────────────────────────────────────────────
// Token management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a valid Copilot API token, refreshing it from KV or re-exchanging
 * with GitHub if it is missing or about to expire.
 */
export async function getValidCopilotToken(kv: KVNamespace): Promise<string> {
  const expiresStr = await kv.get(KV_KEY_COPILOT_EXPIRES);
  const token = await kv.get(KV_KEY_COPILOT_TOKEN);

  if (token && expiresStr) {
    const expiresAt = parseInt(expiresStr, 10);
    // Refresh 60 s before actual expiry.
    if (Date.now() / 1000 < expiresAt - 60) {
      return token;
    }
  }

  // Need to re-exchange with the stored GitHub token.
  const githubToken = await kv.get(KV_KEY_GITHUB_TOKEN);
  if (!githubToken) {
    throw new Error(
      "No GitHub token found.  Run the Device Login flow to authenticate.",
    );
  }

  const { token: newToken, expires_at } = await exchangeForCopilotToken(githubToken);
  await kv.put(KV_KEY_COPILOT_TOKEN, newToken);
  await kv.put(KV_KEY_COPILOT_EXPIRES, String(expires_at));
  return newToken;
}

/**
 * Store a freshly obtained GitHub OAuth token in KV so it can later be used
 * for Copilot token exchange.
 */
export async function storeGitHubToken(kv: KVNamespace, token: string): Promise<void> {
  await kv.put(KV_KEY_GITHUB_TOKEN, token);
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat completion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a chat-completion request to the GitHub Copilot API.
 * Automatically retries with fallback models if the primary model fails.
 */
export async function copilotChat(
  kv: KVNamespace,
  messages: ChatMessage[],
  modelOverride?: string,
): Promise<CopilotResponse> {
  const apiToken = await getValidCopilotToken(kv);
  const models = modelOverride ? [modelOverride, ...MODEL_PRIORITY] : MODEL_PRIORITY;

  let lastError: Error | null = null;
  for (const model of models) {
    try {
      const res = await fetch(`${COPILOT_API}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
          "Editor-Version": "intelliway/1.0",
          "Editor-Plugin-Version": "intelliway-agent/1.0",
          "Copilot-Integration-Id": "intelliway",
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 4096,
          temperature: 0.7,
          stream: false,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        lastError = new Error(`Copilot API error (${model}): ${res.status} ${text}`);
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await res.json<any>();
      return {
        content: data.choices[0].message.content as string,
        model: data.model as string,
        usage: data.usage as CopilotResponse["usage"],
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error("All Copilot models failed");
}
