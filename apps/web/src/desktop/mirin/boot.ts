import type { DesktopAppBranding, DesktopEnvironmentBootstrap } from "@t3tools/contracts";

export interface MirinRendererBoot {
  readonly branding: DesktopAppBranding;
  readonly platform: string;
  readonly locale: string;
  readonly bootstraps: ReadonlyArray<DesktopEnvironmentBootstrap>;
}

const BOOT_PARAM = "mirinBoot";
const BOOT_STORAGE_KEY = "t3code-mirin:boot";

function decodeBoot(encoded: string): MirinRendererBoot | null {
  try {
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
    );
    return JSON.parse(json) as MirinRendererBoot;
  } catch {
    return null;
  }
}

/**
 * The shell hands the renderer its synchronous facts (branding, bootstraps)
 * through a query parameter on the first navigation, since mirin's RPC is
 * asynchronous. The parameter is stripped before the router sees the URL and
 * kept in sessionStorage so a reload stays in desktop mode.
 */
export function readMirinRendererBoot(): MirinRendererBoot | null {
  const url = new URL(window.location.href);
  const encoded = url.searchParams.get(BOOT_PARAM);
  if (encoded !== null) {
    url.searchParams.delete(BOOT_PARAM);
    window.history.replaceState(window.history.state, "", url.toString());
    const boot = decodeBoot(encoded);
    if (boot !== null) window.sessionStorage.setItem(BOOT_STORAGE_KEY, JSON.stringify(boot));
    return boot;
  }
  const stored = window.sessionStorage.getItem(BOOT_STORAGE_KEY);
  if (stored === null) return null;
  try {
    return JSON.parse(stored) as MirinRendererBoot;
  } catch {
    return null;
  }
}
