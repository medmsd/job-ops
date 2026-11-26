# Bulk Tailor + PDF Design — Discovered Jobs Toolbar Control

Date: 2026-11-26
Status: Approved (design A; reuse the existing `move_to_ready` bulk action)
Related: `docs/plans/2026-11-22-tailoring-v2-plan.md`, `docs/plans/2026-11-22-tailoring-phase3-design.md`, `docs/plans/2026-11-23-application-response-tracking-design.md`

## What it is

A number input and button in the discovered-jobs toolbar that tailors the first N discovered jobs in the current filtered/sorted order, generates each resume PDF, and moves those jobs to Ready.

## Why it exists

Today the only bulk way to tailor and generate PDFs is to select jobs one by one and press **Move to Ready** in the floating selection bar. For a large discovered list that means many manual selections. There is no way to say "process the next 25 discovered jobs" in one action.

The server already does exactly the requested work: the `move_to_ready` job action calls `processJob()`, which runs `summarizeJob()` (AI tailoring grounded in the approved evidence bank) and `generateFinalPdf()`, then leaves the job in Ready. The missing piece is only the UI control that feeds it a computed batch of job IDs.

## Scope

In scope:

1. A count input + action button shown only on the discovered tab toolbar.
2. Processing the first N jobs from `activeJobs` (already filtered and sorted client-side).
3. Reuse of the existing streaming bulk action, progress toast, error handling, and job reload.
4. Component and container tests, user-facing docs, and CI-parity verification.

Out of scope:

- New server routes, new `JobAction` variants, or API contract changes.
- Changing AI tailoring behaviour, evidence grounding, or snapshot approval.
- Changing source suitability scoring or Rescore.
- Changing the floating selection bar or the empty-state actions.
- Processing jobs outside the discovered tab.

## Decisions (approved)

1. **Input:** number of jobs to process. Default `10`, clamped to `1..500` (matches the existing `MAX_JOB_ACTION_JOB_IDS` / schema maximum).
2. **Placement:** discovered-tab toolbar, between `OrchestratorFilters` and the job list grid. Hidden on all other tabs.
3. **Tailoring mode:** AI tailor then generate PDF, using the existing pipeline `processJob()` path. This is an explicit user click, so the "no AI on job open / tailoring open" rule is preserved.
4. **Status change:** jobs move to Ready automatically as part of this explicit bulk action. No separate confirmation step.
5. **Ordering:** jobs are taken from `activeJobs.slice(0, N)`, so the user's current search/filter/sort determines which jobs are processed.
6. **Reuse:** call the existing `runJobAction("move_to_ready", ids)` from `useJobSelectionActions`; no new API or server code. Tenant scoping, request IDs, structured logging, hosted-usage reservations, SSE progress, and per-job failure reporting are inherited unchanged.
7. **Failure handling:** unchanged from the existing action — succeeded jobs reload out of discovered; failed job IDs stay selected so they can be retried.

## Components

### `BulkTailorPdfControl.tsx`

New client component in `orchestrator/src/client/pages/orchestrator/`:

- Props: `jobCount: number`, `inFlight: boolean`, `onProcess: (limit: number) => void`.
- Local numeric input state with clamping on change and blur; the button is disabled when `jobCount === 0` or `inFlight`.
- Uses the project's existing `Button` and `Input` UI primitives; no new dependencies.
- Renders a short helper line describing that AI tailoring runs and jobs move to Ready.

### Integration

- `OrchestratorJobsWorkspace.tsx`: accept an optional `onBulkTailorPdf` callback and render `BulkTailorPdfControl` only when `activeTab === "discovered"`, between `OrchestratorFilters` and the job grid.
- `OrchestratorJobWorkspaceContainer.tsx`: pass the callback; compute `activeJobs.slice(0, limit)` and call `runJobAction("move_to_ready", ids)`.
- Reuse `runJobAction` directly; do not add a second bulk-action implementation.

## Error handling and safety

- Server-side validation already rejects empty, oversized, and non-existent job IDs; cross-tenant job IDs are not returned by the scoped repository lookup.
- Errors are reported per job through the existing `JobActionResult` shape and surfaced in the progress toast; a stream-level error uses `showErrorToast`.
- No raw upstream bodies or large payloads are logged; existing structured logging applies.
- The button is disabled during an in-flight action to prevent overlapping batches.

## Tests

1. `BulkTailorPdfControl.test.tsx`: default value, clamping below 1 and above 500, disabled states, and the emitted limit.
2. `OrchestratorJobWorkspaceContainer.test.tsx` (or the closest existing container test): clicking the control calls `runJobAction` with exactly the first N discovered job IDs and does nothing on other tabs.
3. Targeted existing job-action tests to prove no regression.
4. Full CI-parity checks from `AGENTS.md`.

## Docs

Update the orchestrator/discovered-jobs user documentation with the new control, its defaults and limits, the fact that it processes the current filtered order, and that jobs move to Ready.

## Verification

- Targeted Vitest files for touched components.
- `./orchestrator/node_modules/.bin/biome ci --formatter-enabled=false .` (full Biome formatter has pre-existing Windows line-ending noise).
- `npm run check:types:shared`
- `npm --workspace orchestrator run check:types`
- `npm --workspace gradcracker-extractor run check:types`
- `npm --workspace ukvisajobs-extractor run check:types`
- `npm --workspace orchestrator run build:client`
- `npm --workspace orchestrator run test:run`
- `graphify update .`
