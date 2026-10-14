// Runs only under Bun: `bun scripts/smoke-bun-terminal.ts`. vitest executes on
// Node, where Bun.Terminal does not exist, so the adapter is proven here.
import * as Effect from "effect/Effect";

import * as BunTerminalAdapter from "../src/terminal/BunTerminalAdapter.ts";

const program = Effect.gen(function* () {
  const adapter = yield* BunTerminalAdapter.make();
  const spawned = yield* adapter.spawn({
    shell: "/bin/sh",
    args: ["-c", "stty size; echo SMOKE_OK; exit 3"],
    cwd: process.cwd(),
    cols: 100,
    rows: 30,
    env: process.env,
  });
  let output = "";
  spawned.onData((chunk) => {
    output += chunk;
  });
  const exit = yield* Effect.callback<{ exitCode: number; signal: number | null }>((resume) => {
    spawned.onExit((event) => resume(Effect.succeed(event)));
  });
  const ok =
    spawned.pid > 0 &&
    exit.exitCode === 3 &&
    output.includes("30 100") &&
    output.includes("SMOKE_OK");
  console.log(
    ok
      ? "bun terminal smoke: ok"
      : `bun terminal smoke: FAILED ${JSON.stringify({ exit, output })}`,
  );
  if (!ok) process.exit(1);
});

await Effect.runPromise(program);
