import type { ResumeProfile } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSetting } = vi.hoisted(() => ({ getSetting: vi.fn() }));

vi.mock("@server/repositories/settings", () => ({ getSetting }));

import {
  buildEvidencePromptBlock,
  checkTailoredClaims,
  getCareerEvidenceBank,
  resolveEvidenceRefs,
} from "./careerEvidence";

const profile: ResumeProfile = {
  basics: { label: "Senior Java Engineer" },
  sections: {
    skills: {
      items: [
        {
          id: "skills-1",
          name: "Backend",
          description: "",
          level: 3,
          visible: true,
          keywords: ["Java", "Spring Boot", "PostgreSQL"],
        },
      ],
    },
    projects: {
      items: [
        {
          id: "payments-platform",
          name: "Payments Platform",
          description: "Spring Boot microservices",
          date: "",
          summary: "",
          visible: true,
          keywords: ["Spring Boot", "Kafka"],
        },
      ],
    },
    experience: {
      items: [
        {
          id: "senior-java-engineer",
          company: "Acme",
          position: "Senior Java Engineer",
          location: "",
          date: "",
          summary: "",
          visible: true,
        },
      ],
    },
  },
};

const bank = {
  targetRoles: ["Senior Java Backend Engineer"],
  coreSkills: [
    {
      name: "Java",
      years: 8,
      level: "expert",
      evidence: ["project:payments-platform"],
      aliases: ["JVM"],
    },
    {
      name: "Spring Boot",
      years: 7,
      level: "advanced",
      evidence: ["job:senior-java-engineer"],
      aliases: ["SpringBoot"],
    },
  ],
  achievements: [
    {
      id: "ev-latency",
      text: "Reduced API p95 latency from 800ms to 180ms",
      metric: "77% reduction",
      evidence: ["project:payments-platform"],
    },
  ],
  alwaysInclude: ["REST APIs"],
  neverClaim: ["Kubernetes administrator"],
  preferredTerms: ["OAuth2"],
  avoidTerms: ["ninja"],
};

describe("careerEvidence", () => {
  beforeEach(() => {
    getSetting.mockReset();
    getSetting.mockResolvedValue(null);
  });

  it("falls back to an empty bank when no override is stored", async () => {
    await expect(getCareerEvidenceBank()).resolves.toEqual({
      targetRoles: [],
      coreSkills: [],
      achievements: [],
      alwaysInclude: [],
      neverClaim: [],
      preferredTerms: [],
      avoidTerms: [],
    });
  });

  it("reads and validates a stored bank", async () => {
    getSetting.mockResolvedValue(JSON.stringify(bank));
    await expect(getCareerEvidenceBank()).resolves.toEqual(bank);
  });

  it("resolves evidence refs against Resume Studio facts", () => {
    expect(resolveEvidenceRefs(bank, profile)).toEqual({
      valid: ["project:payments-platform", "job:senior-java-engineer"],
      missing: [],
    });

    const withMissing = {
      ...bank,
      coreSkills: [
        { ...bank.coreSkills[0], evidence: ["project:deleted-project"] },
      ],
      achievements: [],
    };
    expect(resolveEvidenceRefs(withMissing, profile).missing).toEqual([
      "project:deleted-project",
    ]);
  });

  it("whitelists and caps the prompt block", () => {
    const block = buildEvidencePromptBlock(bank, profile) as Record<
      string,
      any
    >;
    expect(block.neverClaim).toEqual(["Kubernetes administrator"]);
    expect(block.coreSkills[0]).toMatchObject({
      name: "Java",
      years: 8,
      evidenceRefs: ["project:payments-platform"],
    });
    expect(JSON.stringify(block)).not.toContain("<script");
    expect(block.danglingEvidenceRefs).toEqual([]);
  });

  it("hard-blocks neverClaim terms", () => {
    const result = checkTailoredClaims({
      bank,
      profile,
      text: "Senior Java engineer and Kubernetes administrator with Spring Boot experience.",
      jobDescription: "We need a Java engineer with Kubernetes administrator skills.",
    });
    expect(result.blocked).toContain("Kubernetes administrator");
  });

  it("distinguishes covered from unsupported JD terms", () => {
    const result = checkTailoredClaims({
      bank,
      profile,
      text: "Java Spring Boot PostgreSQL REST APIs with Kafka OAuth2 and GraphQL.",
      jobDescription: "Java Spring Boot PostgreSQL Kafka OAuth2 GraphQL.",
    });
    expect(result.covered).toEqual(
      expect.arrayContaining(["java", "spring", "boot", "postgresql", "kafka", "oauth2"]),
    );
    expect(result.unsupported).toContain("graphql");
    expect(result.unsupported).not.toContain("java");
  });

  it("reports dangling refs without inventing support", () => {
    const withMissing = {
      ...bank,
      coreSkills: [
        { ...bank.coreSkills[0], evidence: ["project:deleted-project"] },
      ],
      achievements: [],
    };
    const result = checkTailoredClaims({
      bank: withMissing,
      profile,
      text: "Java and GraphQL",
      jobDescription: "GraphQL experience required",
    });
    expect(result.missingEvidenceRefs).toContain("project:deleted-project");
    expect(result.unsupported).toContain("graphql");
  });

  it("does not treat an empty bank as vacuous proof", () => {
    const emptyBank = {
      targetRoles: [],
      coreSkills: [],
      achievements: [],
      alwaysInclude: [],
      neverClaim: [],
      preferredTerms: [],
      avoidTerms: [],
    };
    const result = checkTailoredClaims({
      bank: emptyBank,
      profile: {},
      text: "GraphQL and Rust",
      jobDescription: "GraphQL and Rust",
    });
    expect(result.blocked).toEqual([]);
    expect(result.covered).toEqual([]);
    expect(result.unsupported).toEqual(
      expect.arrayContaining(["graphql", "rust"]),
    );
  });
});
