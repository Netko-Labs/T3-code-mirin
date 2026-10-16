import type { DesktopAppBranding, DesktopAppStageLabel } from "@t3tools/contracts";

const APP_BASE_NAME = "T3 Code";
// Same shape the Electron shell checks: nightlies and previews share one brand.
const PRERELEASE_VERSION_PATTERN = /^[^-+]+-(?:nightly|preview)\.\d{8}\.\d+$/;

export function resolveStageLabel(input: {
  readonly isDev: boolean;
  readonly version: string;
}): DesktopAppStageLabel {
  if (input.isDev) return "Dev";
  return PRERELEASE_VERSION_PATTERN.test(input.version) ? "Nightly" : "Alpha";
}

export function resolveAppBranding(input: {
  readonly isDev: boolean;
  readonly version: string;
}): DesktopAppBranding {
  const stageLabel = resolveStageLabel(input);
  return {
    baseName: APP_BASE_NAME,
    stageLabel,
    displayName: `${APP_BASE_NAME} Mirin (${stageLabel})`,
  };
}
