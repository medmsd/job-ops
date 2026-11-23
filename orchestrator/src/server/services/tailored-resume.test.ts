import type {
  DesignResumeJson,
  Job,
  ResumeProfile,
  TailoredResumeSnapshot,
} from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultV5ResumeData } from "./rxresume/schema/v5";

const mocks = vi.hoisted(() => ({
  getJobById: vi.fn(),
  updateJob: vi.fn(),
  listForJob: vi.fn(),
  insertVersion: vi.fn(),
  markSuperseded: vi.fn(),
  pruneToLatest: vi.fn(),
  getById: vi.fn(),
  getCurrentDesignResumeOrNullOnLegacy: vi.fn(),
  prepareTailoredResumeForPdf: vi.fn(),
  getCareerEvidenceBank: vi.fn(),
  checkTailoredClaims: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock("@server/repositories/jobs", () => ({
  getJobById: mocks.getJobById,
  updateJob: mocks.updateJob,
}));

vi.mock("@server/repositories/tailored-resumes", () => ({
  listForJob: mocks.listForJob,
  insertVersion: mocks.insertVersion,
  markSuperseded: mocks.markSuperseded,
  pruneToLatest: mocks.pruneToLatest,
  getById: mocks.getById,
}));

vi.mock("./design-resume", () => ({
  getCurrentDesignResumeOrNullOnLegacy:
    mocks.getCurrentDesignResumeOrNullOnLegacy,
}));

vi.mock("./rxresume", () => ({
  prepareTailoredResumeForPdf: mocks.prepareTailoredResumeForPdf,
}));

vi.mock("./careerEvidence", () => ({
  getCareerEvidenceBank: mocks.getCareerEvidenceBank,
  checkTailoredClaims: mocks.checkTailoredClaims,
}));

vi.mock("./profile", () => ({
  getProfile: mocks.getProfile,
}));

import {
  approveSnapshot,
  buildResumeChangeLog,
  restoreSnapshot,
  saveSnapshotEdit,
} from "./tailored-resume";

const baseResume = {
  ...defaultV5ResumeData,
  basics: { ...defaultV5ResumeData.basics, headline: "Original headline" },
  summary: { ...defaultV5ResumeData.summary, content: "Original summary" },
} as unknown as DesignResumeJson;

function makeJob(): Job {
  return {
    id: "job-1",
    jobDescription: "Build reliable backend services with Java and Spring.",
    employer: "Acme",
    tailoredSummary: "Tailored summary",
    tailoredHeadline: "Tailored headline",
    tailoredSkills: JSON.stringify([{ name: "Backend", keywords: ["Java"] }]),
    selectedProjectIds: null,
    tracerLinksEnabled: false,
  } as unknown as Job;
}

function makeSnapshot(
  overrides: Partial<TailoredResumeSnapshot> = {},
): TailoredResumeSnapshot {
  return {
    id: "snapshot-1",
    jobId: "job-1",
    version: 1,
    status: "approved",
    origin: "approved",
    resumeJson: baseResume,
    changes: [],
    ats: null,
    model: null,
    baseResumeDocumentId: "base-doc-1",
    baseResumeRevision: 2,
    generatedAt: 100,
    createdAt: "2026-11-22T00:00:00.000Z",
    updatedAt: "2026-11-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("tailored-resume service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getJobById.mockResolvedValue(makeJob());
    mocks.updateJob.mockResolvedValue(makeJob());
    mocks.listForJob.mockResolvedValue([]);
    mocks.insertVersion.mockImplementation(async (input) =>
      makeSnapshot({ ...input, status: "approved" }),
    );
    mocks.getById.mockResolvedValue(null);
    mocks.markSuperseded.mockResolvedValue(undefined);
    mocks.pruneToLatest.mockResolvedValue(undefined);
    mocks.getCurrentDesignResumeOrNullOnLegacy.mockResolvedValue({
      id: "base-doc-1",
      revision: 2,
      resumeJson: baseResume,
    });
    mocks.prepareTailoredResumeForPdf.mockImplementation(async (args) => ({
      mode: "v5",
      data: {
        ...(args.resumeData as object),
        basics: {
          ...(defaultV5ResumeData.basics as object),
          headline: "Tailored headline",
        },
        summary: {
          ...(defaultV5ResumeData.summary as object),
          content: "Tailored summary",
        },
      },
      projectCatalog: [],
      selectedProjectIds: [],
    }));
    mocks.getCareerEvidenceBank.mockResolvedValue({
      targetRoles: [],
      coreSkills: [],
      achievements: [],
      alwaysInclude: [],
      neverClaim: [],
      preferredTerms: [],
      avoidTerms: [],
    });
    mocks.getProfile.mockResolvedValue({
      basics: {},
      sections: {},
    } as unknown as ResumeProfile);
    mocks.checkTailoredClaims.mockReturnValue({
      blocked: [],
      unsupported: [],
      covered: [],
      missingEvidenceRefs: [],
    });
  });

  it("approves version 1 and updates the job snapshot reference", async () => {
    const snapshot = await approveSnapshot("job-1", {
      requestOrigin: "https://example.test",
      model: "test-model",
    });

    expect(snapshot).toMatchObject({ version: 1, status: "approved" });
    expect(mocks.insertVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        version: 1,
        origin: "approved",
        model: "test-model",
        baseResumeDocumentId: "base-doc-1",
        baseResumeRevision: 2,
      }),
    );
    expect(mocks.updateJob).toHaveBeenCalledWith("job-1", {
      tailoredResumeSnapshotId: snapshot.id,
      tailoredResumeVersion: 1,
    });
    expect(mocks.checkTailoredClaims).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Tailored headline"),
        jobDescription: makeJob().jobDescription,
      }),
    );
    expect(mocks.prepareTailoredResumeForPdf).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1" }),
    );
  });

  it("leaves baseline skills untouched when tailored skills are empty or malformed", async () => {
    for (const tailoredSkills of [null, "not json", "[]"]) {
      mocks.getJobById.mockResolvedValue({
        ...makeJob(),
        tailoredSkills,
      } as unknown as Job);

      await approveSnapshot("job-1");

      expect(mocks.prepareTailoredResumeForPdf).toHaveBeenLastCalledWith(
        expect.objectContaining({
          tailoredContent: expect.objectContaining({ skills: null }),
        }),
      );
    }
  });

  it("supersedes the previous approval and writes version 2", async () => {
    mocks.listForJob.mockResolvedValue([
      makeSnapshot({ id: "snapshot-1", version: 1 }),
    ]);
    mocks.insertVersion.mockImplementation(async (input) =>
      makeSnapshot({ ...input, id: "snapshot-2", version: 2 }),
    );

    const snapshot = await approveSnapshot("job-1");

    expect(snapshot.version).toBe(2);
    expect(mocks.insertVersion).toHaveBeenCalledWith(
      expect.objectContaining({ version: 2, origin: "approved" }),
    );
    expect(mocks.markSuperseded).toHaveBeenCalledWith(["snapshot-1"]);
    expect(mocks.pruneToLatest).toHaveBeenCalledWith("job-1", 10);
  });

  it("prunes to the latest 10 when there are 11 existing versions", async () => {
    const existing = Array.from({ length: 11 }, (_, index) =>
      makeSnapshot({ id: `snapshot-${index + 1}`, version: index + 1 }),
    );
    mocks.listForJob.mockResolvedValue([...existing].reverse());

    await approveSnapshot("job-1");

    expect(mocks.insertVersion).toHaveBeenCalledWith(
      expect.objectContaining({ version: 12 }),
    );
    expect(mocks.pruneToLatest).toHaveBeenCalledWith("job-1", 10);
    expect(mocks.markSuperseded).toHaveBeenCalledWith(
      [...existing].reverse().map((row) => row.id),
    );
  });

  it("saves an edit as a new approved version with a change log", async () => {
    mocks.listForJob.mockResolvedValue([
      makeSnapshot({ id: "snapshot-1", version: 1 }),
    ]);
    mocks.getById.mockResolvedValue(makeSnapshot());
    const edited = {
      ...baseResume,
      basics: {
        ...(defaultV5ResumeData.basics as object),
        headline: "Edited headline",
      },
    } as unknown as DesignResumeJson;

    await saveSnapshotEdit("job-1", "snapshot-1", edited);

    expect(mocks.insertVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        version: 2,
        origin: "approved",
        model: null,
        ats: null,
        changes: expect.arrayContaining([
          expect.objectContaining({
            path: "basics.headline",
            label: "Headline",
            kind: "changed",
            before: "Original headline",
            after: "Edited headline",
          }),
        ]),
      }),
    );
    expect(mocks.updateJob).toHaveBeenCalledWith("job-1", {
      tailoredResumeSnapshotId: expect.any(String),
      tailoredResumeVersion: expect.any(Number),
    });
  });

  it("restores a snapshot as a new version with identical resume JSON", async () => {
    mocks.listForJob.mockResolvedValue([
      makeSnapshot({ id: "snapshot-1", version: 1 }),
    ]);
    mocks.getById.mockResolvedValue(makeSnapshot({ version: 3 }));

    await restoreSnapshot("job-1", "snapshot-1");

    expect(mocks.insertVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        version: 2,
        origin: "restored",
        resumeJson: baseResume,
        changes: [
          {
            path: "version",
            label: "Restored from version 3",
            kind: "changed",
            before: 3,
            after: 4,
          },
        ],
      }),
    );
  });

  it("restores a superseded snapshot as a new latest version", async () => {
    mocks.listForJob.mockResolvedValue([
      makeSnapshot({ id: "snapshot-1", version: 1, status: "superseded" }),
      makeSnapshot({ id: "snapshot-2", version: 2 }),
    ]);
    mocks.getById.mockResolvedValue(
      makeSnapshot({ id: "snapshot-1", version: 1, status: "superseded" }),
    );

    const restored = await restoreSnapshot("job-1", "snapshot-1");

    expect(restored.origin).toBe("restored");
    expect(mocks.insertVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        origin: "restored",
        resumeJson: baseResume,
      }),
    );
  });

  it("does not allow editing a superseded snapshot", async () => {
    mocks.getById.mockResolvedValue(makeSnapshot({ status: "superseded" }));

    await expect(
      saveSnapshotEdit("job-1", "snapshot-1", baseResume),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.insertVersion).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND for a snapshot from another job", async () => {
    mocks.getById.mockResolvedValue(
      makeSnapshot({ id: "snapshot-2", jobId: "job-2" }),
    );

    await expect(
      saveSnapshotEdit("job-1", "snapshot-2", baseResume),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(restoreSnapshot("job-1", "snapshot-2")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mocks.insertVersion).not.toHaveBeenCalled();
  });

  it("builds change log entries with exact comparisons", () => {
    const changes = buildResumeChangeLog(
      {
        basics: { headline: "Before" },
        summary: { content: "Old summary" },
        sections: {
          skills: { items: [{ name: "Java" }] },
          projects: { items: [{ id: "p1", hidden: false }] },
        },
      },
      {
        basics: { headline: "After" },
        sections: {
          summary: { content: "New summary" },
          skills: { items: [{ name: "Java" }, { name: "Spring" }] },
          projects: { items: [{ id: "p1", hidden: true }] },
        },
      },
    );

    expect(changes.map((change) => change.path)).toEqual([
      "basics.headline",
      "sections.summary.content",
      "sections.skills.items",
      "sections.projects.items.p1.hidden",
    ]);
    expect(changes[3]).toMatchObject({
      label: "Project p1",
      kind: "visibility",
      before: false,
      after: true,
    });
    expect(
      buildResumeChangeLog(
        { basics: { headline: "Same" } },
        { basics: { headline: "Same" } },
      ),
    ).toEqual([]);
  });

  it("does not call an LLM or network client", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.reject(new Error("network disabled")));
    mocks.getById.mockResolvedValue(makeSnapshot());
    try {
      await approveSnapshot("job-1");
      await saveSnapshotEdit("job-1", "snapshot-1", baseResume);
      await restoreSnapshot("job-1", "snapshot-1");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
