import type { ResumeProfile } from "@shared/types";
import type { CareerEvidenceBank } from "@shared/types/career-evidence";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callJsonMock } = vi.hoisted(() => ({ callJsonMock: vi.fn() }));

vi.mock("./modelSelection", () => ({
  resolveLlmModel: vi.fn().mockResolvedValue("test-model"),
  createConfiguredLlmService: vi.fn().mockResolvedValue({
    callJson: callJsonMock,
    getProvider: () => "test-provider",
  }),
}));

import { generateTailoringPlan } from "./tailoring-plan";

const profile: ResumeProfile = {
  basics: { label: "Senior Java Engineer" },
  sections: {
    projects: {
      items: [
        {
          id: "payments-platform",
          name: "Payments Platform",
          description: "Spring Boot microservices",
          date: "",
          summary: "",
          visible: true,
          keywords: ["Kafka"],
        },
      ],
    },
  },
};

const bank: CareerEvidenceBank = {
  targetRoles: ["Senior Java Engineer"],
  coreSkills: [
    {
      name: "Java",
      years: 8,
      level: "expert",
      evidence: ["project:payments-platform"],
      aliases: [],
    },
  ],
  achievements: [
    {
      id: "ev-latency",
      text: "Reduced p95 latency",
      metric: "77%",
      evidence: ["project:payments-platform"],
    },
  ],
  alwaysInclude: [],
  neverClaim: ["Kubernetes administrator"],
  preferredTerms: [],
  avoidTerms: [],
};

describe("generateTailoringPlan", () => {
  beforeEach(() => {
    callJsonMock.mockReset();
    callJsonMock.mockResolvedValue({
      success: true,
      data: { items: [] },
    });
  });

  it("does not call the LLM for an empty job description", async () => {
    const result = await generateTailoringPlan({
      jobDescription: "   ",
      profile,
      evidenceBank: bank,
    });

    expect(result.success).toBe(false);
    expect(callJsonMock).not.toHaveBeenCalled();
  });

  it("drops invalid refs, marks unsupported items, and defaults targetField", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            jdRequirement: "Java microservices",
            evidenceRefs: ["project:payments-platform", "project:deleted"],
            proposedWording: "Built Java microservices",
            supportLevel: "strong",
          },
          {
            jdRequirement: "GraphQL APIs",
            evidenceRefs: ["project:deleted"],
            proposedWording: "Designed GraphQL APIs",
            supportLevel: "strong",
          },
        ],
      },
    });

    const result = await generateTailoringPlan({
      jobDescription: "Java microservices and GraphQL APIs",
      profile,
      evidenceBank: bank,
    });

    expect(result.success).toBe(true);
    const items = result.data?.items ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      evidenceRefs: ["project:payments-platform"],
      supportLevel: "strong",
      status: "ready",
      targetField: "summary",
      userDecision: "pending",
    });
    expect(items[1]).toMatchObject({
      evidenceRefs: [],
      supportLevel: "unsupported",
      status: "needs-review",
    });
  });

  it("deterministically removes neverClaim wording even if the model returns it", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            jdRequirement: "Kubernetes operations",
            evidenceRefs: ["project:payments-platform"],
            proposedWording: "Kubernetes administrator for the platform",
            supportLevel: "strong",
          },
          {
            jdRequirement: "Java",
            evidenceRefs: ["project:payments-platform"],
            proposedWording: "Java services",
            supportLevel: "strong",
          },
        ],
      },
    });

    const result = await generateTailoringPlan({
      jobDescription: "Kubernetes and Java",
      profile,
      evidenceBank: bank,
    });

    expect(result.data?.items).toHaveLength(1);
    expect(result.data?.items[0].proposedWording).toBe("Java services");
  });

  it("checks the current CV text, not the advisory plan wording", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            jdRequirement: "Java",
            evidenceRefs: ["project:payments-platform"],
            proposedWording: "Java services",
            supportLevel: "strong",
          },
        ],
      },
    });

    const result = await generateTailoringPlan({
      jobDescription: "Java and GraphQL",
      profile,
      evidenceBank: bank,
      currentText: "GraphQL experience",
    });

    expect(result.data?.check.unsupported).toContain("graphql");
    expect(result.data?.check.unsupported).not.toContain("java");
  });

  it("caps the plan at 12 items", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        items: Array.from({ length: 20 }, (_, index) => ({
          jdRequirement: `Requirement ${index}`,
          evidenceRefs: ["project:payments-platform"],
          proposedWording: `Supported wording ${index}`,
          supportLevel: "partial",
        })),
      },
    });

    const result = await generateTailoringPlan({
      jobDescription: "Java engineer",
      profile,
      evidenceBank: bank,
    });

    expect(result.data?.items).toHaveLength(12);
  });
});
