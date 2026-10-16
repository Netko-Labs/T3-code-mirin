import { defineConfig } from "mirinjs/config";

// Nightly and preview builds wear upstream's nightly icon, everything else the
// black one. The release workflow sets MIRIN_APP_VERSION; local builds have none.
const isNightlyBuild = /-(?:nightly|preview)\.\d{8}\.\d+$/.test(
  process.env.MIRIN_APP_VERSION ?? "",
);
const brandDir = isNightlyBuild ? "../../assets/nightly" : "../../assets/prod";
const brandPng = isNightlyBuild ? "nightly-macos-1024.png" : "black-macos-1024.png";

export default defineConfig({
  id: "dev.netko-labs.t3-code-mirin",
  name: "T3 Code Mirin",
  main: "main/main.ts",
  // The Icon Composer document carries macOS 26 appearance variants; the PNG
  // is the iconutil fallback and the Linux/Windows source.
  icon: { default: `${brandDir}/${brandPng}`, macos: `${brandDir}/app-icon.icon` },
  // Own scheme on purpose: t3code:// stays with the official app.
  urlSchemes: ["t3code-mirin"],
  // Packaged builds run the staged server bundle with the bundled bun
  // (scripts/stage-server.ts fills vendor/). Dev runs apps/server from source.
  // Updater artifacts from mirin release, published to the fork's GitHub Releases.
  release: {
    baseUrl: "https://github.com/Netko-Labs/T3-code-mirin/releases/latest/download",
    channel: "stable",
  },
  // bun JITs and dlopens the server's .node addons (signed by us, not Apple):
  // without these the hardened-runtime sidecar dies on first addon load.
  sidecars: {
    bun: {
      bin: "vendor/bun",
      entitlements: ["allow-jit", "allow-unsigned-executable-memory", "disable-library-validation"],
    },
  },
  resources: { server: "vendor/server" },
  windows: {
    main: {
      title: "T3 Code Mirin",
      width: 1280,
      height: 860,
      minWidth: 900,
      minHeight: 600,
      // The splash; main/main.ts swaps it for the server-served UI once the
      // backend answers.
      url: "app://ui/index.html",
      titleBarStyle: "hiddenInset",
      // Centered in the 52px workspace topbar like the Electron shell (26 - 7).
      trafficLightPosition: { x: 16, y: 19 },
      show: "ready",
    },
  },
});
