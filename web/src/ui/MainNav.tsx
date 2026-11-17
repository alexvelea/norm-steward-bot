import type { ReactNode } from "react";
import { worldHref } from "../lib/router";
import { Link } from "./common";

export function MainNav({ worldId, page, onLogout, children }: {
  worldId: string; page: "world" | "settings" | "bot"; onLogout?(): Promise<void>; children?: ReactNode;
}) {
  return <header className={`cc-nav main-nav${page === "world" ? " world-bar" : ""}`}>
    <Link href="/" className="cc-brand">Steward <span>Control</span></Link>
    <nav className="cc-main-links" aria-label="Control center">
      <Link href="/" className={page === "bot" ? "is-active" : ""}>Bot</Link>
      <Link href={worldHref(worldId)} className={page === "world" ? "is-active" : ""}>Map & commands</Link>
      <Link href="/settings" className={page === "settings" ? "is-active" : ""}>Settings</Link>
    </nav>
    {children}
    {onLogout && <button className="btn btn-small" onClick={() => void onLogout()}>Lock</button>}
  </header>;
}
