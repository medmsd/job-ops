# Tailoring Phase 4 — Derived Tailored-Fit Score Implementation Plan

Date: 2026-11-23
Status: Ready to implement
Design: `docs/plans/2026-11-23-tailoring-phase4-design.md`
Parent plan: `docs/plans/2026-11-22-tailoring-v2-plan.md`

## Goal

Add an explicit, derived, job-specific tailored-fit score computed from the approved tailored CV snapshot, display it separately from source fit, and leave source suitability scoring and manual Rescore unchanged.

## Global constraints

- Push only to `fork` (`https://github.com/medmsd/job-ops.git`). Never push to `origin`.
- All `/api/*` responses use `{ ok: true, data, meta?: { requestId } }` or `{ ok: false, error: { code, message, details? }, meta: { requestId } }`.
- Honor inbound `x-request-id`; always return the header; include the request ID in structured logs.
- Treat every server-side change as multi-tenant: use `requireJob()` and `privateDataScopeFilter()` conventions. Add cross-tenant coverage.
- Use `infra/logger.ts`; no direct `console.log/warn/error`.
- Never log raw prompts, LLM bodies, profile dumps, or large JSON blobs.
- No AI on job open, tailoring open, snapshot approve/save/restore, PDF generation, email preview, or email apply. `GET` is deterministic. Only the explicit `POST` may call AI.
- Do not modify `scoreJobSuitability`, `suitabilityScore`, `suitabilityReason`, `jobBrief`, the Rescore action, or the **Rescore** button.
- User-visible changes require docs updates in `docs-site/docs/features/orchestrator.md`.
- Execution: one implementer per task, followed by one reviewer. Do not start a later task before the prior reviewer approves.

## Task 1 — Shared types, schema, migration, repository mapping

**Files**

- `shared/src/types/tailored-fit.ts` (new)
- `shared/src/types/index.ts`
- `shared/src/types/jobs.ts`
- `orchestrator/src/server/db/schema.ts`
- `orchestrator/src/server/db/migrate.ts`
- `orchestrator/src/server/repositories/jobs.ts`
- repository test for full-job field mapping (add to existing jobs repository test or create `jobs-tailored-fit-fields.test.ts`)

**Steps**

