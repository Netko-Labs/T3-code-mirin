import type {
  ClientSettings,
  DesktopBridge,
  DesktopServerExposureState,
  DesktopUpdateState,
  DesktopWslState,
  MirinShellEvents,
  MirinShellRpc,
  MirinTransport,
} from "@t3tools/contracts";

import type { MirinRendererBoot } from "./boot";

declare global {
  interface Window {
    mirin?: MirinTransport;
  }
}

export function shellApi(transport: MirinTransport): MirinShellRpc {
  const call = <K extends keyof MirinShellRpc>(method: K) =>
    ((input: unknown) => transport.call(method, input)) as MirinShellRpc[K];
  return {
    getBearerToken: call("getBearerToken"),
    getClientSettings: call("getClientSettings"),
    setClientSettings: call("setClientSettings"),
    pickFolder: call("pickFolder"),
    openExternal: call("openExternal"),
    notify: call("notify"),
    showContextMenu: call("showContextMenu"),
    cliCommandState: call("cliCommandState"),
    cliCommandInstall: call("cliCommandInstall"),
    cliCommandUninstall: call("cliCommandUninstall"),
    webLinksReady: call("webLinksReady"),
    appActivationReady: call("appActivationReady"),
    appActivationComplete: call("appActivationComplete"),
    receiveProviderAuthCallback: call("receiveProviderAuthCallback"),
    cancelProviderAuthCallback: call("cancelProviderAuthCallback"),
    openSystemSettings: call("openSystemSettings"),
    checkSystemPermission: call("checkSystemPermission"),
    snapShotState: call("snapShotState"),
    snapShotSetup: call("snapShotSetup"),
    snapShotRequestPermissions: call("snapShotRequestPermissions"),
    snapShotCheckShortcut: call("snapShotCheckShortcut"),
    snapShotSetSuppressed: call("snapShotSetSuppressed"),
    snapShotListPending: call("snapShotListPending"),
    snapShotRead: call("snapShotRead"),
    snapShotAcknowledge: call("snapShotAcknowledge"),
  };
}

function onShellEvent<K extends keyof MirinShellEvents>(
  transport: MirinTransport,
  event: K,
  listener: (payload: MirinShellEvents[K]) => void,
): () => void {
  return transport.onEvent(event, (payload) => listener(payload as MirinShellEvents[K]));
}

const LOCAL_ONLY_EXPOSURE: DesktopServerExposureState = {
  mode: "local-only",
  endpointUrl: null,
  advertisedHost: null,
  tailscaleServeEnabled: false,
  tailscaleServePort: 443,
};

const NO_WSL: DesktopWslState = {
  enabled: false,
  distro: null,
  available: false,
  wslOnly: false,
  distros: [],
  preflightError: null,
};

const UPDATES_DISABLED: DesktopUpdateState = {
  enabled: false,
  status: "disabled",
  channel: "latest",
  currentVersion: "0.0.1",
  hostArch: "arm64",
  appArch: "arm64",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};

const unsupported = (feature: string) => () =>
  Promise.reject(new Error(`${feature} is not available in the mirin shell yet.`));

const noListener = () => () => {};

/** `DesktopBridge` over mirin RPC; the Electron preload's contract, minus preview/SSH/WSL for now. */
/**
 * CEF exposes the Notification API but never displays anything (permission
 * stays "default"). Route it through the shell so thread notifications reach
 * Notification Center.
 */
export function installMirinNotifications(api: MirinShellRpc): void {
  class MirinNotification extends EventTarget {
    static readonly permission: NotificationPermission = "granted";
    static requestPermission(): Promise<NotificationPermission> {
      return Promise.resolve("granted");
    }
    readonly title: string;
    readonly body: string;
    readonly tag: string;
    onclick: ((this: Notification, ev: Event) => unknown) | null = null;
    onclose: ((this: Notification, ev: Event) => unknown) | null = null;
    onerror: ((this: Notification, ev: Event) => unknown) | null = null;
    onshow: ((this: Notification, ev: Event) => unknown) | null = null;
    constructor(title: string, options: NotificationOptions = {}) {
      super();
      this.title = title;
      this.body = options.body ?? "";
      this.tag = options.tag ?? "";
      void api.notify(this.body.length > 0 ? { title, body: this.body } : { title });
    }
    close(): void {}
  }
  Object.defineProperty(window, "Notification", { value: MirinNotification, configurable: true });
}

