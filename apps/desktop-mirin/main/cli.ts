import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { DesktopCliCommandState } from "@t3tools/contracts";

// `t3-mirin`, not `t3`: the official T3 Code app installs `t3` and the fork
// must never shadow or be shadowed by it.
export const CLI_COMMAND_NAME = "t3-mirin";

const LINK_DIRS = [
  NodePath.join(NodeOS.homedir(), ".local", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
];

function shimPath(home: string): string {
  return NodePath.join(home, "bin", CLI_COMMAND_NAME);
}

function pathDirs(): string[] {
  return (process.env["PATH"] ?? "").split(":").filter((dir) => dir.length > 0);
}

async function exists(path: string): Promise<boolean> {
  return NodeFSP.access(path, NodeFS.constants.F_OK).then(
    () => true,
    () => false,
  );
}

async function writeShim(home: string, serverEntry: string): Promise<string> {
  const target = shimPath(home);
  await NodeFSP.mkdir(NodePath.join(home, "bin"), { recursive: true });
  const script = [
    "#!/bin/sh",
    "# Written by T3 Code Mirin: runs the fork's t3 CLI with its own data home.",
    `export T3CODE_HOME=${JSON.stringify(home)}`,
    `exec bun ${JSON.stringify(serverEntry)} "$@"`,
    "",
  ].join("\n");
  await Bun.write(target, script);
  await NodeFSP.chmod(target, 0o755);
  return target;
}

async function installedLink(home: string): Promise<string | null> {
  const shim = shimPath(home);
  for (const dir of LINK_DIRS) {
    const link = NodePath.join(dir, CLI_COMMAND_NAME);
    const linkTarget = await NodeFSP.readlink(link).catch(() => null);
    if (linkTarget !== null && NodePath.resolve(dir, linkTarget) === shim) return link;
  }
  return null;
}

export async function cliCommandState(home: string): Promise<DesktopCliCommandState> {
  const installedPath = await installedLink(home);
  const dirs = pathDirs();
  const onPath = installedPath !== null && dirs.includes(NodePath.resolve(installedPath, ".."));
  let shadowedBy: string | undefined;
  if (installedPath !== null) {
    for (const dir of dirs) {
      if (dir === NodePath.resolve(installedPath, "..")) break;
      const candidate = NodePath.join(dir, CLI_COMMAND_NAME);
      if (await exists(candidate)) {
        shadowedBy = candidate;
        break;
      }
    }
  }
  return {
    supported: true,
    installedPath,
    onPath,
    ...(shadowedBy === undefined ? {} : { shadowedBy }),
  };
}

export async function installCliCommand(
  home: string,
  serverEntry: string,
): Promise<DesktopCliCommandState> {
  const shim = await writeShim(home, serverEntry);
  const dirs = pathDirs();
  const preferred = [...LINK_DIRS.filter((dir) => dirs.includes(dir)), ...LINK_DIRS];
  for (const dir of preferred) {
    try {
      await NodeFSP.mkdir(dir, { recursive: true });
      const link = NodePath.join(dir, CLI_COMMAND_NAME);
      const current = await NodeFSP.lstat(link).catch(() => null);
      if (current !== null) {
        if (!current.isSymbolicLink()) continue;
        await NodeFSP.unlink(link);
      }
      await NodeFSP.symlink(shim, link);
      break;
    } catch {
      // not writable; try the next directory
    }
  }
  return cliCommandState(home);
}

export async function uninstallCliCommand(home: string): Promise<DesktopCliCommandState> {
  const link = await installedLink(home);
  if (link !== null) await NodeFSP.unlink(link).catch(() => undefined);
  await NodeFSP.unlink(shimPath(home)).catch(() => undefined);
  return cliCommandState(home);
}
