/**
 * Client for the "Ask OneLens" Fabric Data Agent's native MCP endpoint.
 *
 * The Rayfin auth SDK (`@microsoft/rayfin-auth-provider-fabric`) mints its own
 * JWT for Rayfin's own GraphQL API (see `Auth.getJwks()`/`createSessionFromTokenResponse`
 * in `@microsoft/rayfin-auth`) — it is NOT a Microsoft Entra ID token and cannot
 * be reused for any Microsoft-audience API. To call the Data Agent's MCP
 * endpoint we need a genuine Entra token for `https://api.fabric.microsoft.com`,
 * so this module runs a small, separate MSAL.js instance against the SAME
 * Fabric SSO app registration used for sign-in (now also granted the
 * `Item.Read.All` / `Item.Execute.All` delegated Power BI Service permissions).
 *
 * This is not a workaround — it's the same pattern Microsoft's own reference
 * Rayfin app uses. `pbi-fixer` (github.com/microsoft/awesome-rayfin) documents
 * this exact architecture: "The browser signs the user in with MSAL and
 * acquires a Power BI service token... That same token is used both to
 * invoke [its backend] and... call the Fabric REST API on the user's behalf."
 * Two separate sign-ins (Rayfin's own broker + this one) is an inherent
 * platform constraint, not an implementation gap.
 *
 * This never touches a client secret — it's a public SPA client using the
 * standard MSAL browser flow: a cached-account silent refresh when possible,
 * a one-time interactive popup otherwise. Deliberately does NOT use MSAL's
 * `ssoSilent` (hidden-iframe SSO) — it's prone to a slow, ~5-10s timeout
 * whenever there's no usable third-party-cookie session, which is the norm
 * the first time a new scope is requested. See `trySilent()` below.
 *
 * Cache is `localStorage` (not `sessionStorage`) so the one-time popup
 * consent persists across tabs and browser restarts — the user should only
 * ever see it once per browser profile, not once per session.
 *
 * The popup's `redirectUri` points at a dedicated static page
 * (`/auth-redirect.html`), NOT the SPA root. msal-browser 4.x+ needs the
 * popup to report its result back to the main window over BroadcastChannel
 * (the "redirect bridge" — required because Cross-Origin-Opener-Policy
 * increasingly prevents the older `window.opener`/`popupWindow.location`
 * polling approach from working). Pointing the popup at the full React app
 * instead of a minimal bridge page means the bridge script never runs (the
 * app has no idea it's supposed to call it), so `acquireTokenPopup` hangs
 * until it throws `timed_out` with suberror `redirect_bridge_timeout` — this
 * was the actual root cause of a reported `timed_out` error, distinct from
 * the earlier (also real) `ssoSilent` timeout issue. See
 * https://aka.ms/msal.js.errors#timed_out.
 */
import { PublicClientApplication, type AccountInfo } from '@azure/msal-browser';

function requiredConfig(name: string, value: string | undefined): string {
  const configured = value?.trim();
  if (!configured) throw new Error(`${name} environment variable is required for Ask OneLens.`);
  return configured;
}

const TENANT_ID = requiredConfig('VITE_FABRIC_TENANT_ID', import.meta.env.VITE_FABRIC_TENANT_ID);
const CLIENT_ID = requiredConfig(
  'VITE_RAYFIN_FABRIC_SPA_CLIENT_ID',
  import.meta.env.VITE_RAYFIN_FABRIC_SPA_CLIENT_ID || import.meta.env.VITE_FABRIC_SPA_CLIENT_ID,
);
const WORKSPACE_ID = requiredConfig(
  'VITE_RAYFIN_ASKONELENS_WORKSPACE_ID (or VITE_FABRIC_WORKSPACE_ID)',
  import.meta.env.VITE_RAYFIN_ASKONELENS_WORKSPACE_ID
    || import.meta.env.VITE_ASKONELENS_WORKSPACE_ID
    || import.meta.env.VITE_FABRIC_WORKSPACE_ID,
);
const DATA_AGENT_ID = requiredConfig(
  'VITE_RAYFIN_ASKONELENS_AGENT_ID',
  import.meta.env.VITE_RAYFIN_ASKONELENS_AGENT_ID || import.meta.env.VITE_ASKONELENS_AGENT_ID,
);

