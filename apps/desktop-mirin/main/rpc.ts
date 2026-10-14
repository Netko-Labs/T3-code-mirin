import * as NodePath from "node:path";
import {
  type ContextMenuItemSchemaType,
  type DesktopAppActivationRequest,
  type DesktopAppActivationResponse,
  type PickFolderOptions,
  REMOTE_CAPABLE_EDITOR_IDS,
  remoteSchemeForEditor,
} from "@t3tools/contracts";
import {
  cancelCodexAuthCallback,
  receiveCodexAuthCallback,
} from "@t3tools/shared/codexAuthCallback";
import { dialog, menu, type MenuItemTemplate, notification } from "mirinjs";
import { rpc } from "mirinjs/rpc";

import { cliCommandState, installCliCommand, uninstallCliCommand } from "./cli.ts";
import { readJsonFile, userDataDir, writeJsonFile } from "./settings.ts";
import { shell } from "./state.ts";

export const T3_HOME =
  process.env["T3CODE_HOME"] ?? NodePath.join(process.env["HOME"] ?? "~", ".t3-mirin");

const CLIENT_SETTINGS_FILE = NodePath.join(userDataDir(T3_HOME), "client-settings.json");

// Web links plus the editor deep-link schemes the web app builds; nothing else leaves the app.
const OPEN_EXTERNAL_SCHEMES = new Set([
  "http:",
  "https:",
  "mailto:",
  ...REMOTE_CAPABLE_EDITOR_IDS.flatMap((id) => {
    const scheme = remoteSchemeForEditor(id);
    return scheme === undefined ? [] : [`${scheme}:`];
  }),
]);

async function openExternal(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!OPEN_EXTERNAL_SCHEMES.has(parsed.protocol)) return false;
  const proc = Bun.spawn(["open", parsed.href], { stdout: "ignore", stderr: "ignore" });
  return (await proc.exited) === 0;
}

function backend() {
  const running = shell.backend;
  if (!running) throw new Error("The backend is not running yet.");
  return running;
}

function contextMenuTemplate(
  items: readonly ContextMenuItemSchemaType[],
  resolve: (id: string) => void,
): MenuItemTemplate[] {
  return items.flatMap((item) => {
    const entry: MenuItemTemplate = item.children
      ? { label: item.label, submenu: contextMenuTemplate(item.children, resolve) }
      : {
          label: item.label,
          enabled: !item.disabled && !item.header,
          ...(item.checked === undefined ? {} : { checked: item.checked }),
          click: () => resolve(item.id),
        };
    return item.separatorBefore ? [{ type: "separator" as const }, entry] : [entry];
  });
}

export const router = rpc.router({
  backendStatus: rpc.event<{ message: string }>(),
  menuAction: rpc.event<{ action: string }>(),
  webLinkOpen: rpc.event<{ url: string }>(),
  appActivationRequest: rpc.event<DesktopAppActivationRequest>(),

  getBearerToken: rpc.query(async (_: null) => backend().bearerToken()),

  getClientSettings: rpc.query(async (_: null) => readJsonFile(CLIENT_SETTINGS_FILE)),
  setClientSettings: rpc.mutation(async (settings: unknown) =>
    writeJsonFile(CLIENT_SETTINGS_FILE, settings),
  ),

  pickFolder: rpc.mutation(async (_options: PickFolderOptions | null) => {
    const picked = await dialog.openFile({ directories: true, message: "Choose a project folder" });
    return picked?.[0] ?? null;
  }),

  openExternal: rpc.mutation(async (url: string) => openExternal(url)),

  cliCommandState: rpc.query(async (_: null) => cliCommandState(T3_HOME)),
  cliCommandInstall: rpc.mutation(async (_: null) =>
    installCliCommand(T3_HOME, backend().serverEntry),
  ),
  cliCommandUninstall: rpc.mutation(async (_: null) => uninstallCliCommand(T3_HOME)),

  webLinksReady: rpc.mutation(async (ready: boolean) => {
    shell.webLinksReady = ready;
    if (ready) shell.flushWebLinks();
  }),
  appActivationReady: rpc.mutation(async (ready: boolean) => shell.activation?.setReady(ready)),
  appActivationComplete: rpc.mutation(async (response: DesktopAppActivationResponse) =>
    shell.activation?.complete(response),
  ),

  // The ChatGPT sign-in redirects to a loopback server this process hosts; the
  // credentials themselves stay on the backend.
  receiveProviderAuthCallback: rpc.mutation(async (authorizationUrl: string) =>
    receiveCodexAuthCallback(authorizationUrl, openExternal),
  ),
  cancelProviderAuthCallback: rpc.mutation(async (authorizationUrl: string) =>
    cancelCodexAuthCallback(authorizationUrl),
  ),

  notify: rpc.mutation(async (input: { title: string; body?: string }) =>
    notification.show(input.body === undefined ? { title: input.title } : input),
  ),

  // Resolves with the clicked id; mirin has no "popup dismissed" event yet, so
  // the renderer times the promise out on its next interaction.
  showContextMenu: rpc.mutation(
    async (input: { items: readonly ContextMenuItemSchemaType[] }) =>
      new Promise<string>((resolve) => {
        menu.popup(contextMenuTemplate(input.items, resolve));
      }),
  ),
});

export type ShellRouter = typeof router;
