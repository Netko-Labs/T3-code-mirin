import { readMirinRendererBoot } from "./boot";
import { createMirinDesktopBridge, installMirinNotifications, shellApi } from "./bridge";

// Matches the Electron preload: the sidebar header leaves this much room for
// the traffic lights (window zoom is 1 under mirin).
const MACOS_WINDOW_CONTROLS_INSET = "90px";

// Runs before env.ts samples window.desktopBridge: main.tsx imports this first.
const transport = typeof window === "undefined" ? undefined : window.mirin;
if (transport !== undefined && window.desktopBridge === undefined) {
  const boot = readMirinRendererBoot();
  if (boot !== null) {
    window.desktopBridge = createMirinDesktopBridge(transport, boot);
    installMirinNotifications(shellApi(transport));
    if (boot.platform === "darwin") {
      document.documentElement.style.setProperty(
        "--desktop-window-controls-inset",
        MACOS_WINDOW_CONTROLS_INSET,
      );
    }
  }
}
