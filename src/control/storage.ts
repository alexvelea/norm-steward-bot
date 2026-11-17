import { chmod, copyFile, mkdir, open, readFile, rename } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import type { SavedControl } from "./types.js";
import { controlStore, decodeControlStore, UnsupportedControlStoreError } from "../bot/persistence/schema.js";

export interface ControlStorage {
  load(): Promise<SavedControl | null>;
  save(value: SavedControl): Promise<void>;
}
export class FileControlStorage implements ControlStorage {
  constructor(readonly directory: string) {}
  async load(): Promise<SavedControl | null> {
    const path = join(this.directory, "control.json");
    try {
      const source = await readFile(path, "utf8");
      const parsed: unknown = JSON.parse(source);
      try {
        const decoded = decodeControlStore(parsed);
        if (parsed && typeof parsed === "object" && !("storeVersion" in parsed)) {
          const backup = join(this.directory, `control.legacy-${Date.now()}.json`);
          try {
            await copyFile(path, backup, constants.COPYFILE_EXCL);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            if (!(await readFile(backup)).equals(Buffer.from(source)))
              throw new Error("Existing migration backup does not match control.json.");
          }
          await chmod(backup, 0o600);
          await this.save(decoded);
        }
        return decoded;
      } catch (error) {
        if (!(error instanceof UnsupportedControlStoreError)) throw error;
        const store = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
        const settings = store.settings && typeof store.settings === "object"
          ? store.settings as SavedControl["settings"]
          : { serverUrl: "", worldId: "", apiKey: "" };
        return {
          settings,
          pending: null,
          decisions: [],
          automatic: false,
          recoveryRequired: error.message,
        };
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (e instanceof SyntaxError) throw new Error("Private control state could not be read; repair control.json before starting.");
      if (e instanceof UnsupportedControlStoreError) throw e;
      throw new Error("Private control state could not be read; repair control.json before starting.");
    }
  }
  async save(value: SavedControl): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temp = join(this.directory, `control.${process.pid}.tmp`);
    const file = await open(temp, "w", 0o600);
    try {
      await file.writeFile(JSON.stringify(controlStore(value), null, 2));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, join(this.directory, "control.json"));
    const directory = await open(this.directory, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}
