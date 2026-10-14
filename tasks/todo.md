# T3-code-mirin — port t3code to mirin

Plan of record: `mirin/tasks/design/t3code-fork/plan.html` (Juan's repo, gitignored).
Decisions: fork = Netko-Labs/T3-code-mirin · macOS first · shell lives in `apps/desktop-mirin`
beside Electron until parity · package manager bun, keep vite-plus/oxlint/tsgo · server ships as a
`bun build --compile` sidecar · T3 Connect / passkeys / default-browser / mobile / marketing / relay
deferred · separate data home (`T3CODE_HOME`) · mirin consumed via `file:` link until alpha tags.

## M0 — fork + green

- [x] fork + clone, `upstream` remote
- [x] bun workspaces (pruned: no mobile/marketing/infra), catalog, overrides, patches, hoisted linker
- [x] `bun install` migrates pnpm-lock; all 11 kept patches verified in node_modules
- [x] `bun run typecheck` green (11 workspaces)
- [x] `vp test` green: contracts 661, shared 1572, client-runtime 2094, web 6772, server 5990 (macOS needs `TMPDIR=$HOME/t3tmp` + playwright chromium; see lessons)
- [x] pnpm-lock.yaml dropped, pnpm-workspace kept as `.pnpm-reference`; ci.yml installs bun
- Acceptance: fresh clone → `bun install && bun run typecheck && bun run test` passes on macOS.

## M1 — server on Bun

- [ ] `@effect/platform-node` → `@effect/platform-bun` (≈11 sites); port Windows taskkill patch
- [ ] `PtyAdapter` on `Bun.Terminal` (POSIX); keep node-pty path for Windows
- [ ] fff via `bun:ffi`; probe `@napi-rs/keyring`, `@cursor/sdk`, playwright-core under Bun
- [ ] self-invocation (`process.execPath`) → bun / compiled binary; `bun build --compile` sidecar
- Acceptance: `bun apps/server/src/bin.ts serve` → browser UI at :3773, one Claude thread + terminal work.

## M2 — mirin shell (daily-usable)

- mirin P0s: scoped preload, bootData, shell.openExternal, secureStorage, nativeTheme, notifications polyfill
- [ ] `apps/desktop-mirin`: config, server spawn (stdin bootstrap), app:// serving web build, desktopBridge subset
- Acceptance: `cd apps/desktop-mirin && bun run dev` boots; `mirin check` green in CI.

## M3 — preview parity · M4 — native polish (macOS) · M5 — Linux/Windows

See plan.html.

## Lessons

- (none yet)
