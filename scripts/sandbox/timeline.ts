/** First tick each milestone is observed in a sandbox run. Pure: fed the state after every clock step. */
export const LABELS: Record<string, string> = { hall: "Hall", lumberyard: "Lumberyard", quarry: "Quarry", mine: "Iron Mine", farm: "Farm", storehouse: "Storehouse", cellar: "Cellar", barracks: "Barracks", smithy: "Smithy", stable: "Stable", workshop: "Workshop", market: "Market", wall: "Wall", watchtower: "Watchtower", court: "Court", pikeman: "Pikemen", shieldman: "Shieldmen", raider: "Raiders", archer: "Archers", scout: "Scouts", lancer: "Lancers", knight: "Knights", ram: "Rams", trebuchet: "Trebuchets", envoy: "Envoys" };
const label = (id: string) => LABELS[id] ?? id;
/** `major` rows are the ones shown in timeline.md and in comparisons; every row stays in result.json. */
export type Milestone = { tick: number; key: string; major: boolean };

export class Timeline {
  readonly milestones: Milestone[] = [];
  /** Every incoming command ever seen, by id, with the tick it first appeared. */
  readonly incoming: Record<string, any> = {};
  private seen = new Set<string>();
  private capital?: string;
  private mark(tick: number, key: string, major = true) {
    if (this.seen.has(key)) return;
    this.seen.add(key); this.milestones.push({ tick, key, major });
  }
  observe(state: any) {
    const tick = state.world.tick;
    this.capital ??= state.villages[0]?.id;
    const capital = state.villages.find((v: any) => v.id === this.capital);
    if (capital) {
      for (const [building, level] of Object.entries(capital.buildings ?? {}) as [string, number][])
        for (let n = 1; n <= level; n++) this.mark(tick, `${label(building)} ${n}`, n === 1 || n % 5 === 0);
      const army: Record<string, number> = {};
      for (const group of [capital.units?.home, capital.units?.away]) for (const [unit, n] of Object.entries(group ?? {})) army[unit] = (army[unit] ?? 0) + Number(n);
      for (const [unit, count] of Object.entries(army)) {
        if (count >= 1) this.mark(tick, `${label(unit)} 1`);
        for (let n = 50; n <= count; n += 50) this.mark(tick, `${label(unit)} ${n}`);
      }
    }
    for (let n = 2; n <= state.villages.length; n++) this.mark(tick, `Village ${n} held`);
    for (const command of state.commands?.outgoing ?? []) {
      if (!command.kind || command.returning) continue;
      const sent = command.sentTick ?? tick;
      this.mark(sent, `First ${command.kind} sent`);
      if (Number(command.units?.envoy) > 0) this.mark(sent, "First Envoy sent");
    }
    for (const command of state.commands?.incoming ?? []) {
      if (!command.id) continue;
      this.incoming[command.id] = { seenTick: this.incoming[command.id]?.seenTick ?? tick, ...command };
      if (command.kind) this.mark(tick, `First incoming ${command.kind} seen`);
      if (command.kind === "attack") this.mark(command.arrivalTick, "First incoming attack lands");
    }
  }
  /** Milestones reached at tick 0 are the starting position, not progress. */
  rows(majorOnly = true) {
    return this.milestones.filter(m => m.tick > 0 && (m.major || !majorOnly)).sort((a, b) => a.tick - b.tick);
  }
  markdown() {
    return ["| Tick | Minute | Milestone |", "|---:|---:|---|", ...this.rows().map(m => `| ${m.tick} | ${(m.tick / 60).toFixed(1)} | ${m.key} |`)].join("\n") + "\n";
  }
}
