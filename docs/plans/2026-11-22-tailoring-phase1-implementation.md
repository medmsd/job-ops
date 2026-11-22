# Tailoring V2 — Phase 1 Implementation Plan

Date: 2026-11-22
Status: Ready to implement
Parent plan: `docs/plans/2026-11-22-tailoring-v2-plan.md`

## Scope

Phase 1 improves tailoring quality and trust without adding a new data model:

1. Pass structured job facts and per-job notes into the tailoring prompt.
2. Fix the missing-skills regeneration gap.
3. Preserve manual edits on regeneration by storing AI output as a reviewable suggestion instead of silently overwriting edited fields.
4. Add a review layer with original baseline, current value, and AI suggestion plus Accept / Keep mine / Undo to original actions.
5. Unify readiness checks behind one helper used by the tailoring workspace, application kit, and job sidebar.
6. Surface effective global writing rules inside the tailoring panel.

No new API endpoints or database columns are required.

---

## Task 1 — Extend tailoring service input contract

Files:

- `orchestrator/src/server/services/summary.ts`
- `orchestrator/src/server/services/summary.test.ts`

### Changes

Add exported types:

```ts
export interface TailoringApprovedContext {
  summary?: string | null;
  headline?: string | null;
  skills?: TailoredData["skills"] | null;
}

export interface TailoringJobContext {
  title?: string | null;
  employer?: string | null;
  location?: string | null;
  jobBrief?: string | null;
  suitabilityReason?: string | null;
  degreeRequired?: string | null;
  disciplines?: string | null;
  notes?: readonly string[] | null;
  approved?: TailoringApprovedContext | null;
}
```

Change signature to:

```ts
export async function generateTailoring(
  jobDescription: string,
  profile: ResumeProfile,
  context: TailoringJobContext = {},
): Promise<TailoringResult>
```

Keep `generateSummary()` working by calling the new third argument with `{}`.

Add `buildTailoringContext()` inside `summary.ts` that:

- trims strings;
- strips HTML from `jobBrief`, `suitabilityReason`, notes, and approved text;
- caps each note at 600 characters and the notes list at 10 entries;
- caps `jobBrief` at 2,000 characters and `suitabilityReason` at 800 characters;
- omits empty values;
- returns a plain object safe for `JSON.stringify`.

Pass these new values through `renderPromptTemplate`:

- `structuredJobContextJson`
- `approvedContextJson`

Update `buildTailoringPrompt()` to accept `context`.

Replace raw logging of `result.data` with a structured warning:

```ts
logger.warn("AI response missing required tailoring fields", {
  hasSummary: Boolean(summary),
  hasHeadline: Boolean(headline),
  skillsIsArray: Array.isArray(skills),
});
```

### Tests

Add tests in `summary.test.ts`:

- prompt contains structured job facts (`title`, `employer`, `location`, `degreeRequired`, `disciplines`, `jobBrief`, `suitabilityReason`, notes);
- excluded/empty values are omitted;
- approved context is passed into the prompt;
- long notes/jobBrief are truncated;
- HTML is stripped from context values;
- `generateSummary()` still works.

Run: `npm --workspace orchestrator exec vitest run src/server/services/summary.test.ts`

---

## Task 2 — Update default tailoring prompt

Files:

- `shared/src/prompt-template-definitions.ts`
- `orchestrator/src/server/services/summary.test.ts`

### Changes

Add to `tailoringPromptTemplate.placeholders`:

- `structuredJobContextJson`
- `approvedContextJson`

Add a new section after `MY PROFILE`:

```text
STRUCTURED JOB FACTS:
{{structuredJobContextJson}}

CURRENT APPROVED TAILORING CONTEXT:
{{approvedContextJson}}
```

Change the skills instruction from “Keyword Stuffing” to evidence-bound alignment:

```text
Keyword alignment: prefer exact JD terms only when the profile or approved context supports the underlying skill. Reorder and rephrase supported skills; do not invent tools, years, metrics, levels, or seniority.
```

