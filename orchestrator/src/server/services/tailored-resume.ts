import {
  badRequest,
  conflict,
  notFound,
  unprocessableEntity,
} from "@infra/errors";
import { logger } from "@infra/logger";
import { createId } from "@paralleldrive/cuid2";
import * as jobsRepo from "@server/repositories/jobs";
import * as tailoredResumesRepo from "@server/repositories/tailored-resumes";
import type {
  DesignResumeJson,
  TailoredResumeChange,
  TailoredResumeOrigin,
  TailoredResumeSnapshot,
  TailoringPlanResult,
} from "@shared/types";
import { checkTailoredClaims, getCareerEvidenceBank } from "./careerEvidence";
import { getCurrentDesignResumeOrNullOnLegacy } from "./design-resume";
import { getProfile } from "./profile";
import { prepareTailoredResumeForPdf } from "./rxresume";
import { safeParseV5ResumeData } from "./rxresume/schema/v5";

type RecordLike = Record<string, unknown>;

export interface ApproveSnapshotOptions {
  requestOrigin?: string | null;
  model?: string | null;
}

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function valueAt(record: RecordLike, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    const current = asRecord(value);
    return current ? current[key] : undefined;
  }, record);
}

/**
 * Local equivalent of the rxresume tailoring helper (which is not exported).
 * Malformed persisted tailored skills never block approval.
 */
function safeParseTailoredSkills(
  raw: string | null | undefined,
): Array<{ name: string; keywords: string[] }> | null {
  // Empty/malformed input must mean "no override" so the baseline skills survive.
  if (!raw?.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    if (
      parsed.every(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof (item as { name?: unknown }).name === "string" &&
          Array.isArray((item as { keywords?: unknown }).keywords),
      )
    ) {
      return parsed as Array<{ name: string; keywords: string[] }>;
    }
    const keywords = parsed.filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
    return keywords.length > 0 ? [{ name: "Core Skills", keywords }] : null;
  } catch {
    return null;
  }
}

function summaryField(
  record: RecordLike,
): { path: string; value: unknown } | null {
  const direct = valueAt(record, "summary.content");
  if (direct !== undefined) return { path: "summary.content", value: direct };
  const nested = valueAt(record, "sections.summary.content");
  if (nested !== undefined) {
    return { path: "sections.summary.content", value: nested };
  }
  return null;
}

export function buildResumeChangeLog(
  before: RecordLike,
  after: RecordLike,
): TailoredResumeChange[] {
  const changes: TailoredResumeChange[] = [];
  const pushIfChanged = (
    path: string,
    label: string,
    kind: TailoredResumeChange["kind"],
    beforeValue: unknown,
    afterValue: unknown,
  ) => {
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) return;
    changes.push({
      path,
      label,
      kind,
      before: beforeValue,
      after: afterValue,
    });
  };

  pushIfChanged(
    "basics.headline",
    "Headline",
    "changed",
    valueAt(before, "basics.headline"),
    valueAt(after, "basics.headline"),
  );

  const beforeSummary = summaryField(before);
  const afterSummary = summaryField(after);
  pushIfChanged(
    afterSummary?.path ?? beforeSummary?.path ?? "summary.content",
    "Summary",
    "changed",
    beforeSummary?.value,
    afterSummary?.value,
  );

  pushIfChanged(
    "sections.skills.items",
    "Tailored skills",
    "changed",
    valueAt(before, "sections.skills.items"),
    valueAt(after, "sections.skills.items"),
  );

  const afterProjects =
    asArray(valueAt(after, "sections.projects.items")) ?? [];
  for (const item of afterProjects) {
    const project = asRecord(item);
    const id = project?.id;
    if (typeof id !== "string" || !id) continue;
    const beforeItems =
      asArray(valueAt(before, "sections.projects.items")) ?? [];
    const beforeProject = beforeItems
      .map(asRecord)
      .find((candidate) => candidate?.id === id);
    pushIfChanged(
      `sections.projects.items.${id}.hidden`,
      `Project ${id}`,
      "visibility",
      beforeProject?.hidden,
      project?.hidden,
    );
  }

  return changes;
}

function resumeTextForClaimCheck(data: RecordLike): string {
  const parts: string[] = [];
  const headline = valueAt(data, "basics.headline");
  if (typeof headline === "string") parts.push(headline);

  const summary = summaryField(data);
  if (typeof summary?.value === "string") parts.push(summary.value);

  const skills = asArray(valueAt(data, "sections.skills.items")) ?? [];
  for (const item of skills) {
    const skill = asRecord(item);
    if (!skill) continue;
    if (typeof skill.name === "string") parts.push(skill.name);
    for (const keyword of asArray(skill.keywords) ?? []) {
      if (typeof keyword === "string") parts.push(keyword);
    }
  }
  return parts.join(" ");
}

async function requireJob(jobId: string) {
  const job = await jobsRepo.getJobById(jobId);
  if (!job) throw notFound("Job not found");
  return job;
}

