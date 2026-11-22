# Tailoring Phase 3 Design — Editable Per-Job Tailored CV Artifact

Date: 2026-11-22
Status: Approved (approach B — snapshot-first)
Parent plan: `docs/plans/2026-11-22-tailoring-v2-plan.md`
Prior phase: `docs/plans/2026-11-22-tailoring-phase2-implementation.md`

## Why this exists

Phase 1 stores tailoring as a few overlay fields on the job row and re-applies them to a fresh clone of the global Resume Studio resume at PDF render time. Phase 2 added a grounded evidence check and review plan, but the plan is advisory and no durable per-job CV exists. A user still cannot edit the complete CV for one job, see what changed against the baseline, restore an earlier version, or guarantee that the PDF was rendered from exactly the text they approved.

Phase 3 introduces a durable, tenant-scoped **tailored resume snapshot** per job. The PDF renders from the approved snapshot, not from a live in-memory overlay. This is also the prerequisite for Phase 4's tailored-fit signal, which must measure a real tailored artifact.

## Decisions (approved)

1. **Approach:** snapshot-first. New dedicated table and focused per-job editor reusing existing Resume Studio section primitives; do not duplicate the full Resume Studio app.
2. **Snapshot trigger:** explicit **Approve snapshot** action. It persists the current prepared resume JSON as a version and marks it approved. No snapshot is created on job open, tailoring open, autosave, email preview, or PDF rendering.
3. **Versioning:** keep the newest **10** approved snapshots per job. Restore copies an older `resume_json` into a new latest version (`origin: "restored"`); history is never deleted by restore. Pruning beyond 10 happens on write.
4. **Eligibility:** any job with a job description can create a snapshot. No status gate and no automatic creation.
5. **Approved source:** PDF generation uses the approved snapshot's `resume_json`; in-memory tailoring is skipped when a snapshot is supplied. Any edit that changes the approved snapshot invalidates PDF freshness until re-approved.
6. **Scoring:** source suitability scoring remains candidate-independent and unchanged. Tailored fit stays Phase 4.

## Data model

New table `tailored_resumes` in `orchestrator/src/server/db/schema.ts`, following `design_resume_documents` and `privateDataScopeFilter()` conventions:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text PK | cuid2 |
| `tenant_id` | text not null, default `tenant_default` | tenancy |
| `user_id` | text nullable | private-data scope |
| `job_id` | text not null | FK → `jobs.id` ON DELETE CASCADE |
| `version` | integer not null | monotonic per scope + job |
| `status` | text not null | `approved` on write; prior rows become `superseded` |
| `resume_json` | text not null | JSON text of prepared v5 resume |
| `changes` | text not null | JSON: baseline → snapshot path-level change log |
| `ats` | text nullable | JSON: Phase 2 evidence check result at approval |
| `origin` | text not null | `approved` or `restored` |
| `model` | text nullable | model that produced the prepared content |
| `base_resume_document_id` | text nullable | provenance |
| `base_resume_revision` | integer nullable | provenance |
| `generated_at` | integer not null | epoch ms |
| `created_at` | integer not null | epoch ms |
| `updated_at` | integer not null | epoch ms |

Indexes: unique `(tenant_id, coalesce(user_id,''), job_id, version)`; index `(tenant_id, user_id, job_id, status, updated_at)`.

## Backend

- Repository `orchestrator/src/server/repositories/tailored-resumes.ts`: `getLatestApprovedForJob`, `getById`, `listForJob`, `insertVersion`, `markSuperseded`, `pruneToLatest(10)`. All reads/writes use `privateDataScopeFilter()`; job-scoped reads first go through the tenant-scoped job lookup so cross-tenant IDs return `404`.
- Service `orchestrator/src/server/services/tailored-resume.ts`:
  - `approveSnapshot(jobId)` — load scoped job, prepare resume JSON via `prepareTailoredResumeForPdf()` with current tailoring fields, compute baseline → snapshot change log, write next version, supersede prior versions, prune beyond 10.
  - `saveSnapshotEdit(jobId, snapshotId, resumeJson)` — explicit editor save writes a new version.
  - `restoreSnapshot(jobId, snapshotId)` — copies old `resume_json` into a new latest version with `origin: "restored"`.
- Routes under `/api/jobs/:id/tailored-snapshots`: `POST` approve, `GET` current, `GET` list, `PATCH :snapshotId` save edits, `POST :snapshotId/restore`. All use `{ ok, data/error, meta.requestId }`, honor inbound `x-request-id`, and return the header.
- PDF/fingerprint: pipeline passes approved snapshot JSON into `generatePdf()`; rendering skips in-memory tailoring when present. `createJobPdfFingerprint()` includes approved snapshot id/version and bumps `PDF_FINGERPRINT_VERSION` to `v2` so existing PDFs become stale on release.

## Client

- `orchestrator/src/client/api/jobs.ts` gains snapshot API functions.
- `TailoringWorkspace` shows **Approve snapshot** for jobs with a JD, current version badge, link to **Open full tailored CV**, and PDF gating that also requires an approved, unmodified snapshot.
- New `components/tailoring/TailoredCvEditor.tsx` reuses Resume Studio primitives (`BasicsSection`, `SummarySection`, `DesignResumeSection`, `ItemDialog`, preview panel) bound to snapshot `resume_json`; explicit **Save edits** writes a new version. Embedded field assistant, if present, remains strictly click-driven — no AI on open.
- Version history panel lists last 10 versions with time, origin, and change summary; **Restore** creates a new latest version. Diff panel shows baseline → current changes by path (summary, headline, skills, project visibility).

## Documentation

Update `docs-site/docs/features/orchestrator.md` with the snapshot workflow, approval requirement, version history/restore, and fingerprint `v2` staleness behavior. Keep the project's feature-page structure and frontmatter.

## Verification

Targeted tests: repository tenancy, service versioning/pruning/restore, route contract and cross-tenant `404`, fingerprint inclusion, client approve/restore/PDF gating. Then full CI-parity checks from `AGENTS.md`, `docs:build`, `docker:rebuild:kiri`, and live browser verification: no AI on open, approval creates a version, restore creates a new version, PDF uses snapshot, no email sent.

## Out of scope

- Phase 4 tailored-fit scoring.
- Source suitability scoring changes.
- Editing the global Resume Studio baseline from the tailored editor.
- Automatic snapshot creation or AI on open/preview.
- Hidden BCC, extra attachments, or changes to the review-first email apply flow.
