import { app } from "mirinjs";

import { startActivationBroker } from "./activation.ts";
import { startBackend } from "./backend.ts";
import { installApplicationMenu } from "./menu.ts";
import { router, T3_HOME } from "./rpc.ts";
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
      label: (await import("node:os")).hostname(),
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
  shell.activation?.stop();
  shell.backend?.stop();
  app.quit();
});
