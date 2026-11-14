import type { Settings } from "./types.js";
export class RemoteError extends Error {
  constructor(
    readonly status: number,
    readonly retryMs: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
export function validateOrigin(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Game server must be an HTTP(S) origin without credentials, path or query.",
    );
  return url.origin;
}
export type Remote = <T>(
  settings: Settings,
  path: string,
  body?: unknown,
) => Promise<T>;
export const remoteRequest: Remote = async <T>(
  settings: Settings,
  path: string,
  body?: unknown,
): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(settings.serverUrl + "/api/v1" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        Accept: "application/json",
        ...(body === undefined
          ? { "X-Steward-Client": "dashboard" }
          : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new RemoteError(
      0,
      5000,
      "The game server could not be reached; write outcome may be unknown.",
    );
  }
  if (!response.ok) {
    let message = `Game server returned HTTP ${response.status}`;
    const header = response.headers.get("Retry-After");
    const seconds = header === null ? 5 : Number(header);
    const retryMs = Number.isFinite(seconds)
      ? seconds * 1000
      : Math.max(1000, Date.parse(header ?? "") - Date.now()) || 5000;
    let code: string | undefined;
    try {
      const data = (await response.json()) as {
        error?: {
          code?: string;
          message?: string;
          details?: { retryAfterMs?: number };
        };
      };
      code = data.error?.code;
      if (data.error?.message) message += `: ${data.error.message}`;
    } catch {}
    throw new RemoteError(
      response.status,
      Math.max(1000, retryMs),
      message,
      code,
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new RemoteError(
      0,
      5000,
      "Invalid game response; write outcome may be unknown.",
    );
  }
};
