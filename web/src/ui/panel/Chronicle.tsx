// Chronicle: the round so far, from GET /history (one sample every HISTORY.sampleEveryTicks).
import { useMemo } from "react";
import { HISTORY } from "../../contract";
import { AMBER, EMBER, GOLD, STEEL } from "../../lib/palette";
import { LineChart, type Series } from "../charts";
import { Empty, Section } from "../common";
import { selectHistory, useWorld } from "../worldContext";

const TIMBER = "#a7b46a";
const STONE = "#b8b2a4";
const IRON = "#7fa6b8";

export function ChronicleTab() {
  const samples = useWorld(selectHistory);
  const charts = useMemo(() => {
    const ticks = samples.map((s) => s.tick);
    const pick = (name: string, color: string, read: (i: number) => number): Series => ({
      name,
      color,
      values: samples.map((_, i) => read(i)),
    });
    const s = (i: number) => samples[i]!;
    return {
      ticks,
      score: [pick("score", GOLD, (i) => s(i).score), pick("points", STEEL, (i) => s(i).points)],
      resources: [
        pick("timber", TIMBER, (i) => s(i).resources.timber),
        pick("stone", STONE, (i) => s(i).resources.stone),
        pick("iron", IRON, (i) => s(i).resources.iron),
      ],
      production: [
        pick("timber/min", TIMBER, (i) => s(i).production.timber),
        pick("stone/min", STONE, (i) => s(i).production.stone),
        pick("iron/min", IRON, (i) => s(i).production.iron),
      ],
      army: [pick("army population", EMBER, (i) => s(i).armyPop)],
      renown: [pick("attack", EMBER, (i) => s(i).renown.attack), pick("defence", STEEL, (i) => s(i).renown.defense)],
      villages: [pick("villages", AMBER, (i) => s(i).villages)],
    };
  }, [samples]);

  if (samples.length < 2) return <Empty>The chronicle fills in as the round goes on: a sample every {HISTORY.sampleEveryTicks} ticks.</Empty>;
  return (
    <div className="tab-page">
      <Section title="Score and points">
        <LineChart ticks={charts.ticks} series={charts.score} />
      </Section>
      <Section title="Resources held">
        <LineChart ticks={charts.ticks} series={charts.resources} area={false} />
      </Section>
      <Section title="Production">
        <LineChart ticks={charts.ticks} series={charts.production} area={false} />
      </Section>
      <Section title="Army size">
        <LineChart ticks={charts.ticks} series={charts.army} />
      </Section>
      <Section title="Renown">
        <LineChart ticks={charts.ticks} series={charts.renown} area={false} />
      </Section>
      <Section title="Villages">
        <LineChart ticks={charts.ticks} series={charts.villages} />
      </Section>
    </div>
  );
}
