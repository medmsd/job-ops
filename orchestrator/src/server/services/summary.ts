/**
 * Service for generating tailored resume content (Summary, Headline, Skills).
 */

import { logger } from "@infra/logger";
import type { ResumeProfile } from "@shared/types";
import type { CareerEvidenceBank } from "@shared/types/career-evidence";
import { stripHtmlTags } from "@shared/utils/string";
import { buildEvidencePromptBlock, getCareerEvidenceBank } from "./careerEvidence";
import type { JsonSchemaDefinition } from "./llm/types";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";
import {
  getWritingLanguageLabel,
  resolveWritingOutputLanguage,
} from "./output-language";
import {
  getEffectivePromptTemplate,
  renderPromptTemplate,
} from "./prompt-templates";
import { filterProfileProjectsForAi } from "./resumeProjects";
import {
  getWritingStyle,
  stripKeywordLimitFromConstraints,
  stripLanguageDirectivesFromConstraints,
  stripWordLimitFromConstraints,
} from "./writing-style";

export interface TailoredData {
  summary: string;
  headline: string;
  skills: Array<{ name: string; keywords: string[] }>;
}

export interface TailoringApprovedContext {
  summary?: string | null;
  headline?: string | null;
  skills?: TailoredData["skills"] | null;
}

export interface TailoringJobContext {
  title?: string | null;
  employer?: string | null;
  location?: string | null;
  jobBrief?: string | null;
  suitabilityReason?: string | null;
  degreeRequired?: string | null;
  disciplines?: string | null;
  notes?: readonly string[] | null;
  approved?: TailoringApprovedContext | null;
}

export interface TailoringResult {
  success: boolean;
  data?: TailoredData;
  error?: string;
}

const TAILORING_CONTEXT_LIMITS = {
  jobBrief: 2000,
  suitabilityReason: 800,
  note: 600,
  notes: 10,
  approvedText: 1200,
} as const;

/** JSON schema for resume tailoring response */
const TAILORING_SCHEMA: JsonSchemaDefinition = {
  name: "resume_tailoring",
  schema: {
    type: "object",
    properties: {
      headline: {
        type: "string",
        description: "Job title headline matching the JD exactly",
      },
      summary: {
        type: "string",
        description: "Tailored resume summary paragraph",
      },
      skills: {
        type: "array",
        description: "Skills sections with keywords tailored to the job",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Skill category name (e.g., Frontend, Backend)",
            },
            keywords: {
              type: "array",
              items: { type: "string" },
              description: "List of skills/technologies in this category",
            },
          },
          required: ["name", "keywords"],
          additionalProperties: false,
        },
      },
    },
    required: ["headline", "summary", "skills"],
    additionalProperties: false,
  },
};

/**
 * Generate tailored resume content (summary, headline, skills) for a job.
 */
export async function generateTailoring(
  jobDescription: string,
  profile: ResumeProfile,
  context: TailoringJobContext = {},
): Promise<TailoringResult> {
  const [model, writingStyle, aiProfile, evidenceBank] = await Promise.all([
    resolveLlmModel("tailoring"),
    getWritingStyle(),
    filterProfileProjectsForAi(profile),
    getCareerEvidenceBank(),
  ]);
  const prompt = await buildTailoringPrompt(
    aiProfile,
    jobDescription,
    writingStyle,
    context,
    evidenceBank,
  );

  const llm = await createConfiguredLlmService("tailoring");
  const result = await llm.callJson<TailoredData>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: TAILORING_SCHEMA,
  });

  if (!result.success) {
    const context = `provider=${llm.getProvider()} baseUrl=${llm.getBaseUrl()}`;
    if (result.error.toLowerCase().includes("api key")) {
      const message = `LLM API key not set, cannot generate tailoring. (${context})`;
      logger.warn(message);
      return { success: false, error: message };
    }
    return {
      success: false,
      error: `${result.error} (${context})`,
    };
  }

  const { summary, headline, skills } = result.data;

  // Basic validation
  if (!summary || !headline || !Array.isArray(skills)) {
    logger.warn("AI response missing required tailoring fields", {
      hasSummary: Boolean(summary),
      hasHeadline: Boolean(headline),
      skillsIsArray: Array.isArray(skills),
    });
  }

  return {
    success: true,
    data: {
      summary: sanitizeText(summary || ""),
      headline: sanitizeText(headline || ""),
      skills: skills || [],
    },
  };
}

/**
 * Backwards compatibility wrapper if needed, or alias.
 */
export async function generateSummary(
  jobDescription: string,
  profile: ResumeProfile,
  context: TailoringJobContext = {},
): Promise<{ success: boolean; summary?: string; error?: string }> {
  // If we just need summary, we can discard the rest (or cache it? but here we just return summary)
  const result = await generateTailoring(jobDescription, profile, context);
  return {
    success: result.success,
    summary: result.data?.summary,
    error: result.error,
  };
}

