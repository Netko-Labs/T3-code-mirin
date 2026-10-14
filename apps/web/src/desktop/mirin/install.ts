import { readMirinRendererBoot } from "./boot";
import { createMirinDesktopBridge, installMirinNotifications, shellApi } from "./bridge";

// Runs before env.ts samples window.desktopBridge: main.tsx imports this first.
const transport = typeof window === "undefined" ? undefined : window.mirin;
if (transport !== undefined && window.desktopBridge === undefined) {
  const boot = readMirinRendererBoot();
  if (boot !== null) {
    window.desktopBridge = createMirinDesktopBridge(transport, boot);
    installMirinNotifications(shellApi(transport));
  }
}
