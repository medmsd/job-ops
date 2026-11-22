import type { JobPdfFreshness } from "@shared/types.js";
import { parseTailoredSkills } from "../tailoring-utils";

export function canFinalizeTailoring(summary: string): boolean {
  return summary.trim().length > 0;
}

export type TailoringCheckId =
  | "jobDescription"
  | "summary"
  | "headline"
  | "skills"
  | "projects"
  | "pdf";

export interface TailoringReadinessInput {
  summary?: string | null;
  headline?: string | null;
  skillsJson?: string | null;
  jobDescription?: string | null;
  selectedProjectIds?: string | null;
  pdfFreshness?: JobPdfFreshness | null;
  pdfRegenerating?: boolean | null;
  projectsAreLoading?: boolean;
}

export interface TailoringCheck {
  id: TailoringCheckId;
  label: string;
  ready: boolean;
  detail?: string;
}

export interface TailoringReadiness {
  checks: TailoringCheck[];
  readyCount: number;
  totalCount: number;
  isReady: boolean;
  canGeneratePdf: boolean;
  missingLabels: string[];
}

const hasText = (value: string | null | undefined): boolean =>
  Boolean(value?.trim());

const hasSelectedProjects = (value: string | null | undefined): boolean =>
  Boolean(value?.split(",").some((id) => id.trim().length > 0));

const hasTailoredSkills = (value: string | null | undefined): boolean =>
  parseTailoredSkills(value).some(
    (group) =>
      group.name.trim().length > 0 && group.keywords.some((keyword) => keyword.trim().length > 0),
  );

export function getTailoringReadiness(
  input: TailoringReadinessInput,
): TailoringReadiness {
  const checks: TailoringCheck[] = [
    {
      id: "jobDescription",
      label: "Job description",
      ready: hasText(input.jobDescription),
      detail: hasText(input.jobDescription)
        ? undefined
        : "Add the job description before finalizing.",
    },
    {
      id: "summary",
      label: "Tailored summary",
      ready: hasText(input.summary),
      detail: hasText(input.summary)
        ? undefined
        : "Write or generate a summary.",
    },
    {
      id: "headline",
      label: "Tailored headline",
      ready: hasText(input.headline),
      detail: hasText(input.headline)
        ? undefined
        : "Write or generate a headline.",
    },
    {
      id: "skills",
      label: "Tailored skills",
      ready: hasTailoredSkills(input.skillsJson),
      detail: hasTailoredSkills(input.skillsJson)
        ? undefined
        : "Add at least one skill group with keywords.",
    },
    {
      id: "projects",
      label: "Selected projects",
      ready: input.projectsAreLoading === true || hasSelectedProjects(input.selectedProjectIds),
      detail:
        input.projectsAreLoading === true
          ? "Project settings are still loading."
          : hasSelectedProjects(input.selectedProjectIds)
            ? undefined
            : "No projects selected for this job.",
    },
    {
      id: "pdf",
      label: "Resume PDF",
      ready:
        !input.pdfRegenerating &&
        (input.pdfFreshness === "current" || input.pdfFreshness === "uploaded"),
      detail: input.pdfRegenerating
        ? "PDF regeneration is in progress."
        : input.pdfFreshness === "current" || input.pdfFreshness === "uploaded"
          ? undefined
          : "Generate a fresh PDF before finalizing.",
    },
  ];

  const byId = (id: TailoringCheckId) =>
    checks.find((check) => check.id === id) as TailoringCheck;

  return {
    checks,
    readyCount: checks.filter((check) => check.ready).length,
    totalCount: checks.length,
    isReady: checks.every((check) => check.ready),
    canGeneratePdf:
      byId("summary").ready && byId("headline").ready && byId("skills").ready,
    missingLabels: checks
      .filter((check) => !check.ready)
      .map((check) => check.label),
  };
}
