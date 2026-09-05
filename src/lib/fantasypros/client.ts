import "server-only";

import { getAccessToken, MCP_ENDPOINT } from "@/lib/fantasypros/oauth";

/**
 * The league's MCP client for FantasyPros.
 *
 * WHY THIS IS HAND-ROLLED AND NOT `@modelcontextprotocol/sdk`.
 *
 * The official SDK is the right default and was the first thing tried. Its
 * `dependencies` are unconditional and include `express`, `hono`,
 * `@hono/node-server`, `cors`, `express-rate-limit` and `raw-body` — the server
 * half of the SDK, none of which a client needs, all of which npm installs and
 * a Next.js function bundle then carries. Adding a web framework and a rate
 * limiter to the production bundle of a draft board, the night before the
 * draft, is not a trade worth making for the client side of Streamable HTTP,
 * which is one POST carrying a JSON-RPC envelope and an answer that is either
 * JSON or a one-event SSE frame. That is the ~80 lines below, and it is a
 * shape that has to be understood to be operated at 8pm on a Saturday anyway.
 *
 * If the transport ever grows a second connection mode this decision should be
 * revisited; the inventory in `docs/FANTASYPROS-MCP.md` records what the server
 * actually speaks so the comparison can be made from evidence.
 *
 * EVERY CALL IS BOUNDED. There is a timeout on the socket and a hard ceiling on
 * the whole exchange, because the failure this module exists to avoid is not a
 * bad answer — it is a draft board that hangs because an upstream API is slow
 * while ten people watch. Callers get an error quickly and fall back; see
 * `@/lib/fantasypros/cache`.
 */

/**
 * The protocol version this client speaks. FantasyPros answered `initialize`
 * with exactly this, so it is what the server negotiated rather than a guess.
 */
const PROTOCOL_VERSION = "2025-06-18";

const CLIENT_INFO = { name: "ultimate-keeper-league", version: "1.0.0" };

/** Well clear of a healthy call (~1.2s observed) and well short of impatience. */
const DEFAULT_TIMEOUT_MS = 12_000;

export type McpToolDescriptor = {
  name: string;
  title: string | null;
  description: string | null;
  inputSchema: Record<string, unknown>;
};

export type McpResourceDescriptor = {
  uri: string;
  name: string;
  description: string | null;
  mimeType: string | null;
};

export type FantasyProsErrorKind = "auth" | "transport" | "protocol" | "tool";

/**
 * Fields are assigned rather than declared as constructor parameter
 * properties: the verification scripts run this module through `node
 * --experimental-strip-types`, which is strip-only and rejects that syntax.
 */
export class FantasyProsError extends Error {
  readonly kind: FantasyProsErrorKind;

  constructor(message: string, kind: FantasyProsErrorKind, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FantasyProsError";
    this.kind = kind;
  }
}

/**
 * Streamable HTTP replies as `application/json` or as a single SSE frame
 * depending on the call. Both carry one JSON-RPC response, so both are reduced
 * to the same object here rather than making every caller care.
 */
function parseBody(contentType: string | null, body: string): unknown {
  const looksLikeSse =
    contentType?.includes("text/event-stream") ||
    body.startsWith("event:") ||
    body.startsWith("data:");

  if (!looksLikeSse) {
    try {
      return JSON.parse(body) as unknown;
    } catch (cause) {
      throw new FantasyProsError(
        `FantasyPros returned a body that is neither JSON nor SSE: ${body.slice(0, 200)}`,
        "protocol",
        { cause },
      );
    }
  }

  const data = body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("");
  if (!data) {
    throw new FantasyProsError("FantasyPros sent an SSE frame with no data.", "protocol");
  }
  try {
    return JSON.parse(data) as unknown;
  } catch (cause) {
    throw new FantasyProsError(
      `FantasyPros sent an SSE frame whose data is not JSON: ${data.slice(0, 200)}`,
      "protocol",
      { cause },
    );
  }
}

type JsonRpcResponse = {
  result?: unknown;
  error?: { code: number; message: string };
};

/**
 * One MCP session.
 *
 * Sessions are cheap here — `initialize` is a single round trip — so a session
 * is created per unit of work rather than pooled. Pooling would mean holding a
 * session across a serverless instance's lifetime and discovering it had been
 * expired by the server at the moment it was needed.
 */
export class FantasyProsClient {
  private sessionId: string | null = null;
  private initialized = false;
  private nextId = 0;
  private serverInfo: { name: string; version: string } | null = null;
  private readonly timeoutMs: number;

  constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  private async post(
    message: Record<string, unknown>,
    accessToken: string,
    expectResponse: boolean,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    if (message.method !== "initialize") headers["mcp-protocol-version"] = PROTOCOL_VERSION;

    let res: Response;
    try {
      res = await fetch(MCP_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", ...message }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";
      throw new FantasyProsError(
        timedOut
          ? `FantasyPros did not answer within ${this.timeoutMs}ms.`
          : `Could not reach FantasyPros: ${cause instanceof Error ? cause.message : String(cause)}`,
        "transport",
        { cause },
      );
    }

    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    if (res.status === 401 || res.status === 403) {
      throw new FantasyProsError(
        `FantasyPros rejected the token (${res.status}). The grant may have been ` +
          `revoked — re-run \`npm run auth:fantasypros\`.`,
        "auth",
      );
    }

    const text = await res.text();
    if (!res.ok) {
      throw new FantasyProsError(
        `FantasyPros returned ${res.status}: ${text.slice(0, 300)}`,
        "transport",
      );
    }

    // Notifications get 202 with an empty body and have no response to parse.
    if (!expectResponse || text.length === 0) return null;

    const doc = parseBody(res.headers.get("content-type"), text) as JsonRpcResponse;
    if (doc.error) {
      throw new FantasyProsError(
        `FantasyPros rejected ${String(message.method)}: ${doc.error.message} (${doc.error.code})`,
        "protocol",
      );
    }
    return doc.result ?? null;
  }

  /**
   * `initialize`, then the `notifications/initialized` the spec requires before
   * any other request.
   *
   * The 401 retry lives here rather than around every call: a token that has
   * gone stale between a cached expiry and reality shows up on the first
   * request of a session, and one forced refresh clears it. Retrying every
   * request would risk hammering the token endpoint during a real outage.
   */
  private async ensureInitialized(): Promise<string> {
    let token = await getAccessToken();
    if (this.initialized) return token;

    const handshake = async (accessToken: string) => {
      const result = (await this.post(
        {
          id: ++this.nextId,
          method: "initialize",
          params: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: CLIENT_INFO,
          },
        },
        accessToken,
        true,
      )) as { serverInfo?: { name: string; version: string } } | null;
      this.serverInfo = result?.serverInfo ?? null;
      await this.post({ method: "notifications/initialized" }, accessToken, false);
    };

    try {
      await handshake(token);
    } catch (err) {
      if (!(err instanceof FantasyProsError) || err.kind !== "auth") throw err;
      // The cached access token was spent or revoked. One forced refresh, then
      // let a second failure through — that is a real problem, not a stale token.
      this.sessionId = null;
      token = await getAccessToken({ force: true });
      await handshake(token);
    }

    this.initialized = true;
    return token;
  }

  /** Name and version the server reports. Populated after the first call. */
  server(): { name: string; version: string } | null {
    return this.serverInfo;
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const token = await this.ensureInitialized();
    const result = (await this.post(
      { id: ++this.nextId, method: "tools/list", params: {} },
      token,
      true,
    )) as { tools?: unknown[] } | null;

    return (result?.tools ?? []).map((raw) => {
      const t = raw as Record<string, unknown>;
      return {
        name: String(t.name),
        title: typeof t.title === "string" ? t.title : null,
        description: typeof t.description === "string" ? t.description : null,
        inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
      };
    });
  }

  async listResources(): Promise<McpResourceDescriptor[]> {
    const token = await this.ensureInitialized();
    const result = (await this.post(
      { id: ++this.nextId, method: "resources/list", params: {} },
      token,
      true,
    )) as { resources?: unknown[] } | null;

    return (result?.resources ?? []).map((raw) => {
      const r = raw as Record<string, unknown>;
      return {
        uri: String(r.uri),
        name: String(r.name ?? r.uri),
        description: typeof r.description === "string" ? r.description : null,
        mimeType: typeof r.mimeType === "string" ? r.mimeType : null,
      };
    });
  }

  /**
   * Calls a tool and returns its parsed JSON payload.
   *
   * FantasyPros answers with text content that happens to be JSON, and marks
   * refusals with `isError` rather than a JSON-RPC error — a premium gate and a
   * validation failure both arrive as a successful response with an error
   * message inside. Both are raised here so a caller cannot mistake one for
   * data.
   */
  async callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const token = await this.ensureInitialized();
    const result = (await this.post(
      { id: ++this.nextId, method: "tools/call", params: { name, arguments: args } },
      token,
      true,
    )) as { content?: { type: string; text?: string }[]; isError?: boolean } | null;

    const text = (result?.content ?? []).map((c) => c.text ?? "").join("");

    if (result?.isError) {
      throw new FantasyProsError(`FantasyPros tool \`${name}\` failed: ${text.slice(0, 400)}`, "tool");
    }

    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new FantasyProsError(
        `FantasyPros tool \`${name}\` returned non-JSON content: ${text.slice(0, 200)}`,
        "protocol",
        { cause },
      );
    }
  }

  /** Reads an `ff://` resource and parses it as JSON. */
  async readResource<T = unknown>(uri: string): Promise<T> {
    const token = await this.ensureInitialized();
    const result = (await this.post(
      { id: ++this.nextId, method: "resources/read", params: { uri } },
      token,
      true,
    )) as { contents?: { text?: string }[] } | null;

    const text = (result?.contents ?? []).map((c) => c.text ?? "").join("");
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new FantasyProsError(
        `FantasyPros resource ${uri} returned non-JSON content: ${text.slice(0, 200)}`,
        "protocol",
        { cause },
      );
    }
  }
}

/**
 * Runs `work` against a fresh session.
 *
 * The one entry point the rest of the app — and the projections agent — should
 * use, so timeouts and the auth retry are not reimplemented per caller.
 */
export async function withFantasyPros<T>(
  work: (client: FantasyProsClient) => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  return work(new FantasyProsClient(options.timeoutMs));
}
