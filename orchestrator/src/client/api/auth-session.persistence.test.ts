import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN_KEY = "jobops.authToken";
const LEGACY_TOKEN_KEY = "jobops.jwtToken";

type AuthSessionModule = typeof import("./auth-session");

async function loadFreshAuthSession(): Promise<AuthSessionModule> {
  vi.resetModules();
  return import("./auth-session");
}

function dispatchTokenChange(newValue: string | null): void {
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: TOKEN_KEY,
      oldValue: newValue ? "previous-token" : "removed-token",
      newValue,
    }),
  );
}

describe("auth session persistence across tabs", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores the bearer token in localStorage so another tab can read it", async () => {
    const auth = await loadFreshAuthSession();

    auth.setAuthenticatedSession("shared-token");

    expect(localStorage.getItem(TOKEN_KEY)).toBe("shared-token");
    expect(auth.getCachedAuthHeader()).toBe("Bearer shared-token");
  });

  it("restores the bearer token from localStorage on a fresh page load", async () => {
    localStorage.setItem(TOKEN_KEY, "persisted-token");

    const auth = await loadFreshAuthSession();

    expect(auth.hasAuthenticatedSession()).toBe(true);
    expect(auth.getCachedAuthHeader()).toBe("Bearer persisted-token");
  });

  it("migrates a legacy sessionStorage token into shared storage", async () => {
    sessionStorage.setItem(LEGACY_TOKEN_KEY, "legacy-token");

    const auth = await loadFreshAuthSession();

    expect(auth.getCachedAuthHeader()).toBe("Bearer legacy-token");
    expect(localStorage.getItem(TOKEN_KEY)).toBe("legacy-token");
    expect(sessionStorage.getItem(LEGACY_TOKEN_KEY)).toBeNull();
  });

  it("adopts a token written by another tab", async () => {
    const auth = await loadFreshAuthSession();
    auth.setAuthenticatedSession("old-token");

    dispatchTokenChange("new-token");

    expect(auth.getCachedAuthHeader()).toBe("Bearer new-token");
  });

  it("drops the cached token when another tab signs out", async () => {
    const auth = await loadFreshAuthSession();
    auth.setAuthenticatedSession("logged-in-token");

    dispatchTokenChange(null);

    expect(auth.hasAuthenticatedSession()).toBe(false);
    expect(auth.getCachedAuthHeader()).toBeUndefined();
  });

  it("clears cached app data when another tab changes the signed-in workspace", async () => {
    vi.resetModules();
    const { queryClient } = await import("@/client/lib/queryClient");
    const clearSpy = vi.spyOn(queryClient, "clear");
    const auth = await import("./auth-session");
    auth.setAuthenticatedSession("workspace-one-token");
    clearSpy.mockClear();

    dispatchTokenChange("workspace-two-token");

    expect(clearSpy).toHaveBeenCalled();
  });
});
