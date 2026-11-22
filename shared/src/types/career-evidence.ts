/**
 * Structured, reusable career facts used to ground AI-generated application
 * content. Stored as a tenant/user-scoped JSON value in the settings table.
 *
 * Evidence refs are stable IDs pointing at Resume Studio facts (project or
 * experience item ids) or `"bank:<achievement-id>"` for bank-owned
 * achievements. Missing refs produce warnings; they never block a save.
 */

export interface CareerEvidenceCoreSkill {
  name: string;
  years: number | null;
  level: string;
  evidence: string[];
  aliases: string[];
}

export interface CareerEvidenceAchievement {
  id: string;
  text: string;
  metric: string;
  evidence: string[];
}

export interface CareerEvidenceBank {
  targetRoles: string[];
  coreSkills: CareerEvidenceCoreSkill[];
  achievements: CareerEvidenceAchievement[];
  alwaysInclude: string[];
  neverClaim: string[];
  preferredTerms: string[];
  avoidTerms: string[];
}

export function createEmptyCareerEvidenceBank(): CareerEvidenceBank {
  return {
    targetRoles: [],
    coreSkills: [],
    achievements: [],
    alwaysInclude: [],
    neverClaim: [],
    preferredTerms: [],
    avoidTerms: [],
  };
}

/** Deterministic, non-AI result of checking text against the evidence bank. */
export interface ClaimCheckResult {
  /** Terms from `neverClaim` found in the text. These hard-block PDF generation. */
  blocked: string[];
  /** JD/alwaysInclude terms found in the text without supporting evidence. */
  unsupported: string[];
  /** JD terms found in the text that are supported by evidence. */
  covered: string[];
  /** Evidence ref IDs that no longer resolve to a Resume Studio fact. */
  missingEvidenceRefs: string[];
}

/** One explicit, user-reviewed mapping from a JD requirement to evidence. */
export interface TailoringPlanItem {
  jdRequirement: string;
  evidenceRefs: string[];
  proposedWording: string;
  /** Where Accept applies the proposed wording. Defaults to "summary". */
  targetField?: "summary" | "headline" | "skills";
  supportLevel: "strong" | "partial" | "unsupported";
  status: "ready" | "needs-review";
  userDecision: "pending" | "accepted" | "edited" | "rejected";
}

export interface TailoringPlanResult {
  items: TailoringPlanItem[];
  check: ClaimCheckResult;
}
