// Standings: the public leaderboard (refreshed every SCORING.publicSnapshotTicks). Your row is gold;
// picking a row flies the map to that player's largest village.
import type { LeaderboardEntry } from "../../contract";
import { formatInt } from "../../lib/format";
import { colorsForPlayer, GOLD } from "../../lib/palette";
import { Empty } from "../common";
import { selectLeaderboard, selectMap, selectPlayerId, useWorld, useWorldContext } from "../worldContext";

export function StandingsTab() {
  const board = useWorld(selectLeaderboard);
  const playerId = useWorld(selectPlayerId);
  const map = useWorld(selectMap);
  const { map: controller, select } = useWorldContext();
  if (!board) return <Empty>Reading the standings…</Empty>;
  if (board.entries.length === 0) return <Empty>Nobody has joined yet.</Empty>;

  const flyTo = (entry: LeaderboardEntry) => {
    let best: { id: string; x: number; y: number; points: number } | null = null;
    for (const v of map.villages.values()) if (v.ownerId === entry.playerId && (!best || v.points > best.points)) best = v;
    if (best) {
      select(best.id);
      controller.focus(best.x, best.y, null);
    }
  };

  return (
    <div className="tab-page">
      <p className="muted small">
        Round {board.round} · as of tick {formatInt(board.snapshotTick)}
      </p>
      <table className="table standings">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Player</th>
            <th className="num">Score</th>
            <th className="num">Points</th>
            <th className="num" title="Villages">Vil.</th>
            <th className="num" title="Renown: attack / defence">Renown</th>
          </tr>
        </thead>
        <tbody>
          {board.entries.map((e) => {
            const mine = e.playerId === playerId;
            return (
              <tr key={e.playerId} className={mine ? "is-you" : ""} onClick={() => flyTo(e)}>
                <td className="num mono">{e.rank}</td>
                <td>
                  <span className="swatch" style={{ background: mine ? GOLD : colorsForPlayer(e.playerId).fill }} />
                  {e.name}
                  {e.houseBot && <span className="tag">{e.houseBot}</span>}
                </td>
                <td className="num mono">{formatInt(e.score)}</td>
                <td className="num mono muted">{formatInt(e.points)}</td>
                <td className="num mono muted">{e.villages}</td>
                <td className="num mono muted">
                  {formatInt(e.renown.attack)}/{formatInt(e.renown.defense)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
