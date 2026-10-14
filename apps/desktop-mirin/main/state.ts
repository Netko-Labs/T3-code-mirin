import type { ActivationBroker } from "./activation.ts";
import type { BackendHandle } from "./backend.ts";
import type { SnapShotController } from "./snapshot.ts";
import type { UpdateBridge } from "./updates.ts";

// The router's handlers and the lifecycle in main.ts share the running backend
// through this module so neither has to import the other.
export const shell: {
  backend: BackendHandle | undefined;
  activation: ActivationBroker | undefined;
  snapShots: SnapShotController | undefined;
  updates: UpdateBridge | undefined;
  webLinksReady: boolean;
  /** Links that arrived before the renderer subscribed; replayed on ready. */
  queuedWebLinks: string[];
  flushWebLinks: () => void;
} = {
  backend: undefined,
  activation: undefined,
  snapShots: undefined,
  updates: undefined,
  webLinksReady: false,
  queuedWebLinks: [],
  flushWebLinks: () => {},
};
