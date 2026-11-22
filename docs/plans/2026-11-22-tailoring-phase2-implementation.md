# Tailoring V2 — Phase 2 Implementation Plan

Date: 2026-11-22
Status: Ready to implement
Parent plan: `docs/plans/2026-11-22-tailoring-v2-plan.md`

## Scope

Phase 2 adds a tenant-scoped Global Career Evidence Bank and uses it to constrain every AI-generated claim, without adding a new database table or per-job snapshot artifact.

1. Add a structured `careerEvidence` setting (target roles, core skills with evidence refs, achievements, `alwaysInclude`, `neverClaim`, `preferredTerms`, `avoidTerms`) to the existing settings registry.
2. Add a Settings-only editor section with dangling-reference warnings computed from the Resume Studio catalog.
3. Add server helpers to load/sanitize the bank, resolve evidence refs against the profile catalog, and check generated text for unsupported claims and `neverClaim` violations.
4. Feed the bank into the tailoring and cover-letter prompts through configurable template placeholders.
5. Add an explicit **Check evidence** action that returns a Tailoring Plan (JD requirement → evidence → proposed wording) and an evidence/ATS report; surface it in the review layer with Accept / Edit / Reject and an acknowledgment gate before PDF generation.
6. Keep source suitability scoring candidate-independent and unchanged; never call AI on job open, tailoring open, or email preview.

No new database table is required: `settings` already stores tenant/user-scoped JSON values. No AI call happens on open or preview.

Decisions locked with the user:

- Unsupported claims: **warn + require explicit acknowledgment**; only `neverClaim` terms hard-block PDF generation.
- Evidence Bank location: **Settings only**.
- Evidence references: **stable IDs** with dangling-reference warnings (never hard-fail a save).

---

## Task 1 — Evidence Bank data model and settings plumbing

Files:

- `shared/src/types/settings.ts`
- `shared/src/settings-registry.ts`
- `shared/src/settings-schema.ts`
- `shared/src/testing/factories.ts`
- `orchestrator/src/server/services/settings-update/registry.ts`
- `orchestrator/src/server/api/routes/settings.test.ts`

### Changes

1. In `shared/src/types/settings.ts`, export the bank types:

   - `CareerEvidenceCoreSkill`: `name`, `years: number | null`, `level`, `evidence: string[]`, `aliases: string[]`.
   - `CareerEvidenceAchievement`: `text`, `evidence: string[]`, `metric`.
   - `CareerEvidenceBank`: `targetRoles: string[]`, `coreSkills: CareerEvidenceCoreSkill[]`, `achievements: CareerEvidenceAchievement[]`, `alwaysInclude: string[]`, `neverClaim: string[]`, `preferredTerms: string[]`, `avoidTerms: string[]`.
   - Add `careerEvidence: Resolved<CareerEvidenceBank>` to `AppSettings` beside `resumeProjects`.

2. In `shared/src/settings-registry.ts`, add a strict zod `careerEvidenceSchema` with bounded arrays/strings, a `default()` returning an empty bank, `parse()` from JSON with schema validation, and `serialize()` to JSON. Register `careerEvidence` as a `typed` setting exactly like `resumeProjects`.

3. `updateSettingsSchema` derives from the registry automatically — no direct edit to `shared/src/settings-schema.ts` other than re-exporting the new schema for UI/tests if needed.

4. In `shared/src/testing/factories.ts`, add the empty-bank default to `createAppSettings()`.

5. In `orchestrator/src/server/services/settings-update/registry.ts`, add a dedicated handler for `careerEvidence` that JSON-stringifies a validated value (reusing the registry serializer) so malformed input cannot reach storage. No PDF cache invalidation is needed because the bank affects future AI output, not already-rendered PDFs.

6. Extend `orchestrator/src/server/api/routes/settings.test.ts`:
   - GET returns the empty default bank.
   - PATCH persists a bank override and reads it back.
   - Invalid bank payload returns `400 INVALID_REQUEST`.

Commit: `feat(evidence): add tenant-scoped career evidence bank setting`.

---

## Task 2 — Settings UI editor

Files:

- `orchestrator/src/client/pages/settings/types.ts`
- `orchestrator/src/client/pages/SettingsPage.tsx`
- `orchestrator/src/client/pages/settings/components/CareerEvidenceSection.tsx` (new)
- `orchestrator/src/client/pages/settings/components/CareerEvidenceSection.test.tsx` (new)
- `docs-site/docs/features/settings.md`

