# Engineering architect review handoff

Use this prompt with an agent that has access to this private GitHub repository:

> Review this personal game-bot control center as an engineering architect. Read AGENTS.md,
> docs/setup.md, docs/architecture.md, docs/strategy.md, docs/control-center.md and docs/reviews.md.
> Inspect the actual source and tests; treat documentation as claims to verify.
>
> Trace the complete paths from advisor proposals through President allocation and the durable
> executor, and from the systemd timer through Codex instructions, evidence, experiments, checks,
> Git publishing and recoverable deployment. Inspect scripts/review/prompt.md and its output schema.
>
> Focus on correctness, stale state, retries/idempotency, competing actions, resource reservations,
> process ownership, experiment fairness, evidence freshness/rules versions, quota/time limits,
> interrupted work, activation/rollback and whether the review loop can learn useful gameplay strategy.
> Distinguish measured game outcomes from implementation checks and expectations. Inspect tests for
> important missing cases. Explain which complexity is justified and which can be simplified.
>
> Run local typecheck/tests/build if available; these need no game credentials. Do not enable services,
> submit live actions, change the central engine, read secrets or deploy. A GitHub-only review cannot
> verify private runtime state; label those facts as unverified rather than inferring success.
>
> Return prioritized findings with concrete file/line references, failure scenarios, impact and the
> smallest practical fixes. Explain architectural tradeoffs. Avoid a broad framework rewrite without
> evidence. Include a short proposed implementation order and tests that would demonstrate each fix.

The main setup, prompts, services and experiment harness are versioned. Runtime settings, private
traces and credentials intentionally are not. [Strategy history](strategy-history.md) contains older
measurements and superseded policies; consult it selectively after understanding the current policy.
Check the active release record on the machine before assuming Git HEAD is deployed.
