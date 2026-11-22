import { beforeEach, describe, expect, it, vi } from "vitest";
import * as jobsRepo from "../repositories/jobs";
import * as settingsRepo from "../repositories/settings";
import { getProfile } from "../services/profile";
import { pickProjectIdsForJob } from "../services/projectSelection";
import { generateTailoring } from "../services/summary";
import { summarizeJob } from "./orchestrator";

vi.mock("@infra/logger", () => {
  const logger = {
    child: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return { logger };
});

vi.mock("@infra/product-analytics", () => ({
  trackServerProductEvent: vi.fn(),
}));

vi.mock("../repositories/jobs", () => ({
  getJobById: vi.fn(),
  listJobNotes: vi.fn(),
  updateJob: vi.fn(),
}));

vi.mock("../repositories/pipeline", () => ({
  createPipelineRun: vi.fn(),
  updatePipelineRun: vi.fn(),
}));

vi.mock("../repositories/settings", () => ({
  getSetting: vi.fn(),
  getAllSettings: vi.fn(),
}));

vi.mock("../services/pdf", () => ({
  generatePdf: vi.fn(),
}));

vi.mock("../services/pdf-fingerprint", () => ({
  createJobPdfFingerprint: vi.fn(),
  resolvePdfFingerprintContext: vi.fn(),
}));

vi.mock("../services/profile", () => ({
  getProfile: vi.fn(),
}));

vi.mock("../services/projectSelection", () => ({
  pickProjectIdsForJob: vi.fn(),
}));

vi.mock("../services/summary", () => ({
  generateTailoring: vi.fn(),
}));

vi.mock("./steps", () => ({
  discoverJobsStep: vi.fn(),
  importJobsStep: vi.fn(),
  loadProfileStep: vi.fn(),
  notifyPipelineWebhookStep: vi.fn(),
  processJobsStep: vi.fn(),
  scoreJobsStep: vi.fn(),
  selectJobsStep: vi.fn(),
}));

const profileWithProjects = {
  sections: {
    projects: {
      items: [
        {
          id: "mumtaz-urdu",
          name: "Mumtaz Urdu",
          summary: "Next.js education platform.",
          description: "",
          date: "",
          visible: false,
        },
        {
          id: "jobops",
          name: "JobOps",
          summary: "Job search automation app.",
          description: "",
          date: "",
          visible: false,
        },
        {
          id: "indus-marine",
          name: "Indus Marine Services",
          summary: "Induction platform.",
          description: "",
          date: "",
          visible: false,
        },
      ],
    },
  },
};

describe("summarizeJob project selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(jobsRepo.listJobNotes).mockResolvedValue([]);
    vi.mocked(generateTailoring).mockResolvedValue({
      success: true,
      data: {
        summary: "Generated summary",
        headline: "Generated headline",
        skills: [{ name: "Backend", keywords: ["Java"] }],
      },
    });
    vi.mocked(jobsRepo.getJobById).mockResolvedValue({
      id: "job-1",
      jobDescription: "Data acquisition engineer role.",
      tailoredSummary: "Existing summary.",
      tailoredHeadline: "Existing headline.",
      tailoredSkills: JSON.stringify(["TypeScript"]),
      selectedProjectIds: "mumtaz-urdu,jobops,indus-marine",
    } as any);
    vi.mocked(jobsRepo.updateJob).mockResolvedValue(undefined as any);
    vi.mocked(getProfile).mockResolvedValue(profileWithProjects as any);
    vi.mocked(settingsRepo.getSetting).mockImplementation(async (key) => {
      if (key !== "resumeProjects") return null;
      return JSON.stringify({
        maxProjects: 3,
        lockedProjectIds: [],
        aiSelectableProjectIds: ["mumtaz-urdu"],
      });
    });
    vi.mocked(pickProjectIdsForJob).mockResolvedValue(["mumtaz-urdu"]);
  });

  it("reselects stale saved projects using only the AI-selectable pool", async () => {
    const result = await summarizeJob("job-1");

    expect(result).toEqual({ success: true });
    expect(pickProjectIdsForJob).toHaveBeenCalledTimes(1);
    expect(pickProjectIdsForJob).toHaveBeenCalledWith(
      expect.objectContaining({
        desiredCount: 3,
        eligibleProjects: [
          expect.objectContaining({
            id: "mumtaz-urdu",
            name: "Mumtaz Urdu",
          }),
        ],
      }),
    );
    expect(jobsRepo.updateJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        selectedProjectIds: "mumtaz-urdu",
      }),
    );
  });

  it("does not call the selection model when must-include projects fill the target", async () => {
    vi.mocked(jobsRepo.getJobById).mockResolvedValue({
      id: "job-1",
      jobDescription: "Data acquisition engineer role.",
      tailoredSummary: "Existing summary.",
      tailoredHeadline: "Existing headline.",
      tailoredSkills: JSON.stringify(["TypeScript"]),
      selectedProjectIds: null,
    } as any);
    vi.mocked(settingsRepo.getSetting).mockResolvedValue(
      JSON.stringify({
        maxProjects: 3,
        lockedProjectIds: ["mumtaz-urdu", "jobops", "indus-marine"],
        aiSelectableProjectIds: [],
      }),
    );

    expect(await summarizeJob("job-1")).toEqual({ success: true });
    expect(pickProjectIdsForJob).not.toHaveBeenCalled();
    expect(jobsRepo.updateJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ selectedProjectIds: "" }),
    );
  });

  it("replaces only projects when projects are explicitly requested", async () => {
    await summarizeJob("job-1", { force: true, fields: ["projects"] });

    expect(jobsRepo.updateJob).toHaveBeenCalledWith("job-1", {
      selectedProjectIds: "mumtaz-urdu",
    });
  });
});

