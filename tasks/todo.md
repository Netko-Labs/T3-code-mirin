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

- [x] server boots under Bun unchanged except `node:sea` (HostProcess.IsExecutable is now runtime-aware)
- [x] `PtyAdapter` on `Bun.Terminal` (`BunTerminalAdapter`, picked when Bun is the runtime); node-pty stays for Node
- [x] probes under Bun: @napi-rs/keyring ok, @ff-labs/fff-node (ffi-rs) ok, @cursor/sdk loads, playwright-core ok
- [x] E2E on Bun: paired UI, Claude Haiku thread answered, terminal drawer ran a command
- [ ] deferred: `@effect/platform-node` → `platform-bun` (runs fine on Bun as-is; swap when WS perf matters)
- [ ] deferred to M4: `bun build --compile` sidecar + self-invocation for packaged builds
- [ ] follow-up: thread title generation warned once (cause truncated by Bun console depth); compare on Node
- Acceptance met: `cd apps/server && T3CODE_HOME=~/.t3-mirin bun src/bin.ts serve` → UI at :3773 with a Claude thread + terminal.

## M2 — mirin shell (daily-usable)

- mirin P0s: scoped preload, bootData, shell.openExternal, secureStorage, nativeTheme, notifications polyfill
- [ ] `apps/desktop-mirin`: config, server spawn (stdin bootstrap), app:// serving web build, desktopBridge subset
- Acceptance: `cd apps/desktop-mirin && bun run dev` boots; `mirin check` green in CI.

## M3 — preview parity · M4 — native polish (macOS) · M5 — Linux/Windows

See plan.html.

## Lessons

- (none yet)
