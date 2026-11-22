/**
 * Deterministic helpers for the Global Career Evidence Bank.
 *
 * These functions do not call an LLM. They sanitize bank data for prompts,
 * resolve evidence references against the current Resume Studio profile, and
 * check generated text for unsupported claims and forbidden terms.
 */

import * as settingsRepo from "@server/repositories/settings";
import { settingsRegistry } from "@shared/settings-registry";
import type { ResumeProfile } from "@shared/types";
import type {
  CareerEvidenceBank,
  ClaimCheckResult,
} from "@shared/types/career-evidence";

const LIMITS = {
  text: 400,
  list: 60,
  skills: 60,
  achievements: 60,
  jdTerms: 40,
  findings: 25,
} as const;

const STOP_WORDS = new Set([
  "about", "ability", "across", "after", "again", "against", "also", "among",
  "and", "any", "are", "been", "being", "better", "both", "but", "can",
  "career", "company", "could", "did", "does", "each", "etc", "experience",
  "for", "from", "good", "had", "has", "have", "help", "high", "how", "into",
  "job", "join", "just", "know", "knowledge", "level", "like", "looking",
  "make", "more", "most", "must", "need", "new", "not", "now", "of", "on",
  "only", "or", "other", "our", "out", "over", "part", "people", "preferred",
  "qualification", "qualifications", "required", "requirements", "role",
  "skills", "strong", "such", "support", "team", "than", "that", "the",
  "their", "them", "then", "there", "these", "they", "this", "through", "to",
  "under", "understanding", "use", "using", "very", "want", "was", "we",
  "well", "were", "what", "when", "where", "which", "while", "who", "will",
  "with", "work", "working", "would", "year", "years", "you", "your",
]);

const REF_PREFIXES = ["project:", "job:", "experience:", "bank:"] as const;