const FABRIC_SCOPES = ['https://api.fabric.microsoft.com/.default'];
export function dataAgentMcpUrl(workspaceId: string, dataAgentId: string): string {
  return `https://api.fabric.microsoft.com/v1/mcp/workspaces/${workspaceId}/dataagents/${dataAgentId}/agent`;
}
const MCP_URL = dataAgentMcpUrl(WORKSPACE_ID, DATA_AGENT_ID);
const MCP_PROTOCOL_VERSION = '2024-11-05';
const MCP_TIMEOUT_MS = 90_000;

let msal: PublicClientApplication | undefined;
let msalInit: Promise<void> | undefined;
let activeAccount: AccountInfo | undefined;
let tokenPromise: Promise<string> | undefined;

function getMsal(): PublicClientApplication {
  if (!msal) {
    msal = new PublicClientApplication({
      auth: {
        clientId: CLIENT_ID,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        redirectUri: `${window.location.origin}/auth-redirect.html`,
      },
      cache: { cacheLocation: 'localStorage' },
    });
    msalInit = msal.initialize();
  }
  return msal;
}

/**
 * Try to get a token using only silent methods (cached-account refresh, or an
 * invisible SSO iframe) — never opens a popup. Resolves to `undefined` rather
 * than throwing when silent auth simply isn't available (the normal case the
 * very first time, or when third-party cookies are restricted); that's not an
 * error, it just means an interactive sign-in will be needed later.
 */
/**
 * Try to get a token using only a cached MSAL account — never opens a popup
 * and never attempts `ssoSilent`. Resolves to `undefined` rather than
 * throwing when there's no cached account yet (the normal case the very
 * first time); that's not an error, it just means an interactive sign-in
 * will be needed later.
 *
 * `ssoSilent` is deliberately NOT used here: it works through a hidden
 * iframe that can take the full ~5-10s timeout to fail whenever there's no
 * usable third-party-cookie SSO session (the common case for a scope being
 * requested for the first time) — that's the "taking long to load, then
 * times_out" symptom. Rayfin's own Fabric auth broker
 * (`@microsoft/rayfin-auth-provider-fabric`) avoids this same iframe
 * approach entirely, using a popup/postMessage handoff to a REAL Fabric
 * Portal window instead — skipping `ssoSilent` here mirrors that choice.
 */
async function trySilent(): Promise<string | undefined> {
  const client = getMsal();
  await msalInit;

  const account = activeAccount ?? client.getAllAccounts()[0];
  if (!account) return undefined;
  try {
    const result = await client.acquireTokenSilent({ scopes: FABRIC_SCOPES, account });
    activeAccount = result.account ?? account;
    return result.accessToken;
  } catch {
    return undefined;
  }
}

/**
 * Get a token, opening an interactive popup if a cached account isn't
 * already available.
 *
 * IMPORTANT: browsers only allow `acquireTokenPopup` to succeed when it's
 * called as a result of a direct user gesture (a click) — a popup triggered
 * from a `useEffect`, timer, or other non-gesture context gets silently
 * blocked and the returned promise can hang forever. Only call this from
 * inside a real click handler (e.g. the "Ask" button), never on page load.
 */
async function acquireFabricToken(loginHint?: string): Promise<string> {
  const client = getMsal();
  await msalInit;

  const silent = await trySilent();
  if (silent) return silent;

  const account = activeAccount ?? client.getAllAccounts()[0];
  try {
    const result = await client.acquireTokenPopup({ scopes: FABRIC_SCOPES, loginHint, account });
    activeAccount = result.account ?? activeAccount;
    return result.accessToken;
  } catch (err) {
    // A previously-abandoned popup (e.g. closed without finishing, or from
    // before this de-duplication fix existed) can leave MSAL's own
    // "interaction in progress" flag stuck in storage across reloads.
    // Clear it and retry once rather than surfacing a confusing error forever.
    const code = (err as { errorCode?: string })?.errorCode;
    if (code === 'interaction_in_progress') {
      clearStuckInteractionFlag();
      const result = await client.acquireTokenPopup({ scopes: FABRIC_SCOPES, loginHint, account });
      activeAccount = result.account ?? activeAccount;
      return result.accessToken;
    }
    throw err;
  }
}

/** Remove MSAL's interaction-status markers from browser storage so a stuck
 * "interaction_in_progress" state (left over from an abandoned popup) doesn't
 * block every future attempt. MSAL keeps this transient marker in
 * sessionStorage regardless of the configured `cacheLocation`, so check both. */
function clearStuckInteractionFlag(): void {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      for (const key of Object.keys(storage)) {
        if (key.includes('interaction.status')) storage.removeItem(key);
      }
    } catch {
      // storage may be unavailable (privacy mode, etc.) — nothing to do.
    }
  }
}


