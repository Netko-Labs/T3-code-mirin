import * as NodePath from "node:path";
import { resolveResource, resolveSidecar } from "mirinjs";
import { bootstrapRemoteBearerSession } from "@t3tools/client-runtime/authorization";
import type { DesktopBackendBootstrap, DesktopEnvironmentBootstrap } from "@t3tools/contracts";
import { PRIMARY_LOCAL_ENVIRONMENT_ID, SERVER_EXIT_CODE_STATE_DIR_OWNED } from "@t3tools/contracts";
import { currentDesktopBootstrapToken } from "@t3tools/shared/desktopBootstrapToken";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";

// Well above the official T3 Code app's 3773 so the two never share a port.
const DEFAULT_PORT = 3873;
const READY_TIMEOUT_MS = 60_000;

export interface BackendHandle {
  readonly port: number;
  /** The CLI entry the `t3-mirin` shim runs. */
  readonly serverEntry: string;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  /** The renderer's bootstrap for the primary environment, minted fresh per call. */
  primaryBootstrap(): DesktopEnvironmentBootstrap;
  bearerToken(): Promise<string>;
  stop(): void;
}

export interface StartBackendOptions {
  home: string;
  label: string;
  onStatus(message: string): void;
}

// A loopback-only bind succeeds beside a wildcard listener on the same port, so
// every family and the wildcard must be free before the port counts as free.
const PROBE_HOSTS = ["127.0.0.1", "0.0.0.0", "::"];

function canBind(hostname: string, port: number): boolean {
  try {
    const probe = Bun.listen({ hostname, port, socket: { data() {} } });
    probe.stop(true);
    return true;
  } catch {
    return false;
  }
}

async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 50; port++) {
    if (PROBE_HOSTS.every((hostname) => canBind(hostname, port))) return port;
  }
  throw new Error(`No free port in ${start}–${start + 49}`);
}

async function waitForReady(
  httpBaseUrl: string,
  exitMessage: () => string | undefined,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const exited = exitMessage();
    if (exited !== undefined) throw new Error(exited);
    try {
      const res = await fetch(`${httpBaseUrl}/.well-known/t3/environment`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await Bun.sleep(250);
  }
  throw new Error("The backend did not become ready in time.");
}

function pipeLines(stream: ReadableStream<Uint8Array>, prefix: string): void {
  void (async () => {
    const decoder = new TextDecoder();
    let buffered = "";
    for await (const chunk of stream) {
      buffered += decoder.decode(chunk, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) if (line.length > 0) console.log(`${prefix} ${line}`);
    }
    if (buffered.length > 0) console.log(`${prefix} ${buffered}`);
  })();
}

interface ServerLaunch {
  readonly command: string;
  readonly cwd: string;
  readonly entry: string;
  readonly preload: string;
}

// Dev (`mirin dev`) runs apps/server from source with the developer's bun;
// a packaged app runs the staged bundle with the bundled bun sidecar.
function serverLaunch(): ServerLaunch {
  if (process.env["MIRIN_DEV_URL"] !== undefined) {
    const cwd = NodePath.resolve(process.cwd(), "..", "server");
    return {
      command: "bun",
      cwd,
      entry: NodePath.resolve(cwd, "src", "bin.ts"),
      preload: NodePath.resolve(import.meta.dir, "..", "server", "watchdog.ts"),
    };
  }
  const cwd = resolveResource("server");
  return {
    command: resolveSidecar("bun"),
    cwd,
    entry: NodePath.join(cwd, "bin.js"),
    preload: NodePath.join(cwd, "watchdog.js"),
  };
}

export async function startBackend(options: StartBackendOptions): Promise<BackendHandle> {
  const port = await findFreePort(DEFAULT_PORT);
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const httpBaseUrl = `http://127.0.0.1:${port}`;
  const wsBaseUrl = `ws://127.0.0.1:${port}`;

  const envelope: DesktopBackendBootstrap = {
    mode: "desktop",
    noBrowser: true,
    port,
    t3Home: options.home,
    host: "127.0.0.1",
    desktopBootstrapToken: currentDesktopBootstrapToken(secret, Date.now()),
    desktopBootstrapSecret: secret,
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  };

  const { command, cwd, entry, preload } = serverLaunch();
  options.onStatus(`Starting the backend on port ${port}…`);
  const proc = Bun.spawn([command, "--preload", preload, entry, "serve", "--bootstrap-fd", "0"], {
    cwd,
    env: {
      ...process.env,
      T3CODE_HOME: options.home,
      // The fork must not report into upstream's product analytics.
      T3CODE_TELEMETRY_ENABLED: "false",
      // Read by server/watchdog.ts so the backend follows the host down.
      T3CODE_MIRIN_HOST_PID: String(process.pid),
    },
    stdin: new Blob([`${JSON.stringify(envelope)}\n`]),
    stdout: "pipe",
    stderr: "pipe",
  });
  pipeLines(proc.stdout, "[backend]");
  pipeLines(proc.stderr, "[backend!]");
  let exitMessage: string | undefined;
  void proc.exited.then((code) => {
    exitMessage =
      code === SERVER_EXIT_CODE_STATE_DIR_OWNED
        ? `Another T3 Code server is using ${options.home}. Stop it or set a separate T3CODE_HOME.`
        : `The backend exited with code ${code}.`;
    options.onStatus(exitMessage);
  });

  await waitForReady(httpBaseUrl, () => exitMessage);
  options.onStatus("Backend ready, loading the app…");

  let bearer: Promise<string> | undefined;
  const bearerToken = (): Promise<string> => {
    bearer ??= Effect.runPromise(
      bootstrapRemoteBearerSession({
        httpBaseUrl,
        credential: currentDesktopBootstrapToken(secret, Date.now()),
        clientMetadata: { label: "T3 Code Mirin", deviceType: "desktop" },
      }).pipe(Effect.provide(FetchHttpClient.layer)),
    ).then(
      (result) => result.access_token,
      (error: unknown) => {
        bearer = undefined;
        throw error;
      },
    );
    return bearer;
  };

  return {
    port,
    serverEntry: entry,
    httpBaseUrl,
    wsBaseUrl,
    primaryBootstrap: () => ({
      id: PRIMARY_LOCAL_ENVIRONMENT_ID,
      label: options.label,
      httpBaseUrl,
      wsBaseUrl,
      bootstrapToken: currentDesktopBootstrapToken(secret, Date.now()),
    }),
    bearerToken,
    stop: () => {
      if (exitMessage === undefined) proc.kill();
    },
  };
}
