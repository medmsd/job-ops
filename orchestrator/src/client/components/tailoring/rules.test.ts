import { describe, expect, it } from "vitest";
import { canFinalizeTailoring, getTailoringReadiness } from "./rules";

describe("canFinalizeTailoring", () => {
  it("returns true when summary has non-whitespace content", () => {
    expect(canFinalizeTailoring("Summary")).toBe(true);
  });

  it("returns false when summary is empty", () => {
    expect(canFinalizeTailoring("   ")).toBe(false);
  });
});

describe("getTailoringReadiness", () => {
  const completeInput = {
    summary: "Tailored summary",
    headline: "Senior Engineer",
    skillsJson: JSON.stringify([{ name: "Backend", keywords: ["Java"] }]),
    jobDescription: "Build APIs",
    selectedProjectIds: "project-a",
    pdfFreshness: "current" as const,
    pdfRegenerating: false,
  };

  it("reports all checks ready for a complete application", () => {
    const readiness = getTailoringReadiness(completeInput);

    expect(readiness.isReady).toBe(true);
    expect(readiness.readyCount).toBe(readiness.totalCount);
    expect(readiness.canGeneratePdf).toBe(true);
    expect(readiness.missingLabels).toEqual([]);
  });

  it("lists every missing item", () => {
    const readiness = getTailoringReadiness({
      summary: "  ",
      headline: null,
      skillsJson: "[]",
      jobDescription: "",
      selectedProjectIds: "",
      pdfFreshness: "missing",
    });

    expect(readiness.isReady).toBe(false);
    expect(readiness.canGeneratePdf).toBe(false);
    expect(readiness.missingLabels).toEqual([
      "Job description",
      "Tailored summary",
      "Tailored headline",
      "Tailored skills",
      "Selected projects",
      "Resume PDF",
    ]);
  });

  it("allows PDF generation without job description, projects, or PDF", () => {
    const readiness = getTailoringReadiness({
      ...completeInput,
      jobDescription: null,
      selectedProjectIds: null,
      pdfFreshness: "missing",
    });

    expect(readiness.canGeneratePdf).toBe(true);
    expect(readiness.isReady).toBe(false);
  });

  it("treats loading project settings as pending rather than missing", () => {
    const readiness = getTailoringReadiness({
      ...completeInput,
      selectedProjectIds: null,
      projectsAreLoading: true,
    });

    expect(readiness.checks.find((check) => check.id === "projects")?.ready).toBe(
      true,
    );
    expect(readiness.isReady).toBe(true);
  });

  it("rejects a stale or regenerating PDF", () => {
    expect(
      getTailoringReadiness({
        ...completeInput,
        pdfFreshness: "stale",
      }).isReady,
    ).toBe(false);
    expect(
      getTailoringReadiness({
        ...completeInput,
        pdfRegenerating: true,
      }).isReady,
    ).toBe(false);
  });

  it("accepts an uploaded PDF as ready", () => {
    expect(
      getTailoringReadiness({
        ...completeInput,
        pdfFreshness: "uploaded",
      }).isReady,
    ).toBe(true);
  });

  it("rejects malformed skills JSON", () => {
    const readiness = getTailoringReadiness({
      ...completeInput,
      skillsJson: "{",
    });

    expect(readiness.canGeneratePdf).toBe(false);
    expect(readiness.missingLabels).toContain("Tailored skills");
  });
});
