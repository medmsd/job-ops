# Tailoring Phase 4 Design — Derived Tailored-Fit Score

Date: 2026-11-23
Status: Approved (explicit-only trigger; feedback loop deferred)
Parent plan: `docs/plans/2026-11-22-tailoring-v2-plan.md`
Prior phase: `docs/plans/2026-11-22-tailoring-phase3-implementation.md`

## Why this exists

Phase 1 grounded tailoring suggestions in career evidence. Phase 2 made the evidence check reviewable. Phase 3 made the tailored CV a durable, approved, versioned artifact and made PDF rendering use exactly that artifact.

What is still missing is an answer to a simple question: **did tailoring actually improve the match for this job?** The existing `suitabilityScore` describes the source job against the global profile. It must remain candidate-independent in its job-fact portion and, by product decision, must not change when a tailored snapshot changes. Phase 4 adds a separate, explicitly labelled derived signal that measures the **approved tailored snapshot** against the job description.

## Scope

In scope:

1. A derived `tailoredFitScore` with structured notes.
2. Clear UI separation between source fit and tailored fit.
3. Explicit-only computation, with deterministic freshness reads that do not call AI.
4. Documentation and tests.

Out of scope for this phase:

- The roadmap feedback loop (interview/response tracking and adaptive weighting). It is deferred until an outcome signal exists.
- Any change to source suitability scoring, the Rescore action, or the candidate-independent job-fact review.
- Any automatic scoring on job open, tailoring open, snapshot approval/save/restore, PDF generation, email preview, or email apply.
- Editing the global Resume Studio baseline from the tailored editor.
- Snapshot creation or PDF generation behavior changes.

## Decisions (approved)

1. **Trigger:** explicit **Check tailored fit** button only. No AI or derived-score computation happens on open, approval, save, restore, PDF generation, or email preview. A deterministic `GET` may read stored state and freshness.
2. **Separation:** source `suitabilityScore` and the manual **Rescore** button remain unchanged. Tailored fit is always labelled **Derived tailored fit — job-specific**.
3. **Input artifact:** the score is computed from the current approved `tailored_resumes.resumeJson`, not from the global profile or in-memory tailoring draft.
4. **Method:** AI-assisted, evidence-constrained, with deterministic guardrails. The LLM proposes a score and notes; the server validates evidence references, caps unsupported/blocked claims, clamps the score, and never lets the model invent a new claim.
5. **Persistence:** derived fields live on the job row, together with the snapshot ID and an input hash, so job detail can show the stored result without loading a snapshot. The authoritative inputs remain the approved snapshot, job description, evidence bank, and profile.
6. **Freshness:** stored results are marked stale when the approved snapshot changes or when the input hash changes. The hash covers snapshot JSON, job description, evidence bank, and the profile fields used by the prompt. Staleness is deterministic and does not call AI.
7. **Evidence references:** refs are stable IDs, never display labels. Deleting or renaming a Resume Studio item does not rewrite history; old notes keep their original refs. Recomputing resolves refs, drops invalid ones, and reports them as stale/missing. No silent remapping.
8. **Availability:** any job with a job description and an approved snapshot can be scored. There is no status gate. Without either prerequisite the button is disabled and the UI explains why.
9. **Guardrails:** blocked terms cap the score at 40; unsupported JD terms cap it at 60; a "covered" note without a valid evidence ref is downgraded to "unsupported". Notes are capped at 12 and strings are truncated.
10. **Feedback loop:** deferred. No outcome tracking or adaptive weighting in this phase.

## Data model

Add these nullable columns to `jobs`:

| Column | Type | Notes |
| --- | --- | --- |
| `tailored_fit_score` | `REAL` | 0–100, null until computed |
| `tailored_fit_notes` | `TEXT` | JSON array of `TailoredFitNote`; null until computed |
| `tailored_fit_summary` | `TEXT` | Short explanation of the derived result |
| `tailored_fit_snapshot_id` | `TEXT` | Snapshot that produced the score |
| `tailored_fit_snapshot_version` | `INTEGER` | Display-friendly version provenance |
| `tailored_fit_input_hash` | `TEXT` | SHA-256 of canonical scored inputs |
| `tailored_fit_computed_at` | `INTEGER` | Epoch ms |
| `tailored_fit_model` | `TEXT` | Model used, for provenance |

Shared types are added in a new `shared/src/types/tailored-fit.ts` and exported from `shared/src/types/index.ts`:

```ts
export type TailoredFitNoteStatus =
  | "covered"
  | "partial"
  | "gap"
  | "unsupported";

export interface TailoredFitNote {
  requirement: string;
  status: TailoredFitNoteStatus;
  explanation: string;
  evidenceRefs: string[];
}

export interface TailoredFitResult {
  score: number;
  summary: string;
  notes: TailoredFitNote[];
  snapshotId: string;
  snapshotVersion: number;
  inputHash: string;
  computedAt: number;
  model: string | null;
}

export interface TailoredFitState {
  result: TailoredFitResult | null;
  isStale: boolean;
  reason:
    | "no_description"
    | "no_snapshot"
    | "not_checked"
    | "inputs_changed"
    | null;
}
```

`Job` gains the eight persisted fields, using `TailoredFitNote[] | null` for notes. `UpdateJobInput` gains matching optional fields for repository writes only. The fields are deliberately **not** added to the public `updateJobSchema`, so clients cannot manually overwrite a derived score through `PATCH /api/jobs/:id`.

## Inputs and hashing

The canonical scored input is a stable JSON object containing:

- approved snapshot `resumeJson`;
- `job.jobDescription`;
- the sanitized career evidence bank;
- the profile fields passed to the tailored-fit prompt.

