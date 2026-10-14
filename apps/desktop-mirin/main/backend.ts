import * as NodePath from "node:path";
import { bootstrapRemoteBearerSession } from "@t3tools/client-runtime/authorization";
import type { DesktopBackendBootstrap, DesktopEnvironmentBootstrap } from "@t3tools/contracts";
import { PRIMARY_LOCAL_ENVIRONMENT_ID } from "@t3tools/contracts";
import { currentDesktopBootstrapToken } from "@t3tools/shared/desktopBootstrapToken";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";

// Well above the official T3 Code app's 3773 so the two never share a port.
const DEFAULT_PORT = 3873;
const READY_TIMEOUT_MS = 60_000;

export interface BackendHandle {
  readonly port: number;
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

async function waitForReady(httpBaseUrl: string, isAlive: () => boolean): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isAlive()) throw new Error("The backend exited before it became ready.");
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

/** Dev: the server runs from source with bun. Packaged builds will ship a sidecar. */
function serverEntry(): { cwd: string; entry: string } {
  const cwd = NodePath.resolve(process.cwd(), "..", "server");
  return { cwd, entry: NodePath.resolve(cwd, "src", "bin.ts") };
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

  const { cwd, entry } = serverEntry();
  options.onStatus(`Starting the backend on port ${port}…`);
  const proc = Bun.spawn(["bun", entry, "serve", "--bootstrap-fd", "0"], {
    cwd,
    env: {
      ...process.env,
      T3CODE_HOME: options.home,
      // The fork must not report into upstream's product analytics.
      T3CODE_TELEMETRY_ENABLED: "false",
    },
    stdin: new Blob([`${JSON.stringify(envelope)}\n`]),
    stdout: "pipe",
    stderr: "pipe",
  });
  pipeLines(proc.stdout, "[backend]");
  pipeLines(proc.stderr, "[backend!]");
  let exited = false;
  void proc.exited.then((code) => {
    exited = true;
    options.onStatus(`The backend exited with code ${code}.`);
  });

  await waitForReady(httpBaseUrl, () => !exited);
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
      if (!exited) proc.kill();
    },
  };
}