Add instructions that approved context should be preserved unless the JD clearly requires a different emphasis.

### Tests

Update existing prompt assertions that expect the old “Keyword Stuffing” wording if any. Add an assertion that the default prompt contains evidence-bound alignment wording.

Run: `npm run check:types:shared` and the summary test file.

---

## Task 3 — Wire structured context into `summarizeJob()`

Files:

- `orchestrator/src/server/pipeline/orchestrator.ts`
- `orchestrator/src/server/pipeline/orchestrator.test.ts` (or the closest summarizeJob test file; create if absent)
- `orchestrator/src/server/tailoring-flow.test.ts` if summarizeJob is covered there

### Changes

In `summarizeJob()`:

1. Load notes only when tailoring will run:

```ts
const jobNotes = shouldGenerateTailoring
  ? await jobsRepo.listJobNotes(jobId)
  : [];
```

2. Parse `tailoredSkills` safely for approved context. Add a small local helper that returns `[]` on malformed JSON rather than throwing.

3. Build the context:

```ts
const tailoringContext: TailoringJobContext = {
  title: job.title,
  employer: job.employer,
  location: job.location,
  jobBrief: job.jobBrief,
  suitabilityReason: job.suitabilityReason,
  degreeRequired: job.degreeRequired,
  disciplines: job.disciplines,
  notes: jobNotes.map((note) => `${note.title}: ${note.content}`),
  approved: {
    summary: tailoredSummary,
    headline: tailoredHeadline,
    skills: parseApprovedSkills(tailoredSkills),
  },
};
```

4. Pass it to `generateTailoring(job.jobDescription || "", profile, tailoringContext)`.

5. Fix the regeneration gap by including skills in the skip condition:

```ts
const hasAllTailoringFields = Boolean(
  tailoredSummary && tailoredHeadline && tailoredSkills?.trim(),
);
if (shouldGenerateTailoring && (!hasAllTailoringFields || options?.force)) {
  ...
}
```

6. Keep failure behavior unchanged: failure is fatal only for force or for requested fields currently missing.

### Tests

Add pipeline tests that mock `generateTailoring` and assert:

- structured job facts and notes are passed;
- malformed stored skills do not throw and pass `skills: []`;
- with existing summary+headline but empty skills, tailoring runs;
- with all fields present and no force, tailoring does not run.

Run targeted orchestrator/pipeline tests.

---

## Task 4 — Add shared tailoring readiness helper

Files:

- `orchestrator/src/client/components/tailoring/rules.ts`
- `orchestrator/src/client/components/tailoring/rules.test.ts`

### Changes

Keep `canFinalizeTailoring(summary)` for backwards compatibility.

Add:

```ts
export interface TailoringReadinessInput {
  summary?: string | null;
  headline?: string | null;
  skillsJson?: string | null;
  jobDescription?: string | null;
  selectedProjectIds?: string | null;
  pdfFreshness?: JobPdfFreshness | null;
  pdfRegenerating?: boolean | null;
  projectsAreLoading?: boolean;
}

export interface TailoringCheck {
  id: "jobDescription" | "summary" | "headline" | "skills" | "projects" | "pdf";
  label: string;
  ready: boolean;
  detail?: string;
}

export function getTailoringReadiness(input): {
  checks: TailoringCheck[];
  readyCount: number;
  totalCount: number;
  isReady: boolean;
  canGeneratePdf: boolean;
  missingLabels: string[];
}
```

Rules:

- `jobDescription`: non-empty `jobDescription`.
- `summary`: non-empty trimmed summary.
- `headline`: non-empty trimmed headline.
- `skills`: at least one valid skill group from `parseTailoredSkills()`.
- `projects`: selectedProjectIds has at least one id OR `projectsAreLoading === true` (treated as pending, not failed).
- `pdf`: pdfFreshness is `current` or `uploaded`, and not regenerating.
- `canGeneratePdf` requires only summary + headline + skills, matching current PDF capability.

