// Stages what the packaged app needs beside the shell: the server as a bun
// bundle with its native externals installed, the web build it serves, and the
// bun binary that runs it. `mirin build` then copies vendor/server as a resource
// and vendor/bun as a sidecar (see mirin.config.ts).
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { $ } from "bun";

import { selectCliRuntimeExternalDependencies } from "../../../scripts/lib/cli-external-packages.ts";

const appDir = NodePath.resolve(import.meta.dir, "..");
const serverDir = NodePath.resolve(appDir, "..", "server");
const webDist = NodePath.resolve(appDir, "..", "web", "dist");
const vendor = NodePath.join(appDir, "vendor");
const out = NodePath.join(vendor, "server");

const EXTERNAL_PATTERNS = [
  "@cursor/sdk",
  "@cursor/*",
  "playwright-core",
  "playwright-core/*",
  "node-pty",
  "ffi-rs",
  "@yuuang/*",
  "@ff-labs/*",
  "@napi-rs/keyring",
  "node-gyp-build",
  "node-addon-api",
  "bufferutil",
  "utf-8-validate",
];

if (!NodeFS.existsSync(NodePath.join(webDist, "index.html"))) {
  throw new Error(`apps/web is not built (${webDist}); run \`bun run build\` in apps/web first.`);
}

NodeFS.rmSync(out, { recursive: true, force: true });
NodeFS.mkdirSync(out, { recursive: true });

console.log("[stage] bundling the server with bun…");
const externals = EXTERNAL_PATTERNS.flatMap((pattern) => ["--external", pattern]);
await $`bun build ${NodePath.join(serverDir, "src", "bin.ts")} ${NodePath.join(serverDir, "src", "claude-history-worker.ts")} --target=bun --outdir ${out} ${externals}`.cwd(
  serverDir,
);

const serverPackage = (await Bun.file(NodePath.join(serverDir, "package.json")).json()) as {
  version: string;
  dependencies: Record<string, string>;
};
const dependencies = selectCliRuntimeExternalDependencies(serverPackage.dependencies);
await Bun.write(
  NodePath.join(out, "package.json"),
  `${JSON.stringify(
    {
      name: "t3-code-mirin-server",
      version: serverPackage.version,
      private: true,
      type: "module",
      dependencies,
      // node-pty's build script is skipped on purpose: the Bun runtime uses Bun.Terminal.
      trustedDependencies: [],
    },
    null,
    2,
  )}\n`,
);
console.log("[stage] installing the server's native externals…");
await $`bun install --production --no-save`.cwd(out);

console.log("[stage] copying the web build…");
NodeFS.cpSync(webDist, NodePath.join(out, "client"), { recursive: true });

const bunBinary = Bun.which("bun") ?? process.execPath;
NodeFS.copyFileSync(bunBinary, NodePath.join(vendor, "bun"));
NodeFS.chmodSync(NodePath.join(vendor, "bun"), 0o755);

const size = (await $`du -sh ${out}`.text()).split("\t")[0];
console.log(`[stage] done: vendor/server (${size}), vendor/bun`);
