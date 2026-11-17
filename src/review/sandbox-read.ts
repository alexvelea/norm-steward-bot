import { sandbox, type PrivateSandbox } from './sandbox-client.js';

export function privateRead<T>(box: PrivateSandbox, suffix: string, body?: unknown): Promise<T> {
  return sandbox<T>({op:'query',world:box.world.id,suffix,body});
}