Note: importing `parseTailoredSkills` from `../tailoring-utils` is acceptable; keep `rules.ts` client-only.

### Tests

Expand `rules.test.ts` with cases for each check and `canGeneratePdf`.

Run: `npm --workspace orchestrator exec vitest run src/client/components/tailoring/rules.test.ts`

---

## Task 5 — Use readiness helper in workspace, application kit, and job sidebar

Files:

- `orchestrator/src/client/components/tailoring/TailoringWorkspace.tsx`
- `orchestrator/src/client/pages/orchestrator/JobDetailPanel.tsx`
- `orchestrator/src/client/pages/job-page/JobPageRightSidebar.tsx`
- relevant test files

### Changes

In `TailoringWorkspace`:

- replace local `isDraftReady` with `readiness.canGeneratePdf`;
- show status `Draft ready` / `Draft incomplete` using the same helper;
- show missing labels from `readiness.missingLabels` in the subtitle;
- disable Generate PDF when `!readiness.canGeneratePdf`;
- keep Generate all enabled while optional sections are incomplete.

In `JobDetailPanel`:

- replace `applicationKitReady = hasTailoredSummary && hasTailoredSkills && hasResumePdf` with `getTailoringReadiness({...}).isReady`;
- pass the same `checks` to `KitStatus` rows so labels and ready states match;
- include Selected projects and PDF freshness in the kit;
- keep `Apply now` gated only by PDF availability because email sending does not require every optional section.

In `JobPageRightSidebar`:

- use the same helper for any tailoring readiness label or disabled reason;
- do not change Apply now gating beyond what was already approved.

### Tests

Update existing tests that assert old banner copy or application-kit readiness. Add a test that a stale PDF is reported by the shared checklist.

Run targeted client component tests.

---

## Task 6 — Preserve manual edits and add review suggestions

Files:

- `orchestrator/src/client/components/tailoring/TailoringWorkspace.tsx`
- `orchestrator/src/client/components/tailoring/TailoringSections.tsx`
- `orchestrator/src/client/components/tailoring/TailoringWorkspace.test.tsx`
- `orchestrator/src/client/components/tailoring/TailoringSections.test.ts` (or new review test file)

### State

Add to `TailoringWorkspace`:

```ts
type TailoringReviewKey = "summary" | "headline" | "skills";

interface TailoringSuggestion {
  current: string;
  suggested: string;
  label: string;
}

type TailoringSuggestions = Partial<Record<TailoringReviewKey, TailoringSuggestion>>;

const [suggestions, setSuggestions] = useState<TailoringSuggestions>({});
```

### Generate flow

In `handleGenerateTailoring(target)`:

1. Capture `beforeGeneration = { summary, headline, skillsJson }` and `manuallyEdited` by comparing each field with `aiBaseline`.
2. Call `api.summarizeJob(...)` as today.
3. Compute `aiDraft = toBaselineFromJob(updatedJob)`.
4. For each requested field:
   - if manually edited, keep the current value and set `suggestions[field] = { current: before[field], suggested: aiDraft[field], label }`;
   - otherwise apply the AI value to the draft.
5. Set `aiBaseline` to `aiDraft`.
6. Do not clear unrelated pending suggestions when generating a single section.
7. Toast success as today, but append “Review suggestions” when any were kept.

If target is `all`, fields are summary/headline/skills. Projects are unaffected.

### Review UI

Add props to `TailoringSections`:

```ts
suggestions: TailoringSuggestions;
originalBaseline: TailoringBaseline;
onAcceptSuggestion: (key: TailoringReviewKey) => void;
onKeepCurrentSuggestion: (key: TailoringReviewKey) => void;
```

Render a new accordion item `value="review"` after Headline and before Skills, only when at least one suggestion exists:

- title `Review AI suggestions`;
- state `review`;
- for each suggestion show:
  - label;
  - `Your version` excerpt (first 240 chars);
  - `AI suggestion` excerpt (first 240 chars);
  - `Use AI draft` button;
  - `Keep mine` button.
