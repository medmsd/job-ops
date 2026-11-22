import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesignResumeJson } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RequestContextModule = typeof import("@infra/request-context");

const scopeA = { requestId: "test", tenantId: "tenant-a", userId: "user-a" };
const scopeB = { requestId: "test", tenantId: "tenant-b", userId: "user-b" };

describe.sequential("tailored resumes repository", () => {
  let tempDir: string;
  let repo: Awaited<typeof import("./tailored-resumes")>;
  let runWithRequestContext: RequestContextModule["runWithRequestContext"];

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-tailored-resumes-repo-"));
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
    await db.insert(schema.jobs).values({
      id: "job-1",
      tenantId: "tenant-a",
      userId: "user-a",
      title: "Backend Engineer",
      employer: "Acme",
      jobUrl: "https://example.test/job-1",
    });
    repo = await import("./tailored-resumes");
    ({ runWithRequestContext } = await import("@infra/request-context"));
  });

  afterEach(async () => {
    const { closeDb } = await import("../db/index");
    closeDb();
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function insert(
    jobId: string,
    version: number,
    id = `snap-${jobId}-${version}`,
  ) {
    return runWithRequestContext(scopeA, () =>
      repo.insertVersion({
        id,
        jobId,
        version,
        resumeJson: {
          basics: { headline: `Headline ${version}` },
        } as unknown as DesignResumeJson,
        changes: [],
        ats: null,
        model: null,
        origin: "approved",
        baseResumeDocumentId: null,
        baseResumeRevision: null,
        generatedAt: version,
      }),
    );
  }

  it("lists versions in descending order", async () => {
    await insert("job-1", 1);
    await insert("job-1", 3);
    await insert("job-1", 2);

    const rows = await runWithRequestContext(scopeA, () =>
      repo.listForJob("job-1"),
    );
    expect(rows.map((row) => row.version)).toEqual([3, 2, 1]);
    expect(rows[0]).toMatchObject({
      jobId: "job-1",
      status: "approved",
      origin: "approved",
    });
  });

  it("prunes older versions but keeps the current one", async () => {
    await insert("job-1", 1);
    await insert("job-1", 2);
    await insert("job-1", 3);

    await runWithRequestContext(scopeA, () => repo.pruneToLatest("job-1", 2));

    const rows = await runWithRequestContext(scopeA, () =>
      repo.listForJob("job-1", 100),
    );
    expect(rows.map((row) => row.version)).toEqual([3, 2]);
    await expect(
      runWithRequestContext(scopeA, () => repo.getById("snap-job-1-1")),
    ).resolves.toBeNull();
  });

  it("keeps only the newest 10 versions by default", async () => {
    for (let version = 1; version <= 12; version += 1) {
      await insert("job-1", version);
    }

    await runWithRequestContext(scopeA, () => repo.pruneToLatest("job-1"));

    const rows = await runWithRequestContext(scopeA, () =>
      repo.listForJob("job-1", 100),
    );
    expect(rows.map((row) => row.version)).toEqual([
      12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
    ]);
  });

  it("does not let a second tenant read or delete the first tenant's rows", async () => {
    await insert("job-1", 1);

    await expect(
      runWithRequestContext(scopeB, () => repo.getById("snap-job-1-1")),
    ).resolves.toBeNull();
    await runWithRequestContext(scopeB, () => repo.pruneToLatest("job-1", 0));

    await expect(
      runWithRequestContext(scopeA, () => repo.getById("snap-job-1-1")),
    ).resolves.not.toBeNull();
  });

  it("enforces the unique (tenant, user, job, version) index", async () => {
    await insert("job-1", 1);

    await expect(
      insert("job-1", 1, "snap-job-1-1-duplicate"),
    ).rejects.toThrow();
  });
});
