import type { StateResponse } from "../../contract";
import { useWorldContext } from "../worldContext";

/** Chips for each of your villages; picking one also centres the map on it. */
export function VillagePicker({ state, value, onChange }: { state: StateResponse; value: string; onChange: (id: string) => void }) {
  const { map, select } = useWorldContext();
  if (state.villages.length < 2) return null;
  const threatened = new Set(state.commands.incoming.filter((c) => c.kind === "attack").map((c) => c.to.id));
  return (
    <div className="picker" role="listbox" aria-label="Your villages">
      {state.villages.map((v) => (
        <button
          key={v.id}
          role="option"
          aria-selected={v.id === value}
          className={`chip${v.id === value ? " is-active" : ""}${threatened.has(v.id) ? " is-threatened" : ""}`}
          onClick={() => {
            onChange(v.id);
            select(v.id);
            map.focus(v.x, v.y, null);
          }}
        >
          {v.name}
        </button>
      ))}
    </div>
  );
}
