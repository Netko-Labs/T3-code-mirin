# Lessons

- **bun hoisted linker vs pnpm per-workspace node_modules.** Anything that builds a path like
  `../node_modules/<pkg>/…` relative to a workspace breaks under bun (packages hoist to the root).
  Resolve through the module system instead: `import.meta.resolve("<pkg>/file")`. Found by
  `apps/web/src/bundledDev.test.ts` (2026-10-14).
- **pnpm-only manifest fields** (`allowBuilds`, `packageExtensions`, `"-"` removals,
  `minimumReleaseAge`, `supportedArchitectures`) have no bun equivalent. Nested overrides
  (`a>b`) and `catalog:` do work. Keep `pnpm-workspace.yaml.pnpm-reference` for the _why_ comments.