### Changes

1. Add `CareerEvidenceValues = EffectiveDefault<CareerEvidenceBank>` to `pages/settings/types.ts`.

2. Add a `Career` nav group with section id `career-evidence`, label `Career Evidence`, description and search terms (`evidence`, `claims`, `skills`, `achievements`, `ATS`, `never claim`). Add the section to `SECTION_FIELD_MAP`, the settings form→values mapping, and the render switch.

3. Build `CareerEvidenceSection` following `ScoringSettingsSection`/`PromptTemplatesSection`:

   - Editable lists for target roles, core skills (name, years, level, aliases, evidence refs), achievements (text, metric, evidence refs), and the four term lists.
   - Add/remove row controls; all inputs bound to `react-hook-form` via `Controller`.
   - Show the effective default as a hint and allow "Reset to default".
   - Show a **dangling evidence reference** warning for any ref that is not in the Resume Studio catalog (`profileProjects`) or a known achievement ref; never block saving.

4. Tests cover: rendering seeded values, adding/removing rows, dangling-ref warning, and no AI call on section open.

Commit: `feat(settings): add Career Evidence Bank editor`.

---

## Task 3 — Evidence service: sanitize, resolve refs, and check claims

Files:

- `orchestrator/src/server/services/careerEvidence.ts` (new)
- `orchestrator/src/server/services/careerEvidence.test.ts` (new)
- `shared/src/types/career-evidence.ts` (new, shared report types)

### Changes

1. Export `getCareerEvidenceBank()` reading `settingsRepo.getSetting("careerEvidence")`, parsing through the registry schema, and falling back to the default bank.

2. Export `buildEvidencePromptBlock(bank, profile)` returning a whitelisted, length-capped JSON object: target roles, core skills (with evidence refs and aliases), achievements, alwaysInclude/neverClaim/preferred/avoid terms, and `danglingRefs` computed against `profile.sections.projects.items` and `experience.items` ids.

3. Export `checkTailoredClaims({ bank, text, jobDescription })` returning:

   - `blocked: string[]` — `neverClaim` terms found (case-insensitive, word-boundary).
   - `unsupported: string[]` — JD/alwaysInclude terms present in text with no matching bank skill/achievement/alias or profile fact.
   - `covered: string[]` — JD terms present in text and supported by evidence.
   - `missingEvidenceRefs: string[]` — ref IDs that no longer resolve.

   Use a small deterministic token/phrase matcher (no AI). Cap output sizes.

4. Tests: neverClaim detection, supported vs unsupported terms, aliases, dangling refs, and empty-bank behavior (warn only, never vacuously "all supported").

Commit: `feat(evidence): add deterministic claim and evidence checks`.

---

## Task 4 — Prompt integration

Files:

- `shared/src/prompt-template-definitions.ts`
- `orchestrator/src/server/services/summary.ts`
- `orchestrator/src/server/services/summary.test.ts`
- `orchestrator/src/server/services/post-application/recruiter-email.ts`
- `orchestrator/src/server/services/post-application/recruiter-email.test.ts`

### Changes

1. Add placeholders `evidenceBankJson` and `evidenceRulesBullet` to `tailoringPromptTemplate.placeholders` and to the default template:

   - New section `CAREER EVIDENCE BANK (approved facts only): {{evidenceBankJson}}`.
   - Rule: `Reorder and rephrase only facts present in the bank or profile. Do not add skills, years, metrics, tools, or seniority that lack an evidence reference. Terms in "neverClaim" must never appear.`
   - Add `{{evidenceRulesBullet}}` after the grounding section.

2. In `summary.ts`, load the evidence bank and pass `evidenceBankJson: JSON.stringify(buildEvidencePromptBlock(bank, profile))` and `evidenceRulesBullet: "Never use any term listed in neverClaim."`. Keep all existing whitelisting and truncation.

3. In `recruiter-email.ts`, append a compact, whitelisted evidence block to the cover-letter facts: target roles, allowed skills, and `neverClaim` terms. Do not pass raw profile JSON or full evidence notes. Preserve the "use only supplied facts / do not invent" instruction.

4. Tests assert the evidence block appears in prompts, `neverClaim` is included as a prohibition, custom prompt templates still render without the new tokens left literal only when the user includes them, and cover-letter facts stay free of raw HTML/large blobs.

