import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

// Mirrors the Electron shell's file layout under T3CODE_HOME so a later
// migration is a copy, not a translation.
export function userDataDir(home: string): string {
  return NodePath.join(home, "userdata");
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
  await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
  const tmp = `${path}.${crypto.randomUUID()}.tmp`;
  await Bun.write(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await NodeFSP.rename(tmp, path);
}
