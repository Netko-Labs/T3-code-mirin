import type {
  DesktopUpdateActionResult,
  DesktopUpdateCheckResult,
  DesktopUpdateState,
  DesktopUpdateStatus,
} from "@t3tools/contracts";
import { type UpdateInfo, updater, type UpdaterStatus } from "mirinjs";

const STATUS: Record<UpdaterStatus, DesktopUpdateStatus> = {
  idle: "idle",
  checking: "checking",
  "update-available": "available",
  downloading: "downloading",
  applying: "downloaded",
  complete: "downloaded",
  error: "error",
};

// Same cadence as the Electron shell: one check shortly after launch, then a
// slow poll. Downloads stay user-driven from the settings UI.
const STARTUP_CHECK_DELAY_MS = 15_000;
const POLL_INTERVAL_MS = 4 * 60_000;

function arch(): DesktopUpdateState["hostArch"] {
  // oxlint-disable-next-line t3code/no-global-process-runtime -- The shell is a mirin app, not Effect code.
  const value = process.arch;
  return value === "arm64" || value === "x64" ? value : "other";
}

/** mirin's updater behind the Electron-shaped update state the settings UI renders. */
export class UpdateBridge {
  #info: UpdateInfo | null = null;
  #checkedAt: string | null = null;
  #checked = false;
  #downloaded = false;
  #percent: number | null = null;
  #message: string | null = null;
  #errorContext: DesktopUpdateState["errorContext"] = null;
  readonly #listeners = new Set<(state: DesktopUpdateState) => void>();
  #startupTimer: ReturnType<typeof setTimeout> | null = null;
  #pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    updater.on("status", () => this.#notify());
    updater.on("progress", ({ fraction }) => {
      this.#percent = Math.round(fraction * 100);
      this.#notify();
    });
    updater.on("error", ({ message }) => {
      this.#message = message;
      this.#notify();
    });
  }

  startPolling(): void {
    if (!updater.enabled || this.#pollTimer !== null) return;
    const poll = () => {
      void this.check().then((result) => {
        const version = result.state.availableVersion;
        console.log(
          version === null
            ? `[updates] ${updater.currentVersion} is current (${result.state.status})`
            : `[updates] ${version} is available, running ${updater.currentVersion}`,
        );
      });
    };
    this.#startupTimer = setTimeout(poll, STARTUP_CHECK_DELAY_MS);
    this.#pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    this.#startupTimer.unref();
    this.#pollTimer.unref();
  }

  stop(): void {
    if (this.#startupTimer !== null) clearTimeout(this.#startupTimer);
    if (this.#pollTimer !== null) clearInterval(this.#pollTimer);
    this.#startupTimer = null;
    this.#pollTimer = null;
  }

  onChange(listener: (state: DesktopUpdateState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  state(): DesktopUpdateState {
    const enabled = updater.enabled;
    const status: DesktopUpdateStatus = !enabled
      ? "disabled"
      : updater.status === "idle" && this.#checked && this.#info === null
        ? "up-to-date"
        : STATUS[updater.status];
    return {
      enabled,
      status,
      channel: updater.channel === "nightly" ? "nightly" : "latest",
      currentVersion: updater.currentVersion,
      hostArch: arch(),
      appArch: arch(),
      runningUnderArm64Translation: false,
      availableVersion: this.#info?.version ?? null,
      downloadedVersion: this.#downloaded ? (this.#info?.version ?? null) : null,
      releaseNotes:
        this.#info?.body === undefined
          ? []
          : [{ version: this.#info.version, items: [this.#info.body], totalItems: 1 }],
      omittedReleaseCount: 0,
      downloadPercent: this.#percent,
      checkedAt: this.#checkedAt,
      message: this.#message,
      errorContext: this.#errorContext,
      canRetry: this.#errorContext !== null,
    };
  }

  async check(): Promise<DesktopUpdateCheckResult> {
    if (!updater.enabled) return { checked: false, state: this.state() };
    this.#message = null;
    this.#errorContext = null;
    try {
      this.#info = await updater.checkForUpdate();
      this.#checked = true;
      this.#checkedAt = new Date().toISOString();
    } catch (error) {
      this.#fail("check", error);
    }
    this.#notify();
    return { checked: this.#errorContext === null, state: this.state() };
  }

  async download(): Promise<DesktopUpdateActionResult> {
    if (!updater.enabled || this.#info === null) return this.#refused();
    this.#message = null;
    this.#errorContext = null;
    try {
      await updater.download();
      this.#downloaded = true;
    } catch (error) {
      this.#fail("download", error);
    }
    this.#notify();
    return { accepted: true, completed: this.#downloaded, state: this.state() };
  }

  async install(): Promise<DesktopUpdateActionResult> {
    if (!updater.enabled || !this.#downloaded) return this.#refused();
    try {
      await updater.applyAndRelaunch();
    } catch (error) {
      this.#fail("install", error);
      this.#notify();
      return { accepted: true, completed: false, state: this.state() };
    }
    return { accepted: true, completed: true, state: this.state() };
  }

  #refused(): DesktopUpdateActionResult {
    return { accepted: false, completed: false, state: this.state() };
  }

  #fail(context: NonNullable<DesktopUpdateState["errorContext"]>, error: unknown): void {
    this.#errorContext = context;
    this.#message = error instanceof Error ? error.message : String(error);
  }

  #notify(): void {
    const state = this.state();
    for (const listener of this.#listeners) listener(state);
  }
}
