import * as NodeOS from "node:os";
import { app } from "mirinjs";

import { startBackend } from "./backend.ts";
import { installApplicationMenu } from "./menu.ts";
import { router, T3_HOME } from "./rpc.ts";
import { shell } from "./state.ts";

const mirin = app.serve(router);

const broadcastMenuAction = (action: string) => mirin.rpc.menuAction.broadcast({ action });

function uiUrl(): string {
  const backend = shell.backend;
  if (!backend) throw new Error("backend not started");
  const boot = {
    branding: { baseName: "T3 Code", stageLabel: "Dev", displayName: "T3 Code Mirin" },
    // oxlint-disable-next-line t3code/no-global-process-runtime -- The shell is a mirin app, not Effect code.
    platform: process.platform,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    bootstraps: [backend.primaryBootstrap()],
  };
  const encoded = Buffer.from(JSON.stringify(boot)).toString("base64url");
  return `${backend.httpBaseUrl}/?mirinBoot=${encoded}`;
}

app.on("ready", async () => {
  installApplicationMenu(broadcastMenuAction);
  const window = app.windows.get("main");
  try {
    shell.backend = await startBackend({
      home: T3_HOME,
      label: NodeOS.hostname(),
      onStatus: (message) => {
        console.log(`[shell] ${message}`);
        mirin.rpc.backendStatus.broadcast({ message });
      },
    });
    await window.loadUrl(uiUrl());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[shell] backend failed: ${message}`);
    mirin.rpc.backendStatus.broadcast({ message: `Backend failed: ${message}` });
  }
});

app.on("window-all-closed", () => {
  shell.backend?.stop();
  app.quit();
});
