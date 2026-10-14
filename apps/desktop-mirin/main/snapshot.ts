import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type {
  DesktopPendingSnapShot,
  DesktopSnapShot,
  DesktopSnapShotEvent,
  DesktopSnapShotId,
  DesktopSnapShotShortcutAvailability,
  DesktopSnapShotState,
  SnapShotModifier,
  SnapShotShortcut,
} from "@t3tools/contracts";
import { isModifierPairShortcut, snapShotShortcutModifierPair } from "@t3tools/contracts";
import { devtools, globalShortcut } from "mirinjs";

import { userDataDir } from "./settings.ts";

// Left/right device masks of CGEventSourceFlagsState, as the Electron app uses.
const MODIFIER_PAIR_MASKS: Record<SnapShotModifier, readonly [number, number]> = {
  shift: [0x2, 0x4],
  control: [0x1, 0x2000],
  alt: [0x20, 0x40],
  meta: [0x8, 0x10],
};

const MODIFIER_LABELS: Record<SnapShotModifier, string> = {
  shift: "Shift",
  meta: "Command",
  control: "Control",
  alt: "Option",
};

const PAIR_POLLER = `
ObjC.import("AppKit");
$.NSApplication.sharedApplication.setActivationPolicy($.NSApplicationActivationPolicyProhibited);
ObjC.import("CoreGraphics");
ObjC.import("unistd");
function run(argv) {
  const both = Number(argv[0]) | Number(argv[1]);
  let active = false;
  console.log("ready");
  while ($.getppid() !== 1) {
    const pressed = ($.CGEventSourceFlagsState(0) & both) === both;
    if (pressed && !active) console.log("trigger");
    active = pressed;
    delay(0.05);
  }
  return "orphaned";
}`;

const ACTIVE_WINDOW = `
ObjC.import("AppKit");
ObjC.import("CoreGraphics");
function run() {
  const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  const pid = app.processIdentifier;
  const list = ObjC.castRefToObject(
    $.CGWindowListCopyWindowInfo(
      $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements,
      $.kCGNullWindowID,
    ),
  );
  const count = Number(list.count);
  for (let i = 0; i < count; i++) {
    const w = list.objectAtIndex(i);
    if (w.objectForKey("kCGWindowOwnerPID").js !== pid) continue;
    if (w.objectForKey("kCGWindowLayer").js !== 0) continue;
    const b = ObjC.deepUnwrap(w.objectForKey("kCGWindowBounds")) || {};
    if ((b.Width || 0) < 50 || (b.Height || 0) < 50) continue;
    const title = w.objectForKey("kCGWindowName");
    return JSON.stringify({
      id: w.objectForKey("kCGWindowNumber").js,
      title: title.isNil() ? "" : String(title.js),
      appName: String(app.localizedName.js || ObjC.unwrap(w.objectForKey("kCGWindowOwnerName")) || "App"),
    });
  }
  return "null";
}`;

const PERMISSIONS = `
ObjC.import("CoreGraphics");
ObjC.import("ApplicationServices");
JSON.stringify({ screenRecording: !!$.CGPreflightScreenCaptureAccess(), accessibility: !!$.AXIsProcessTrusted() });`;

export interface SnapShotSettings {
  readonly enabled: boolean;
  readonly shortcut: SnapShotShortcut;
  readonly playSound: boolean;
}

interface PendingRecord extends DesktopPendingSnapShot {
  readonly path: string;
}