1. Create `shared/src/types/tailored-fit.ts` exactly as specified in the design doc: `TailoredFitNoteStatus`, `TailoredFitNote`, `TailoredFitResult`, `TailoredFitState`.
2. Add `export * from "./tailored-fit";` to `shared/src/types/index.ts`, keeping alphabetical order near `tailored-resumes`.
3. In `shared/src/types/jobs.ts`:
   - import `type { TailoredFitNote }` from `./tailored-fit.js` (match the repo's existing import suffix convention);
   - add the eight `tailoredFit*` fields to `Job` after `tailoredResumeVersion`;
   - add matching optional fields to `UpdateJobInput`;
   - do **not** add them to `JobListItem` or `updateJobSchema` — derived values are not client-writable.
4. In `orchestrator/src/server/db/schema.ts`, add to the `jobs` table after `tailoredResumeVersion`:

```ts
    tailoredFitScore: real("tailored_fit_score"),
    tailoredFitNotes: text("tailored_fit_notes"),
    tailoredFitSummary: text("tailored_fit_summary"),
    tailoredFitSnapshotId: text("tailored_fit_snapshot_id"),
    tailoredFitSnapshotVersion: integer("tailored_fit_snapshot_version"),
    tailoredFitInputHash: text("tailored_fit_input_hash"),
    tailoredFitComputedAt: integer("tailored_fit_computed_at", {
      mode: "number",
    }),
    tailoredFitModel: text("tailored_fit_model"),
```

5. In `orchestrator/src/server/db/migrate.ts`:
   - add the same columns to the fresh `jobs` table definition;
   - add `ALTER TABLE jobs ADD COLUMN ...` entries beside the existing tailored snapshot columns at lines ~912–913;
   - add the columns to the `jobs_new` rebuild `CREATE TABLE`, the `INSERT OR REPLACE INTO jobs_new` column list, and the matching `SELECT` list at lines ~1046, ~1073, and ~1086. Use `tableHasColumn("jobs", ...)` guards for the SELECT expressions exactly as neighbouring optional columns do.
6. In `orchestrator/src/server/repositories/jobs.ts`:
   - add a small `parseTailoredFitNotes(value: string | null): TailoredFitNote[] | null` helper that returns `null` on empty/invalid JSON and truncates to at most 12 entries;
   - map all eight fields in `mapRowToJob()`;
   - update any explicit select list that builds a full `Job` row so the new columns are selected. `getJobListItems()` does not need them.
7. Add a repository test that writes all eight fields through `jobsRepo.updateJob`, reads with `getJobById`, and asserts exact round-trip values plus cross-tenant invisibility.

**Commit**

`feat(tailoring): persist derived tailored-fit fields`

**Reviewer checklist**

- Fresh and migrated databases both have the columns.
- Existing jobs read with null derived fields.
- Source score fields are untouched.
- Cross-tenant read returns not found.

## Task 2 — Deterministic input/hash and tailored-fit service

**Files**

- `orchestrator/src/server/services/tailored-fit.ts` (new)
- `orchestrator/src/server/services/tailored-fit.test.ts` (new)

**Steps**

1. Create `tailored-fit.ts` with these exports:

```ts
export function buildTailoredFitInput(args: {
  job: Job;
  snapshot: TailoredResumeSnapshot;
  evidenceBank: CareerEvidenceBank;
  profile: ResumeProfile;
}): Record<string, unknown>;

export function hashTailoredFitInput(
  input: Record<string, unknown>,
): string;

export function getTailoredFitState(job: Job): Promise<TailoredFitState>;

export function computeTailoredFit(job: Job): Promise<Job>;
```

2. `buildTailoredFitInput` uses only:
   - `snapshot.resumeJson`;
   - `job.jobDescription`;
   - `buildEvidencePromptBlock(evidenceBank, profile)`;
   - a whitelisted profile subset containing only sections/items actually visible in the approved resume.
   Truncate long text fields using the same caps style as `careerEvidence.ts` (`LIMITS`).
3. `hashTailoredFitInput` uses `node:crypto` SHA-256 over a stable-stringified object (sort keys recursively). No new dependency.
4. `getTailoredFitState(job)`:
   - `require`-style job is already passed in by the route; do not re-load it;
   - if no JD → `{ result: null, isStale: false, reason: "no_description" }`;
   - load approved snapshot via `tailoredResumesRepo.getLatestApprovedForJob(job.id)`; if none → `reason: "no_snapshot"`;
   - load evidence bank via `getCareerEvidenceBank()` and profile via `getProfile()`;
   - if no stored `tailoredFitInputHash` or score → `reason: "not_checked"`;
   - if snapshot ID differs or current hash differs → `{ result: storedResult, isStale: true, reason: "inputs_changed" }`;
   - otherwise return the stored result with `isStale: false`.
5. `computeTailoredFit(job)`:
   - validate JD and approved snapshot; throw `badRequest(...)` for missing prerequisites;
   - compute the deterministic claim check with `checkTailoredClaims({ bank, profile, text: resumeText, jobDescription })`;
   - build a strict Zod schema for `{ score: number, summary: string, notes: array }`, max 12 notes, statuses limited to the four allowed values;
   - call the LLM following `generateTailoringPlan` model selection, hosted usage reservation, and error handling; do not call the source scorer;
   - validate `evidenceRefs` with `resolveEvidenceRefs(bank, profile)`, drop invalid refs, downgrade unsupported notes, cap for blocked/unsupported, clamp `0–100`, truncate strings;
   - build `TailoredFitResult` with `computedAt: Date.now()` and the model name;
   - persist only the eight derived fields via `jobsRepo.updateJob(job.id, {...})`;
   - log structured metadata only: `requestId`, `jobId`, `snapshotId`, score band, note count, model.
6. Tests:
   - no AI call when inputs are missing;
   - hash changes when JD, snapshot JSON, evidence bank, or profile changes;
   - stored result is fresh, then stale after snapshot version change;
   - invalid evidence ref dropped and `covered` downgraded to `unsupported`;
   - blocked cap 40 and unsupported cap 60;
   - source score fields are not written;
   - cross-tenant snapshot lookup cannot be used for another tenant's job.

**Commit**

`feat(tailoring): add evidence-constrained tailored-fit scoring service`

**Reviewer checklist**

- `scoreJobSuitability` is unchanged.
- Only `POST` can call the LLM; `getTailoredFitState` makes no LLM call.
- Guardrails cannot be bypassed by prompt output.
- No raw prompt/response logging.

## Task 3 — API routes and client API

**Files**

- `orchestrator/src/server/api/routes/jobs/documents.ts`
- `orchestrator/src/client/api/jobs.ts`
- `orchestrator/src/server/api/routes/jobs-tailored-fit.test.ts` (new)

**Steps**

1. In `documents.ts`, import `computeTailoredFit`, `getTailoredFitState`, and `type { TailoredFitState }`.
2. Add:

```ts
jobsDocumentsRouter.get("/:id/tailored-fit", async (req, res) => {
  try {
    const job = await requireJob(req.params.id);
    const state: TailoredFitState = await getTailoredFitState(job);
    ok(res, state);
  } catch (error) {
    fail(res, toJobsRouteError(error));
  }
});

jobsDocumentsRouter.post("/:id/tailored-fit", async (req, res) => {
  try {
    const job = await requireJob(req.params.id);
    if (!job.jobDescription?.trim()) {
      return fail(
        res,
        badRequest("Add a job description before checking tailored fit."),
      );
    }
    const updated = await computeTailoredFit(job);
    logger.info("Tailored fit computed", {
      route: "POST /api/jobs/:id/tailored-fit",
      jobId: job.id,
      requestId: getRequestId(),
      score: updated.tailoredFitScore,
    });
    ok(res, hydrateJobPdfFreshness(updated));
  } catch (error) {
    fail(res, toJobsRouteError(error));
  }
});
```

3. In `orchestrator/src/client/api/jobs.ts`, add:

```ts
export function getTailoredFit(jobId: string): Promise<TailoredFitState>;
export function computeTailoredFit(jobId: string): Promise<Job>;
```

using `fetchApi` and the same envelope handling as `getCurrentTailoredSnapshot` / `approveTailoredSnapshot`.

4. Route tests cover:
   - standard success envelope and `x-request-id` on GET and POST;
   - GET never calls the LLM;
   - POST calls the LLM exactly once;
   - no JD → `400 INVALID_REQUEST`;
   - no approved snapshot → clear error mapped through `toJobsRouteError`;
   - cross-tenant job ID → `404 NOT_FOUND`;
   - POST returns hydrated `Job` with source score unchanged.

**Commit**

`feat(tailoring): add tailored-fit API routes`

**Reviewer checklist**

- Request IDs propagate into service logs.
- Error codes follow `AGENTS.md`.
- `POST` does not accept client-supplied scores.

## Task 4 — Shared tailored-fit UI component and TailoringWorkspace

**Files**

- `orchestrator/src/client/components/tailoring/TailoredFitSummary.tsx` (new)
- `orchestrator/src/client/components/tailoring/TailoringWorkspace.tsx`
- `orchestrator/src/client/components/tailoring/TailoringWorkspace.test.tsx`

**Steps**

1. Create `TailoredFitSummary` with props:

```ts
interface TailoredFitSummaryProps {
  job: Job;
  state: TailoredFitState;
  isComputing: boolean;
  canCompute: boolean;
  disabledReason: string | null;
  onCompute: () => void | Promise<void>;
  variant?: "panel" | "compact";
}
```

   - Always render the label **Derived tailored fit — job-specific**.
   - `panel` variant shows score `/100`, summary, note statuses, evidence refs, and stale/unavailable alerts.
   - `compact` variant shows only the label, score, and a stale dot/text.
   - Use existing design-system primitives and `aria-live="polite"` for the result.
2. In `TailoringWorkspace.tsx`:
   - add state `fitState`, `fitLoading`, `isComputingFit`;
   - on job change call only `api.getTailoredFit(job.id)` (no POST, no AI);
   - add `handleComputeFit()` calling `api.computeTailoredFit(job.id)` then `onJobUpdated(updatedJob)` and refreshing state via GET;
   - derive `canComputeFit = !!jobDescription.trim() && !!snapshot`;
   - render the `panel` variant near the Approve/PDF action row with button **Check tailored fit**;
   - keep all existing generation, evidence, approval, and PDF handlers unchanged.
3. Tests:
   - opening the workspace calls only `getTailoredFit`, never `computeTailoredFit`;
   - clicking **Check tailored fit** calls `computeTailoredFit` once;
   - button disabled and explanatory text shown without JD or snapshot;
   - stale warning displayed when `isStale`;
   - source score is not displayed as tailored fit.

**Commit**

`feat(tailoring): add explicit tailored-fit check to workspace`

**Reviewer checklist**

- No AI on open.
- Explicit button is the only compute trigger.
- Labels clearly distinguish derived fit from source fit.

## Task 5 — JobDetailPanel readout and user documentation

**Files**

- `orchestrator/src/client/hooks/useTailoredFit.ts` (new)
- `orchestrator/src/client/pages/orchestrator/JobDetailPanel.tsx`
- `orchestrator/src/client/pages/orchestrator/JobDetailPanel.test.tsx`
- `docs-site/docs/features/orchestrator.md`

**Steps**

1. Create `useTailoredFit(jobId: string)` returning `{ state, isLoading, refetch }`. Use React Query with key `["tailored-fit", jobId]`, calling only `api.getTailoredFit`.
2. In `JobDetailPanel.tsx`:
   - call the hook with `selectedJob.id`;
   - render `TailoredFitSummary variant="compact"` beside the existing `JobHeader` / source score area;
   - when `onJobUpdated` completes from any fit compute in the workspace, call `refetch()`;
   - leave `useRescoreJob`, the **Recalculate match** menu item, and `ScoreRing` untouched.
3. Update `docs-site/docs/features/orchestrator.md`:
   - add a **Derived tailored fit** section following the design doc structure;
   - clarify source fit vs tailored fit and that **Rescore** and **Check tailored fit** are separate manual actions;
   - state that neither runs on open and neither sends email;
   - document stale inputs, missing evidence refs, and LLM-unavailable behavior;
   - add `/docs/...` related links.
4. Tests:
   - compact readout shows labelled derived score or "Not checked";
   - GET-only on detail open;
   - Rescore button still present and unchanged;
   - docs build succeeds.

**Commit**

`feat(tailoring): show derived fit in job detail and update docs`

**Reviewer checklist**

- Source fit UI not replaced or relabelled as tailored.
- Rescore remains obvious and manual.
- Docs match actual behavior.

## Task 6 — Full verification, live check, rebuild, fork-only push

**Steps**

1. Run targeted tests for touched modules.
2. Run CI-parity checks from `AGENTS.md`:

```powershell
./orchestrator/node_modules/.bin/biome ci .
npm run check:types:shared
npm --workspace orchestrator run check:types
npm --workspace gradcracker-extractor run check:types
npm --workspace ukvisajobs-extractor run check:types
npm --workspace orchestrator run build:client
npm --workspace orchestrator run test:run
npm run docs:build
```

   Repo-wide Biome currently has pre-existing CRLF/generated-file diagnostics on this Windows checkout. Record them, then run:

```powershell
./orchestrator/node_modules/.bin/biome ci --formatter-enabled=false .
./orchestrator/node_modules/.bin/biome ci <touched files>
```

   There must be no new diagnostics in touched files.

3. Run `graphify update .` and `npm run docker:rebuild:kiri`.
4. Browser verification on a disposable job with a JD:
   - open job and tailoring tab: only deterministic GET calls; no LLM route;
   - approve snapshot, then press **Check tailored fit**: POST calls AI once;
   - record `suitabilityScore` before and after: unchanged;
   - Rescore button still visible in sidebar;
   - edit snapshot or JD to trigger stale state and verify the warning;
   - no email endpoint is called;
   - restore the test job data after verification.
5. Confirm container health and restored data.
6. Push only to `fork`:

```powershell
git push fork main
git for-each-ref --format='%(refname:short) %(objectname:short)' refs/remotes/fork/main refs/remotes/origin/main
git ls-remote https://github.com/DaKheera47/job-ops.git refs/heads/main
```

   `origin/main` must remain at `7fac74f`.

**Commit**

No code commit in this task unless verification finds a defect; if so, use a focused `fix(tailoring): ...` commit.

**Reviewer checklist**

- All required checks pass or documented pre-existing failures are unchanged.
- Live behavior matches explicit-only contract.
- Fork updated; origin untouched.
