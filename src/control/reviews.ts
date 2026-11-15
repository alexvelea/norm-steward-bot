import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { ReviewStatus } from "./review-types.js";
export class ReviewStore {
  constructor(
    readonly directory = process.env.STEWARD_REVIEW_DIR ||
      "/var/lib/norm-steward-review",
  ) {}
  private async read(name: string): Promise<any> {
    try {
      return JSON.parse(await readFile(join(this.directory, name), "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("Review state could not be read.");
    }
  }
  async status(): Promise<ReviewStatus> {
    const state = await this.read("state.json");
    let paused = false;
    try {
      await readFile(join(this.directory, "paused"));
      paused = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const installed = !!(await this.read("installed.json"));
    const allowed = [
      "status",
      "retryAt",
      "error",
      "latestReview",
      "startedAt",
      "finishedAt",
      "usage",
      "deployment",
    ];
    const safe = Object.fromEntries(
      allowed.filter((k) => state?.[k] !== undefined).map((k) => [k, state[k]]),
    );
    const epoch = Date.now() / 1000;
    const running = [
      "running",
      "preparing",
      "verifying",
      "publishing",
      "deploying",
    ].includes(state?.status);
    const stale =
      running &&
      state?.startedAt &&
      Date.now() - Date.parse(state.startedAt) > 30 * 60 * 1000;
    return {
      ...safe,
      installed,
      paused,
      status: paused
        ? "paused"
        : stale
          ? "interrupted"
          : state?.status || "not installed",
      nextScheduledAt: installed
        ? Math.max((Math.floor(epoch / 1800) + 1) * 1800, state?.retryAt || 0)
        : null,
      backlog: (await this.read("backlog.json")) || [],
    } as ReviewStatus;
  }
  async pause(paused: boolean): Promise<ReviewStatus> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (paused)
      await writeFile(
        join(this.directory, "paused"),
        new Date().toISOString(),
        { mode: 0o600 },
      );
    else
      try {
        await unlink(join(this.directory, "paused"));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    return this.status();
  }
}
