# T3 Code Mirin (desktop shell)

The mirin shell for T3 Code: a Bun main process and a CEF window. The product UI is `apps/web`,
served by `apps/server`; this package only hosts them. Design and decisions: `docs/mirin-port.md`.

## Develop

```sh
bun install                      # repo root; mirinjs and @mirinjs/cli come through `bun link`
(cd apps/web && bun run build)   # the server serves apps/web/dist
cd apps/desktop-mirin
bun run dev                      # mirin dev: splash window, then the backend-served UI
```

`mirin dev` writes a session under `.mirin/dev/<session>/` with the event stream and an inspector
(screenshots, DOM snapshots, synthetic input). The backend runs from `apps/server/src/bin.ts` with
the developer's `bun`.

## Package

```sh
cd apps/desktop-mirin
bun run build        # stage-server.ts, then mirin build → build/T3 Code Mirin.app
```

`scripts/stage-server.ts` bundles the server with `bun build`, installs its native externals
(Cursor SDK, Playwright, keyring, fff) into `vendor/server/node_modules`, copies the web build to
`vendor/server/client`, and copies the host's `bun` to `vendor/bun`. `mirin.config.ts` ships
`vendor/server` as a resource and `vendor/bun` as a sidecar; the packaged shell runs
`bun --preload watchdog.js bin.js serve` from there (the watchdog exits the server when the host
that spawned it is gone).

## Release

```sh
export MIRIN_SIGN_IDENTITY="Developer ID Application: …"   # keychain identity
export MIRIN_NOTARY_APPLE_ID=… MIRIN_NOTARY_PASSWORD=… MIRIN_NOTARY_TEAM_ID=…
bun run release      # signed + notarized .app, updater artifacts in build/release/
gh release create v<version> build/release/*            # what app.updater polls
```

`release.baseUrl` in `mirin.config.ts` points at this repo's latest GitHub release; the
updater compares `version.json` in the running app with `stable-darwin-arm64-update.json`
there. Without `MIRIN_SIGN_IDENTITY` the build is ad-hoc signed and cannot be notarized or
updated into.

## Isolation from an installed T3 Code

Both can run at once: port base 3873 (official: 3773), data in `~/.t3-mirin`, `t3code-mirin://`
links, a `t3-mirin` CLI, upstream telemetry disabled.
