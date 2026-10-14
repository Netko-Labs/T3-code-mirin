import type { BackendHandle } from "./backend.ts";

// The router's handlers and the lifecycle in main.ts share the running backend
// through this module so neither has to import the other.
export const shell: { backend: BackendHandle | undefined } = { backend: undefined };
