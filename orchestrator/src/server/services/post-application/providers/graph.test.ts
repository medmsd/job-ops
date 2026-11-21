import type { PostApplicationIntegration } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@server/repositories/post-application-integrations", () => ({
  getPostApplicationIntegration: vi.fn().mockResolvedValue(null),
  upsertConnectedPostApplicationIntegration: vi.fn().mockImplementation(
    async ({
      provider,
      accountKey,
      displayName,
      credentials,
    }: {
      provider: "graph";
      accountKey: string;
      displayName: string;
      credentials: Record<string, unknown>;
    }) =>
      ({
        id: "graph-integration-test",
        provider,
        accountKey,
        displayName,
        status: "connected",
        credentials,
        lastConnectedAt: Date.now(),
        lastSyncedAt: null,
        lastError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }) satisfies PostApplicationIntegration,
  ),
  disconnectPostApplicationIntegration: vi.fn().mockImplementation(
    async (provider: "graph", accountKey: string) =>
      ({
        id: "graph-integration-test",
        provider,
        accountKey,
        displayName: "Microsoft Graph (default)",
        status: "disconnected",
        credentials: null,
        lastConnectedAt: Date.now(),
        lastSyncedAt: null,
        lastError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }) satisfies PostApplicationIntegration,
  ),
}));

vi.mock("@server/services/post-application/ingestion/graph-sync", () => ({
  runGraphIngestionSync: vi.fn().mockResolvedValue({
    discovered: 3,
    relevant: 2,
    classified: 2,
    errored: 0,
  }),
}));

const integrationRepo = await import(
  "@server/repositories/post-application-integrations"
);
const graphSync = await import(
  "@server/services/post-application/ingestion/graph-sync"
);

import { PostApplicationProviderError } from "./errors";
import { graphProvider } from "./graph";

describe("graphProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes the graph key", () => {
    expect(graphProvider.key).toBe("graph");
  });

  it("rejects connect without a refresh token", async () => {
    await expect(
      graphProvider.connect({ accountKey: "default" }),
    ).rejects.toBeInstanceOf(PostApplicationProviderError);
  });

  it("stores sanitized credentials and returns a public status", async () => {
    const result = await graphProvider.connect({
      accountKey: "default",
      payload: {
        payload: {
          refreshToken: "refresh-token",
          accessToken: "access-token",
          email: "me@outlook.com",
          displayName: "Me",
        },
      },
    });

    expect(result.status.provider).toBe("graph");
    expect(result.status.connected).toBe(true);
    expect(result.status.integration?.credentials).toEqual({
      hasRefreshToken: true,
      hasAccessToken: true,
      scope: null,
      tokenType: null,
      expiryDate: null,
      email: "me@outlook.com",
    });
    expect(
      integrationRepo.upsertConnectedPostApplicationIntegration,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "graph",
        credentials: expect.objectContaining({
          refreshToken: "refresh-token",
          accessToken: "access-token",
        }),
      }),
    );
  });

  it("runs Graph ingestion on sync", async () => {
    vi.mocked(integrationRepo.getPostApplicationIntegration).mockResolvedValue({
      id: "graph-integration-test",
      provider: "graph",
      accountKey: "default",
      displayName: "Microsoft Graph (default)",
      status: "connected",
      credentials: { refreshToken: "refresh-token" },
      lastConnectedAt: Date.now(),
      lastSyncedAt: null,
      lastError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies PostApplicationIntegration);

    const result = await graphProvider.sync({ accountKey: "default" });

    expect(graphSync.runGraphIngestionSync).toHaveBeenCalledWith({
      accountKey: "default",
      maxMessages: undefined,
      searchDays: undefined,
    });
    expect(result.message).toContain("discovered=3");
  });

  it("disconnects locally and clears credentials", async () => {
    const result = await graphProvider.disconnect({ accountKey: "default" });

    expect(
      integrationRepo.disconnectPostApplicationIntegration,
    ).toHaveBeenCalledWith("graph", "default");
    expect(result.status.connected).toBe(false);
    expect(result.message).toContain("Remove the app's permissions");
  });
});
