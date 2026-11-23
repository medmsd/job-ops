import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@server/services/post-application/providers/service", () => ({
  executePostApplicationProviderAction: mocks.execute,
}));

vi.mock("@infra/logger", () => ({
  logger: { info: mocks.info, warn: mocks.warn },
}));

type RequestContextModule = typeof import("@infra/request-context");

const SCOPE_A = {
  tenantId: "tenant-a",
  userId: "user-a",
  provider: "graph" as const,
  accountKey: "default",
};
const SCOPE_B = {
  tenantId: "tenant-b",
  userId: "user-b",
  provider: "gmail" as const,
  accountKey: "default",
};

function okResult(
  provider: "graph" | "gmail",
  discovered: number,
  classified: number,
) {
  return {
    provider,
    action: "sync" as const,
    accountKey: "default",
    status: {
      provider,
      accountKey: "default",
      connected: true,
      integration: null,
    },
    message: `Sync complete: discovered=${discovered}, relevant=${classified}, classified=${classified}, errored=0.`,
  };
}

describe("response sync scheduler", () => {
  let tempDir: string;
  let runWithRequestContext: RequestContextModule["runWithRequestContext"];
  let getRequestId: RequestContextModule["getRequestId"];
  let getTenantId: RequestContextModule["getTenantId"];
  let getUserId: RequestContextModule["getUserId"];
  let scheduler: Awaited<typeof import("./response-sync-scheduler")>;
  let integrationsRepo: Awaited<
    typeof import("@server/repositories/post-application-integrations")
  >;

  beforeEach(async () => {
    vi.resetModules();
    vi.useRealTimers();
    vi.clearAllMocks();
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-response-sync-scheduler-"));
    process.env.DATA_DIR = tempDir;
    process.env.NODE_ENV = "test";

    await import("@server/db/migrate");
    const { db, schema } = await import("@server/db/index");
    await db.insert(schema.tenants).values([
      { id: "tenant-a", name: "Tenant A", slug: "tenant-a" },
      { id: "tenant-b", name: "Tenant B", slug: "tenant-b" },
    ]);
    await db.insert(schema.users).values([
      { id: "user-a", username: "user-a" },
      { id: "user-b", username: "user-b" },
    ]);

    ({ runWithRequestContext, getRequestId, getTenantId, getUserId } =
      await import("@infra/request-context"));
    integrationsRepo = await import(
      "@server/repositories/post-application-integrations"
    );
    scheduler = await import("./response-sync-scheduler");

    await runWithRequestContext(
      { requestId: "setup-a", tenantId: "tenant-a", userId: "user-a" },
      () =>
        integrationsRepo.upsertConnectedPostApplicationIntegration({
          provider: "graph",
          accountKey: "default",
          credentials: { refreshToken: "refresh-token-a" },
        }),
    );
    await runWithRequestContext(
      { requestId: "setup-b", tenantId: "tenant-b", userId: "user-b" },
      () =>
        integrationsRepo.upsertConnectedPostApplicationIntegration({
          provider: "gmail",
          accountKey: "default",
          credentials: { refreshToken: "refresh-token-b" },
        }),
    );

    mocks.execute.mockImplementation(async () => okResult("graph", 3, 2));
  });

  afterEach(async () => {
    scheduler.stopResponseSyncScheduler();
    const { closeDb } = await import("@server/db/index");
    closeDb();
    await rm(tempDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it("runs each account in its own request context with bounded options", async () => {
    const seen: Array<{
      requestId: string | undefined;
      tenantId: string | undefined;
      userId: string | undefined;
    }> = [];
    mocks.execute.mockImplementation(async () => {
      seen.push({
        requestId: getRequestId(),
        tenantId: getTenantId(),
        userId: getUserId(),
      });
      return okResult("graph", 3, 2);
    });

    const summary = await scheduler.runResponseSyncOnce();

    expect(summary).toEqual({
      attempted: 2,
      succeeded: 2,
      failed: 0,
      skipped: 0,
    });
    expect(seen).toHaveLength(2);
    expect(seen.map((entry) => entry.tenantId).sort()).toEqual([
      "tenant-a",
      "tenant-b",
    ]);
    expect(seen.map((entry) => entry.userId).sort()).toEqual([
      "user-a",
      "user-b",
    ]);
    expect(seen[0]?.requestId).toBeTruthy();
    expect(seen[0]?.requestId).not.toBe(seen[1]?.requestId);
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sync",
        initiatedBy: "response-sync-scheduler",
        syncPayload: { maxMessages: 50, searchDays: 7 },
      }),
    );
    expect(mocks.info).toHaveBeenCalledWith(
      "Response sync completed",
      expect.objectContaining({
        tenantId: "tenant-a",
        provider: "graph",
        accountKey: "default",
        messagesDiscovered: 3,
        messagesClassified: 2,
        status: "completed",
      }),
    );
  });

  it("isolates one account failure from the other accounts", async () => {
    mocks.execute.mockImplementation(async (input: { provider: string }) => {
      if (input.provider === "graph") throw new Error("graph is offline");
      return okResult("gmail", 1, 1);
    });

    const summary = await scheduler.runResponseSyncOnce();

    expect(summary).toEqual({
      attempted: 2,
      succeeded: 1,
      failed: 1,
      skipped: 0,
    });
    expect(mocks.warn).toHaveBeenCalledWith(
      "Response sync failed",
      expect.objectContaining({
        tenantId: "tenant-a",
        provider: "graph",
        error: expect.any(String),
      }),
    );
  });

  it("skips overlapping syncs for the same tenant/provider/account key", async () => {
    let markStarted = () => {};
    let releaseFirst = () => {};
    const firstStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const blocker = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    mocks.execute.mockImplementationOnce(async () => {
      markStarted();
      await blocker;
      return okResult("graph", 0, 0);
    });

    const firstRun = scheduler.runResponseSyncOnce({
      listIntegrations: async () => [SCOPE_A],
    });
    await firstStarted;
    const secondSummary = await scheduler.runResponseSyncOnce({
      listIntegrations: async () => [SCOPE_A],
    });

    expect(secondSummary).toEqual({
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 1,
    });
    expect(mocks.execute).toHaveBeenCalledTimes(1);

    releaseFirst();
    await firstRun;
  });

  it("uses a 30-minute interval and skips the unsupported imap adapter", async () => {
    await runWithRequestContext(
      { requestId: "setup-imap", tenantId: "tenant-a", userId: "user-a" },
      () =>
        integrationsRepo.upsertConnectedPostApplicationIntegration({
          provider: "imap",
          accountKey: "default",
          credentials: { refreshToken: "unused" },
        }),
    );

    vi.useFakeTimers();
    expect(scheduler.RESPONSE_SYNC_INTERVAL_MS).toBe(30 * 60 * 1000);

    scheduler.startResponseSyncScheduler();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.execute).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(scheduler.RESPONSE_SYNC_INTERVAL_MS);
    expect(mocks.execute).toHaveBeenCalledTimes(4);

    scheduler.stopResponseSyncScheduler();
    await vi.advanceTimersByTimeAsync(scheduler.RESPONSE_SYNC_INTERVAL_MS * 2);
    expect(mocks.execute).toHaveBeenCalledTimes(4);
  });
});
