import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe.sequential("jobs repository createJobs", () => {
  let tempDir: string;
  let jobsRepo: Awaited<typeof import("./jobs")>;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-create-jobs-repo-"));
    process.env.DATA_DIR = tempDir;
    process.env.NODE_ENV = "test";

    await import("../db/migrate");
    jobsRepo = await import("./jobs");
  });

  afterEach(async () => {
    const { closeDb } = await import("../db/index");
    closeDb();
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("returns only the jobs newly inserted during this call", async () => {
    const input = {
      source: "manual" as const,
      title: "New Backend Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/create-jobs-new",
    };

    const result = await jobsRepo.createJobs([input, { ...input }]);

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.createdJobs).toHaveLength(1);
    expect(result.createdJobs[0]).toMatchObject({
      title: "New Backend Role",
      employer: "Acme",
      status: "discovered",
      suitabilityScore: null,
    });
  });

  it("returns an empty list when every job already exists", async () => {
    const input = {
      source: "manual" as const,
      title: "Existing Role",
      employer: "Acme",
      jobUrl: "https://example.com/job/create-jobs-existing",
    };
    await jobsRepo.createJob(input);

    const result = await jobsRepo.createJobs([input]);

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.createdJobs).toEqual([]);
  });
});
