import type {
  DesignResumeJson,
  Job,
  ResumeProfile,
  TailoredResumeSnapshot,
} from "@shared/types";
import type { CareerEvidenceBank } from "@shared/types/career-evidence";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callJson: vi.fn(),
  resolveLlmModel: vi.fn(),
  createConfiguredLlmService: vi.fn(),
  getCareerEvidenceBank: vi.fn(),
  getProfile: vi.fn(),
  getLatestApprovedForJob: vi.fn(),
  updateJob: vi.fn(),
  withHostedUsageReservation: vi.fn(),
}));

vi.mock("./modelSelection", () => ({
  resolveLlmModel: mocks.resolveLlmModel,
  createConfiguredLlmService: mocks.createConfiguredLlmService,
}));

vi.mock("./careerEvidence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./careerEvidence")>();
  return { ...actual, getCareerEvidenceBank: mocks.getCareerEvidenceBank };
});

vi.mock("./profile", () => ({ getProfile: mocks.getProfile }));

vi.mock("@server/repositories/tailored-resumes", () => ({
  getLatestApprovedForJob: mocks.getLatestApprovedForJob,
}));

vi.mock("@server/repositories/jobs", () => ({ updateJob: mocks.updateJob }));

vi.mock("./hosted-usage", () => ({
  withHostedUsageReservation: mocks.withHostedUsageReservation,
}));

import { getTenantId, runWithRequestContext } from "@infra/request-context";
import {
  buildTailoredFitInput,
  computeTailoredFit,
  getTailoredFitState,
  hashTailoredFitInput,
} from "./tailored-fit";

function makeResumeJson(
  overrides: Record<string, unknown> = {},
): DesignResumeJson {
  return {
    basics: {
      name: "Jane Doe",
      headline: "Senior Java Engineer",
      location: "Berlin",
    },
    summary: {
      title: "Summary",
      hidden: false,
      content: "Java engineer with Spring Boot",
    },
    sections: {
      skills: {
        title: "Skills",
        hidden: false,
        items: [
          {
            id: "skill-java",
            hidden: false,
            name: "Java",
            proficiency: "Expert",
            level: 5,
            keywords: ["Spring Boot"],
          },
        ],
      },
      projects: {
        title: "Projects",
        hidden: false,
        items: [
          {
            id: "project-payments",
            hidden: false,
            name: "Payments Platform",
            description: "Spring Boot microservices",
            period: "2020",
            keywords: ["Kafka"],
          },
          {
            id: "project-hidden",
            hidden: true,
            name: "Secret Project",
            description: "Hidden work",
          },
        ],
      },
      experience: {
        title: "Experience",
        hidden: false,
        items: [
          {
            id: "exp-acme",
            hidden: false,
            company: "Acme",
            position: "Engineer",
            location: "Berlin",
            period: "2019-2021",
            description: "Java services",
          },
        ],
      },
    },
    ...overrides,
  } as unknown as DesignResumeJson;
}

function makeProfile(overrides: Partial<ResumeProfile> = {}): ResumeProfile {
  return {
    basics: {
      name: "Jane Doe",
      label: "Senior Java Engineer",
      headline: "Senior Java Engineer",
      summary: "Java engineer with Spring Boot",
    },
    sections: {
      summary: { visible: true, content: "Java engineer with Spring Boot" },
      skills: {
        visible: true,
        items: [
          {
            id: "skill-java",
            name: "Java",
            description: "Expert",
            level: 5,
            keywords: ["Spring Boot"],
            visible: true,
          },
        ],
      },
      projects: {
        visible: true,
        items: [
          {
            id: "project-payments",
            name: "Payments Platform",
            description: "Spring Boot microservices",
            date: "2020",
            summary: "Spring Boot microservices",
            visible: true,
            keywords: ["Kafka"],
          },
          {
            id: "project-hidden",
            name: "Secret Project",
            description: "Hidden work",
            date: "",
            summary: "Hidden work",
            visible: false,
          },
        ],
      },
      experience: {
        visible: true,
        items: [
          {
            id: "exp-acme",
            company: "Acme",
            position: "Engineer",
            location: "Berlin",
            date: "2019-2021",
            summary: "Java services",
            visible: true,
          },
        ],
      },
    },
    ...overrides,
  };
}