function cleanText(
  value: string | null | undefined,
  limit: number = LIMITS.text,
): string {
  if (!value) return "";
  const cleaned = value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit - 1).trimEnd()}…` : cleaned;
}

function limitList(
  values: readonly string[] | undefined,
  limit: number = LIMITS.list,
): string[] {
  return (values ?? [])
    .map((value) => cleanText(value))
    .filter(Boolean)
    .slice(0, limit);
}

/** Lowercase alphanumeric text, safe for token and phrase matching. */
function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitTokens(value: string): string[] {
  return value ? value.split(" ").filter(Boolean) : [];
}

function refId(ref: string): string {
  const trimmed = cleanText(ref, 200);
  for (const prefix of REF_PREFIXES) {
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return trimmed;
}

export async function getCareerEvidenceBank(): Promise<CareerEvidenceBank> {
  const raw = await settingsRepo.getSetting("careerEvidence");
  return (
    settingsRegistry.careerEvidence.parse(raw ?? undefined) ??
    settingsRegistry.careerEvidence.default()
  );
}

/** Resolve evidence refs against Resume Studio facts and bank achievements. */
export function resolveEvidenceRefs(
  bank: CareerEvidenceBank,
  profile: ResumeProfile,
): { valid: string[]; missing: string[] } {
  const known = new Set<string>();
  for (const project of profile.sections?.projects?.items ?? []) {
    known.add(project.id);
  }
  for (const experience of profile.sections?.experience?.items ?? []) {
    known.add(experience.id);
  }
  for (const achievement of bank.achievements) {
    known.add(achievement.id);
  }

  const refs = [
    ...bank.coreSkills.flatMap((skill) => skill.evidence ?? []),
    ...bank.achievements.flatMap((achievement) => achievement.evidence ?? []),
  ]
    .map((ref) => cleanText(ref, 200))
    .filter(Boolean);

  const valid: string[] = [];
  const missing: string[] = [];
  for (const ref of refs) {
    if (known.has(refId(ref))) {
      if (!valid.includes(ref)) valid.push(ref);
    } else if (!missing.includes(ref)) {
      missing.push(ref);
    }
  }

  return { valid, missing };
}

/** Whitelisted, length-capped bank representation for LLM prompts. */
export function buildEvidencePromptBlock(
  bank: CareerEvidenceBank,
  profile: ResumeProfile,
): Record<string, unknown> {
  const { missing } = resolveEvidenceRefs(bank, profile);

  return {
    targetRoles: limitList(bank.targetRoles, 20),
    coreSkills: (bank.coreSkills ?? []).slice(0, LIMITS.skills).map((skill) => ({
      name: cleanText(skill.name, 120),
      years: typeof skill.years === "number" ? skill.years : null,
      level: cleanText(skill.level, 120),
      aliases: limitList(skill.aliases, 20),
      evidenceRefs: limitList(skill.evidence, 20),
    })),
    achievements: (bank.achievements ?? [])
      .slice(0, LIMITS.achievements)
      .map((achievement) => ({
        id: cleanText(achievement.id, 120),
        text: cleanText(achievement.text),
        metric: cleanText(achievement.metric, 120),
        evidenceRefs: limitList(achievement.evidence, 20),
      })),
    alwaysInclude: limitList(bank.alwaysInclude),
    neverClaim: limitList(bank.neverClaim),
    preferredTerms: limitList(bank.preferredTerms),
    avoidTerms: limitList(bank.avoidTerms),
    danglingEvidenceRefs: missing.slice(0, LIMITS.list),
  };
}

function collectSupportedTerms(
  bank: CareerEvidenceBank,
  profile: ResumeProfile,
): { tokens: Set<string>; phrases: string[] } {
  const phrases: string[] = [];
  const add = (value: string | null | undefined) => {
    const normalized = normalizeText(value);
    if (normalized) phrases.push(normalized);
  };

  for (const skill of bank.coreSkills ?? []) {
    add(skill.name);
    add(skill.level);
    for (const alias of skill.aliases ?? []) add(alias);
  }
  for (const achievement of bank.achievements ?? []) {
    add(achievement.text);
    add(achievement.metric);
  }
  for (const term of [
    ...(bank.alwaysInclude ?? []),
    ...(bank.preferredTerms ?? []),
  ]) {
    add(term);
  }

  add(profile.basics?.label);
  for (const item of profile.sections?.skills?.items ?? []) {
    add(item.name);
    for (const keyword of item.keywords ?? []) add(keyword);
  }
  for (const item of profile.sections?.projects?.items ?? []) {
    add(item.name);
    for (const keyword of item.keywords ?? []) add(keyword);
  }
  for (const item of profile.sections?.experience?.items ?? []) {
    add(item.company);
    add(item.position);
  }

  const tokens = new Set<string>();
  for (const phrase of phrases) {
    for (const token of splitTokens(phrase)) tokens.add(token);
  }
  return { tokens, phrases: phrases.slice(0, 400) };
}

function containsTerm(
  term: string,
  haystackTokens: Set<string>,
  haystackPhrases: string,
): boolean {
  const normalized = normalizeText(term);
  if (!normalized) return false;
  const parts = splitTokens(normalized);
  if (parts.length === 1) return haystackTokens.has(parts[0]);
  return haystackPhrases.includes(` ${normalized} `);
}

function isSupported(
  term: string,
  supported: { tokens: Set<string>; phrases: string[] },
): boolean {
  const normalized = normalizeText(term);
  if (!normalized) return false;
  const parts = splitTokens(normalized);
  if (parts.length === 1) return supported.tokens.has(parts[0]);
  const joined = ` ${supported.phrases.join(" ")} `;
  return joined.includes(` ${normalized} `);
}

function extractJdTerms(jobDescription: string): string[] {
  const counts = new Map<string, number>();
  for (const token of splitTokens(normalizeText(jobDescription))) {
    if (token.length < 3 || STOP_WORDS.has(token) || /^\d+$/.test(token)) {
      continue;
    }
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, LIMITS.jdTerms)
    .map(([token]) => token);
}

export interface CheckTailoredClaimsInput {
  bank: CareerEvidenceBank;
  profile: ResumeProfile;
  text: string;
  jobDescription: string;
}

/**
 * Deterministic claim check for tailored content. `blocked` terms are hard
 * blockers; `unsupported` terms require explicit user acknowledgment.
 */
export function checkTailoredClaims({
  bank,
  profile,
  text,
  jobDescription,
}: CheckTailoredClaimsInput): ClaimCheckResult {
  const textTokens = new Set(splitTokens(normalizeText(text)));
  const textPhrases = ` ${normalizeText(text)} `;
  const supported = collectSupportedTerms(bank, profile);
  const { missing } = resolveEvidenceRefs(bank, profile);

  const blocked = limitList(bank.neverClaim).filter((term) =>
    containsTerm(term, textTokens, textPhrases),
  );

  const candidates = Array.from(
    new Set([
      ...extractJdTerms(jobDescription),
      ...limitList(bank.alwaysInclude),
    ]),
  );

  const covered: string[] = [];
  const unsupported: string[] = [];
  for (const term of candidates) {
    if (!containsTerm(term, textTokens, textPhrases)) continue;
    const target = isSupported(term, supported) ? covered : unsupported;
    if (target.length >= LIMITS.findings) continue;
    if (!target.includes(term)) target.push(term);
  }

  return {
    blocked: blocked.slice(0, LIMITS.findings).map((term) => cleanText(term, 120)),
    unsupported: unsupported.map((term) => cleanText(term, 120)),
    covered: covered.map((term) => cleanText(term, 120)),
    missingEvidenceRefs: missing.slice(0, LIMITS.findings).map((ref) => cleanText(ref, 120)),
  };
}
