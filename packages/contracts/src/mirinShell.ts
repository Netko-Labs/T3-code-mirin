import type {
  DesktopAppActivationRequest,
  DesktopAppActivationResponse,
} from "./desktopAppActivation.ts";
import type {
  ContextMenuItemSchemaType,
  DesktopCliCommandState,
  DesktopPendingSnapShot,
  DesktopSnapShot,
  DesktopSnapShotEvent,
  DesktopSnapShotSetupAction,
  DesktopSnapShotShortcutAvailability,
  DesktopSnapShotState,
  PickFolderOptions,
  SystemSettingsPane,
} from "./ipc.ts";
import type { SnapShotShortcut } from "./settings.ts";

/**
 * The RPC surface the mirin desktop shell (apps/desktop-mirin) serves to the
 * renderer. Method names are mirin router procedure names; the renderer calls
 * them through the `window.mirin` transport and never imports `mirinjs`, so
 * Bun's ambient types stay out of the browser build.
 */
export interface MirinShellRpc {
  readonly getBearerToken: (input: null) => Promise<string>;
  readonly getClientSettings: (input: null) => Promise<unknown>;
  readonly setClientSettings: (settings: unknown) => Promise<void>;
  readonly pickFolder: (options: PickFolderOptions | null) => Promise<string | null>;
  readonly openExternal: (url: string) => Promise<boolean>;
  readonly notify: (input: { readonly title: string; readonly body?: string }) => Promise<boolean>;
  readonly showContextMenu: (input: {
    readonly items: readonly ContextMenuItemSchemaType[];
  }) => Promise<string>;
  readonly cliCommandState: (input: null) => Promise<DesktopCliCommandState>;
  readonly cliCommandInstall: (input: null) => Promise<DesktopCliCommandState>;
  readonly cliCommandUninstall: (input: null) => Promise<DesktopCliCommandState>;
  readonly webLinksReady: (ready: boolean) => Promise<void>;
  readonly appActivationReady: (ready: boolean) => Promise<void>;
  readonly appActivationComplete: (response: DesktopAppActivationResponse) => Promise<void>;
  readonly receiveProviderAuthCallback: (authorizationUrl: string) => Promise<string>;
  readonly cancelProviderAuthCallback: (authorizationUrl: string) => Promise<void>;
  readonly openSystemSettings: (pane: SystemSettingsPane) => Promise<boolean>;
  readonly checkSystemPermission: (pane: SystemSettingsPane) => Promise<boolean>;
  readonly snapShotState: (input: null) => Promise<DesktopSnapShotState>;
  readonly snapShotSetup: (action: DesktopSnapShotSetupAction) => Promise<void>;
  readonly snapShotRequestPermissions: (includeAccessibility: boolean) => Promise<void>;
  readonly snapShotCheckShortcut: (
    shortcut: SnapShotShortcut,
  ) => Promise<DesktopSnapShotShortcutAvailability>;
  readonly snapShotSetSuppressed: (suppressed: boolean) => Promise<void>;
  readonly snapShotListPending: (input: null) => Promise<readonly DesktopPendingSnapShot[]>;
  readonly snapShotRead: (id: string) => Promise<DesktopSnapShot>;
  readonly snapShotAcknowledge: (id: string) => Promise<void>;
}

export interface MirinShellEvents {
  readonly backendStatus: { readonly message: string };
  readonly menuAction: { readonly action: string };
  readonly webLinkOpen: { readonly url: string };
  readonly appActivationRequest: DesktopAppActivationRequest;
  readonly snapShotEvent: DesktopSnapShotEvent;
}

/** `window.mirin`, installed by mirin's preload bootstrap before page scripts run. */
export interface MirinTransport {
  call(method: string, input: unknown): Promise<unknown>;
  onEvent(method: string, listener: (payload: unknown) => void): () => void;
}
