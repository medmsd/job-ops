# Tailoring Phase 3 — Editable Tailored CV Implementation Plan

Date: 2026-11-22
Status: Ready to implement
Design: `docs/plans/2026-11-22-tailoring-phase3-design.md`
Parent plan: `docs/plans/2026-11-22-tailoring-v2-plan.md`

## Goal

Give every job with a job description a durable, tenant-scoped, versioned tailored CV snapshot; render PDFs from the approved snapshot; and expose a focused per-job editor with change history and restore-as-new-version. Source suitability scoring stays candidate-independent and unchanged.

## Global Constraints

- Push only to `fork` (`https://github.com/medmsd/job-ops.git`). Never push to `origin`.
- All `/api/*` responses use `{ ok, data, meta?: { requestId } }` or `{ ok: false, error: { code, message, details? }, meta: { requestId } }`; status/code mapping follows `AGENTS.md`.
- Honor inbound `x-request-id`; always return the `x-request-id` header; include request ID in structured logs.
- Treat every server-side change as multi-tenant: scope by `privateDataScopeFilter()` / tenant-scoped job lookup; add cross-tenant regression coverage.
- Use `@infra/logger` in core server paths; never direct `console.*`.
- No AI on job open, tailoring open, email preview, snapshot open, or restore. AI runs only on explicit Generate / Regenerate / Rescore / Check evidence / Approve actions.
- Sanitize/redact error details; never log raw resume JSON, upstream bodies, or large `JSON.stringify` blobs.
- User-visible changes require updates in `docs-site/docs/features/orchestrator.md`.
- PDF fingerprint bumps from `v1` to `v2`; all existing generated PDFs become stale on release.
- Keep Rescore as an obvious sidebar button; no changes to email apply flow or bearer-token storage.

## File Structure

- `shared/src/types/tailored-resumes.ts` — new shared snapshot/change types.
- `shared/src/types/jobs.ts`, `shared/src/testing/factories.ts` — two new nullable Job fields for approved snapshot id/version.
- `orchestrator/src/server/db/schema.ts`, `orchestrator/src/server/db/migrate.ts` — `tailored_resumes` table + job columns.
- `orchestrator/src/server/repositories/tailored-resumes.ts` — scoped append-only version storage.
- `orchestrator/src/server/services/tailored-resume.ts` — approve/edit/restore orchestration and change log.
- `orchestrator/src/server/api/routes/jobs/documents.ts` — snapshot routes (inline, like the Phase 2 plan route).
- `orchestrator/src/server/services/pdf-fingerprint.ts` — `v2` fingerprint with snapshot fields.
- `orchestrator/src/server/services/pdf.ts`, `pipeline/orchestrator.ts`, `services/demo-pdf.ts` — render from approved JSON.
- `orchestrator/src/client/api/jobs.ts` — snapshot API client functions.
- `orchestrator/src/client/components/tailoring/TailoredCvEditor.tsx` — focused per-job editor + history + diff.
- `orchestrator/src/client/components/tailoring/TailoringWorkspace.tsx` — Approve/Open editor actions and PDF gating.

---

## Task 1 — Shared types, schema, migration, and fingerprint `v2`

**Files:**

- `shared/src/types/tailored-resumes.ts` (new)
- `shared/src/types/index.ts`
- `shared/src/types/jobs.ts`
- `shared/src/testing/factories.ts`
- `orchestrator/src/server/db/schema.ts`
- `orchestrator/src/server/db/migrate.ts`
- `orchestrator/src/server/services/pdf-fingerprint.ts`
- `orchestrator/src/server/services/pdf-fingerprint.test.ts`

### Changes

1. Create `shared/src/types/tailored-resumes.ts` with the public contract:

```ts
import type { DesignResumeJson } from "./design-resume";
import type { TailoringPlanResult } from "./career-evidence";

export type TailoredResumeStatus = "approved" | "superseded";
export type TailoredResumeOrigin = "approved" | "restored";

export interface TailoredResumeChange {
  path: string;
  label: string;
  kind: "added" | "changed" | "removed" | "visibility";
  before: unknown;
  after: unknown;
}

export interface TailoredResumeSnapshot {
  id: string;
  jobId: string;
  version: number;
  status: TailoredResumeStatus;
  origin: TailoredResumeOrigin;
  resumeJson: DesignResumeJson;
  changes: TailoredResumeChange[];
  ats: TailoringPlanResult["check"] | null;
  model: string | null;
  baseResumeDocumentId: string | null;
  baseResumeRevision: number | null;
  generatedAt: number;
  createdAt: string;
  updatedAt: string;
}
```

2. Add `export * from "./tailored-resumes";` to `shared/src/types/index.ts` after `./settings`.

3. In `shared/src/types/jobs.ts`, add to `Job` beside `tailoredSkills`:

```ts
  tailoredResumeSnapshotId: string | null;
  tailoredResumeVersion: number | null;
```

