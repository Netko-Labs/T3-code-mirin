import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { app } from "mirinjs";

import { startActivationBroker } from "./activation.ts";
import { startBackend } from "./backend.ts";
import { installApplicationMenu } from "./menu.ts";
import { router, snapShotSettings, T3_HOME } from "./rpc.ts";
import { readJsonFile, userDataDir } from "./settings.ts";
import { SnapShotController } from "./snapshot.ts";
import { UpdateBridge } from "./updates.ts";
import { shell } from "./state.ts";

const mirin = app.serve(router);

const broadcastMenuAction = (action: string) => mirin.rpc.menuAction.broadcast({ action });

// The web app understands t3code:// links; the fork registers its own scheme
// so it never captures the official app's URLs, and normalizes on the way in.
const OWN_SCHEME = "t3code-mirin:";
function deliverWebLink(url: string): void {
  const normalized = url.startsWith(OWN_SCHEME) ? `t3code:${url.slice(OWN_SCHEME.length)}` : url;
  if (shell.webLinksReady) mirin.rpc.webLinkOpen.broadcast({ url: normalized });
  else shell.queuedWebLinks.push(normalized);
}
shell.flushWebLinks = () => {
  for (const url of shell.queuedWebLinks.splice(0)) mirin.rpc.webLinkOpen.broadcast({ url });
};
app.on("open-url", deliverWebLink);

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
  const updates = new UpdateBridge();
  updates.onChange((state) => mirin.rpc.updateStateChanged.broadcast(state));
  shell.updates = updates;
  // oxlint-disable-next-line t3code/no-global-process-runtime -- The shell is a mirin app, not Effect code.
  if (process.platform === "darwin") {
    const controller = new SnapShotController(T3_HOME, (event) =>
      mirin.rpc.snapShotEvent.broadcast(event),
    );
    shell.snapShots = controller;
    void controller.start(
      snapShotSettings(
        await readJsonFile(NodePath.join(userDataDir(T3_HOME), "client-settings.json")),
      ),
    );
  }
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
    shell.activation = await startActivationBroker(T3_HOME, (request) =>
      mirin.rpc.appActivationRequest.broadcast(request),
    );
    await window.loadUrl(uiUrl());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[shell] backend failed: ${message}`);
    mirin.rpc.backendStatus.broadcast({ message: `Backend failed: ${message}` });
  }
});

app.on("window-all-closed", () => {
  shell.snapShots?.stop();
  shell.activation?.stop();
  shell.backend?.stop();
  app.quit();
});
