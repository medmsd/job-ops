/**
 * Evidence-constrained tailored-fit scoring.
 *
 * The deterministic input builder and hash are shared by the stored-result
 * freshness check and the AI scoring path. Only the explicit compute action
 * (called from a POST route) may invoke the LLM; reading state never does.
 */

import { createHash } from "node:crypto";
import { badRequest, upstreamError } from "@infra/errors";
import { logger } from "@infra/logger";
import { getRequestId } from "@infra/request-context";
import { sanitizeUnknown } from "@infra/sanitize";
import * as jobsRepo from "@server/repositories/jobs";
import * as tailoredResumesRepo from "@server/repositories/tailored-resumes";
import type {
  DesignResumeJson,
  Job,
  ResumeProfile,
  TailoredFitNote,
  TailoredFitNoteStatus,
  TailoredFitResult,
  TailoredFitState,
  TailoredResumeSnapshot,
} from "@shared/types";
import type { CareerEvidenceBank } from "@shared/types/career-evidence";
import { z } from "zod";
import {
  buildEvidencePromptBlock,
  checkTailoredClaims,
  getCareerEvidenceBank,
  resolveEvidenceRefs,
} from "./careerEvidence";
import { withHostedUsageReservation } from "./hosted-usage";
import type { JsonSchemaDefinition } from "./llm/types";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";
import { getProfile } from "./profile";

const LIMITS = {
  text: 400,
  list: 60,
  jd: 12000,
  summary: 600,
  requirement: 200,
  explanation: 400,
  refs: 8,
  notes: 12,
  depth: 12,
} as const;

const BLOCKED_SCORE_CAP = 40;
const UNSUPPORTED_SCORE_CAP = 60;

const NOTE_STATUSES = [
  "covered",
  "partial",
  "gap",
  "unsupported",
] as const satisfies readonly TailoredFitNoteStatus[];

const FIT_SCHEMA: JsonSchemaDefinition = {
  name: "tailored_fit",
  schema: {
    type: "object",
    properties: {
      score: { type: "number", minimum: 0, maximum: 100 },
      summary: { type: "string" },
      notes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            requirement: { type: "string" },
            status: { type: "string", enum: NOTE_STATUSES },
            explanation: { type: "string" },
            evidenceRefs: { type: "array", items: { type: "string" } },
          },
          required: ["requirement", "status", "explanation", "evidenceRefs"],
          additionalProperties: false,
        },
      },
    },
    required: ["score", "summary", "notes"],
    additionalProperties: false,
  },
};

const fitResponseSchema = z
  .object({
    score: z.number().finite(),
    summary: z.string(),
    notes: z
      .array(
        z
          .object({
            requirement: z.string(),
            status: z.enum(NOTE_STATUSES),
            explanation: z.string(),
            evidenceRefs: z.array(z.string()),
          })
          .strict(),
      )
      .max(LIMITS.notes),
  })
  .strict();

const TEXT_SKIP_KEYS = new Set([
  "id",
  "url",
  "website",
  "image",
  "email",
  "phone",
  "hidden",
  "options",
  "styles",
  "css",
  "metadata",
  "fileName",
  "assetId",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function cleanText(
  value: string | null | undefined,
  limit: number = LIMITS.text,
): string {
  if (!value) return "";
  const cleaned = value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > limit
    ? `${cleaned.slice(0, limit - 1).trimEnd()}…`
    : cleaned;
}

/** Deep, capped copy so long or oversized input cannot dominate the hash/prompt. */
function capInputValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return cleanText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, LIMITS.list)
      .map((item) => capInputValue(item, depth + 1));
  }
  if (depth >= LIMITS.depth) return "[TRUNCATED]";
  const record = asRecord(value);
  if (!record) return null;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, capInputValue(record[key], depth + 1)]),
  );
}

function visibleItemIds(
  resumeJson: DesignResumeJson,
  sectionKey: string,
): Set<string> | null {
  const sections = asRecord(resumeJson.sections);
  const section = asRecord(sections?.[sectionKey]);
  if (!section || section.hidden === true) return new Set();
  if (!Array.isArray(section.items)) return null;

  const ids = new Set<string>();
  for (const raw of section.items) {
    const item = asRecord(raw);
    if (!item || item.hidden === true) continue;
    const id = cleanText(asString(item.id), LIMITS.requirement);
    if (id) ids.add(id);
  }
  return ids;
}