4. In `shared/src/testing/factories.ts`, add the two defaults to `createJob()`:

```ts
  tailoredResumeSnapshotId: null,
  tailoredResumeVersion: null,
```

5. In `orchestrator/src/server/db/schema.ts`, import `TailoredResumeChange` and `TailoringPlanResult` from `@shared/types`, add the two nullable columns to `jobs`, and add this table after `designResumeAssets`:

```ts
export const tailoredResumes = sqliteTable(
  "tailored_resumes",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .default("tenant_default")
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status", { enum: ["approved", "superseded"] })
      .notNull()
      .default("approved"),
    origin: text("origin", { enum: ["approved", "restored"] })
      .notNull()
      .default("approved"),
    resumeJson: text("resume_json", { mode: "json" }).notNull(),
    changes: text("changes", { mode: "json" })
      .notNull()
      .default(sql`'[]'`),
    ats: text("ats", { mode: "json" }),
    model: text("model"),
    baseResumeDocumentId: text("base_resume_document_id"),
    baseResumeRevision: integer("base_resume_revision"),
    generatedAt: integer("generated_at", { mode: "number" }).notNull(),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    tenantUserJobVersionUnique: uniqueIndex(
      "idx_tailored_resumes_tenant_user_job_version_unique",
    ).on(table.tenantId, sql`coalesce(${table.userId}, '')`, table.jobId, table.version),
    tenantJobStatusIndex: index("idx_tailored_resumes_tenant_job_status").on(
      table.tenantId,
      table.userId,
      table.jobId,
      table.status,
      table.updatedAt,
    ),
  }),
);
```

Cast JSON columns on read in the repository (`as TailoredResumeSnapshot["changes"]` and `as DesignResumeJson`) so the service returns the shared types exactly.

6. In `orchestrator/src/server/db/migrate.ts`:
   - add `tailored_resume_snapshot_id TEXT` and `tailored_resume_version INTEGER` to the `CREATE TABLE IF NOT EXISTS jobs (...)` statement after `tailored_skills`;
   - append `ALTER TABLE jobs ADD COLUMN tailored_resume_snapshot_id TEXT` and `ALTER TABLE jobs ADD COLUMN tailored_resume_version INTEGER` to the `migrations` array (the existing loop already tolerates duplicate-column errors for `alter table jobs add column`);
   - insert these statements immediately after the `idx_job_documents_tenant_job_id` index:

```sql
CREATE TABLE IF NOT EXISTS tailored_resumes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_default',
  user_id TEXT,
  job_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','superseded')),
  origin TEXT NOT NULL DEFAULT 'approved' CHECK(origin IN ('approved','restored')),
  resume_json TEXT NOT NULL,
  changes TEXT NOT NULL DEFAULT '[]',
  ats TEXT,
  model TEXT,
  base_resume_document_id TEXT,
  base_resume_revision INTEGER,
  generated_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
)`,
CREATE UNIQUE INDEX IF NOT EXISTS idx_tailored_resumes_tenant_user_job_version_unique
  ON tailored_resumes(tenant_id, coalesce(user_id, ''), job_id, version)`,
CREATE INDEX IF NOT EXISTS idx_tailored_resumes_tenant_job_status
  ON tailored_resumes(tenant_id, user_id, job_id, status, updated_at)`,
```

7. In `orchestrator/src/server/services/pdf-fingerprint.ts`:
   - change `PDF_FINGERPRINT_VERSION` to `"v2"`;
   - extend the `Job` Pick with `"tailoredResumeSnapshotId" | "tailoredResumeVersion"`;
   - add to the `job` payload object in `createJobPdfFingerprint()`:

```ts
      tailoredResumeSnapshotId: job.tailoredResumeSnapshotId ?? null,
      tailoredResumeVersion: job.tailoredResumeVersion ?? null,
```

8. Update `orchestrator/src/server/services/pdf-fingerprint.test.ts`:
   - set `context.version` to `"v2"`;
   - add a test proving two otherwise identical jobs with different `tailoredResumeSnapshotId` / `tailoredResumeVersion` produce different fingerprints, and that omitting them produces the same fingerprint as `null`.

### Verification

Run: `npm --workspace orchestrator exec vitest run src/server/services/pdf-fingerprint.test.ts`
Expected: PASS. Then `npm run check:types:shared` and `npm --workspace orchestrator run check:types`.

Commit: `feat(tailoring): add tailored resume snapshot schema and v2 fingerprint`.

---

## Task 2 — Tenant-scoped snapshot repository and versioning service

**Files:**

- `orchestrator/src/server/repositories/tailored-resumes.ts` (new)
- `orchestrator/src/server/repositories/tailored-resumes.test.ts` (new)
- `orchestrator/src/server/services/tailored-resume.ts` (new)
- `orchestrator/src/server/services/tailored-resume.test.ts` (new)

### Changes

1. Create `repositories/tailored-resumes.ts` following `design-resume.ts`:

```ts
import type {
  DesignResumeJson,
  TailoredResumeChange,
  TailoredResumeOrigin,
  TailoredResumeSnapshot,
  TailoringPlanResult,
} from "@shared/types";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index";
import { getPrivateDataScope, privateDataScopeFilter } from "../tenancy/private-scope";

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

