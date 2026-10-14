import type { DesktopAppBranding, DesktopEnvironmentBootstrap } from "@t3tools/contracts";

export interface MirinRendererBoot {
  readonly branding: DesktopAppBranding;
  readonly platform: string;
  readonly locale: string;
  readonly bootstraps: ReadonlyArray<DesktopEnvironmentBootstrap>;
}

const BOOT_PARAM = "mirinBoot";

/**
 * The shell hands the renderer its synchronous facts (branding, bootstraps)
 * through a query parameter on the first navigation, since mirin's RPC is
 * asynchronous. The parameter is stripped before the router sees the URL.
 */
export function readMirinRendererBoot(): MirinRendererBoot | null {
  const url = new URL(window.location.href);
  const encoded = url.searchParams.get(BOOT_PARAM);
  if (encoded === null) return null;
  url.searchParams.delete(BOOT_PARAM);
  window.history.replaceState(window.history.state, "", url.toString());
  try {
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
    );
    return JSON.parse(json) as MirinRendererBoot;
  } catch {
    return null;
  }
}
