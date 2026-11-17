export class BotRunner<T> {
  #active: Promise<T> | null = null;
  #stopped = false;

  constructor(private readonly runCycle: () => Promise<T>) {}

  start(): Promise<T> {
    this.#stopped = false;
    return this.cycle();
  }

  cycle(): Promise<T> {
    if (this.#stopped) return Promise.reject(new Error("Runner is stopped."));
    if (this.#active) return this.#active;
    this.#active = this.runCycle().finally(() => { this.#active = null; });
    return this.#active;
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    await this.#active;
  }
}
