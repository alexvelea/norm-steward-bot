// Where the pages get their data: the live server by default, or the dev mock (?mock=1), which
// installs itself before the first render. Pages only ever talk to this interface.
import type { MeResponse, RotateKeyResponse, SignupResponse, WorldSummary } from "../contract";
import { apiGet, apiWrite, ApiFailure } from "../lib/http";
import { LiveWorldClient } from "./liveClient";
import type { WorldClient } from "./types";

export interface Backend {
  /** Public worlds, plus the key's own sandboxes. */
  listWorlds(key: string | null): Promise<WorldSummary[]>;
  signup(name: string): Promise<SignupResponse>;
  me(key: string): Promise<MeResponse>;
  rotateKey(key: string): Promise<RotateKeyResponse>;
  worldClient(worldId: string, key: string | null): WorldClient;
}

const live: Backend = {
  listWorlds: (key) => apiGet<WorldSummary[]>("/worlds", key),
  signup: (name) => apiWrite<SignupResponse>("POST", "/accounts", { name }),
  me: (key) => apiGet<MeResponse>("/me", key),
  rotateKey: (key) => apiWrite<RotateKeyResponse>("POST", "/me/rotate-key", undefined, key),
  worldClient: (worldId, key) => new LiveWorldClient(worldId, key),
};

let current: Backend = live;

export function backend(): Backend {
  return current;
}

export function installBackend(replacement: Backend): void {
  current = replacement;
}

export interface WorldList {
  worlds: WorldSummary[];
  /** The saved key was refused (rotated or mistyped), so this is the public list only. */
  keyRefused: boolean;
}

/**
 * The front page's world list. The list itself is public, but the server answers 401 to a wrong key
 * even there, so a refused key falls back to the public list rather than showing no worlds at all.
 */
export async function loadWorldList(key: string | null): Promise<WorldList> {
  try {
    return { worlds: await current.listWorlds(key), keyRefused: false };
  } catch (error) {
    if (!key || !(error instanceof ApiFailure) || error.status !== 401) throw error;
    return { worlds: await current.listWorlds(null), keyRefused: true };
  }
}
