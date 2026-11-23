import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RequestContextModule = typeof import("@infra/request-context");

const scopeA = { requestId: "test-a", tenantId: "tenant-a", userId: "user-a" };
const scopeB = { requestId: "test-b", tenantId: "tenant-b", userId: "user-b" };

describe.sequential("scheduler integration enumeration", () => {
  let tempDir: string;
  let runWithRequestContext: RequestContextModule["runWithRequestContext"];
  let repo: Awaited<typeof import("./post-application-integrations")>;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-scheduler-integrations-"));
    process.env.DATA_DIR = tempDir;
    process.env.NODE_ENV = "test";

    await import("../db/migrate");
    const { db, schema } = await import("../db/index");
    await db.insert(schema.tenants).values([
      { id: "tenant-a", name: "Tenant A", slug: "tenant-a" },
      { id: "tenant-b", name: "Tenant B", slug: "tenant-b" },
    ]);
    await db.insert(schema.users).values([
      { id: "user-a", username: "user-a" },
      { id: "user-b", username: "user-b" },
    ]);

    repo = await import("./post-application-integrations");
    ({ runWithRequestContext } = await import("@infra/request-context"));

    await runWithRequestContext(scopeA, () =>
      repo.upsertConnectedPostApplicationIntegration({
        provider: "graph",
        accountKey: "default",
        credentials: { refreshToken: "refresh-token-a" },
      }),
    );
    await runWithRequestContext(scopeB, () =>
      repo.upsertConnectedPostApplicationIntegration({
        provider: "gmail",
        accountKey: "primary",
        credentials: { refreshToken: "refresh-token-b" },
      }),
    );
    const disconnected = await runWithRequestContext(scopeA, () =>
      repo.upsertConnectedPostApplicationIntegration({
        provider: "gmail",
        accountKey: "disabled",
        credentials: { refreshToken: "refresh-token-disabled" },
      }),
    );
    await runWithRequestContext(scopeA, () =>
      repo.disconnectPostApplicationIntegration(
        disconnected.provider,
        disconnected.accountKey,
      ),
    );
  });

  afterEach(async () => {
    const { closeDb } = await import("../db/index");
    closeDb();
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("returns every connected integration with its tenant and user scope", async () => {
    const rows =
      await repo.listConnectedPostApplicationIntegrationsForScheduler();

    expect(rows).toEqual([
      {
        tenantId: "tenant-a",
        userId: "user-a",
        provider: "graph",
        accountKey: "default",
      },
      {
        tenantId: "tenant-b",
        userId: "user-b",
        provider: "gmail",
        accountKey: "primary",
      },
    ]);
  });
});