function isSectionVisible(
  profileSections: Record<string, unknown>,
  resumeJson: DesignResumeJson,
  sectionKey: string,
): boolean {
  const snapshotSections = asRecord(resumeJson.sections);
  const profileSection = asRecord(profileSections[sectionKey]);
  return (
    asRecord(snapshotSections?.[sectionKey])?.hidden !== true &&
    profileSection?.visible !== false
  );
}

function visibleProfileItems(
  profileSections: Record<string, unknown>,
  sectionKey: string,
  allowedIds: Set<string> | null,
  fields: readonly string[],
): Array<Record<string, unknown>> {
  const section = asRecord(profileSections[sectionKey]) ?? {};
  const rawItems = Array.isArray(section.items) ? section.items : [];
  const items: Array<Record<string, unknown>> = [];

  for (const raw of rawItems.slice(0, LIMITS.list)) {
    const item = asRecord(raw);
    if (!item) continue;
    const id = cleanText(asString(item.id), LIMITS.requirement);
    if (item.visible === false || (allowedIds && !allowedIds.has(id))) continue;

    const entry: Record<string, unknown> = { id };
    for (const field of fields) {
      if (field === "level") {
        entry.level = typeof item.level === "number" ? item.level : null;
      } else if (field === "keywords") {
        entry.keywords = asStringList(item.keywords)
          .map((keyword) => cleanText(keyword, 120))
          .filter(Boolean)
          .slice(0, LIMITS.list);
      } else {
        entry[field] = cleanText(asString(item[field]));
      }
    }
    items.push(entry);
  }
  return items;
}

/** Whitelisted profile facts, limited to what the approved resume actually shows. */
function buildVisibleProfileSubset(
  profile: ResumeProfile,
  resumeJson: DesignResumeJson,
): Record<string, unknown> {
  const basics = profile.basics ?? {};
  const profileSections = asRecord(profile.sections) ?? {};
  const sections: Record<string, unknown> = {};

  if (isSectionVisible(profileSections, resumeJson, "summary")) {
    const summary = asRecord(profileSections.summary) ?? {};
    sections.summary = {
      content: cleanText(asString(summary.content), LIMITS.summary),
    };
  }
  if (isSectionVisible(profileSections, resumeJson, "skills")) {
    sections.skills = {
      items: visibleProfileItems(
        profileSections,
        "skills",
        visibleItemIds(resumeJson, "skills"),
        ["name", "description", "level", "keywords"],
      ),
    };
  }
  if (isSectionVisible(profileSections, resumeJson, "projects")) {
    sections.projects = {
      items: visibleProfileItems(
        profileSections,
        "projects",
        visibleItemIds(resumeJson, "projects"),
        ["name", "description", "date", "summary", "keywords"],
      ),
    };
  }
  if (isSectionVisible(profileSections, resumeJson, "experience")) {
    sections.experience = {
      items: visibleProfileItems(
        profileSections,
        "experience",
        visibleItemIds(resumeJson, "experience"),
        ["company", "position", "location", "date", "summary"],
      ),
    };
  }

  return {
    basics: {
      name: cleanText(basics.name, 120),
      label: cleanText(basics.label, 120),
      headline: cleanText(basics.headline, 120),
      summary: cleanText(basics.summary, LIMITS.summary),
    },
    sections,
  };
}

