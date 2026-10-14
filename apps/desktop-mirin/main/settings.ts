import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

// Mirrors the Electron shell's file layout under T3CODE_HOME so a later
// migration is a copy, not a translation.
export function userDataDir(home: string): string {
  return join(home, "userdata");
}

export async function readJsonFile(path: string): Promise<unknown | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  try {
    return JSON.parse(await file.text()) as unknown;
  } catch {
    return null;
  }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${crypto.randomUUID()}.tmp`;
  await Bun.write(tmp, `${JSON.stringify(value, null, 2)}\n`);
  const { rename } = await import("node:fs/promises");
  await rename(tmp, path);
}
