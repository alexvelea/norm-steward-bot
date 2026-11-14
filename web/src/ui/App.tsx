import { isMock, useRoute } from "../lib/router";
import { ControlCenter } from "./ControlCenter";
import { WorldPage } from "./WorldPage";
export function App() {
  const route = useRoute();
  if (isMock())
    return (
      <div className="cc-mock">
        <div className="cc-mock-banner">
          Synthetic demo · advisor execution disconnected · <a href="/">Return to live control center</a>
        </div>
        <WorldPage worldId={route.name === "world" ? route.worldId : "mock"} />
      </div>
    );
  return <ControlCenter />;
}