async function buildTailoringPrompt(
  profile: ResumeProfile,
  jd: string,
  writingStyle: Awaited<ReturnType<typeof getWritingStyle>>,
  context: TailoringJobContext,
  evidenceBank: CareerEvidenceBank,
): Promise<string> {
  const jobDescription = stripHtmlTags(jd);
  const resolvedLanguage = resolveWritingOutputLanguage({
    style: writingStyle,
    profile,
    jobDescription,
  });
  const outputLanguage = getWritingLanguageLabel(resolvedLanguage.language);
  let effectiveConstraints = stripLanguageDirectivesFromConstraints(
    writingStyle.constraints,
  );
  if (writingStyle.summaryMaxWords != null) {
    effectiveConstraints = stripWordLimitFromConstraints(effectiveConstraints);
  }
  if (writingStyle.maxKeywordsPerSkill != null) {
    effectiveConstraints =
      stripKeywordLimitFromConstraints(effectiveConstraints);
  }

  // Extract only needed parts of profile to save tokens
  const relevantProfile = {
    basics: {
      name: profile.basics?.name,
      label: profile.basics?.label, // Original headline
      summary: profile.basics?.summary,
    },
    skills: profile.sections?.skills,
    projects: profile.sections?.projects?.items?.map((p) => ({
      name: p.name,
      description: p.description,
      keywords: p.keywords,
    })),
    experience: profile.sections?.experience?.items?.map((e) => ({
      company: e.company,
      position: e.position,
      summary: e.summary,
    })),
  };

  const template = await getEffectivePromptTemplate("tailoringPromptTemplate");

  return renderPromptTemplate(template, {
    jobDescription,
    profileJson: JSON.stringify(relevantProfile),
    structuredJobContextJson: JSON.stringify(buildStructuredJobContext(context)),
    approvedContextJson: JSON.stringify(buildApprovedContext(context.approved)),
    evidenceBankJson: JSON.stringify(
      buildEvidencePromptBlock(evidenceBank, profile),
    ),
    evidenceRulesBullet:
      "Terms listed in the evidence bank's neverClaim list must never appear in the output.",
    outputLanguage,
    tone: writingStyle.tone,
    formality: writingStyle.formality,
    summaryMaxWordsLine:
      writingStyle.summaryMaxWords != null
        ? ` Maximum ${writingStyle.summaryMaxWords} ${writingStyle.summaryMaxWords === 1 ? "word" : "words"}.`
        : "",
    maxKeywordsPerSkillLine:
      writingStyle.maxKeywordsPerSkill != null
        ? `\n   - Maximum ${writingStyle.maxKeywordsPerSkill} ${writingStyle.maxKeywordsPerSkill === 1 ? "keyword" : "keywords"} per category. If a category has more, keep only the most JD-relevant ones.`
        : "",
    constraintsBullet: effectiveConstraints
      ? `- Additional constraints: ${effectiveConstraints}`
      : "",
    avoidTermsBullet: writingStyle.doNotUse
      ? `- Avoid these words or phrases: ${writingStyle.doNotUse}`
      : "",
  });
}

function cleanContextText(
  value: string | null | undefined,
  maxLength: number,
): string | undefined {
  if (!value) return undefined;
  const cleaned = stripHtmlTags(value)
    .replace(/\s+/g, " ")
    .replace(/\s+([:,;.!?])/g, "$1")
    .trim();
  if (!cleaned) return undefined;
  return cleaned.length > maxLength
    ? `${cleaned.slice(0, maxLength - 1).trimEnd()}…`
    : cleaned;
}

function buildStructuredJobContext(context: TailoringJobContext) {
  const notes = (context.notes ?? [])
    .map((note) => cleanContextText(note, TAILORING_CONTEXT_LIMITS.note))
    .filter((note): note is string => Boolean(note))
    .slice(0, TAILORING_CONTEXT_LIMITS.notes);

  return {
    title: cleanContextText(context.title, 300),
    employer: cleanContextText(context.employer, 300),
    location: cleanContextText(context.location, 300),
    jobBrief: cleanContextText(
      context.jobBrief,
      TAILORING_CONTEXT_LIMITS.jobBrief,
    ),
    suitabilityReason: cleanContextText(
      context.suitabilityReason,
      TAILORING_CONTEXT_LIMITS.suitabilityReason,
    ),
    degreeRequired: cleanContextText(context.degreeRequired, 300),
    disciplines: cleanContextText(context.disciplines, 300),
    notes: notes.length > 0 ? notes : undefined,
  };
}

function buildApprovedContext(approved: TailoringApprovedContext | null | undefined) {
  if (!approved) return {};
  const skills = (approved.skills ?? [])
    .map((group) => ({
      name: cleanContextText(group.name, 200) ?? "",
      keywords: (group.keywords ?? [])
        .map((keyword) => cleanContextText(keyword, 200))
        .filter((keyword): keyword is string => Boolean(keyword)),
    }))
    .filter((group) => group.name.length > 0 && group.keywords.length > 0);

  return {
    summary: cleanContextText(
      approved.summary,
      TAILORING_CONTEXT_LIMITS.approvedText,
    ),
    headline: cleanContextText(
      approved.headline,
      TAILORING_CONTEXT_LIMITS.approvedText,
    ),
    skills: skills.length > 0 ? skills : undefined,
  };
}

function sanitizeText(text: string): string {
  return text
    .replace(/\*\*[\s\S]*?\*\*/g, "") // remove markdown bold
    .trim();
}