/**
 * Acquire a Fabric-scoped delegated token for the signed-in user, silently
 * when possible and via a one-time popup otherwise.
 *
 * Concurrent callers share the SAME in-flight request instead of each
 * starting their own interactive flow — MSAL throws `interaction_in_progress`
 * if a second popup/redirect is started while one is already open.
 */
function getFabricToken(loginHint?: string): Promise<string> {
  if (!tokenPromise) {
    tokenPromise = acquireFabricToken(loginHint).finally(() => {
      tokenPromise = undefined;
    });
  }
  return tokenPromise;
}

/**
 * Try to connect silently on page load using a cached MSAL account (from an
 * earlier question in this same tab). Never opens a popup and never attempts
 * `ssoSilent`, so it always resolves near-instantly — returns `true` if
 * silently connected, `false` if an interactive sign-in will be needed the
 * first time the user actually asks a question (the normal case for a brand
 * new session). Only throws for genuine unexpected failures.
 */
export async function connectAskOneLens(): Promise<boolean> {
  const token = await trySilent();
  return !!token;
}

interface McpToolContent {
  type: string;
  text?: string;
}

interface McpRpcResult {
  id?: number | string | null;
  result?: { tools?: { name: string }[]; content?: McpToolContent[] };
  error?: { message?: string };
}

let cachedSessionId: string | undefined;
let cachedToolName: string | undefined;
let nextRequestId = 1;

async function mcpCall(token: string, method: string, params: unknown): Promise<McpRpcResult> {
  const requestId = nextRequestId++;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'Mcp-Protocol-Version': MCP_PROTOCOL_VERSION,
  };
  if (cachedSessionId) headers['Mcp-Session-Id'] = cachedSessionId;

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Ask OneLens timed out after ${MCP_TIMEOUT_MS / 1000} seconds.`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
  if (!resp.ok) {
    throw new Error(`Ask OneLens request failed (HTTP ${resp.status}).`);
  }

  const sessionId = resp.headers.get('Mcp-Session-Id');
  if (sessionId) cachedSessionId = sessionId;

  const contentType = resp.headers.get('Content-Type') ?? '';
  if (contentType.includes('text/event-stream')) {
    return parseMcpSsePayload(await resp.text(), requestId);
  }
  return (await resp.json()) as McpRpcResult;
}

/** Decode an SSE body according to event framing and return this request's RPC response. */
export function parseMcpSsePayload(payload: string, requestId: number): McpRpcResult {
  const eventPayloads: string[] = [];
  let dataLines: string[] = [];
  const flush = () => {
    if (dataLines.length > 0) eventPayloads.push(dataLines.join('\n'));
    dataLines = [];
  };

  for (const line of payload.split(/\r?\n/)) {
    if (line === '') {
      flush();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  flush();

  const messages = eventPayloads
    .filter((event) => event !== '[DONE]')
    .map((event) => {
      try {
        return JSON.parse(event) as McpRpcResult;
      } catch {
        throw new Error('Ask OneLens returned an invalid event-stream response.');
      }
    });
  let response: McpRpcResult | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].id === requestId) {
      response = messages[index];
      break;
    }
    if (!response && (messages[index].result !== undefined || messages[index].error !== undefined)) {
      response = messages[index];
    }
  }
  if (!response) throw new Error('Ask OneLens returned an empty response.');
  return response;
}

/** Runs the MCP initialize -> tools/list handshake once per page session and
 * caches the discovered tool name (the agent exposes exactly one). */
async function ensureToolName(token: string): Promise<string> {
  if (cachedToolName) return cachedToolName;

  await mcpCall(token, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'governance-onelens-web', version: '1.0' },
  });
  const tools = await mcpCall(token, 'tools/list', {});
  const toolName = tools.result?.tools?.[0]?.name;
  if (!toolName) throw new Error('Ask OneLens has no tools available yet — is the agent published?');
  cachedToolName = toolName;
  return toolName;
}

/** Ask a natural-language question and return the agent's text answer. */
export async function askOneLens(question: string, loginHint?: string): Promise<string> {
  const token = await getFabricToken(loginHint);
  const toolName = await ensureToolName(token);
  const response = await mcpCall(token, 'tools/call', {
    name: toolName,
    arguments: { userQuestion: question },
  });

  if (response.error?.message) throw new Error(response.error.message);
  const text = response.result?.content?.find((c) => c.type === 'text' && c.text)?.text;
  if (text) return text;
  throw new Error('Ask OneLens did not return a text answer.');
}