A helper computes `sha256(stableStringify(input))`. The same helper is used by `GET` (staleness only) and `POST` (persistence), so a stored result is fresh exactly when the inputs are unchanged.

## Scoring service

Create `orchestrator/src/server/services/tailored-fit.ts`. Leave `scoreJobSuitability` in `scorer.ts` untouched.

Public functions:

- `getTailoredFitState(job: Job): Promise<TailoredFitState>` — deterministic; loads current snapshot, evidence bank, and profile; returns stored result plus staleness.
- `computeTailoredFit(job: Job): Promise<Job>` — explicit-only; loads inputs, calls the LLM, applies guardrails, writes derived fields via `jobsRepo.updateJob`, and returns the updated job.
- `buildTailoredFitInput(...)` / `hashTailoredFitInput(...)` — exported for tests.

The prompt is built from whitelisted, length-capped values: JD text, approved resume JSON text, a short snapshot change summary, the existing deterministic `ClaimCheckResult`, and `buildEvidencePromptBlock`. It must not include raw settings, tokens, or full profile dumps.

The LLM returns a JSON object matching a strict schema: `score`, `summary`, and up to 12 `notes` with `requirement`, `status`, `explanation`, and `evidenceRefs`.

Server-side guardrails:

1. Clamp score to `0–100`.
2. Validate refs with `resolveEvidenceRefs(bank, profile)`; drop invalid refs.
3. Downgrade `covered` notes without valid refs to `unsupported`.
4. Cap score at 40 when `checkTailoredClaims(...).blocked` is non-empty.
5. Cap score at 60 when `unsupported` claims or notes remain.
6. Truncate requirement/explanation strings.
7. Never write `suitabilityScore`, `suitabilityReason`, or `jobBrief`.

Follow `generateTailoringPlan` for model resolution, hosted usage reservation, and structured logging. Log only request ID, job ID, snapshot ID, score band, note counts, and model. Never log raw prompts or LLM bodies.

## API contract

All routes live in `orchestrator/src/server/api/routes/jobs/documents.ts` and use the standard `{ ok, data, meta.requestId }` envelope.

### `GET /api/jobs/:id/tailored-fit`

- Requires tenant-scoped job lookup.
- Returns `TailoredFitState`.
- No AI, no writes.

### `POST /api/jobs/:id/tailored-fit`

- Requires tenant-scoped job lookup, a non-empty JD, and an approved snapshot.
- Calls `computeTailoredFit`.
- Returns the hydrated `Job` so the client can reuse the existing `onJobUpdated` refresh path.
- Maps missing prerequisites to `400 INVALID_REQUEST` / `422 UNPROCESSABLE_ENTITY` consistently with neighbouring routes; upstream LLM failures use the existing `toJobsRouteError` mapping.

## UI

### `TailoringWorkspace.tsx`

- Add an explicit **Check tailored fit** button near **Approve snapshot** and **Generate PDF**.
- Button is disabled with an explanatory tooltip when there is no JD or no approved snapshot.
- On mount, call `GET /api/jobs/:id/tailored-fit` only. This is deterministic and never shows an AI-loading state.
- On click, call `POST /api/jobs/:id/tailored-fit`, then pass the returned `Job` to `onJobUpdated`.
- Show a labelled result panel: **Derived tailored fit — job-specific**, score, summary, note statuses, evidence refs, and a stale warning when `isStale`.
- Keep **Check evidence**, generation, approval, and PDF actions unchanged.

### `JobDetailPanel.tsx`

- Add a compact labelled tailored-fit readout beside the existing source score area, without changing `ScoreRing` labels.
- Reuse the same deterministic `GET` state so the value is passive and never triggers AI.
- Keep the existing **Recalculate match** / Rescore action exactly where it is and unchanged.

## Documentation

Update `docs-site/docs/features/orchestrator.md` with a new **Derived tailored fit** section using the project's feature-page structure:

1. What it is — a derived, job-specific score from the approved tailored snapshot.
2. Why it exists — source fit must not change when tailoring changes.
3. How to use it — approve a snapshot, press **Check tailored fit**, read labels/staleness.
4. Common problems — no snapshot, no JD, stale inputs, missing evidence refs, LLM unavailable.
5. Related pages — link to the tailoring and fit-assessment sections with `/docs/...` URLs.

Explicitly state that **Rescore** is for source fit, **Check tailored fit** is for the tailored artifact, neither runs on open, and neither sends email.

## Verification

Targeted:

- `orchestrator/src/server/services/tailored-fit.test.ts`
- `orchestrator/src/server/api/routes/jobs-tailored-fit.test.ts`
- repository mapping test for new job fields
- `TailoringWorkspace.test.tsx` and `JobDetailPanel.test.tsx`

CI parity from `AGENTS.md`:

1. `./orchestrator/node_modules/.bin/biome ci .`
2. `npm run check:types:shared`
3. `npm --workspace orchestrator run check:types`
4. `npm --workspace gradcracker-extractor run check:types`
5. `npm --workspace ukvisajobs-extractor run check:types`
6. `npm --workspace orchestrator run build:client`
7. `npm --workspace orchestrator run test:run`
8. `npm run docs:build`

Final:

- `graphify update .`
- `npm run docker:rebuild:kiri`
- Browser check: no AI call on open; only explicit **Check tailored fit** calls the POST route; source score unchanged; Rescore still visible; no email endpoint called.
- Push only to `fork`. `origin` must remain untouched at `7fac74f`.

## Open questions resolved

- **When should tailored fit run?** Explicit request only.
- **How should evidence refs survive item deletion/renaming?** Keep original IDs in history, drop invalid refs on recompute, mark stale via input hash, never silently remap.
- **Should the feedback loop be included now?** No; deferred until interview/response tracking exists.
