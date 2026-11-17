import { useRef, useState } from "react";
import type { Action } from "../../contract";
import { ApiFailure, describeFailure } from "../../lib/http";
import { useWorldContext } from "../worldContext";
import type { WorldClient } from "../../world/types";

export function actionFeedback(response: Awaited<ReturnType<WorldClient["act"]>>, count: number) {
  const missing = response.results.length !== count;
  return {
    failed: missing || response.results.some((r) => !r.ok),
    message: [
      ...(missing ? ["Missing action results."] : []),
      ...response.results.map((r) => r.ok ? `${r.type}: accepted at tick ${response.tick}.` : `${r.type}: ${r.error.code} — ${r.error.message}`),
    ].join(" "),
  };
}

export function useManualActions() {
  const { client } = useWorldContext();
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState<Action[] | null>(null);
  async function submit(actions: Action[], isRetry = false) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    const request = isRetry ? actions : actions.map((a) => ({ ...a, clientId: `ui-${crypto.randomUUID()}` }));
    try {
      const response = await client.act(request);
      const feedback = actionFeedback(response, request.length);
      setRetry(null);
      setFailed(feedback.failed);
      setMessage(feedback.message);
    } catch (error) {
      const uncertain = error instanceof ApiFailure && (error.status === 0 || error.status >= 500);
      setRetry(uncertain ? request : null);
      setFailed(true);
      setMessage(
        describeFailure(error) + (uncertain ? " The outcome is unknown. Retry uses the same command IDs to avoid duplicates." : ""),
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return { busy, message, failed, retry, setRetry, submit, act: (action: Action) => submit([action]) };
}