async function writeVersion(args: {
  jobId: string;
  resumeJson: DesignResumeJson;
  changes: TailoredResumeChange[];
  ats: TailoringPlanResult["check"] | null;
  model: string | null;
  origin: TailoredResumeOrigin;
  baseResumeDocumentId: string | null;
  baseResumeRevision: number | null;
}): Promise<TailoredResumeSnapshot> {
  const existing = await tailoredResumesRepo.listForJob(args.jobId, 1000);
  const nextVersion = (existing[0]?.version ?? 0) + 1;
  const snapshot = await tailoredResumesRepo.insertVersion({
    id: createId(),
    jobId: args.jobId,
    version: nextVersion,
    resumeJson: args.resumeJson,
    changes: args.changes,
    ats: args.ats,
    model: args.model,
    origin: args.origin,
    baseResumeDocumentId: args.baseResumeDocumentId,
    baseResumeRevision: args.baseResumeRevision,
    generatedAt: Date.now(),
  });
  if (!snapshot) throw new Error("Failed to persist tailored resume snapshot");

  await tailoredResumesRepo.markSuperseded(existing.map((row) => row.id));
  await tailoredResumesRepo.pruneToLatest(args.jobId, 10);
  await jobsRepo.updateJob(args.jobId, {
    tailoredResumeSnapshotId: snapshot.id,
    tailoredResumeVersion: snapshot.version,
  });
  logger.info("Tailored resume snapshot written", {
    route: "service:tailored-resume",
    jobId: args.jobId,
    snapshotId: snapshot.id,
    version: snapshot.version,
    origin: args.origin,
  });
  return snapshot;
}

export async function approveSnapshot(
  jobId: string,
  options?: ApproveSnapshotOptions,
): Promise<TailoredResumeSnapshot> {
  const job = await requireJob(jobId);
  if (!job.jobDescription?.trim()) {
    throw badRequest("Add a job description before approving a tailored CV.");
  }
  const base = await getCurrentDesignResumeOrNullOnLegacy();
  if (!base) {
    throw conflict("No Resume Studio baseline is available. Create one first.");
  }

  const prepared = await prepareTailoredResumeForPdf({
    resumeData: base.resumeJson,
    tailoredContent: {
      summary: job.tailoredSummary,
      headline: job.tailoredHeadline,
      skills: safeParseTailoredSkills(job.tailoredSkills),
    },
    jobDescription: job.jobDescription,
    selectedProjectIds: job.selectedProjectIds,
    jobId,
    tracerLinks: {
      enabled: Boolean(job.tracerLinksEnabled),
      requestOrigin: options?.requestOrigin ?? null,
      companyName: job.employer,
    },
  });

  const parsed = safeParseV5ResumeData(prepared.data);
  if (!parsed.success) {
    throw unprocessableEntity("Prepared tailored CV is not a valid v5 resume.");
  }

  const [bank, profile] = await Promise.all([
    getCareerEvidenceBank(),
    getProfile(),
  ]);
  const ats = checkTailoredClaims({
    bank,
    profile,
    text: resumeTextForClaimCheck(prepared.data),
    jobDescription: job.jobDescription,
  });

  return writeVersion({
    jobId,
    resumeJson: parsed.data as DesignResumeJson,
    changes: buildResumeChangeLog(
      base.resumeJson as RecordLike,
      prepared.data as RecordLike,
    ),
    ats,
    model: options?.model ?? null,
    origin: "approved",
    baseResumeDocumentId: base.id,
    baseResumeRevision: base.revision,
  });
}

async function requireApprovedSnapshot(
  jobId: string,
  snapshotId: string,
): Promise<TailoredResumeSnapshot> {
  await requireJob(jobId);
  const current = await tailoredResumesRepo.getById(snapshotId);
  if (!current || current.jobId !== jobId || current.status !== "approved") {
    throw notFound("Tailored CV snapshot not found");
  }
  return current;
}

export async function saveSnapshotEdit(
  jobId: string,
  snapshotId: string,
  resumeJson: DesignResumeJson,
): Promise<TailoredResumeSnapshot> {
  const current = await requireApprovedSnapshot(jobId, snapshotId);
  const parsed = safeParseV5ResumeData(resumeJson);
  if (!parsed.success) {
    throw unprocessableEntity("Tailored CV must be a valid v5 resume.");
  }
  return writeVersion({
    jobId,
    resumeJson: parsed.data as DesignResumeJson,
    changes: buildResumeChangeLog(
      current.resumeJson as RecordLike,
      parsed.data as RecordLike,
    ),
    ats: current.ats,
    model: current.model,
    origin: "approved",
    baseResumeDocumentId: current.baseResumeDocumentId,
    baseResumeRevision: current.baseResumeRevision,
  });
}

export async function restoreSnapshot(
  jobId: string,
  snapshotId: string,
): Promise<TailoredResumeSnapshot> {
  const current = await requireApprovedSnapshot(jobId, snapshotId);
  return writeVersion({
    jobId,
    resumeJson: current.resumeJson,
    changes: [
      {
        path: "version",
        label: `Restored from version ${current.version}`,
        kind: "changed",
        before: current.version,
        after: current.version + 1,
      },
    ],
    ats: current.ats,
    model: current.model,
    origin: "restored",
    baseResumeDocumentId: current.baseResumeDocumentId,
    baseResumeRevision: current.baseResumeRevision,
  });
}
