/**
 * Explicit, user-triggered Tailoring Plan generation.
 *
 * Maps JD requirements to approved evidence and proposed wording. The result
 * is advisory only: the client must explicitly accept, edit, or reject each
 * item before any wording is applied to the CV. This module never runs on job
 * open, tailoring open, or email preview.
 */

import { logger } from "@infra/logger";
import type { ResumeProfile } from "@shared/types";
import type {
  CareerEvidenceBank,
  TailoringPlanItem,
  TailoringPlanResult,
} from "@shared/types/career-evidence";
import { stripHtmlTags } from "@shared/utils/string";
import {
  buildEvidencePromptBlock,
  checkTailoredClaims,
  resolveEvidenceRefs,
} from "./careerEvidence";
import type { JsonSchemaDefinition } from "./llm/types";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";

const MAX_ITEMS = 12;
const MAX_TEXT = 600;
const MAX_REFS = 8;

const PLAN_SCHEMA: JsonSchemaDefinition = {
  name: "tailoring_plan",
  schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            jdRequirement: { type: "string" },
            evidenceRefs: { type: "array", items: { type: "string" } },
            proposedWording: { type: "string" },
            targetField: {
              type: "string",
              enum: ["summary", "headline", "skills"],
            },
            supportLevel: {
              type: "string",
              enum: ["strong", "partial", "unsupported"],
            },
          },
          required: [
            "jdRequirement",
            "evidenceRefs",
            "proposedWording",
            "supportLevel",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
};

interface PlanDraftItem {
  jdRequirement?: string;
  evidenceRefs?: string[];
  proposedWording?: string;
  targetField?: string;
  supportLevel?: string;
}

function cleanText(value: string | null | undefined, limit: number): string {
  if (!value) return "";
  const cleaned = stripHtmlTags(value)
    .replace(/\s+/g, " ")
    .replace(/\s+([:,;.!?])/g, "$1")
    .trim();
  return cleaned.length > limit
    ? `${cleaned.slice(0, limit - 1).trimEnd()}…`
    : cleaned;
}

function buildPlanPrompt(args: {
  jobDescription: string;
  profile: ResumeProfile;
  evidenceBank: CareerEvidenceBank;
}): string {
  const evidence = buildEvidencePromptBlock(args.evidenceBank, args.profile);
  const allowedRefs = [
    ...(evidence.coreSkills as Array<{ evidenceRefs?: string[] }>).flatMap(
      (skill) => skill.evidenceRefs ?? [],
    ),
    ...(evidence.achievements as Array<{ evidenceRefs?: string[] }>).flatMap(
      (achievement) => achievement.evidenceRefs ?? [],
    ),
  ];

  return `You are preparing a resume tailoring plan for a single job application.
Return a JSON object with an "items" array of at most ${MAX_ITEMS} items.
Each item must contain:
- "jdRequirement": the requirement from the job description.
- "evidenceRefs": only refs from the allowed list below that support it.
- "proposedWording": suggested resume wording using ONLY approved facts.
- "targetField": one of "summary", "headline", or "skills" - where the wording belongs.
- "supportLevel": "strong", "partial", or "unsupported".

Rules:
- Do not invent skills, years, metrics, tools, responsibilities, or seniority.
- If no approved evidence supports a requirement, use evidenceRefs: [] and supportLevel "unsupported".
- Terms in the evidence bank's neverClaim list must never appear in proposedWording.
- Preserve exact job-title wording when referring to the role.
- Return only the JSON object.

JOB DESCRIPTION:
${cleanText(args.jobDescription, 12000)}

APPROVED CAREER EVIDENCE (JSON):
${JSON.stringify(evidence)}

ALLOWED EVIDENCE REFS:
${JSON.stringify(Array.from(new Set(allowedRefs)))}
`.trim();
}

export interface TailoringPlanResponse {
  success: boolean;
  data?: TailoringPlanResult;
  error?: string;
}

/** Generate an evidence-backed plan. Call only from an explicit user action. */
export async function generateTailoringPlan({
  jobDescription,
  profile,
  evidenceBank,
  currentText = "",
}: {
  jobDescription: string;
  profile: ResumeProfile;
  evidenceBank: CareerEvidenceBank;
  currentText?: string;
}): Promise<TailoringPlanResponse> {
  if (!jobDescription.trim()) {
    return {
      success: false,
      error: "Add a job description before checking evidence.",
    };
  }

  const [model, llm] = await Promise.all([
    resolveLlmModel("tailoring"),
    createConfiguredLlmService("tailoring"),
  ]);

  const result = await llm.callJson<{ items?: PlanDraftItem[] }>({
    model,
    messages: [
      {
        role: "user",
        content: buildPlanPrompt({ jobDescription, profile, evidenceBank }),
      },
    ],
    jsonSchema: PLAN_SCHEMA,
  });

  if (!result.success) {
    logger.warn("Tailoring plan generation failed", {
      provider: llm.getProvider(),
      error: result.error.slice(0, 300),
    });
    return { success: false, error: result.error };
  }

  const { valid } = resolveEvidenceRefs(evidenceBank, profile);
  const allowedRefs = new Set(valid);
  const items: TailoringPlanItem[] = (result.data.items ?? [])
    .slice(0, MAX_ITEMS)
    .flatMap((item): TailoringPlanItem[] => {
      const refs = (item.evidenceRefs ?? [])
        .map((ref) => cleanText(ref, 200))
        .filter((ref) => allowedRefs.has(ref))
        .slice(0, MAX_REFS);
      const proposedWording = cleanText(item.proposedWording, MAX_TEXT);

      // Deterministic safety net: never surface forbidden wording as a plan item.
      const wordingCheck = checkTailoredClaims({
        bank: evidenceBank,
        profile,
        text: proposedWording,
        jobDescription: "",
      });
      if (wordingCheck.blocked.length > 0) return [];

      const requestedSupport: TailoringPlanItem["supportLevel"] =
        item.supportLevel === "strong" || item.supportLevel === "partial"
          ? item.supportLevel
          : "unsupported";
      const supportLevel: TailoringPlanItem["supportLevel"] =
        refs.length === 0 ? "unsupported" : requestedSupport;
      const targetField: NonNullable<TailoringPlanItem["targetField"]> =
        item.targetField === "headline" || item.targetField === "skills"
          ? item.targetField
          : "summary";

      return [
        {
          jdRequirement: cleanText(item.jdRequirement, 400),
          evidenceRefs: refs,
          proposedWording,
          targetField,
          supportLevel,
          status: supportLevel === "unsupported" ? "needs-review" : "ready",
          userDecision: "pending",
        },
      ];
    })
    .filter((item) => item.jdRequirement && item.proposedWording);

  // The report covers the CURRENT CV text, so the PDF gate is based on what
  // will actually be rendered - not on advisory plan wording.
  const check = checkTailoredClaims({
    bank: evidenceBank,
    profile,
    text: currentText,
    jobDescription,
  });

  return { success: true, data: { items, check } };
}