export function buildTailoredFitInput(args: {
  job: Job;
  snapshot: TailoredResumeSnapshot;
  evidenceBank: CareerEvidenceBank;
  profile: ResumeProfile;
}): Record<string, unknown> {
  return {
    version: 1,
    resumeJson: capInputValue(args.snapshot.resumeJson),
    jobDescription: cleanText(args.job.jobDescription ?? "", LIMITS.jd),
    evidence: buildEvidencePromptBlock(args.evidenceBank, args.profile),
    profile: buildVisibleProfileSubset(args.profile, args.snapshot.resumeJson),
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function hashTailoredFitInput(input: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

function toStoredResult(job: Job): TailoredFitResult | null {
  if (!job.tailoredFitInputHash || job.tailoredFitScore == null) return null;
  return {
    score: job.tailoredFitScore,
    summary: job.tailoredFitSummary ?? "",
    notes: job.tailoredFitNotes ?? [],
    snapshotId: job.tailoredFitSnapshotId ?? "",
    snapshotVersion: job.tailoredFitSnapshotVersion ?? 0,
    inputHash: job.tailoredFitInputHash,
    computedAt: job.tailoredFitComputedAt ?? 0,
    model: job.tailoredFitModel ?? null,
  };
}

/** Read-only state check. This function never invokes an LLM. */
export async function getTailoredFitState(job: Job): Promise<TailoredFitState> {
  if (!job.jobDescription?.trim()) {
    return { result: null, isStale: false, reason: "no_description" };
  }

  const snapshot = await tailoredResumesRepo.getLatestApprovedForJob(job.id);
  if (!snapshot) {
    return { result: null, isStale: false, reason: "no_snapshot" };
  }

  const [evidenceBank, profile] = await Promise.all([
    getCareerEvidenceBank(),
    getProfile(),
  ]);

  const result = toStoredResult(job);
  if (!result) {
    return { result: null, isStale: false, reason: "not_checked" };
  }

  const currentHash = hashTailoredFitInput(
    buildTailoredFitInput({ job, snapshot, evidenceBank, profile }),
  );
  if (
    job.tailoredFitSnapshotId !== snapshot.id ||
    job.tailoredFitSnapshotVersion !== snapshot.version ||
    job.tailoredFitInputHash !== currentHash
  ) {
    return { result, isStale: true, reason: "inputs_changed" };
  }
  return { result, isStale: false, reason: null };
}

function collectResumeText(value: unknown, out: string[], depth = 0): void {
  if (out.length >= LIMITS.list || depth > LIMITS.depth) return;
  if (typeof value === "string") {
    const cleaned = cleanText(value);
    if (cleaned) out.push(cleaned);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, LIMITS.list)) {
      collectResumeText(item, out, depth + 1);
    }
    return;
  }
  const record = asRecord(value);
  if (!record || record.hidden === true) return;
  for (const [key, child] of Object.entries(record)) {
    if (TEXT_SKIP_KEYS.has(key)) continue;
    if (child === null || child === undefined) continue;
    if (typeof child === "number" || typeof child === "boolean") continue;
    collectResumeText(child, out, depth + 1);
  }
}

function resumeTextFromSnapshot(resumeJson: DesignResumeJson): string {
  const parts: string[] = [];
  collectResumeText(resumeJson, parts);
  return parts.join(" ");
}

function buildFitPrompt(args: {
  input: Record<string, unknown>;
  allowedRefs: string[];
}): string {
  return `You are scoring how well an APPROVED tailored resume fits one job description.
Return only a JSON object: { "score": number 0-100, "summary": string, "notes": array }.
Each note must have "requirement", "status", "explanation", and "evidenceRefs".
Use at most ${LIMITS.notes} notes. Valid statuses: ${NOTE_STATUSES.join(", ")}.
"evidenceRefs" may only contain refs from the allowed list; use [] when no evidence supports the requirement.

Rules:
- Use only approved facts present in the resume/evidence below. Do not invent skills, years, metrics, tools, or seniority.
- "covered" requires at least one valid evidenceRef; otherwise use "unsupported" or "gap".
- Terms in neverClaim must never be described as experience.
- The score is advisory; deterministic evidence checks can lower it.

APPROVED RESUME (JSON):
${JSON.stringify(args.input.resumeJson)}

JOB DESCRIPTION:
${cleanText(asString(args.input.jobDescription), LIMITS.jd)}

APPROVED EVIDENCE (JSON):
${JSON.stringify(args.input.evidence)}

VISIBLE PROFILE (JSON):
${JSON.stringify(args.input.profile)}

ALLOWED EVIDENCE REFS:
${JSON.stringify(args.allowedRefs)}
`.trim();
}

function scoreBand(score: number): "low" | "medium" | "high" {
  return score < 40 ? "low" : score < 70 ? "medium" : "high";
}

/** Explicit, user-triggered AI scoring. Call only from a POST route. */
export function computeTailoredFit(job: Job): Promise<Job> {
  return withHostedUsageReservation({ action: "tailoring" }, async () => ({
    result: await computeTailoredFitImpl(job),
    usedUnits: 1,
  }));
}

async function computeTailoredFitImpl(job: Job): Promise<Job> {
  if (!job.jobDescription?.trim()) {
    throw badRequest("Add a job description before checking tailored fit.");
  }

  // The repository applies the active tenant/user scope; a snapshot belonging
  // to another tenant is never returned to this call.
  const snapshot = await tailoredResumesRepo.getLatestApprovedForJob(job.id);
  if (!snapshot) {
    throw badRequest("Approve a tailored resume before checking tailored fit.");
  }

  const [evidenceBank, profile] = await Promise.all([
    getCareerEvidenceBank(),
    getProfile(),
  ]);
  const check = checkTailoredClaims({
    bank: evidenceBank,
    profile,
    text: resumeTextFromSnapshot(snapshot.resumeJson),
    jobDescription: job.jobDescription,
  });
  const input = buildTailoredFitInput({ job, snapshot, evidenceBank, profile });
  const { valid: validRefs } = resolveEvidenceRefs(evidenceBank, profile);

  const [model, llm] = await Promise.all([
    resolveLlmModel("tailoring"),
    createConfiguredLlmService("tailoring"),
  ]);
  const result = await llm.callJson<unknown>({
    model,
    messages: [
      {
        role: "user",
        content: buildFitPrompt({ input, allowedRefs: validRefs }),
      },
    ],
    jsonSchema: FIT_SCHEMA,
    maxRetries: 1,
    retryDelayMs: 300,
  });

  if (!result.success) {
    logger.warn("Tailored fit scoring failed", {
      requestId: getRequestId(),
      jobId: job.id,
      snapshotId: snapshot.id,
      provider: llm.getProvider(),
      error: sanitizeUnknown(result.error, { maxString: 200 }),
    });
    throw upstreamError("Tailored fit scoring failed");
  }

  const raw = asRecord(result.data) ?? {};
  const candidate = {
    ...raw,
    notes: Array.isArray(raw.notes) ? raw.notes.slice(0, LIMITS.notes) : [],
  };
  const parsed = fitResponseSchema.safeParse(candidate);
  if (!parsed.success) {
    logger.warn("Tailored fit response was invalid", {
      requestId: getRequestId(),
      jobId: job.id,
      snapshotId: snapshot.id,
      issueCount: parsed.error.issues.length,
    });
    throw upstreamError("Tailored fit response was invalid");
  }

  const allowedRefs = new Set(validRefs);
  const notes: TailoredFitNote[] = parsed.data.notes.map((note) => {
    const refs = Array.from(
      new Set(
        note.evidenceRefs
          .map((ref) => cleanText(ref, LIMITS.requirement))
          .filter((ref) => allowedRefs.has(ref))
          .slice(0, LIMITS.refs),
      ),
    );
    const status: TailoredFitNoteStatus =
      refs.length === 0 &&
      (note.status === "covered" || note.status === "partial")
        ? "unsupported"
        : note.status;
    return {
      requirement: cleanText(note.requirement, LIMITS.requirement),
      status,
      explanation: cleanText(note.explanation, LIMITS.explanation),
      evidenceRefs: refs,
    };
  });

  let score = Math.min(100, Math.max(0, Math.round(parsed.data.score)));
  if (check.blocked.length > 0) score = Math.min(score, BLOCKED_SCORE_CAP);
  if (check.unsupported.length > 0) {
    score = Math.min(score, UNSUPPORTED_SCORE_CAP);
  }

  const tailoredFit: TailoredFitResult = {
    score,
    summary: cleanText(parsed.data.summary, LIMITS.summary),
    notes,
    snapshotId: snapshot.id,
    snapshotVersion: snapshot.version,
    inputHash: hashTailoredFitInput(input),
    computedAt: Date.now(),
    model,
  };

  const updated = await jobsRepo.updateJob(job.id, {
    tailoredFitScore: tailoredFit.score,
    tailoredFitNotes: tailoredFit.notes,
    tailoredFitSummary: tailoredFit.summary,
    tailoredFitSnapshotId: tailoredFit.snapshotId,
    tailoredFitSnapshotVersion: tailoredFit.snapshotVersion,
    tailoredFitInputHash: tailoredFit.inputHash,
    tailoredFitComputedAt: tailoredFit.computedAt,
    tailoredFitModel: tailoredFit.model,
  });
  if (!updated) {
    throw new Error("Failed to persist tailored fit result");
  }

  logger.info("Tailored fit computed", {
    requestId: getRequestId(),
    jobId: job.id,
    snapshotId: snapshot.id,
    scoreBand: scoreBand(score),
    noteCount: notes.length,
    model,
  });
  return updated;
}