async function jxa(script: string, args: string[] = []): Promise<string> {
  const proc = Bun.spawn(["/usr/bin/osascript", "-l", "JavaScript", "-e", script, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text.trim();
}

function chordAccelerator(shortcut: SnapShotShortcut): string | null {
  if (isModifierPairShortcut(shortcut)) return null;
  const parts: string[] = [];
  if (shortcut.metaKey || shortcut.modKey) parts.push("Cmd");
  if (shortcut.ctrlKey) parts.push("Ctrl");
  if (shortcut.altKey) parts.push("Alt");
  if (shortcut.shiftKey) parts.push("Shift");
  parts.push(shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key);
  return parts.join("+");
}

export function snapShotShortcutLabel(shortcut: SnapShotShortcut): string {
  if (isModifierPairShortcut(shortcut)) {
    const label = MODIFIER_LABELS[snapShotShortcutModifierPair(shortcut)];
    return `${label} + ${label}`;
  }
  return chordAccelerator(shortcut) ?? "";
}

/** Window capture on a global shortcut, macOS only; mirrors the Electron SnapShot flow. */
export class SnapShotController {
  readonly #dir: string;
  readonly #emit: (event: DesktopSnapShotEvent) => void;
  #settings: SnapShotSettings = {
    enabled: false,
    shortcut: { kind: "both-shift-keys" },
    playSound: true,
  };
  #registeredAccelerator: string | undefined;
  #poller: ReturnType<typeof Bun.spawn> | undefined;
  #suppressed = false;
  #registered = false;
  #message: string | null = null;
  #pending = new Map<string, PendingRecord>();
  #capturing = false;
  #lastError: string | null = null;

  constructor(home: string, emit: (event: DesktopSnapShotEvent) => void) {
    this.#dir = NodePath.join(userDataDir(home), "snapshots");
    this.#emit = emit;
  }

  async start(settings: SnapShotSettings): Promise<void> {
    await NodeFSP.mkdir(this.#dir, { recursive: true });
    await this.#loadPending();
    await this.configure(settings);
  }

  async configure(settings: SnapShotSettings): Promise<void> {
    this.#settings = settings;
    this.#unregister();
    if (!settings.enabled) {
      this.#emit({ type: "shortcut-changed" });
      return;
    }
    if (isModifierPairShortcut(settings.shortcut)) {
      const [left, right] = MODIFIER_PAIR_MASKS[snapShotShortcutModifierPair(settings.shortcut)];
      this.#startPoller(left, right);
    } else {
      const accelerator = chordAccelerator(settings.shortcut);
      if (accelerator !== null) {
        try {
          globalShortcut.register(accelerator, () => this.#trigger());
          this.#registeredAccelerator = accelerator;
          this.#registered = true;
          this.#message = null;
        } catch (error) {
          this.#registered = false;
          this.#message = error instanceof Error ? error.message : String(error);
        }
      }
    }
    this.#emit({ type: "shortcut-changed" });
  }

  async state(): Promise<DesktopSnapShotState> {
    let permissions = { screenRecording: true, accessibility: false };
    try {
      permissions = JSON.parse(await jxa(PERMISSIONS)) as typeof permissions;
    } catch {
      // keep the optimistic default; capture reports the real failure
    }
    return {
      mode: "direct",
      shortcut: this.#settings.shortcut,
      shortcutRegistered: this.#registered,
      shortcutLabel: snapShotShortcutLabel(this.#settings.shortcut),
      shortcutMessage: this.#message,
      macPermissions: permissions,
      message: this.#lastError,
    };
  }

  checkShortcut(shortcut: SnapShotShortcut): DesktopSnapShotShortcutAvailability {
    if (isModifierPairShortcut(shortcut)) return { available: true, message: null };
    return chordAccelerator(shortcut) === null
      ? { available: false, message: "This shortcut cannot be registered." }
      : { available: true, message: null };
  }

  setSuppressed(suppressed: boolean): void {
    this.#suppressed = suppressed;
  }

  listPending(): DesktopPendingSnapShot[] {
    return [...this.#pending.values()].map(({ path: _path, ...rest }) => rest);
  }

  async read(id: string): Promise<DesktopSnapShot> {
    const record = this.#pending.get(id);
    if (!record) throw new Error(`Unknown snapshot ${id}.`);
    const bytes = await NodeFSP.readFile(record.path);
    const { path: _path, ...rest } = record;
    return { ...rest, dataUrl: `data:image/png;base64,${bytes.toString("base64")}` };
  }

  async acknowledge(id: string): Promise<void> {
    const record = this.#pending.get(id);
    if (!record) return;
    this.#pending.delete(id);
    await NodeFSP.rm(record.path, { force: true });
    await NodeFSP.rm(`${record.path}.json`, { force: true });
  }

  /** Capture once, outside the shortcut (Settings → "Test capture"). */
  captureNow(): Promise<void> {
    return this.#trigger();
  }

  stop(): void {
    this.#unregister();
  }

  #startPoller(left: number, right: number): void {
    const proc = Bun.spawn(
      ["/usr/bin/osascript", "-l", "JavaScript", "-e", PAIR_POLLER, String(left), String(right)],
      { stdout: "pipe", stderr: "ignore" },
    );
    this.#poller = proc;
    this.#registered = true;
    this.#message = null;
    void (async () => {
      const decoder = new TextDecoder();
      let buffered = "";
      for await (const chunk of proc.stdout) {
        buffered += decoder.decode(chunk, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) if (line.trim() === "trigger") void this.#trigger();
      }
      if (this.#poller === proc) {
        this.#poller = undefined;
        this.#registered = false;
        this.#message = "The shortcut listener stopped.";
        this.#emit({ type: "shortcut-changed" });
      }
    })();
  }

  #unregister(): void {
    if (this.#registeredAccelerator !== undefined) {
      globalShortcut.unregister(this.#registeredAccelerator);
      this.#registeredAccelerator = undefined;
    }
    if (this.#poller !== undefined) {
      const poller = this.#poller;
      this.#poller = undefined;
      poller.kill();
    }
    this.#registered = false;
  }

  async #loadPending(): Promise<void> {
    const entries = await NodeFSP.readdir(this.#dir).catch(() => [] as string[]);
    for (const entry of entries) {
      if (!entry.endsWith(".png.json")) continue;
      try {
        const record = JSON.parse(
          await NodeFSP.readFile(NodePath.join(this.#dir, entry), "utf8"),
        ) as PendingRecord;
        this.#pending.set(record.id, record);
      } catch {
        // a torn write; the png beside it is unreachable anyway
      }
    }
  }

  async #trigger(): Promise<void> {
    devtools.event({
      type: "snapshot.trigger",
      data: { suppressed: this.#suppressed, capturing: this.#capturing },
    });
    if (this.#suppressed || this.#capturing) return;
    this.#capturing = true;
    const id = crypto.randomUUID() as DesktopSnapShotId;
    this.#emit({ type: "requested", id });
    try {
      const target = JSON.parse(await jxa(ACTIVE_WINDOW)) as {
        id: number;
        title: string;
        appName: string;
      } | null;
      devtools.event({ type: "snapshot.target", data: { target } });
      if (target === null) throw new Error("No window to capture.");
      this.#emit({ type: "started", id });
      const path = NodePath.join(this.#dir, `${id}.png`);
      const capture = Bun.spawn(
        ["/usr/sbin/screencapture", "-l", String(target.id), "-o", "-x", "-t", "png", path],
        { stdout: "ignore", stderr: "ignore" },
      );
      if ((await capture.exited) !== 0) throw new Error("screencapture failed.");
      const size = (await NodeFSP.stat(path)).size;
      if (size === 0) throw new Error("screencapture produced an empty file.");
      const stamp = new Date();
      const record: PendingRecord = {
        id,
        name: `SnapShot ${stamp.toISOString().slice(0, 19).replace("T", " ").replaceAll(":", ".")}.png`,
        mimeType: "image/png",
        sizeBytes: size,
        source: {
          kind: "snap-shot",
          capturedAt: stamp.toISOString(),
          appName: target.appName.slice(0, 255),
          windowTitle: target.title.slice(0, 1000),
        },
        path,
      };
      await NodeFSP.writeFile(`${path}.json`, JSON.stringify(record));
      this.#pending.set(id, record);
      if (this.#settings.playSound) {
        Bun.spawn(["/usr/bin/afplay", "/System/Library/Sounds/Pop.aiff"], {
          stdout: "ignore",
          stderr: "ignore",
        });
      }
      this.#lastError = null;
      this.#emit({ type: "ready", id });
    } catch (error) {
      this.#lastError = error instanceof Error ? error.message : String(error);
      devtools.event({ type: "snapshot.failed", msg: this.#lastError });
      this.#emit({ type: "failed", id });
    } finally {
      this.#capturing = false;
    }
  }
}