export function createMirinDesktopBridge(
  transport: MirinTransport,
  boot: MirinRendererBoot,
): DesktopBridge {
  const api = shellApi(transport);
  let pendingContextMenu: ((id: null) => void) | undefined;
  // A dismissed native popup reports nothing; the next page interaction settles it.
  const settlePendingContextMenu = () => {
    pendingContextMenu?.(null);
    pendingContextMenu = undefined;
  };
  window.addEventListener("pointerdown", settlePendingContextMenu, true);
  window.addEventListener("keydown", settlePendingContextMenu, true);

  return {
    getAppBranding: () => boot.branding,
    getClientPlatform: () => boot.platform,
    getSystemLocale: () => boot.locale,
    getLocalEnvironmentBootstraps: () => boot.bootstraps,
    getLocalEnvironmentEnabled: () => true,
    getLocalEnvironmentBearerToken: () => api.getBearerToken(null),
    getClientSettings: () => api.getClientSettings(null) as Promise<ClientSettings | null>,
    setClientSettings: (settings) => api.setClientSettings(settings),

    discoverSshHosts: () => Promise.resolve([]),
    resolveSshHost: unsupported("SSH"),
    ensureSshEnvironment: unsupported("SSH"),
    disconnectSshEnvironment: () => Promise.resolve(),
    fetchSshEnvironmentDescriptor: unsupported("SSH"),
    bootstrapSshBearerSession: unsupported("SSH"),
    fetchSshSessionState: unsupported("SSH"),
    issueSshWebSocketTicket: unsupported("SSH"),
    onSshPasswordPrompt: noListener,
    resolveSshPasswordPrompt: () => Promise.resolve(),

    getServerExposureState: () => Promise.resolve(LOCAL_ONLY_EXPOSURE),
    setServerExposureMode: () => Promise.resolve(LOCAL_ONLY_EXPOSURE),
    setTailscaleServeEnabled: () => Promise.resolve(LOCAL_ONLY_EXPOSURE),
    getAdvertisedEndpoints: () => Promise.resolve([]),

    getWslState: () => Promise.resolve(NO_WSL),
    setWslBackendEnabled: () => Promise.resolve(NO_WSL),
    setWslDistro: () => Promise.resolve(NO_WSL),
    setWslOnly: () => Promise.resolve(NO_WSL),

    pickFolder: (options) => api.pickFolder(options ?? null),
    setTheme: () => Promise.resolve(),
    showContextMenu: (items) => {
      settlePendingContextMenu();
      return new Promise((resolve) => {
        pendingContextMenu = resolve;
        void api.showContextMenu({ items }).then((id) => {
          if (pendingContextMenu === resolve) pendingContextMenu = undefined;
          resolve(id as (typeof items)[number]["id"]);
        });
      });
    },
    openExternal: (url) => api.openExternal(url),
    onMenuAction: (listener) =>
      onShellEvent(transport, "menuAction", ({ action }) => listener(action)),

    getWindowFullscreenState: () => false,
    onWindowFullscreenStateChange: noListener,

    getUpdateState: () => Promise.resolve(UPDATES_DISABLED),
    setUpdateChannel: () => Promise.resolve(UPDATES_DISABLED),
    checkForUpdate: () => Promise.resolve({ checked: false, state: UPDATES_DISABLED }),
    downloadUpdate: () =>
      Promise.resolve({ accepted: false, completed: false, state: UPDATES_DISABLED }),
    installUpdate: () =>
      Promise.resolve({ accepted: false, completed: false, state: UPDATES_DISABLED }),
    onUpdateState: noListener,

    openSystemSettings: (pane) => api.openSystemSettings(pane),
    checkSystemPermission: (pane) => api.checkSystemPermission(pane),
    ...(boot.platform === "darwin"
      ? {
          requestSnapShotPermissions: (includeAccessibility) =>
            api.snapShotRequestPermissions(includeAccessibility),
          getSnapShotState: () => api.snapShotState(null),
          setupSnapShot: (action) => api.snapShotSetup(action),
          checkSnapShotShortcut: (shortcut) => api.snapShotCheckShortcut(shortcut),
          setSnapShotShortcutSuppressed: (suppressed) => api.snapShotSetSuppressed(suppressed),
          listPendingSnapShots: () => api.snapShotListPending(null),
          readSnapShot: (id) => api.snapShotRead(id),
          setSnapShotAnimationDestination: () => Promise.resolve(),
          dismissSnapShotAnimation: () => Promise.resolve(),
          acknowledgeSnapShot: (id) => api.snapShotAcknowledge(id),
          onSnapShotEvent: (listener) => onShellEvent(transport, "snapShotEvent", listener),
        }
      : {}),
    receiveProviderAuthCallback: (url) => api.receiveProviderAuthCallback(url),
    cancelProviderAuthCallback: (url) => api.cancelProviderAuthCallback(url),
    cliCommand: {
      getState: () => api.cliCommandState(null),
      install: () => api.cliCommandInstall(null),
      uninstall: () => api.cliCommandUninstall(null),
    },
    webLinks: {
      setReady: (ready) => api.webLinksReady(ready),
      onOpen: (listener) => onShellEvent(transport, "webLinkOpen", ({ url }) => listener(url)),
    },
    appActivation: {
      setReady: (ready) => api.appActivationReady(ready),
      complete: (response) => api.appActivationComplete(response),
      onRequest: (listener) => onShellEvent(transport, "appActivationRequest", listener),
    },
  };
}