export async function getLatestApprovedForJob(jobId: string) {
  const [row] = await db
    .select()
    .from(tailoredResumes)
    .where(and(privateDataScopeFilter(tailoredResumes), eq(tailoredResumes.jobId, jobId), eq(tailoredResumes.status, "approved")))
    .orderBy(desc(tailoredResumes.version))
    .limit(1);
  return row ? mapRow(row) : null;
}

export async function getById(id: string) {
  const [row] = await db
    .select()
    .from(tailoredResumes)
    .where(and(privateDataScopeFilter(tailoredResumes), eq(tailoredResumes.id, id)))
    .limit(1);
  return row ? mapRow(row) : null;
}

export async function listForJob(jobId: string, limit = 10) {
  const rows = await db
    .select()
    .from(tailoredResumes)
    .where(and(privateDataScopeFilter(tailoredResumes), eq(tailoredResumes.jobId, jobId)))
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
}) {
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

export async function markSuperseded(ids: string[]) {
  if (ids.length === 0) return;
  await db.update(tailoredResumes)
    .set({ status: "superseded", updatedAt: new Date().toISOString() })
    .where(and(privateDataScopeFilter(tailoredResumes), inArray(tailoredResumes.id, ids)));
}

export async function pruneToLatest(jobId: string, keep = 10) {
  const rows = await listForJob(jobId, 1000);
  const staleIds = rows.slice(keep).map((row) => row.id);
  if (staleIds.length > 0) {
    await db.delete(tailoredResumes)
      .where(and(privateDataScopeFilter(tailoredResumes), inArray(tailoredResumes.id, staleIds)));
  }
}
```

Every function must go through `privateDataScopeFilter(tailoredResumes)`. Do not add an "any tenant" lookup.

2. Write `repositories/tailored-resumes.test.ts` with `vi.resetModules()`, temp `DATA_DIR`, `await import("../db/migrate")` as in `jobs.create.test.ts`, and `runWithRequestContext({ requestId: "test", tenantId: "tenant-a", userId: "user-a" }, ...)` around writes/reads. Assert:
   - versions are returned descending;
   - `pruneToLatest("job-1", 2)` deletes older rows but keeps the current one;
   - a second tenant/user context cannot read or delete the first tenant's rows;
   - `insertVersion` respects the unique `(tenant, user, job, version)` index (second insert with same version rejects).

3. Create `services/tailored-resume.ts` with these imports and exports:

```ts
import { badRequest, conflict, notFound, unprocessableEntity } from "@infra/errors";
import { logger } from "@infra/logger";
import { createId } from "@paralleldrive/cuid2";
import type {
  DesignResumeJson,
  TailoredResumeChange,
  TailoredResumeOrigin,
  TailoredResumeSnapshot,
  TailoringPlanResult,
} from "@shared/types";
import * as jobsRepo from "@server/repositories/jobs";
import * as tailoredResumesRepo from "@server/repositories/tailored-resumes";
import { checkTailoredClaims, getCareerEvidenceBank } from "./careerEvidence";
import { getCurrentDesignResumeOrNullOnLegacy } from "./design-resume";
import { getProfile } from "./profile";
import { prepareTailoredResumeForPdf } from "./rxresume";
import { safeParseV5ResumeData } from "./rxresume/schema/v5";
import { parseTailoredSkills } from "./rxresume/tailoring";
```

```ts
export interface ApproveSnapshotOptions {
  requestOrigin?: string | null;
  model?: string | null;
}

export async function approveSnapshot(jobId: string, options?: ApproveSnapshotOptions): Promise<TailoredResumeSnapshot>;
export async function saveSnapshotEdit(jobId: string, snapshotId: string, resumeJson: DesignResumeJson): Promise<TailoredResumeSnapshot>;
export async function restoreSnapshot(jobId: string, snapshotId: string): Promise<TailoredResumeSnapshot>;
export function buildResumeChangeLog(before: Record<string, unknown>, after: Record<string, unknown>): TailoredResumeChange[];
```

4. Implement the shared write helper inside the service:

```ts
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
```

5. Implement `approveSnapshot`:
   - `const job = await jobsRepo.getJobById(jobId); if (!job) throw notFound("Job not found");`
   - `if (!job.jobDescription?.trim()) throw badRequest("Add a job description before approving a tailored CV.");`
   - `const base = await getCurrentDesignResumeOrNullOnLegacy(); if (!base) throw conflict("No Resume Studio baseline is available. Create one first.");`
   - parse `job.tailoredSkills` with `parseTailoredSkills()` from `@server/services/rxresume/tailoring` (never throw on malformed JSON — fall back to `[]`);
   - call `prepareTailoredResumeForPdf({ resumeData: base.resumeJson, tailoredContent: { summary: job.tailoredSummary, headline: job.tailoredHeadline, skills }, jobDescription: job.jobDescription, selectedProjectIds: job.selectedProjectIds, jobId, tracerLinks: { enabled: Boolean(job.tracerLinksEnabled), requestOrigin: options?.requestOrigin ?? null, companyName: job.employer } })`;
   - validate the result with `safeParseV5ResumeData(prepared.data)`; on failure throw `unprocessableEntity("Prepared tailored CV is not a valid v5 resume.")`;
   - `changes: buildResumeChangeLog(base.resumeJson as Record<string, unknown>, prepared.data)`;
   - compute `ats` with the existing deterministic checker (no AI):

```ts
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
```

     Add a local `resumeTextForClaimCheck(data: Record<string, unknown>): string` helper that joins `basics.headline`, `summary.content` (or `sections.summary.content`), each `sections.skills.items[].name`, and each `sections.skills.items[].keywords[]`; ignore missing/non-string values;
   - `model: options?.model ?? null`, provenance from `base.id` / `base.revision`;
   - call `writeVersion` with `origin: "approved"`.

6. Implement `buildResumeChangeLog(before, after)` with exact comparisons (no deep-diff dependency):
   - `basics.headline`: label "Headline", kind `changed`;
   - `summary.content` falling back to `sections.summary.content`: label "Summary", kind `changed`;
   - `sections.skills.items`: label "Tailored skills", kind `changed` (serialize arrays with `JSON.stringify` only for equality/comparison, never in logs);
   - for every item in `sections.projects.items` with an `id`, compare `hidden`: label `Project ${id}`, kind `visibility`;
   - emit only entries where `JSON.stringify(beforeValue) !== JSON.stringify(afterValue)`.

7. Implement `saveSnapshotEdit`:
   - `requireJob(jobId)`-equivalent scoped job check via `jobsRepo.getJobById`;
   - `const current = await tailoredResumesRepo.getById(snapshotId); if (!current || current.jobId !== jobId || current.status !== "approved") throw notFound("Tailored CV snapshot not found");`
   - `safeParseV5ResumeData(resumeJson)` and throw `unprocessableEntity("Tailored CV must be a valid v5 resume.")` on failure;
   - `writeVersion({ jobId, resumeJson, changes: buildResumeChangeLog(current.resumeJson as Record<string, unknown>, resumeJson as Record<string, unknown>), ats: current.ats, model: current.model, origin: "approved", baseResumeDocumentId: current.baseResumeDocumentId, baseResumeRevision: current.baseResumeRevision })`.

8. Implement `restoreSnapshot`:
   - same scoped load as `saveSnapshotEdit`;
   - `writeVersion({ jobId, resumeJson: current.resumeJson, changes: [{ path: "version", label: `Restored from version ${current.version}`, kind: "changed", before: current.version, after: current.version + 1 }], ats: current.ats, model: current.model, origin: "restored", baseResumeDocumentId: current.baseResumeDocumentId, baseResumeRevision: current.baseResumeRevision })`.

9. Write `services/tailored-resume.test.ts` with mocked `jobsRepo`, `tailoredResumesRepo`, `design-resume` service, `prepareTailoredResumeForPdf`, `careerEvidence`, and `profile`. Mock `getCareerEvidenceBank()` to return an empty bank and `getProfile()` to return a minimal profile. Assert:
   - approval creates version 1, sets status `approved`, and updates the job's snapshot id/version;
   - a second approval supersedes version 1, writes version 2, and calls `pruneToLatest(jobId, 10)`;
   - with 11 existing versions, prune keeps versions 2–11 and deletes version 1;
   - `saveSnapshotEdit` writes a new version with `origin: "approved"` and a change log entry;
   - `restoreSnapshot` writes a new version with `origin: "restored"` and identical `resumeJson`;
   - a missing cross-job snapshot id throws `NOT_FOUND`;
   - no function calls an LLM client.

### Verification

Run: `npm --workspace orchestrator exec vitest run src/server/repositories/tailored-resumes.test.ts src/server/services/tailored-resume.test.ts`
Expected: PASS.

Commit: `feat(tailoring): add versioned snapshot repository and service`.

---

## Task 3 — Snapshot API routes and client API functions

**Files:**

- `orchestrator/src/server/api/routes/jobs/documents.ts`
- `orchestrator/src/server/api/routes/jobs-tailored-snapshots.test.ts` (new)
- `orchestrator/src/client/api/jobs.ts`
- `orchestrator/src/client/components/tailoring/TailoringWorkspace.test.tsx` (mocks only)

### Changes

1. In `documents.ts`, add imports:

```ts
import * as tailoredResumesRepo from "@server/repositories/tailored-resumes";
import {
  approveSnapshot,
  restoreSnapshot,
  saveSnapshotEdit,
} from "@server/services/tailored-resume";
```

Add the request schema beside `tailoringPlanRequestSchema`:

```ts
const tailoredSnapshotEditSchema = z.object({
  resumeJson: z.record(z.string(), z.unknown()),
});
```

2. Append these routes after the `/:id/tailoring-plan` route:

```ts
jobsDocumentsRouter.get("/:id/tailored-snapshots/current", async (req, res) => {
  try {
    await requireJob(req.params.id);
    ok(res, await tailoredResumesRepo.getLatestApprovedForJob(req.params.id));
  } catch (error) {
    fail(res, toJobsRouteError(error));
  }
});

jobsDocumentsRouter.get("/:id/tailored-snapshots", async (req, res) => {
  try {
    await requireJob(req.params.id);
    ok(res, await tailoredResumesRepo.listForJob(req.params.id, 10));
  } catch (error) {
    fail(res, toJobsRouteError(error));
  }
});

jobsDocumentsRouter.post("/:id/tailored-snapshots/approve", async (req, res) => {
  try {
    const job = await requireJob(req.params.id);
    if (!job.jobDescription?.trim()) {
      return fail(res, badRequest("Add a job description before approving a tailored CV."));
    }
    const snapshot = await approveSnapshot(job.id, {
      requestOrigin: resolveRequestOrigin(req),
    });
    logger.info("Tailored CV snapshot approved", {
      route: "POST /api/jobs/:id/tailored-snapshots/approve",
      jobId: job.id,
      requestId: getRequestId(),
      snapshotId: snapshot.id,
      version: snapshot.version,
    });
    ok(res, snapshot, 201);
  } catch (error) {
    fail(res, toJobsRouteError(error));
  }
});

jobsDocumentsRouter.patch("/:id/tailored-snapshots/:snapshotId", async (req, res) => {
  try {
    await requireJob(req.params.id);
    const parsed = tailoredSnapshotEditSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(res, badRequest("Invalid tailored CV payload."));
    ok(res, await saveSnapshotEdit(
      req.params.id,
      req.params.snapshotId,
      parsed.data.resumeJson as DesignResumeJson,
    ));
  } catch (error) {
    fail(res, toJobsRouteError(error));
  }
});

jobsDocumentsRouter.post("/:id/tailored-snapshots/:snapshotId/restore", async (req, res) => {
  try {
    await requireJob(req.params.id);
    ok(res, await restoreSnapshot(req.params.id, req.params.snapshotId), 201);
  } catch (error) {
    fail(res, toJobsRouteError(error));
  }
});
```

Import `type DesignResumeJson` from `@shared/types`. Do not use `res.json` anywhere (the API contract guardrail test forbids it).

3. Write `jobs-tailored-snapshots.test.ts` using the same `startServer` / `stopServer`, login, `authHeaders`, and manual-job import helpers as `jobs-tailoring-plan.test.ts`. Mock `@server/services/tailored-resume` in a `vi.hoisted()` block. Assert:
   - POST approve returns `201`, `{ ok: true }`, echoed `x-request-id` and `meta.requestId`, and calls `approveSnapshot` with the scoped job id;
   - GET current/list return `{ ok: true, data }` with the mocked snapshot/list;
   - PATCH with invalid `resumeJson` returns `400 INVALID_REQUEST`;
   - PATCH and restore return the new snapshot;
   - a job without a description returns `400 INVALID_REQUEST`;
   - admin and a second tenant user cannot read or mutate each other's snapshots: both get `404 NOT_FOUND` from `requireJob`.

4. In `orchestrator/src/client/api/jobs.ts`, import `TailoredResumeSnapshot` and `DesignResumeJson` from `@shared/types`, then add:

```ts
export async function getTailoredSnapshots(jobId: string): Promise<TailoredResumeSnapshot[]> {
  return fetchApi<TailoredResumeSnapshot[]>(`/jobs/${jobId}/tailored-snapshots`);
}

export async function getCurrentTailoredSnapshot(jobId: string): Promise<TailoredResumeSnapshot | null> {
  return fetchApi<TailoredResumeSnapshot | null>(`/jobs/${jobId}/tailored-snapshots/current`);
}

export async function approveTailoredSnapshot(jobId: string): Promise<TailoredResumeSnapshot> {
  return fetchApi<TailoredResumeSnapshot>(`/jobs/${jobId}/tailored-snapshots/approve`, { method: "POST" });
}

export async function saveTailoredSnapshot(
  jobId: string,
  snapshotId: string,
  resumeJson: DesignResumeJson,
): Promise<TailoredResumeSnapshot> {
  return fetchApi<TailoredResumeSnapshot>(`/jobs/${jobId}/tailored-snapshots/${snapshotId}`, {
    method: "PATCH",
    body: JSON.stringify({ resumeJson }),
  });
}

export async function restoreTailoredSnapshot(
  jobId: string,
  snapshotId: string,
): Promise<TailoredResumeSnapshot> {
  return fetchApi<TailoredResumeSnapshot>(`/jobs/${jobId}/tailored-snapshots/${snapshotId}/restore`, {
    method: "POST",
  });
}
```

5. Add the five new functions to the `@client/api` mock in `TailoringWorkspace.test.tsx` so existing tests keep compiling.

### Verification

Run: `npm --workspace orchestrator exec vitest run src/server/api/routes/jobs-tailored-snapshots.test.ts src/server/api/routes/api-contract.test.ts`
Expected: PASS, including no direct-`res.json` offenders.

Commit: `feat(tailoring): add tailored snapshot API routes`.

---

## Task 4 — Render PDFs from the approved snapshot

**Files:**

- `orchestrator/src/server/services/pdf.ts`
- `orchestrator/src/server/services/pdf-tailoring.test.ts`
- `orchestrator/src/server/pipeline/orchestrator.ts`
- `orchestrator/src/server/services/demo-pdf.ts`

### Changes

1. In `pdf.ts`, extend `GeneratePdfOptions`:

```ts
  approvedResumeData?: Record<string, unknown> | null;
```

2. Replace the unconditional tailoring block in `generatePdf()` with:

```ts
    let preparedResume: Awaited<
      ReturnType<typeof prepareTailoredResumeForPdf>
    > | null = null;
    if (options?.approvedResumeData) {
      const approvedData = parseV5ResumeData(options.approvedResumeData) as Record<string, unknown>;
      preparedResume = {
        mode: "v5",
        data: approvedData,
        projectCatalog: [],
        selectedProjectIds: [],
      };
      logger.info("Rendering PDF from approved tailored snapshot", { jobId });
    } else {
      try {
        preparedResume = await prepareTailoredResumeForPdf({
          resumeData: baseResume.data,
          tailoredContent,
          jobDescription,
          selectedProjectIds,
          jobId,
          tracerLinks: {
            enabled: Boolean(options?.tracerLinksEnabled),
            requestOrigin: options?.requestOrigin ?? null,
            companyName: options?.tracerCompanyName ?? null,
          },
        });
      } catch (err) {
        logger.warn("Resume tailoring step failed during PDF generation", { jobId, error: err });
        throw err;
      }
    }
```

`loadBaseResumeSource()` still runs before this block; leave it in place to preserve renderer resolution and legacy behavior. The snapshot branch must not call `prepareTailoredResumeForPdf()`.

3. In `orchestrator.ts`, change the existing errors import to `import { conflict, type AppErrorCode } from "@infra/errors";` and add `import * as tailoredResumesRepo from "@server/repositories/tailored-resumes";`. Immediately before `generatePdf()` in `generateFinalPdf()`:

```ts
      let approvedResumeData: Record<string, unknown> | null = null;
      if (job.tailoredResumeSnapshotId) {
        const snapshot = await tailoredResumesRepo.getById(job.tailoredResumeSnapshotId);
        if (!snapshot) {
          throw conflict(
            "The approved tailored CV is no longer available. Approve a new snapshot before generating a PDF.",
          );
        }
        approvedResumeData = snapshot.resumeJson as unknown as Record<string, unknown>;
      }
```

Add `approvedResumeData` to the options object passed to `generatePdf()`. The existing `createJobPdfFingerprint(job, fingerprintContext)` call stays unchanged — the job row now carries the snapshot id/version from Task 1.

4. In `services/demo-pdf.ts`, perform the same scoped snapshot lookup when `job.tailoredResumeSnapshotId` is set and pass `approvedResumeData` in the `generatePdf()` options. Demo mode must not invent a different CV than the approved snapshot.

5. Add tests to `pdf-tailoring.test.ts`:
   - with `approvedResumeData` supplied, `prepareTailoredResumeForPdf` is not called and `renderResumePdf` receives the exact supplied `summary.content` / `basics.headline`;
   - without it, existing behavior is unchanged (existing tests cover this);
   - invalid `approvedResumeData` returns `{ success: false }` with an error code instead of throwing.

### Verification

Run: `npm --workspace orchestrator exec vitest run src/server/services/pdf-tailoring.test.ts src/server/services/pdf-fingerprint.test.ts`
Expected: PASS.

Commit: `feat(tailoring): render PDFs from approved tailored snapshots`.

---

## Task 5 — Focused tailored CV editor and workspace integration

**Files:**

- `orchestrator/src/client/components/tailoring/TailoredCvEditor.tsx` (new)
- `orchestrator/src/client/components/tailoring/TailoredCvEditor.test.tsx` (new)
- `orchestrator/src/client/components/tailoring/TailoringWorkspace.tsx`
- `orchestrator/src/client/components/tailoring/TailoringWorkspace.test.tsx`

### Changes

1. Create `TailoredCvEditor.tsx`:

```tsx
type TailoredCvEditorProps = {
  jobId: string;
  snapshot: TailoredResumeSnapshot;
  versions: TailoredResumeSnapshot[];
  onSaved: (snapshot: TailoredResumeSnapshot, versions: TailoredResumeSnapshot[]) => void;
  onRestored: (snapshot: TailoredResumeSnapshot, versions: TailoredResumeSnapshot[]) => void;
};
```

State: `draft: DesignResumeJson` initialized from `snapshot.resumeJson`, `dirty: boolean`, `saving: boolean`, `dialog: { definition: ItemDefinition; index: number | null } | null`.

Behavior:
- `update(path, value)` uses `setByPath(draft as Record<string, unknown>, path, value)` from `@client/components/design-resume/utils` and sets `dirty = true`;
- render `BasicsSection` and `SummarySection` from `DesignResumeInlineSections.tsx`, and a compact list of `ITEM_DEFINITIONS` sections with Add/Edit buttons opening `ItemDialog`;
- build the dialog item with `getDesignResumeDialogItem({ resumeJson: draft, ... } as DesignResumeDocument, definition, index)`; on save, write the returned item to `sections.${definition.key}.items[${index ?? -1}]` using `setByPath` and close;
- **Save edits** calls `api.saveTailoredSnapshot(jobId, snapshot.id, draft)`, then `api.getTailoredSnapshots(jobId)`, then `onSaved(nextSnapshot, versions)`; disabled when `!dirty || saving`;
- **Restore** appears for each older version in the history list; calls `api.restoreTailoredSnapshot(jobId, version.id)`, refreshes the list, resets `draft` to the returned snapshot, and calls `onRestored`;
- render a **Changes from baseline** panel from `snapshot.changes` using `label`, `kind`, `before`, `after` (truncate long strings to 160 characters in the UI);
- render a version row per version: `v{version}`, `origin`, `createdAt`, and change summary count;
- do not import or call any LLM/AI field assistant API. No request happens on mount.

2. In `TailoringWorkspace.tsx`:
   - import `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` from `@/components/ui/dialog`, `FileEdit` from `lucide-react`, and the new API functions;
   - add state `snapshot`, `versions`, `isCvEditorOpen`, `isApprovingSnapshot`, `snapshotError`;
   - add `useEffect` keyed on `props.job.id` that loads `getCurrentTailoredSnapshot` and `getTailoredSnapshots`; use a cancelled flag so stale responses cannot overwrite a newer job's state;
   - add `handleApproveSnapshot`: call `api.approveTailoredSnapshot(props.job.id)`, set `snapshot`, refresh list, call `props.onUpdate()` so the job row's snapshot id/version and PDF freshness refresh; toast success/failure; no AI call;
   - add `handleSnapshotSaved` / `handleSnapshotRestored`: update state and call `props.onUpdate()`;
   - in the action grid, add buttons after **Generate PDF**:
     - `Approve snapshot` — visible when `props.job.jobDescription?.trim()`, disabled while `!tailoringReadiness.canGeneratePdf || generateTarget || isGeneratingPdf || isApprovingSnapshot || evidenceCheck?.blocked.length`; label shows `Update snapshot` when a snapshot exists;
     - `Open full tailored CV` — visible when `snapshot` exists, enabled when `autosaveStatus === "saved"`; opens the dialog containing `TailoredCvEditor`;
     - a small badge `v{snapshot.version}` next to the buttons when a snapshot exists;
   - render the dialog at the end of the component:

```tsx
<Dialog open={isCvEditorOpen} onOpenChange={setIsCvEditorOpen}>
  <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
    <DialogHeader><DialogTitle>Tailored CV — {props.job.title}</DialogTitle></DialogHeader>
    {snapshot && (
      <TailoredCvEditor
        jobId={props.job.id}
        snapshot={snapshot}
        versions={versions}
        onSaved={handleSnapshotSaved}
        onRestored={handleSnapshotRestored}
      />
    )}
  </DialogContent>
</Dialog>
```

   - change PDF gating from `const canGeneratePdf = isDraftReady && ...` to also require `Boolean(snapshot) && props.job.tailoredResumeSnapshotId === snapshot.id && props.job.tailoredResumeVersion === snapshot.version && autosaveStatus === "saved"`. Keep the existing evidence gate untouched. When blocked only by snapshot state, show the message "Approve a tailored CV snapshot before generating a PDF." beside the button.

3. Update `TailoringWorkspace.test.tsx`:
   - add the new API mocks with default resolved values (`null`, `[]`, a mock snapshot);
   - assert opening the workspace does not call `summarizeJob`, `approveTailoredSnapshot`, or any AI function;
   - assert **Approve snapshot** is hidden without a JD, visible with one, and clicking it calls `approveTailoredSnapshot("job-1")` exactly once;
   - assert **Generate PDF** is disabled when no snapshot exists and enabled when the mocked job/version match the mocked snapshot;
   - assert clicking **Open full tailored CV** renders a "Changes from baseline" panel and that clicking **Save edits** calls `saveTailoredSnapshot` with the job id, snapshot id, and edited `resumeJson`.

4. Add `TailoredCvEditor.test.tsx` with these API mocks and assertions:
   - renders baseline change labels and ten version rows from props;
   - Save edits is disabled until a field is edited, then calls the save API with the edited JSON;
   - Restore calls the restore API and calls `onRestored` with the new snapshot and refreshed versions;
   - no AI/summarize function is called on render or restore.

### Verification

Run: `npm --workspace orchestrator exec vitest run src/client/components/tailoring/TailoredCvEditor.test.tsx src/client/components/tailoring/TailoringWorkspace.test.tsx`
Expected: PASS. Then `npm --workspace orchestrator run build:client`.

Commit: `feat(tailoring): add per-job tailored CV editor and approval UI`.

---

## Task 6 — Documentation, full verification, and live check

**Files:**

- `docs-site/docs/features/orchestrator.md`
- `docs/plans/2026-11-22-tailoring-phase3-design.md` (status note only if behavior changed)

### Changes

1. In `docs-site/docs/features/orchestrator.md`, extend the **Tailoring review workflow** with a new subsection `### Tailored CV snapshots` covering:
   - **What it is** — a durable, versioned, per-job CV built from the Resume Studio baseline and current tailoring fields.
   - **Why it exists** — PDFs must render exactly the text the user approved; the old in-memory overlay had no durable artifact or history.
   - **How to use it** — click **Approve snapshot** after the draft is ready; click **Open full tailored CV** to edit basics, summary, and items; **Save edits** creates a new version; **Restore** copies an older version into a new latest version; the last 10 versions are kept. PDF generation is disabled until a snapshot is approved and the job references the current version.
   - **Common problems** — "Approve snapshot is disabled" (complete summary/headline/skills and write the JD), "PDF is stale" (regenerate after approving/editing), "The approved tailored CV is no longer available" (approve a new snapshot).
   - **Related pages** — link to `/docs/features/settings` for the Career Evidence Bank and `/docs/next/getting-started/microsoft-graph-oauth-setup` for the email flow.
   - Add a note under **Generating PDFs** that PDFs now render from the approved snapshot and that fingerprint `v2` makes previously generated PDFs stale once this release ships.

2. Run the full CI-parity list from `AGENTS.md` from repository root:

```bash
./orchestrator/node_modules/.bin/biome ci .
npm run check:types:shared
npm --workspace orchestrator run check:types
npm --workspace gradcracker-extractor run check:types
npm --workspace ukvisajobs-extractor run check:types
npm --workspace orchestrator run build:client
npm --workspace orchestrator run test:run
npm run docs:build
```

If using the formatter is noisy on unchanged generated files, use `biome ci --formatter-enabled=false .` as in Phase 2, but state that explicitly in the final report. If `better-sqlite3` fails with an ABI mismatch, run `npm --workspace orchestrator rebuild better-sqlite3` and rerun tests.

3. Run `npm run docker:rebuild:kiri` once (single step, per project rule).

4. Live verification at `http://localhost:3005` using bearer token from `localStorage.jobops.authToken`:
   - open a discovered job with a JD → no AI request in the network log;
   - edit summary/headline/skills → **Approve snapshot** → confirm a `v1` badge and a row in version history;
   - open the full CV editor → edit a field → **Save edits** → confirm `v2` and a change entry;
   - **Restore** `v1` → confirm a new `v3` with `origin: restored` and no deleted history;
   - **Generate PDF** → confirm the rendered PDF contains the approved snapshot text;
   - run **Check evidence** only by explicit click; no email preview/send is triggered.
   - Restore live data afterward: job status `discovered`, tailoring fields to their prior values (or `null`), and delete test snapshots if the test job is reused.

5. `git push fork main` only. Confirm `origin/main` remains at `7fac74f`.

Commit: `docs: document tailored CV snapshots and phase 3 verification`.

---

## Self-review checklist

- [x] New table + migration + tenant scope (Task 1–2).
- [x] Explicit approval, no AI on open/preview (Task 3, 5).
- [x] Bounded history of 10, restore-as-new-version (Task 2, 5).
- [x] Any job with JD is eligible (Task 3, 5).
- [x] PDF and fingerprint use approved snapshot id/version (Task 1, 4).
- [x] Source suitability scoring untouched.
- [x] Docs, full CI parity, Kiri rebuild, live check, fork-only push (Task 6).