- Add a small helper line: “Manual edits are kept. AI wording is shown here until you accept it.”
- Buttons disabled while `disableInputs`.

Add a separate always-visible accordion item `value="baseline"` after Review (or after Skills when no suggestions) showing:

- Original summary excerpt;
- Original headline;
- Original skill category names;
- Current values excerpt;
- copy: “Compared with the Resume Studio baseline. This is for review only; edit fields above.”

`onAcceptSuggestion` applies the suggested value to the field and removes the suggestion.
`onKeepCurrentSuggestion` removes the suggestion without changing the value.

### Tests

- A manual-edited summary is unchanged after Generate all, and a review suggestion appears.
- Clicking `Use AI draft` applies the AI summary.
- Clicking `Keep mine` dismisses the suggestion and leaves the manual summary.
- A non-edited field still updates immediately.
- Review panel never triggers AI by itself.

Run targeted client tests.

---

## Task 7 — Surface effective global writing rules

Files:

- `orchestrator/src/client/components/tailoring/TailoringWorkspace.tsx`
- `orchestrator/src/client/components/tailoring/TailoringWorkspace.test.tsx` or new test

### Changes

Add a compact collapsed panel near the status banner:

```tsx
<TailoringRulesStrip
  language={...}
  tone={settings?.chatStyleTone.value}
  formality={settings?.chatStyleFormality.value}
  constraints={settings?.chatStyleConstraints.value}
  doNotUse={settings?.chatStyleDoNotUse.value}
  summaryMaxWords={settings?.chatStyleSummaryMaxWords.value}
  maxKeywordsPerSkill={settings?.chatStyleMaxKeywordsPerSkill.value}
  isLoading={isSettingsLoading}
/>
```

Implement `TailoringRulesStrip` in the same file or a small local component file under `orchestrator/src/client/components/tailoring/`.

Behavior:

- show `Loading tailoring rules...` while settings load;
- show `Default rules` when settings are unavailable;
- show language from `chatStyleLanguageMode.value === "match-job-description" ? "Match job description" : chatStyleManualLanguage.value`;
- show constraints/do-not-use only when non-empty;
- include a link to `/settings` labelled `Edit in Settings`.

### Tests

Render with mocked settings and assert the effective values are visible. Assert no AI API is called on render.

---

## Task 8 — Update docs

Files:

- `docs-site/docs/features/orchestrator.md`
- possibly `docs-site/docs/features/design-resume.md` if readiness wording changes there

### Changes

Document:

- tailoring now receives structured job facts and notes;
- manual edits are kept on regeneration and AI wording appears as a review suggestion;
- review panel compares with Resume Studio baseline;
- readiness checklist is shared across tailoring, application kit, and job page;
- global writing rules are visible in the tailoring panel.

Keep the existing feature-page structure and frontmatter.

---

## Commit strategy

1. `feat(tailoring): pass structured job context into prompts`
2. `feat(tailoring): preserve manual edits with review suggestions`
3. `feat(tailoring): unify readiness and show writing rules`
4. `docs: describe tailoring review workflow`

Commit each task only after its targeted tests pass.

## Verification

After all tasks:

1. `./orchestrator/node_modules/.bin/biome ci .` (note pre-existing CRLF issues on untouched files; touched files must be clean)
2. `npm run check:types:shared`
3. `npm --workspace orchestrator run check:types`
4. `npm --workspace gradcracker-extractor run check:types`
5. `npm --workspace ukvisajobs-extractor run check:types`
6. `npm --workspace orchestrator run build:client`
7. `npm --workspace orchestrator run test:run`
8. `npm run docs:build`
9. `npm run docker:rebuild:kiri`
10. Browser check at `http://localhost:3005`:
    - opening a job/tailoring calls no AI endpoint;
    - existing manual edits survive Generate all;
    - review panel offers Use AI draft / Keep mine;
    - readiness labels match across tailoring and application kit;
    - global writing rules are visible;
    - no email is sent.

Push only to `fork/main`; leave `origin/main` untouched.