function makeBank(
  overrides: Partial<CareerEvidenceBank> = {},
): CareerEvidenceBank {
  return {
    targetRoles: ["Senior Java Engineer"],
    coreSkills: [
      {
        name: "Java",
        years: 8,
        level: "expert",
        evidence: ["project:project-payments"],
        aliases: [],
      },
    ],
    achievements: [
      {
        id: "ev-latency",
        text: "Reduced p95 latency",
        metric: "77%",
        evidence: ["project:project-payments"],
      },
    ],
    alwaysInclude: [],
    neverClaim: ["Kubernetes administrator"],
    preferredTerms: [],
    avoidTerms: [],
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<TailoredResumeSnapshot> = {},
): TailoredResumeSnapshot {
  return {
    id: "snapshot-1",
    jobId: "job-1",
    version: 3,
    status: "approved",
    origin: "approved",
    resumeJson: makeResumeJson(),
    changes: [],
    ats: null,
    model: null,
    baseResumeDocumentId: null,
    baseResumeRevision: null,
    generatedAt: 1000,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  const base = {
    id: "job-1",
    source: "manual",
    jobUrl: "https://example.test/jobs/1",
    title: "Senior Java Engineer",
    employer: "Acme",
    jobDescription: "We need Java and GraphQL engineers.",
    status: "ready",
    suitabilityScore: 42,
    suitabilityReason: "existing score",
    jobBrief: "existing brief",
    tailoredFitScore: null,
    tailoredFitNotes: null,
    tailoredFitSummary: null,
    tailoredFitSnapshotId: null,
    tailoredFitSnapshotVersion: null,
    tailoredFitInputHash: null,
    tailoredFitComputedAt: null,
    tailoredFitModel: null,
  };
  return { ...base, ...overrides } as unknown as Job;
}

describe("tailored-fit", () => {
  beforeEach(() => {
    mocks.callJson.mockReset();
    mocks.callJson.mockResolvedValue({
      success: true,
      data: { score: 80, summary: "Strong match", notes: [] },
    });
    mocks.resolveLlmModel.mockReset().mockResolvedValue("test-model");
    mocks.createConfiguredLlmService.mockReset().mockResolvedValue({
      callJson: mocks.callJson,
      getProvider: () => "test-provider",
    });
    mocks.getCareerEvidenceBank.mockReset().mockResolvedValue(makeBank());
    mocks.getProfile.mockReset().mockResolvedValue(makeProfile());
    mocks.getLatestApprovedForJob.mockReset().mockResolvedValue(makeSnapshot());
    mocks.updateJob.mockReset().mockImplementation(async (_id, input) => ({
      ...makeJob(),
      ...input,
    }));
    mocks.withHostedUsageReservation
      .mockReset()
      .mockImplementation(async (_args, work) => (await work()).result);
  });

  it("does not call the LLM when the JD or approved snapshot is missing", async () => {
    await expect(
      computeTailoredFit(makeJob({ jobDescription: "   " })),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

    mocks.getLatestApprovedForJob.mockResolvedValueOnce(null);
    await expect(computeTailoredFit(makeJob())).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });

    expect(mocks.callJson).not.toHaveBeenCalled();
    expect(mocks.updateJob).not.toHaveBeenCalled();
  });

  it("returns deterministic non-AI states", async () => {
    await expect(
      getTailoredFitState(makeJob({ jobDescription: null })),
    ).resolves.toEqual({
      result: null,
      isStale: false,
      reason: "no_description",
    });

    mocks.getLatestApprovedForJob.mockResolvedValueOnce(null);
    await expect(getTailoredFitState(makeJob())).resolves.toEqual({
      result: null,
      isStale: false,
      reason: "no_snapshot",
    });

    await expect(getTailoredFitState(makeJob())).resolves.toEqual({
      result: null,
      isStale: false,
      reason: "not_checked",
    });
    expect(mocks.callJson).not.toHaveBeenCalled();
  });

  it("is stable for key order and changes when any input source changes", async () => {
    const args = {
      job: makeJob(),
      snapshot: makeSnapshot(),
      evidenceBank: makeBank(),
      profile: makeProfile(),
    };
    const base = hashTailoredFitInput(buildTailoredFitInput(args));

    expect(hashTailoredFitInput({ a: 1, b: 2 })).toBe(
      hashTailoredFitInput({ b: 2, a: 1 }),
    );
    expect(
      hashTailoredFitInput(
        buildTailoredFitInput({
          ...args,
          job: makeJob({ jobDescription: "Kotlin only" }),
        }),
      ),
    ).not.toBe(base);
    expect(
      hashTailoredFitInput(
        buildTailoredFitInput({
          ...args,
          snapshot: makeSnapshot({
            resumeJson: makeResumeJson({
              basics: { headline: "Lead Java Engineer" },
            }),
          }),
        }),
      ),
    ).not.toBe(base);
    expect(
      hashTailoredFitInput(
        buildTailoredFitInput({
          ...args,
          evidenceBank: makeBank({ neverClaim: ["Rust administrator"] }),
        }),
      ),
    ).not.toBe(base);
    expect(
      hashTailoredFitInput(
        buildTailoredFitInput({
          ...args,
          profile: makeProfile({
            basics: { label: "Lead Java Engineer" },
          }),
        }),
      ),
    ).not.toBe(base);
  });

  it("returns the stored result fresh and stale after a snapshot version change", async () => {
    const snapshot = makeSnapshot();
    const job = makeJob();
    const inputHash = hashTailoredFitInput(
      buildTailoredFitInput({
        job,
        snapshot,
        evidenceBank: makeBank(),
        profile: makeProfile(),
      }),
    );
    const storedJob = makeJob({
      tailoredFitScore: 88,
      tailoredFitSummary: "Good fit",
      tailoredFitNotes: [],
      tailoredFitSnapshotId: snapshot.id,
      tailoredFitSnapshotVersion: snapshot.version,
      tailoredFitInputHash: inputHash,
      tailoredFitComputedAt: 1234,
      tailoredFitModel: "test-model",
    });

    await expect(getTailoredFitState(storedJob)).resolves.toMatchObject({
      isStale: false,
      reason: null,
      result: { score: 88, snapshotId: snapshot.id },
    });

    mocks.getLatestApprovedForJob.mockResolvedValueOnce(
      makeSnapshot({ version: snapshot.version + 1 }),
    );
    await expect(getTailoredFitState(storedJob)).resolves.toMatchObject({
      isStale: true,
      reason: "inputs_changed",
      result: { score: 88 },
    });
    expect(mocks.callJson).not.toHaveBeenCalled();
  });

  it("drops invalid evidence refs and downgrades covered notes without valid refs", async () => {
    mocks.callJson.mockResolvedValueOnce({
      success: true,
      data: {
        score: 90,
        summary: "Mostly covered",
        notes: [
          {
            requirement: "Java",
            status: "covered",
            explanation: "Used Java",
            evidenceRefs: ["project:project-payments", "project:deleted"],
          },
          {
            requirement: "GraphQL",
            status: "covered",
            explanation: "Claimed GraphQL",
            evidenceRefs: ["project:deleted"],
          },
        ],
      },
    });

    const result = await computeTailoredFit(makeJob());
    expect(result.tailoredFitNotes?.[0]).toMatchObject({
      status: "covered",
      evidenceRefs: ["project:project-payments"],
    });
    expect(result.tailoredFitNotes?.[1]).toMatchObject({
      status: "unsupported",
      evidenceRefs: [],
    });
  });

  it("caps the score at 40 when the resume contains a neverClaim term", async () => {
    mocks.getCareerEvidenceBank.mockResolvedValueOnce(
      makeBank({ neverClaim: ["Kubernetes administrator"] }),
    );
    mocks.getLatestApprovedForJob.mockResolvedValueOnce(
      makeSnapshot({
        resumeJson: makeResumeJson({
          summary: {
            title: "Summary",
            hidden: false,
            content: "Kubernetes administrator with Java",
          },
        }),
      }),
    );
    mocks.callJson.mockResolvedValueOnce({
      success: true,
      data: { score: 99, summary: "Great", notes: [] },
    });

    const result = await computeTailoredFit(makeJob());
    expect(result.tailoredFitScore).toBe(40);
  });

  it("caps the score at 60 when JD terms are unsupported by evidence", async () => {
    mocks.getLatestApprovedForJob.mockResolvedValueOnce(
      makeSnapshot({
        resumeJson: makeResumeJson({
          summary: {
            title: "Summary",
            hidden: false,
            content: "Java and GraphQL services",
          },
        }),
      }),
    );
    mocks.callJson.mockResolvedValueOnce({
      success: true,
      data: { score: 99, summary: "Great", notes: [] },
    });

    const result = await computeTailoredFit(makeJob());
    expect(result.tailoredFitScore).toBe(60);
  });

  it("clamps out-of-range scores and caps notes at 12", async () => {
    mocks.callJson.mockResolvedValueOnce({
      success: true,
      data: {
        score: 250,
        summary: "Great",
        notes: Array.from({ length: 20 }, (_, index) => ({
          requirement: `Requirement ${index}`,
          status: "gap",
          explanation: "Missing",
          evidenceRefs: [],
        })),
      },
    });

    const result = await computeTailoredFit(makeJob());
    expect(result.tailoredFitScore).toBe(100);
    expect(result.tailoredFitNotes).toHaveLength(12);
  });

  it("persists only the eight derived tailored-fit fields", async () => {
    await computeTailoredFit(makeJob());

    expect(mocks.updateJob).toHaveBeenCalledTimes(1);
    const [jobId, input] = mocks.updateJob.mock.calls[0] as [string, Job];
    expect(jobId).toBe("job-1");
    expect(Object.keys(input).sort()).toEqual(
      [
        "tailoredFitScore",
        "tailoredFitNotes",
        "tailoredFitSummary",
        "tailoredFitSnapshotId",
        "tailoredFitSnapshotVersion",
        "tailoredFitInputHash",
        "tailoredFitComputedAt",
        "tailoredFitModel",
      ].sort(),
    );
    for (const field of ["suitabilityScore", "suitabilityReason", "jobBrief"]) {
      expect(input).not.toHaveProperty(field);
    }
  });

  it("cannot use another tenant's snapshot for a job", async () => {
    const snapshot = makeSnapshot();
    mocks.getLatestApprovedForJob.mockImplementation(async (jobId: string) =>
      getTenantId() === "tenant-a" && jobId === "job-1" ? snapshot : null,
    );

    await expect(
      runWithRequestContext(
        { requestId: "req-tenant-b", tenantId: "tenant-b", userId: "user-b" },
        () => computeTailoredFit(makeJob()),
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(mocks.callJson).not.toHaveBeenCalled();

    const result = await runWithRequestContext(
      { requestId: "req-tenant-a", tenantId: "tenant-a", userId: "user-a" },
      () => computeTailoredFit(makeJob()),
    );
    expect(result.tailoredFitSnapshotId).toBe(snapshot.id);
  });
});
