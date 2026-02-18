export type NotificationCapabilityKind = "available" | "ios_home_screen_required" | "insecure_context" | "unsupported";

export interface NotificationCapability {
  kind: NotificationCapabilityKind;
  permission: NotificationPermission;
  canRequest: boolean;
  isSecureContext: boolean;
  isStandalone: boolean;
}

export interface NotificationCapabilityInput {
  hasNotificationApi: boolean;
  permission: NotificationPermission;
  isSecureContext: boolean;
  isIos: boolean;
  isStandalone: boolean;
}

export function isIosDevice(input: {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}): boolean {
  const userAgent = input.userAgent || "";
  const platform = input.platform || "";
  const maxTouchPoints = Number.isFinite(input.maxTouchPoints) ? Number(input.maxTouchPoints) : 0;

  if (/iPad|iPhone|iPod/i.test(userAgent)) return true;
  if (/iPad|iPhone|iPod/i.test(platform)) return true;

  // iPadOS can report itself as MacIntel while still being a touch device.
  return platform === "MacIntel" && maxTouchPoints > 1;
}

export function isStandaloneDisplayMode(input: {
  displayModeStandalone?: boolean;
  navigatorStandalone?: boolean;
}): boolean {
  return Boolean(input.displayModeStandalone || input.navigatorStandalone);
}

export function detectNotificationCapability(input: NotificationCapabilityInput): NotificationCapability {
  if (!input.isSecureContext) {
    return {
      kind: "insecure_context",
      permission: input.permission,
      canRequest: false,
      isSecureContext: false,
      isStandalone: input.isStandalone,
    };
  }

  if (input.hasNotificationApi) {
    return {
      kind: "available",
      permission: input.permission,
      canRequest: input.permission !== "granted",
      isSecureContext: true,
      isStandalone: input.isStandalone,
    };
  }

  if (input.isIos && !input.isStandalone) {
    return {
      kind: "ios_home_screen_required",
      permission: input.permission,
      canRequest: false,
      isSecureContext: true,
      isStandalone: false,
    };
  }

  return {
    kind: "unsupported",
    permission: input.permission,
    canRequest: false,
    isSecureContext: true,
    isStandalone: input.isStandalone,
  };
}

export function detectBrowserNotificationCapability(): NotificationCapability {
  if (typeof window === "undefined") {
    return {
      kind: "unsupported",
      permission: "default",
      canRequest: false,
      isSecureContext: false,
      isStandalone: false,
    };
  }

  const navigatorStandalone = typeof navigator !== "undefined"
    && "standalone" in navigator
    && navigator.standalone === true;
  const displayModeStandalone = typeof window.matchMedia === "function"
    ? window.matchMedia("(display-mode: standalone)").matches
    : false;
  const isStandalone = isStandaloneDisplayMode({
    displayModeStandalone,
    navigatorStandalone,
  });

  const isIos = isIosDevice({
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    platform: typeof navigator !== "undefined" ? navigator.platform : "",
    maxTouchPoints: typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0,
  });

  const hasNotificationApi = "Notification" in window;
  const permission = hasNotificationApi ? window.Notification.permission : "default";

  return detectNotificationCapability({
    hasNotificationApi,
    permission,
    isSecureContext: window.isSecureContext,
    isIos,
    isStandalone,
  });
}
