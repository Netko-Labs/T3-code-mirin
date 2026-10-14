import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION,
  type DesktopAppActivationRequest,
  type DesktopAppActivationResponse,
} from "@t3tools/contracts";
import { resolveDesktopAppControlAddress } from "@t3tools/shared/desktopAppControl";

import { userDataDir } from "./settings.ts";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REQUEST_BYTES = 64 * 1024;

export interface ActivationBroker {
  readonly address: string;
  /** The renderer announces whether it can take requests. */
  setReady(ready: boolean): void;
  /** The renderer answers a request it was handed. */
  complete(response: DesktopAppActivationResponse): void;
  stop(): void;
}

interface Pending {
  readonly reply: (response: DesktopAppActivationResponse) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

function failure(
  requestId: string,
  code: "invalid-request" | "renderer-unavailable" | "request-timeout" | "internal-error",
  message: string,
): DesktopAppActivationResponse {
  return { version: DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION, requestId, ok: false, code, message };
}

function parseRequest(line: string): DesktopAppActivationRequest | null {
  try {
    const value = JSON.parse(line) as Partial<DesktopAppActivationRequest>;
    if (
      value.version === DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION &&
      typeof value.requestId === "string" &&
      value.type === "open-workspace" &&
      typeof value.workspaceRoot === "string" &&
      (value.platform === "darwin" || value.platform === "linux" || value.platform === "win32")
    ) {
      return value as DesktopAppActivationRequest;
    }
  } catch {
    // fall through
  }
  return null;
}

/** Hosts the `t3 app <dir>` control socket the server CLI connects to. */
export async function startActivationBroker(
  home: string,
  onRequest: (request: DesktopAppActivationRequest) => void,
): Promise<ActivationBroker> {
  const { address } = resolveDesktopAppControlAddress({
    stateDir: userDataDir(home),
    // oxlint-disable-next-line t3code/no-global-process-runtime -- The shell is a mirin app, not Effect code.
    platform: process.platform,
    tempDir: NodeOS.tmpdir(),
    userId: NodeOS.userInfo().uid,
    joinPath: NodePath.join,
  });
  await NodeFSP.unlink(address).catch(() => undefined);

  const pending = new Map<string, Pending>();
  let rendererReady = false;

  const server = Bun.listen<{ buffer: string }>({
    unix: address,
    socket: {
      open(socket) {
        socket.data = { buffer: "" };
      },
      data(socket, chunk) {
        socket.data.buffer += chunk.toString();
        if (socket.data.buffer.length > MAX_REQUEST_BYTES) {
          socket.end(
            `${JSON.stringify(failure("invalid-request", "invalid-request", "The request is too large."))}\n`,
          );
          return;
        }
        const newline = socket.data.buffer.indexOf("\n");
        if (newline === -1) return;
        const line = socket.data.buffer.slice(0, newline);
        const request = parseRequest(line);
        const reply = (response: DesktopAppActivationResponse) => {
          socket.end(`${JSON.stringify(response)}\n`);
        };
        if (request === null) {
          reply(failure("invalid-request", "invalid-request", "Malformed desktop app request."));
          return;
        }
        if (!rendererReady) {
          reply(failure(request.requestId, "renderer-unavailable", "The app window is not ready."));
          return;
        }
        const timer = setTimeout(() => {
          pending.delete(request.requestId);
          reply(failure(request.requestId, "request-timeout", "The app did not answer in time."));
        }, REQUEST_TIMEOUT_MS);
        pending.set(request.requestId, { reply, timer });
        onRequest(request);
      },
      error(_socket, error) {
        console.error(`[activation] socket error: ${error.message}`);
      },
    },
  });

  return {
    address,
    setReady: (ready) => {
      rendererReady = ready;
    },
    complete: (response) => {
      const entry = pending.get(response.requestId);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(response.requestId);
      entry.reply(response);
    },
    stop: () => {
      server.stop(true);
      void NodeFSP.unlink(address).catch(() => undefined);
    },
  };
}
