import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isMock } from "./lib/router";
import { installBackend } from "./world/backend";
import { App } from "./ui/App";

async function boot(): Promise<void> {
  // The mock world lives in its own chunk and is fetched only when asked for.
  if (isMock()) {
    const { mockBackend } = await import("./dev/mock");
    installBackend(mockBackend);
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
