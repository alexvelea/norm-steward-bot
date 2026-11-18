type ActionResponse = {
  results: { ok: boolean; error?: { code: string; details?: { retryAfterMs?: number } } }[];
};

export async function retrySandboxAction<T extends ActionResponse>(
  send: () => Promise<T>,
  record: (response: T) => void,
  sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await send();
    record(response);
    const outcome = response.results[0];
    if (!outcome) throw new Error('Action response contained no result; outcome unknown');
    if (outcome.ok || outcome.error?.code !== 'RATE_LIMITED') return response;
    if (attempt === 29) break;
    await sleep(Math.max(10000, Number(outcome.error.details?.retryAfterMs) || 0));
  }
  throw new Error('Action quota retry bound exceeded');
}
