import { mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { SavedControl } from "./types.js";

export interface ControlStorage {
  load(): Promise<SavedControl | null>;
  save(value: SavedControl): Promise<void>;
}
export class FileControlStorage implements ControlStorage {
  constructor(readonly directory: string) {}
  async load(): Promise<SavedControl | null> {
    try {
      return JSON.parse(await readFile(join(this.directory, "control.json"), "utf8")) as SavedControl;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("Private control state could not be read; repair control.json before starting.");
    }
  }
  async save(value: SavedControl): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temp = join(this.directory, `control.${process.pid}.tmp`);
    const file = await open(temp, "w", 0o600);
    try {
      await file.writeFile(JSON.stringify(value, null, 2));
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
