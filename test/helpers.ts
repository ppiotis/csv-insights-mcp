import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

export function makeSandbox(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "csv-insights-"));
  cpSync(fixtures, path.join(dir, "data"), { recursive: true });
  return dir;
}

export function removeSandbox(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}
