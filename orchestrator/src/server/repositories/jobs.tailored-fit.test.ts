import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TailoredFitNote } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RequestContextModule = typeof import("@infra/request-context");

const scopeA = { requestId: "test-a", tenantId: "tenant-a", userId: "user-a" };
const scopeB = { requestId: "test-b", tenantId: "tenant-b", userId: "user-b" };

const notes: TailoredFitNote[] = [
  {
    requirement: "TypeScript",
    status: "covered",
    explanation: "Shown in project work.",
    evidenceRefs: ["skill-typescript"],
  },
  {
    requirement: "Kubernetes",
    status: "gap",
    explanation: "No supporting evidence.",
    evidenceRefs: [],
  },
];

describe.sequential("jobs repository tailored-fit fields", () => {
  let tempDir: string;
  let jobsRepo: Awaited<typeof import("./jobs")>;
  let runWithRequestContext: RequestContextModule["runWithRequestContext"];
  let jobId: string;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-tailored-fit-repo-"));
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

    jobsRepo = await import("./jobs");
    ({ runWithRequestContext } = await import("@infra/request-context"));

    const job = await runWithRequestContext(scopeA, () =>
      jobsRepo.createJob({
        source: "manual",
        title: "Backend Engineer",
        employer: "Acme",
        jobUrl: "https://example.test/job-tailored-fit",
      }),
    );
    jobId = job.id;
  });

  afterEach(async () => {
    const { closeDb } = await import("../db/index");
    closeDb();
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("reads null derived fields on an existing job", async () => {
    const job = await runWithRequestContext(scopeA, () =>
      jobsRepo.getJobById(jobId),
    );

    expect(job).not.toBeNull();
    expect(job).toMatchObject({
      tailoredFitScore: null,
      tailoredFitNotes: null,
      tailoredFitSummary: null,
      tailoredFitSnapshotId: null,
      tailoredFitSnapshotVersion: null,
      tailoredFitInputHash: null,
      tailoredFitComputedAt: null,
      tailoredFitModel: null,
    });
  });

  it("round-trips all eight derived fields through updateJob and getJobById", async () => {
    const input = {
      tailoredFitScore: 78,
      tailoredFitNotes: notes,
      tailoredFitSummary: "Strong match with one gap.",
      tailoredFitSnapshotId: "snap-job-tailored-fit-1",
      tailoredFitSnapshotVersion: 3,
      tailoredFitInputHash: "a".repeat(64),
      tailoredFitComputedAt: 1_733_000_000_000,
      tailoredFitModel: "test-model",
    };

    const updated = await runWithRequestContext(scopeA, () =>
      jobsRepo.updateJob(jobId, input),
    );
    const read = await runWithRequestContext(scopeA, () =>
      jobsRepo.getJobById(jobId),
    );

    expect(updated).toMatchObject(input);
    expect(read).toMatchObject(input);
    expect(read?.tailoredFitNotes).toEqual(notes);
    expect(input).not.toHaveProperty("suitabilityScore");
    expect(input).not.toHaveProperty("jobBrief");
  });

  it("does not expose or modify derived fields from another tenant", async () => {
    await runWithRequestContext(scopeA, () =>
      jobsRepo.updateJob(jobId, {
        tailoredFitScore: 91,
        tailoredFitNotes: notes,
        tailoredFitSummary: "Private result.",
      }),
    );

    await expect(
      runWithRequestContext(scopeB, () => jobsRepo.getJobById(jobId)),
    ).resolves.toBeNull();
    await expect(
      runWithRequestContext(scopeB, () =>
        jobsRepo.updateJob(jobId, { tailoredFitScore: 1 }),
      ),
    ).resolves.toBeNull();

    const read = await runWithRequestContext(scopeA, () =>
      jobsRepo.getJobById(jobId),
    );
    expect(read?.tailoredFitScore).toBe(91);
    expect(read?.tailoredFitSummary).toBe("Private result.");
    expect(read?.tailoredFitNotes).toEqual(notes);
  });

  it("truncates notes to 12 entries and returns null for invalid stored JSON", async () => {
    const manyNotes: TailoredFitNote[] = Array.from({ length: 15 }, (_, i) => ({
      requirement: `Requirement ${i + 1}`,
      status: "partial",
      explanation: `Explanation ${i + 1}`,
      evidenceRefs: [],
    }));

    await runWithRequestContext(scopeA, () =>
      jobsRepo.updateJob(jobId, { tailoredFitNotes: manyNotes }),
    );
    const truncated = await runWithRequestContext(scopeA, () =>
      jobsRepo.getJobById(jobId),
    );
    expect(truncated?.tailoredFitNotes).toHaveLength(12);
    expect(truncated?.tailoredFitNotes?.[0]).toEqual(manyNotes[0]);
    expect(truncated?.tailoredFitNotes?.[11]).toEqual(manyNotes[11]);

    const { db, schema } = await import("../db/index");
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.jobs)
      .set({ tailoredFitNotes: "not-valid-json" })
      .where(eq(schema.jobs.id, jobId));

    const invalid = await runWithRequestContext(scopeA, () =>
      jobsRepo.getJobById(jobId),
    );
    expect(invalid?.tailoredFitNotes).toBeNull();
  });
});
