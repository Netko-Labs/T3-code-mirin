import * as NodeOS from "node:os";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as PtyAdapter from "@t3tools/shared/PtyAdapter";

// The server's tsconfig has no bun-types: only the slice of Bun's API this
// adapter touches is declared here. Keep it in sync with bun.d.ts.
interface BunTerminal {
  write(data: string): number;
  resize(cols: number, rows: number): void;
  close(): void;
}

interface BunTerminalOptions {
  cols: number;
  rows: number;
  name: string;
  data: (terminal: BunTerminal, chunk: Uint8Array) => void;
}

interface BunSubprocess {
  readonly pid: number;
  readonly exited: Promise<number>;
  readonly signalCode: string | null;
  kill(signal?: string | number): void;
}

interface BunRuntime {
  Terminal: new (options: BunTerminalOptions) => BunTerminal;
  spawn(
    command: ReadonlyArray<string>,
    options: { cwd: string; env: NodeJS.ProcessEnv; terminal: BunTerminal },
  ): BunSubprocess;
}

const bunRuntime = (): BunRuntime | undefined => (globalThis as { Bun?: BunRuntime }).Bun;

export const isBunRuntime = (): boolean => bunRuntime() !== undefined;

const signalNumber = (name: string | null): number | null => {
  if (name === null) return null;
  const signals = NodeOS.constants.signals as Record<string, number | undefined>;
  return signals[name] ?? null;
};

class BunTerminalProcess implements PtyAdapter.PtyProcess {
  private readonly subprocess: BunSubprocess;
  private readonly terminal: BunTerminal;
  private readonly decoder = new TextDecoder();
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: PtyAdapter.PtyExitEvent) => void>();
  private exitEvent: PtyAdapter.PtyExitEvent | undefined;

  constructor(bun: BunRuntime, input: PtyAdapter.PtySpawnInput) {
    this.terminal = new bun.Terminal({
      cols: input.cols,
      rows: input.rows,
      name: "xterm-256color",
      data: (_terminal, chunk) => {
        const text = this.decoder.decode(chunk, { stream: true });
        if (text.length === 0) return;
        for (const listener of this.dataListeners) listener(text);
      },
    });
    this.subprocess = bun.spawn([input.shell, ...(input.args ?? [])], {
      cwd: input.cwd,
      env: input.env,
      terminal: this.terminal,
    });
    void this.subprocess.exited.then((exitCode) => {
      const tail = this.decoder.decode();
      if (tail.length > 0) for (const listener of this.dataListeners) listener(tail);
      this.exitEvent = { exitCode, signal: signalNumber(this.subprocess.signalCode) };
      this.terminal.close();
      for (const listener of this.exitListeners) listener(this.exitEvent);
      this.exitListeners.clear();
      this.dataListeners.clear();
    });
  }

  get pid(): number {
    return this.subprocess.pid;
  }

  write(data: string): void {
    if (this.exitEvent) return;
    this.terminal.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.exitEvent) return;
    this.terminal.resize(cols, rows);
  }

  kill(signal?: string): void {
    if (this.exitEvent) return;
    this.subprocess.kill(signal);
  }

  onData(callback: (data: string) => void): () => void {
    this.dataListeners.add(callback);
    return () => {
      this.dataListeners.delete(callback);
    };
  }

  onExit(callback: (event: PtyAdapter.PtyExitEvent) => void): () => void {
    if (this.exitEvent) {
      callback(this.exitEvent);
      return () => {};
    }
    this.exitListeners.add(callback);
    return () => {
      this.exitListeners.delete(callback);
    };
  }
}

export const make = Effect.fn("BunTerminalAdapter.make")(function* () {
  const bun = bunRuntime();
  if (bun === undefined) {
    return yield* Effect.die(new Error("BunTerminalAdapter requires the Bun runtime."));
  }
  return PtyAdapter.PtyAdapter.of({
    spawn: Effect.fn("BunTerminalAdapter.spawn")(function* (input) {
      return yield* Effect.try({
        try: () => new BunTerminalProcess(bun, input),
        catch: (cause) =>
          new PtyAdapter.PtySpawnError({ adapter: "bun-terminal", shell: input.shell, cause }),
      });
    }),
  });
});

export const layer = Layer.effect(PtyAdapter.PtyAdapter, make());
