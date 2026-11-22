import type { ResumeProfile } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callJsonMock = vi.fn();
const getProviderMock = vi.fn();
const getBaseUrlMock = vi.fn();
const settingsMocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  getEffectiveSettings: vi.fn(),
}));

vi.mock("../repositories/settings", () => settingsMocks);
vi.mock("@server/repositories/settings", () => settingsMocks);
vi.mock("@server/services/settings", () => ({
  getEffectiveSettings: settingsMocks.getEffectiveSettings,
}));

vi.mock("./llm/service", () => ({
  LlmService: class {
    callJson = callJsonMock;
    getProvider = getProviderMock;
    getBaseUrl = getBaseUrlMock;
  },
}));

vi.mock("./writing-style", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./writing-style")>();

  return {
    ...actual,
    getWritingStyle: vi.fn(),
  };
});

import { getSetting } from "../repositories/settings";
import { generateSummary, generateTailoring } from "./summary";
import { getWritingStyle } from "./writing-style";

describe("generateTailoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProviderMock.mockReturnValue("openrouter");
    getBaseUrlMock.mockReturnValue("https://openrouter.ai");
    settingsMocks.getEffectiveSettings.mockResolvedValue({
      model: { value: "gpt-4o-mini" },
      llmProvider: { value: "openrouter" },
      llmBaseUrl: { value: null },
      llmPurposeOverrides: { value: {} },
      modelTailoring: { value: null },
    });
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        summary: "Tailored summary",
        headline: "Senior Engineer",
        skills: [],
      },
    });
    vi.mocked(getSetting).mockResolvedValue(null);
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "Keep it under 90 words",
      doNotUse: "synergy",
      languageMode: "manual",
      manualLanguage: "german",
      summaryMaxWords: null,
      maxKeywordsPerSkill: null,
    });
  });

  it("passes shared writing-style and language instructions into tailoring prompts", async () => {
    const profile: ResumeProfile = {
      basics: {
        name: "Test User",
        label: "Engineer",
        summary: "Existing summary",
      },
    };

    await generateTailoring("<p>Build <strong>APIs</strong></p>", profile);

    expect(callJsonMock).toHaveBeenCalledTimes(1);

    const request = callJsonMock.mock.calls[0]?.[0];
    expect(request?.messages?.[0]?.content).toContain(
      "WRITING STYLE PREFERENCES:",
    );
    expect(request?.messages?.[0]?.content).toContain("Tone: friendly");
    expect(request?.messages?.[0]?.content).toContain("Formality: low");
    expect(request?.messages?.[0]?.content).toContain(
      "Additional constraints: Keep it under 90 words",
    );
    expect(request?.messages?.[0]?.content).toContain(
      "Avoid these words or phrases: synergy",
    );
    expect(request?.messages?.[0]?.content).toContain(
      "Output language for summary and skills: German",
    );
    expect(request?.messages?.[0]?.content).toContain(
      "Do NOT translate, localize, or paraphrase the headline, even if the rest of the output is in German.",
    );
    expect(request?.messages?.[0]?.content).toContain(
      'Keep "headline" in the exact original job-title wording from the JD.',
    );
    expect(request?.messages?.[0]?.content).toContain("Build APIs");
    expect(request?.messages?.[0]?.content).not.toContain("<strong>");
    expect(request?.messages?.[0]?.content).toContain(
      '"basics":{"name":"Test User"',
    );
  });

  it("includes the evidence bank and neverClaim rule in the tailoring prompt", async () => {
    vi.mocked(getSetting).mockImplementation(async (key) =>
      key === "careerEvidence"
        ? JSON.stringify({
            targetRoles: ["Senior Java Engineer"],
            coreSkills: [],
            achievements: [],
            alwaysInclude: [],
            neverClaim: ["Kubernetes administrator"],
            preferredTerms: [],
            avoidTerms: [],
          })
        : null,
    );

    await generateTailoring("Java engineer", {
      basics: { name: "Test User", label: "Engineer" },
    });

    const prompt = callJsonMock.mock.calls[0]?.[0]?.messages?.[0]?.content as string;
    expect(prompt).toContain("CAREER EVIDENCE BANK (approved facts only):");
    expect(prompt).toContain("Senior Java Engineer");
    expect(prompt).toContain("Kubernetes administrator");
    expect(prompt).toContain("Terms listed in the evidence bank's neverClaim list");
  });

  it("omits globally excluded projects from the tailoring prompt", async () => {
    vi.mocked(getSetting).mockImplementation(async (key) =>
      key === "resumeProjects"
        ? JSON.stringify({
            maxProjects: 1,
            lockedProjectIds: ["included"],
            aiSelectableProjectIds: [],
          })
        : null,
    );

    await generateTailoring("Build APIs", {
      sections: {
        projects: {
          items: ["included", "excluded"].map((id) => ({
            id,
            name: `${id} project`,
            description: id,
            summary: id,
            date: "2026",
            visible: true,
          })),
        },
      },
    });

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).toContain("included project");
    expect(prompt).not.toContain("excluded project");
  });

  it("removes language directives from constraints so explicit language settings win", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "Always respond in French. Keep it under 90 words.",
      doNotUse: "synergy",
      languageMode: "manual",
      manualLanguage: "german",
      summaryMaxWords: null,
      maxKeywordsPerSkill: null,
    });

    await generateTailoring("Build APIs", {
      basics: {
        name: "Test User",
        label: "Engineer",
      },
    });

    const request = callJsonMock.mock.calls.at(-1)?.[0];
    expect(request?.messages?.[0]?.content).toContain(
      "Additional constraints: Keep it under 90 words",
    );
    expect(request?.messages?.[0]?.content).not.toContain(
      "Always respond in French",
    );
    expect(request?.messages?.[0]?.content).toContain(
      "Output language for summary and skills: German",
    );
  });

  it("uses the detected job description language when configured", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "",
      doNotUse: "",
      languageMode: "match-job-description",
      manualLanguage: "english",
      summaryMaxWords: null,
      maxKeywordsPerSkill: null,
    });

    await generateTailoring(
      "Wir suchen Erfahrung mit Entwicklung und Verantwortung für APIs.",
      {
        basics: {
          name: "Test User",
          label: "Engineer",
        },
      },
    );

    const request = callJsonMock.mock.calls.at(-1)?.[0];
    expect(request?.messages?.[0]?.content).toContain(
      "Output language for summary and skills: German",
    );
  });

  it("falls back to english when job description language detection is weak", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "",
      doNotUse: "",
      languageMode: "match-job-description",
      manualLanguage: "german",
      summaryMaxWords: null,
      maxKeywordsPerSkill: null,
    });

    await generateTailoring("Senior platform role with Kubernetes.", {
      basics: {
        name: "Test User",
        label: "Engineer",
      },
    });

    const request = callJsonMock.mock.calls.at(-1)?.[0];
    expect(request?.messages?.[0]?.content).toContain(
      "Output language for summary and skills: English",
    );
  });

  it("uses a stored tailoring prompt template override", async () => {
    vi.mocked(getSetting).mockImplementation(async (key) =>
      key === "tailoringPromptTemplate"
        ? "Tailor {{tone}} {{outputLanguage}} {{unknownToken}}"
        : null,
    );

    await generateTailoring("Build APIs", {
      basics: {
        name: "Test User",
        label: "Engineer",
      },
    });

    const request = callJsonMock.mock.calls.at(-1)?.[0];
    expect(request?.messages?.[0]?.content).toContain(
      "Tailor friendly German {{unknownToken}}",
    );
  });

  it("includes word limit when summaryMaxWords is set", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "",
      doNotUse: "",
      languageMode: "manual",
      manualLanguage: "english",
      summaryMaxWords: 35,
      maxKeywordsPerSkill: null,
    });

    await generateTailoring("Build APIs", {
      basics: { name: "Test User", label: "Engineer" },
    });

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).toContain("Maximum 35 words.");
  });

  it("uses singular 'word' when summaryMaxWords is 1", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "",
      doNotUse: "",
      languageMode: "manual",
      manualLanguage: "english",
      summaryMaxWords: 1,
      maxKeywordsPerSkill: null,
    });

    await generateTailoring("Build APIs", {
      basics: { name: "Test User", label: "Engineer" },
    });

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).toContain("Maximum 1 word.");
  });

  it("omits word limit line when summaryMaxWords is null", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "",
      doNotUse: "",
      languageMode: "manual",
      manualLanguage: "english",
      summaryMaxWords: null,
      maxKeywordsPerSkill: null,
    });

    await generateTailoring("Build APIs", {
      basics: { name: "Test User", label: "Engineer" },
    });

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).not.toContain("Maximum");
  });

  it("includes keyword limit when maxKeywordsPerSkill is set", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "",
      doNotUse: "",
      languageMode: "manual",
      manualLanguage: "english",
      summaryMaxWords: null,
      maxKeywordsPerSkill: 8,
    });

    await generateTailoring("Build APIs", {
      basics: { name: "Test User", label: "Engineer" },
    });

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).toContain("Maximum 8 keywords per category");
  });

  it("omits keyword limit when maxKeywordsPerSkill is null", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "",
      doNotUse: "",
      languageMode: "manual",
      manualLanguage: "english",
      summaryMaxWords: null,
      maxKeywordsPerSkill: null,
    });

    await generateTailoring("Build APIs", {
      basics: { name: "Test User", label: "Engineer" },
    });

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).not.toContain("keywords per category");
  });

  it("includes both limits and constraints when all set", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "friendly",
      formality: "low",
      constraints: "keep under 90 words",
      doNotUse: "",
      languageMode: "manual",
      manualLanguage: "english",
      summaryMaxWords: 35,
      maxKeywordsPerSkill: 8,
    });

    await generateTailoring("Build APIs", {
      basics: { name: "Test User", label: "Engineer" },
    });

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).toContain("Maximum 35 words.");
    expect(prompt).toContain("Maximum 8 keywords per category");
    // "keep under 90 words" is stripped from constraints because summaryMaxWords (35) takes precedence
    expect(prompt).not.toContain("keep under 90 words");
  });

  it("passes structured job facts and notes into the prompt", async () => {
    await generateTailoring(
      "Build APIs",
      {
        basics: { name: "Test User", label: "Engineer" },
      },
      {
        title: "Senior Backend Engineer",
        employer: "Example Co",
        location: "Tunisia / Remote",
        degreeRequired: "BSc Computer Science",
        disciplines: "Software Engineering",
        jobBrief: "{\"role_summary\":\"Build APIs\"}",
        suitabilityReason: "Strong backend match",
        notes: ["<b>Referral</b>: talk to Sam", "On-site twice monthly"],
      },
    );

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).toContain("STRUCTURED JOB FACTS:");
    expect(prompt).toContain("Senior Backend Engineer");
    expect(prompt).toContain("Example Co");
    expect(prompt).toContain("Tunisia / Remote");
    expect(prompt).toContain("BSc Computer Science");
    expect(prompt).toContain("Software Engineering");
    expect(prompt).toContain("Build APIs");
    expect(prompt).toContain("Strong backend match");
    expect(prompt).toContain("Referral: talk to Sam");
    expect(prompt).not.toContain("<b>");
  });

  it("passes approved tailoring context into the prompt", async () => {
    await generateTailoring(
      "Build APIs",
      {
        basics: { name: "Test User", label: "Engineer" },
      },
      {
        approved: {
          summary: "Approved summary",
          headline: "Approved headline",
          skills: [
            {
              name: "Backend",
              keywords: ["Java", "Spring Boot"],
            },
          ],
        },
      },
    );

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).toContain("CURRENT APPROVED TAILORING CONTEXT:");
    expect(prompt).toContain("Approved summary");
    expect(prompt).toContain("Approved headline");
    expect(prompt).toContain("Spring Boot");
    expect(prompt).toContain("GROUNDING AND APPROVED CONTEXT:");
  });

  it("truncates long context values and caps the notes list", async () => {
    const longNote = `note ${"x".repeat(700)}`;
    await generateTailoring(
      "Build APIs",
      {
        basics: { name: "Test User", label: "Engineer" },
      },
      {
        jobBrief: "A".repeat(2100),
        suitabilityReason: "B".repeat(900),
        notes: Array.from({ length: 12 }, (_, index) => `${longNote}-${index}`),
      },
    );

    const prompt = callJsonMock.mock.calls.at(-1)?.[0]?.messages?.[0]?.content;
    expect(prompt).not.toContain("A".repeat(2001));
    expect(prompt).not.toContain("B".repeat(801));
    expect(prompt).not.toContain("x".repeat(601));
    expect(prompt).not.toContain("note xxxxx-11");
  });

  it("keeps the summary wrapper working with the new context argument", async () => {
    const result = await generateSummary("Build APIs", {
      basics: { name: "Test User", label: "Engineer" },
    });

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Tailored summary");
  });
});
