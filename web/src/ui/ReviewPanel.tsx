import { useEffect, useState } from "react";
import { controlRequest } from "../lib/control";
import type { ReviewStatus } from "../../../src/control/review-types";
export function ReviewPanel() {
  const [view, setView] = useState<ReviewStatus | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const v = await controlRequest<ReviewStatus>("/reviews");
        if (active) {
          setView(v);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const time = (n: number | null | undefined) =>
    n ? new Date(n * 1000).toLocaleString() : "—";
  return (
    <section className="cc-card cc-reviews">
      <div className="cc-section-heading">
        <h2>Strategic reviews</h2>
        {view?.installed && (
          <button
            className="btn btn-small"
            onClick={async () => {
              try {
                setView(
                  await controlRequest<ReviewStatus>("/reviews", "PUT", {
                    paused: !view.paused,
                  }),
                );
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {view.paused ? "Resume reviews" : "Pause reviews"}
          </button>
        )}
      </div>
      <p>
        <strong>{view?.status || "Loading review status…"}</strong> · Codex
        every ~30 minutes · gameplay runs independently
      </p>
      <p className="small muted">
        Latest:{" "}
        {view?.finishedAt ? new Date(view.finishedAt).toLocaleString() : "—"} ·
        Next: {view?.paused ? "Paused" : time(view?.nextScheduledAt)}
      </p>
      {view?.retryAt && view.retryAt > Date.now() / 1000 ? (
        <p className="warn-line">Review retry after {time(view.retryAt)}</p>
      ) : null}
      {(error || view?.error) && (
        <p className="error-line" role="alert">
          {error || view?.error}
        </p>
      )}
      {view?.usage && (
        <p className="small muted">
          Codex usage:{" "}
          {view.usage.available
            ? Object.entries(view.usage.limits || {})
                .map(
                  ([id, limit]) =>
                    `${id}: ${limit.primary ? `${limit.primary.usedPercent}% of primary window used` : "primary unavailable"}; ${limit.secondary ? `${limit.secondary.usedPercent}% of secondary window used` : "secondary unavailable"}`,
                )
                .join(" · ")
            : "Unavailable; no remaining-token estimate"}
        </p>
      )}
      <p className="small muted">
        Economic Advisor: continuous. Military, defence and raiding advisors:
        planned.
      </p>
      {view?.latestReview && (
        <details open>
          <summary>{view.latestReview.summary}</summary>
          <p>{view.latestReview.expectedEffect}</p>
          <p>
            <strong>Measured:</strong> {view.latestReview.measuredOutcome}
          </p>
          <p>
            <strong>Next measurement:</strong> {view.latestReview.nextMeasure}
          </p>
          <details>
            <summary>Evidence & changes</summary>
            <ul>
              {view.latestReview.evidence.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </details>
        </details>
      )}
      {!!view?.backlog?.length && (
        <details>
          <summary>Current strategic priorities</summary>
          <ol>
            {[...view.backlog]
              .sort((a, b) => a.priority - b.priority)
              .map((b, i) => (
                <li key={i}>
                  <strong>{b.title}</strong> · {b.effortPoints} effort points
                  <p className="small muted">{b.nextStep}</p>
                </li>
              ))}
          </ol>
          <p className="small muted">
            Effort points estimate work, not tokens or quota.
          </p>
        </details>
      )}
    </section>
  );
}
