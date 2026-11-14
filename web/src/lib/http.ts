// Reads use the dashboard bucket; manual writes use the same authenticated API as stewards.
import type { ApiError, ErrorResponse } from "../contract";

const BASE = "/api/v1";
const DASHBOARD_HEADER = "X-Steward-Client";
const MCP_PATH = /(^|\/)mcp(\/|\?|$)/;

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError,
  ) {
    super(error.message);
  }
}

function assertRestPath(path: string): void {
  if (MCP_PATH.test(path)) throw new Error(`Use REST rather than ${path}`);
}

function authHeader(key: string | null | undefined): Record<string, string> {
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const error = (body as ErrorResponse | undefined)?.error ?? {
      code: "VALIDATION",
      message: `HTTP ${response.status}`,
    };
    throw new ApiFailure(response.status, error as ApiError);
  }
  return body as T;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(BASE + path, init);
  } catch {
    throw new ApiFailure(0, { code: "VALIDATION", message: "The server can't be reached." } as ApiError);
  }
}

export async function apiGet<T>(path: string, key?: string | null, signal?: AbortSignal): Promise<T> {
  assertRestPath(path);
  const response = await send(path, {
    method: "GET",
    headers: { Accept: "application/json", [DASHBOARD_HEADER]: "dashboard", ...authHeader(key) },
    signal,
  });
  return parse<T>(response);
}

/** Writes never carry the dashboard header: gameplay is logged and rate-limited normally. */
export async function apiWrite<T>(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown, key?: string | null): Promise<T> {
  assertRestPath(path);
  const response = await send(path, {
    method,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...authHeader(key),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parse<T>(response);
}

export function streamUrl(worldId: string): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}${BASE}/worlds/${encodeURIComponent(worldId)}/stream`;
}

export function describeFailure(error: unknown): string {
  if (error instanceof ApiFailure) return error.status ? `${error.error.code}: ${error.error.message}` : error.message;
  return error instanceof Error ? error.message : String(error);
}
