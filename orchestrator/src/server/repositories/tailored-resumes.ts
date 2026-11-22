import type {
  DesignResumeJson,
  TailoredResumeChange,
  TailoredResumeOrigin,
  TailoredResumeSnapshot,
  TailoringPlanResult,
} from "@shared/types";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index";
import {
  getPrivateDataScope,
  privateDataScopeFilter,
} from "../tenancy/private-scope";

const { tailoredResumes } = schema;

type SnapshotRow = typeof tailoredResumes.$inferSelect;

function mapRow(row: SnapshotRow): TailoredResumeSnapshot {
  return {
    id: row.id,
    jobId: row.jobId,
    version: row.version,
    status: row.status,
    origin: row.origin,
    resumeJson: row.resumeJson as DesignResumeJson,
    changes: row.changes as TailoredResumeChange[],
    ats: row.ats as TailoringPlanResult["check"] | null,
    model: row.model,
    baseResumeDocumentId: row.baseResumeDocumentId,
    baseResumeRevision: row.baseResumeRevision,
    generatedAt: row.generatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getLatestApprovedForJob(
  jobId: string,
): Promise<TailoredResumeSnapshot | null> {
  const [row] = await db
    .select()
    .from(tailoredResumes)
    .where(
      and(
        privateDataScopeFilter(tailoredResumes),
        eq(tailoredResumes.jobId, jobId),
        eq(tailoredResumes.status, "approved"),
      ),
    )
    .orderBy(desc(tailoredResumes.version))
    .limit(1);
  return row ? mapRow(row) : null;
}

export async function getById(
  id: string,
): Promise<TailoredResumeSnapshot | null> {
  const [row] = await db
    .select()
    .from(tailoredResumes)
    .where(
      and(privateDataScopeFilter(tailoredResumes), eq(tailoredResumes.id, id)),
    )
    .limit(1);
  return row ? mapRow(row) : null;
}

export async function listForJob(
  jobId: string,
  limit = 10,
): Promise<TailoredResumeSnapshot[]> {
  const rows = await db
    .select()
    .from(tailoredResumes)
    .where(
      and(
        privateDataScopeFilter(tailoredResumes),
        eq(tailoredResumes.jobId, jobId),
      ),
    )
    .orderBy(desc(tailoredResumes.version))
    .limit(limit);
  return rows.map(mapRow);
}

export async function insertVersion(input: {
  id: string;
  jobId: string;
  version: number;
  resumeJson: DesignResumeJson;
  changes: TailoredResumeChange[];
  ats: TailoringPlanResult["check"] | null;
  model: string | null;
  origin: TailoredResumeOrigin;
  baseResumeDocumentId: string | null;
  baseResumeRevision: number | null;
  generatedAt: number;
}): Promise<TailoredResumeSnapshot | null> {
  const scope = getPrivateDataScope();
  const now = new Date().toISOString();
  await db.insert(tailoredResumes).values({
    ...input,
    tenantId: scope.tenantId,
    userId: scope.userId,
    status: "approved",
    createdAt: now,
    updatedAt: now,
  });
  return getById(input.id);
}

export async function markSuperseded(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(tailoredResumes)
    .set({ status: "superseded", updatedAt: new Date().toISOString() })
    .where(
      and(
        privateDataScopeFilter(tailoredResumes),
        inArray(tailoredResumes.id, ids),
      ),
    );
}

export async function pruneToLatest(jobId: string, keep = 10): Promise<void> {
  const rows = await listForJob(jobId, 1000);
  const staleIds = rows.slice(keep).map((row) => row.id);
  if (staleIds.length > 0) {
    await db
      .delete(tailoredResumes)
      .where(
        and(
          privateDataScopeFilter(tailoredResumes),
          inArray(tailoredResumes.id, staleIds),
        ),
      );
  }
}
