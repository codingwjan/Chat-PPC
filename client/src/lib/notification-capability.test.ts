import { describe, expect, it } from "vitest";
import {
  detectNotificationCapability,
  isIosDevice,
  isStandaloneDisplayMode,
  type NotificationCapabilityInput,
} from "@/lib/notification-capability";

function baseInput(overrides?: Partial<NotificationCapabilityInput>): NotificationCapabilityInput {
  return {
    hasNotificationApi: false,
    permission: "default",
    isSecureContext: true,
    isIos: false,
    isStandalone: false,
    ...(overrides || {}),
  };
}

describe("notification capability detection", () => {
  it("returns available on secure desktop browsers with Notification API", () => {
    const capability = detectNotificationCapability(
      baseInput({ hasNotificationApi: true, permission: "default" }),
    );

    expect(capability.kind).toBe("available");
    expect(capability.permission).toBe("default");
    expect(capability.canRequest).toBe(true);
  });

  it("returns ios_home_screen_required on iOS tab without Notification API", () => {
    const capability = detectNotificationCapability(
      baseInput({ isIos: true, isStandalone: false, hasNotificationApi: false }),
    );

    expect(capability.kind).toBe("ios_home_screen_required");
    expect(capability.canRequest).toBe(false);
  });

  it("returns unsupported on iOS standalone without Notification API", () => {
    const capability = detectNotificationCapability(
      baseInput({ isIos: true, isStandalone: true, hasNotificationApi: false }),
    );

    expect(capability.kind).toBe("unsupported");
    expect(capability.canRequest).toBe(false);
  });

  it("returns insecure_context when context is not secure", () => {
    const capability = detectNotificationCapability(
      baseInput({ isSecureContext: false, hasNotificationApi: true }),
    );

    expect(capability.kind).toBe("insecure_context");
    expect(capability.canRequest).toBe(false);
  });

  it("keeps permission values for available notifications", () => {
    const permissions: Array<"default" | "denied" | "granted"> = ["default", "denied", "granted"];

    for (const permission of permissions) {
      const capability = detectNotificationCapability(
        baseInput({ hasNotificationApi: true, permission }),
      );

      expect(capability.permission).toBe(permission);
      expect(capability.kind).toBe("available");
      expect(capability.canRequest).toBe(permission !== "granted");
    }
  });

  it("sets canRequest only for available capability", () => {
    const available = detectNotificationCapability(baseInput({ hasNotificationApi: true }));
    const insecure = detectNotificationCapability(baseInput({ isSecureContext: false }));
    const iosTab = detectNotificationCapability(baseInput({ isIos: true, isStandalone: false }));
    const unsupported = detectNotificationCapability(baseInput({ isIos: false, hasNotificationApi: false }));

    expect(available.canRequest).toBe(true);
    expect(insecure.canRequest).toBe(false);
    expect(iosTab.canRequest).toBe(false);
    expect(unsupported.canRequest).toBe(false);
  });

  it("detects iOS and standalone helper behavior", () => {
    expect(isIosDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" })).toBe(true);
    expect(isIosDevice({ platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
    expect(isIosDevice({ platform: "Win32", maxTouchPoints: 0 })).toBe(false);

    expect(isStandaloneDisplayMode({ displayModeStandalone: true, navigatorStandalone: false })).toBe(true);
    expect(isStandaloneDisplayMode({ displayModeStandalone: false, navigatorStandalone: true })).toBe(true);
    expect(isStandaloneDisplayMode({ displayModeStandalone: false, navigatorStandalone: false })).toBe(false);
  });
});