describe("summarizeJob tailoring context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(jobsRepo.listJobNotes).mockResolvedValue([
      {
        id: "note-1",
        jobId: "job-context",
        title: "Recruiter note",
        content: "Referral from Sam",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    vi.mocked(jobsRepo.updateJob).mockResolvedValue(undefined as any);
    vi.mocked(getProfile).mockResolvedValue({} as any);
    vi.mocked(generateTailoring).mockResolvedValue({
      success: true,
      data: {
        summary: "Generated summary",
        headline: "Generated headline",
        skills: [{ name: "Backend", keywords: ["Java"] }],
      },
    });
  });

  it("passes structured job facts, notes, and approved context into tailoring", async () => {
    vi.mocked(jobsRepo.getJobById).mockResolvedValue({
      id: "job-context",
      title: "Senior Backend Engineer",
      employer: "Example Co",
      location: "Remote",
      jobDescription: "Build APIs",
      jobBrief: "{\"role_summary\":\"Build APIs\"}",
      suitabilityReason: "Strong match",
      degreeRequired: "BSc",
      disciplines: "Computer Science",
      tailoredSummary: "Approved summary",
      tailoredHeadline: "Approved headline",
      tailoredSkills: JSON.stringify([
        { name: "Backend", keywords: ["Java"] },
      ]),
    } as any);

    const result = await summarizeJob("job-context", {
      force: true,
      fields: ["summary", "headline", "skills"],
    });

    expect(result).toEqual({ success: true });
    expect(generateTailoring).toHaveBeenCalledWith(
      "Build APIs",
      {},
      expect.objectContaining({
        title: "Senior Backend Engineer",
        employer: "Example Co",
        location: "Remote",
        jobBrief: "{\"role_summary\":\"Build APIs\"}",
        suitabilityReason: "Strong match",
        degreeRequired: "BSc",
        disciplines: "Computer Science",
        notes: ["Recruiter note: Referral from Sam"],
        approved: {
          summary: "Approved summary",
          headline: "Approved headline",
          skills: [{ name: "Backend", keywords: ["Java"] }],
        },
      }),
    );
  });

  it("generates missing skills when summary and headline already exist", async () => {
    vi.mocked(jobsRepo.getJobById).mockResolvedValue({
      id: "job-missing-skills",
      title: "Backend Engineer",
      employer: "Example Co",
      jobDescription: "Build APIs",
      tailoredSummary: "Existing summary",
      tailoredHeadline: "Existing headline",
      tailoredSkills: null,
    } as any);

    await summarizeJob("job-missing-skills", {
      fields: ["skills"],
    });

    expect(generateTailoring).toHaveBeenCalledTimes(1);
    expect(jobsRepo.updateJob).toHaveBeenCalledWith(
      "job-missing-skills",
      expect.objectContaining({
        tailoredSkills: JSON.stringify([
          { name: "Backend", keywords: ["Java"] },
        ]),
      }),
    );
  });

  it("does not generate when all tailoring fields are present", async () => {
    vi.mocked(jobsRepo.getJobById).mockResolvedValue({
      id: "job-complete",
      title: "Backend Engineer",
      employer: "Example Co",
      jobDescription: "Build APIs",
      tailoredSummary: "Existing summary",
      tailoredHeadline: "Existing headline",
      tailoredSkills: JSON.stringify([
        { name: "Backend", keywords: ["Java"] },
      ]),
    } as any);

    await summarizeJob("job-complete", {
      fields: ["summary", "headline", "skills"],
    });

    expect(generateTailoring).not.toHaveBeenCalled();
  });

  it("tolerates malformed stored skills when building approved context", async () => {
    vi.mocked(jobsRepo.getJobById).mockResolvedValue({
      id: "job-bad-skills",
      title: "Backend Engineer",
      employer: "Example Co",
      jobDescription: "Build APIs",
      tailoredSkills: "{",
    } as any);

    await summarizeJob("job-bad-skills", { force: true, fields: ["skills"] });

    expect(generateTailoring).toHaveBeenCalledWith(
      "Build APIs",
      {},
      expect.objectContaining({
        approved: expect.objectContaining({ skills: [] }),
      }),
    );
  });
});
