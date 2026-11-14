import { useRoute } from "../lib/router";
import { Home } from "./Home";
import { WorldPage } from "./WorldPage";

export function App() {
  const route = useRoute();
  return route.name === "world" ? <WorldPage key={route.worldId} worldId={route.worldId} /> : <Home />;
}