Commit: `feat(prompts): ground tailoring and cover letters in evidence bank`.

---

## Task 5 — Tailoring Plan, review UI, and PDF acknowledgment gate

Files:

- `shared/src/types/career-evidence.ts`
- `orchestrator/src/server/services/tailoring-plan.ts` (new)
- `orchestrator/src/server/services/tailoring-plan.test.ts` (new)
- `orchestrator/src/server/api/routes/jobs/tailoring-plan.ts` (new route module and registration)
- `orchestrator/src/client/api/index.ts`
- `orchestrator/src/client/components/tailoring/TailoringWorkspace.tsx`
- `orchestrator/src/client/components/tailoring/TailoringSections.tsx`
- `orchestrator/src/client/components/tailoring/TailoringSections.review.test.tsx`
- `orchestrator/src/client/components/tailoring/TailoringWorkspace.test.tsx`
- `docs-site/docs/features/orchestrator.md`

### Changes

1. Define `TailoringPlanItem` (`jdRequirement`, `evidenceRefs`, `proposedWording`, `supportLevel`, `status`, `userDecision`) and `TailoringPlanResult` in shared types.

2. Add `generateTailoringPlan(jobDescription, bank, profile)` using the `"tailoring"` LLM purpose only on an explicit call. Return strictly validated plan items capped at 12; every `evidenceRefs` entry is checked against the bank/profile and unsupported items are marked `unsupported`. No AI on open or preview.

3. Add `POST /api/jobs/:id/tailoring-plan` (explicit action) returning the standard `{ ok, data, meta.requestId }` contract, honoring `x-request-id`, with `400 INVALID_REQUEST` when the job description is empty. Log via `infra/logger` with `jobId`/`requestId`. Tenant scope comes from the existing jobs repository.

4. Client: add `getTailoringPlan(jobId)` to the API client. Add an explicit **Check evidence** button in the tailoring workspace (disabled while generating/empty description) that loads the plan and a claim report for the current summary/headline/skills.

5. Review UI: render plan items with **Accept** (apply proposed wording to the relevant field), **Edit** (inline textarea that updates `proposedWording`), and **Reject** (dismiss). Reuse the existing suggestion state machinery — plan items are suggestions with an evidence explanation, never silent writes. Show `neverClaim` blockers prominently.

6. PDF gate: when blockers or unsupported claims exist, show a warning panel with an acknowledgment checkbox. PDF regeneration stays disabled until the user checks it; `neverClaim` blockers cannot be acknowledged away. Clear acknowledgment when the text changes. Keep the existing `canGeneratePdf` readiness helper as the base condition.

7. Tests: explicit action only (no call on open), Accept/Edit/Reject wiring, blocker cannot be acknowledged, acknowledgment resets on text change, API error contract, and cross-tenant `404`.

Commit: `feat(tailoring): add evidence-backed plan review and PDF gate`.

---

## Task 6 — Documentation and verification

Files:

- `docs-site/docs/features/orchestrator.md`
- `docs-site/docs/features/settings.md`

### Changes

1. Document the Evidence Bank, how to add evidence refs, dangling-ref warnings, the Check evidence action, Accept/Edit/Reject, and the PDF acknowledgment gate. Use the required feature-page structure and frontmatter.

2. Run targeted tests first, then the full CI-parity list from `AGENTS.md`:

   - `./orchestrator/node_modules/.bin/biome ci --formatter-enabled=false .` (formatter-only pre-existing CRLF noise is the documented workaround)
   - `npm run check:types:shared`
   - `npm --workspace orchestrator run check:types`
   - `npm --workspace gradcracker-extractor run check:types`
   - `npm --workspace ukvisajobs-extractor run check:types`
   - `npm --workspace orchestrator run build:client`
   - `npm --workspace orchestrator run test:run`
   - `npm --workspace docs-site run docs:build`

3. Produce a `comprehension-check` walkthrough before any commit, then commit each task separately and push only to `fork/main`.

Commit: `docs: document evidence-backed tailoring workflow`.

---

## Out of scope for Phase 2

- `tailored_resumes` table/version history (Phase 3).
- Tailored-fit score (Phase 4).
- Changes to source suitability scoring or `NON_SOURCE_JOB_FIELDS`.
- Any automatic AI call on job open, tailoring open, or email preview.
