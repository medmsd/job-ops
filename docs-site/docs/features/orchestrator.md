---
id: orchestrator
title: Orchestrator
description: Job states, ready flow, and PDF generation/regeneration behavior.
sidebar_position: 1
---

## What it is

The Orchestrator is the primary jobs workspace in JobOps.

![Orchestrator jobs workspace](/img/features/orchestrator-jobs.png)

It controls:

- job lifecycle states
- manual and automatic ready flow
- PDF generation and regeneration
- job-level titled markdown notes on the dedicated job page
- handoff to post-application tracking

Job states:

- `discovered`: found by crawler/import, not tailored yet
- `processing`: tailoring and/or PDF generation in progress
- `ready`: tailored PDF generated and ready to apply
- `applied`: marked as applied
- `skipped`: explicitly excluded from active queue
- `expired`: deadline passed

## Why it exists

Orchestrator centralizes the transition from discovered opportunities to application-ready artifacts.

It exists to ensure:

- a consistent path from discovery to tailored output
- clear status transitions across manual and automated workflows
- predictable regeneration behavior when job data changes
- a place to keep application-specific answers, interview contacts, and general reminders close to the job
- visibility when a reposted role looks like a job you already applied to, even if the URL changed
- faster external research from the Ready tab with prebuilt search links for LinkedIn, GitHub, and broader web results
- one place to filter and sort jobs across every orchestrator tab

## How to use it

### Find opportunities or add an existing job

- Select **Find jobs** to describe a search or enter its criteria, review the existing configuration form, then select **Run search**.
- Select **Add a job** to import a link, description, or PDF you already have.

See [Find jobs](/docs/next/features/pipeline-run) for the search review flow.

### Intended ready flow

1. Manual flow:
   1. Job starts in `discovered`.
   2. Open the job and choose Tailor.
   3. Edit JD/tailored fields/project picks.
   4. Click **Finalize & Move to Ready**.
2. Auto flow:
   1. Pipeline scores discovered jobs.
   2. Top jobs above threshold are auto-processed.
   3. Jobs move directly to `ready` with generated PDFs.

Fit scores are stored with each job. Opening a job (including old jobs) only
reads the stored score and does not call the AI. After you update your CV or
tailoring, use the **Rescore** button in the job page actions to recalculate
that job's score explicitly.

When you select a job, the detail panel shows the available title, employer,
status, and listing information immediately. A loading skeleton fills the
remaining detail area until the full job arrives. If that request fails, use
**Retry** in the panel; actions that require full details stay unavailable.

### Using the Filters panel

The main jobs page has a `Filters` button on the top-right next to `Search`.

Use it when you need to narrow the current tab without changing tabs.

What the panel includes:

- source filters
- sponsor status filters
- salary filters
- date filters
- sorting controls

Job rows and the detail header can also show a `Previously Applied` warning when JobOps finds a high-confidence fuzzy match against one of your past applied or in-progress jobs using title and company, not just URL dedupe. To avoid flagging genuinely new openings, JobOps only shows this warning when the matched historical application falls within 30 days of the current job's discovery date.

Date filters work on every jobs tab:

- `Ready`
- `Discovered`
- `All Jobs`

Available date dimensions:

- `Ready`
- `Applied`
- `Closed`
- `Discovered`

Each selected date dimension uses the same range:

- quick presets: `7`, `14`, `30`, `90` days
- custom `Start date` and `End date`

Jobs match when they fit the current tab and at least one selected date dimension falls in range.

### Sorting by date

The sort section includes `Sort by Date`.

Use it with:

- `Most recent`
- `Least recent`

Date sorting follows the active date-filter context. If multiple date dimensions are enabled, JobOps uses this priority:

1. `Ready`
2. `Applied`
3. `Closed`
4. `Discovered`

If a job does not have the first selected timestamp, JobOps falls back to the next available date in that order.

### Ghostwriter availability

Ghostwriter is available in `discovered` and `ready` job views.

For details, see [Ghostwriter](/docs/next/features/ghostwriter).

### Job notes

The dedicated job page includes a full-width `Notes` section below the stage timeline and job details area.

Use it for things like:

- answers to application questions, such as why you want the role or how your experience fits
- notes about recruiters, hiring managers, and interviewers
- reminders, follow-ups, and other job-specific context you want to keep with the application

Each note has a title and a markdown body. The section shows a notes list on the left and a full TipTap editor on the right when you click **Edit** or **Add note**.

To use it:

1. Open a job in the dedicated job page.
2. Scroll below the stage timeline and application details cards to the `Notes` section.
3. Click **Add note** or **Edit** on an existing note.
4. Use the TipTap editor on the right to enter a title and write the note body.
5. Save the note, then edit or delete it later from the same section if needed.

The saved view renders markdown by default, so links, lists, headings, and emphasis stay readable without leaving the job page.

### Ready tab search links

In the `ready` view, JobOps can show prebuilt search links based on the current job's employer, title, and skills.

This enables you to:

- quickly open Google searches for likely LinkedIn profiles tied to the company and target skills
- search GitHub for matching public profiles or repositories without rewriting the query yourself
- run a broader web search to gather context before applying

Open the **search links** row in the Ready summary to reveal the generated links.

### Opening documentation from the sidebar

1. Open the sidebar menu.
2. In the footer section under `Version vX.Y.Z`, click **Documentation**, which opens the locally hosted docs in a new tab.

### Tailoring review workflow

Open a job's **Tailoring** tab to review its job-specific CV fields.

What it is:

- **Summary**, **Headline**, and **Tailored Skills** are editable fields for this job.
- **Generate all** uses AI only when you explicitly click it; opening a job or tailoring panel never calls AI.
- AI receives structured job facts (title, employer, location, parsed job brief, suitability reason, degree/disciplines, and job notes) plus your current approved tailoring values and the **Career Evidence Bank** from **Settings → Career Evidence Bank**. This keeps wording grounded in the role and your approved evidence.
- The **Evidence review** panel maps job-description requirements to approved evidence. It only runs when you click **Check evidence**, and its suggestions are advisory until you accept, edit, or reject them.
- The effective writing rules from **Settings → Writing Style & Language** appear in the panel with an **Edit in Settings** link.

Why it exists:

- Manual edits stay authoritative. Regeneration keeps edited fields unchanged and shows the AI wording as a suggestion instead of silently replacing your text.
- The **Review AI suggestions** panel shows your version beside the AI version, with **Use AI draft**, **Keep mine**, and **Undo to original** actions.
- The **Evidence review** panel prevents invented claims. Each item shows the job requirement, the evidence references behind it, a support level (**strong**, **partial**, or **unsupported**), and proposed wording. Nothing is applied until you choose **Accept**, **Edit**, or **Reject**.
- Unsupported terms have no approved evidence and require an explicit acknowledgment before **Generate PDF** is enabled. Terms in the evidence bank's **neverClaim** list are hard-blocked: they cannot be acknowledged away and must be removed from the CV text.
- Changing the CV after a check marks the result stale; you must run **Check evidence** again before generating a PDF.
- The **Resume Studio baseline** panel shows the original summary, headline, and skill categories for comparison. It is read-only.
- One readiness checklist is shared by the tailoring workspace, the application kit, and the job page. It checks job description, summary, headline, skills, selected projects, and PDF freshness.

How to use it:

1. Open the job and select **Tailoring**.
2. Edit fields directly, or click **Generate** on a section / **Generate all**.
3. If a field was manually edited, open **Review AI suggestions**.
   1. Choose **Use AI draft** to accept the suggested wording.
   2. Choose **Keep mine** to dismiss the suggestion without changing the field.
   3. Choose **Undo to original** to restore the Resume Studio value.
4. Open **Evidence review** and click **Check evidence** to map job requirements to your approved evidence. This calls AI only on this explicit action.
   1. For each item, review the support level and evidence references.
   2. Choose **Accept** to apply the proposed wording to its target field, **Edit** to change it first, or **Reject** to dismiss it.
5. If the evidence check flags unsupported terms, read them carefully. Check the acknowledgment box only if you can personally verify those claims. Hard-blocked **neverClaim** terms must be removed from the CV text instead.
6. Check the readiness banner before selecting **Generate PDF**.
7. Use **Preview PDF** to inspect the rendered CV.

Common problems:

- **AI wording did not replace my edit.** This is intentional. Open **Review AI suggestions** and choose **Use AI draft** if you want it.
- **Generate PDF is disabled after an evidence check.** Unsupported terms need the acknowledgment checkbox. Hard-blocked **neverClaim** terms must be removed from the CV text and the check run again.
- **The app says the CV changed after the evidence check.** Any edit to summary, headline, or skills invalidates the check. Click **Check evidence** again.
- **A requirement shows as unsupported.** It has no matching entry in your approved evidence. Add verified facts in **Settings → Career Evidence Bank**, or reject the item. Do not accept wording for claims you cannot support.
- **The app says the PDF is stale.** Regenerate the PDF after changing the JD, tailoring fields, or selected projects.
- **Writing rules look different than expected.** Open **Settings → Writing Style & Language** from the rules strip; the panel shows effective values, not just overrides.

Related pages:

- [Design Resume](/docs/next/features/design-resume)
- [Settings](/docs/next/features/settings)
- [Ghostwriter](/docs/next/features/ghostwriter)

### Tailored CV snapshots

What it is:

- A tailored CV snapshot is a durable, versioned copy of your per-job CV, built from the Resume Studio baseline plus the current summary, headline, tailored skills, and selected projects.
- Each job keeps its own snapshot history. The newest 10 approved versions are retained.
- Snapshots are tenant- and user-scoped; one job's CV is never visible to another workspace.

Why it exists:

- PDFs must render exactly the text you approved. Before snapshots, tailoring happened in memory at PDF time with no durable artifact and no history.
- Approval makes the CV explicit: no snapshot is created by opening a job, editing a field, previewing an email, or generating a PDF.
- Version history lets you compare what changed and return to an earlier CV without losing later versions.

How to use it:

1. Open the job's **Tailoring** tab and finish the summary, headline, and skills. A job description is required.
2. Click **Approve snapshot** (or **Update snapshot** for later versions). This creates a new version and does not call AI.
3. Click **Open full tailored CV** to edit basics, summary, skills, and item sections. **Save edits** creates a new version; **Restore** beside an older version copies that text into a new latest version. Neither action deletes history.
4. Review **Changes from baseline** in the editor to see what the snapshot changed and why (headline, summary, skills, project visibility).
5. Generate the PDF. **Generate PDF** stays disabled until the job references the currently approved snapshot and all edits are saved.

Common problems:

- **Approve snapshot is disabled.** Write a job description, complete the summary/headline/skills readiness checks, and clear any evidence blockers first.
- **The PDF is stale after approving or editing a CV.** Regenerate it. PDF fingerprints include the snapshot ID and version (fingerprint `v2`), so previously generated PDFs become stale when this release ships.
- **The app says the approved tailored CV is no longer available.** Approve a new snapshot before generating a PDF.

Related pages:

- [Resume Studio](/docs/next/features/design-resume)
- [Career Evidence Bank in Settings](/docs/next/features/settings)
- [Microsoft Graph OAuth Setup](/docs/next/getting-started/microsoft-graph-oauth-setup)

### Derived tailored fit

What it is:

- **Derived tailored fit — job-specific** is a stored, derived score for how well this job's **approved tailored CV snapshot** matches its job description. The compact readout next to the source score in the job detail panel shows the stored `score/100`, `Not checked` when no result exists, or a `• Stale` marker.
- The source `suitabilityScore` in the score ring is a different value: it describes the job found by discovery/import. Tailored fit describes the job-specific resume artifact. The two scores are never relabelled as each other.

Why it exists:

- Source fit must stay stable when you edit your tailored CV; tailored fit must reflect the approved snapshot. Keeping them separate makes it clear which artifact changed.
- **Rescore** (labelled **Recalculate match** in the detail panel actions) and **Check tailored fit** are separate, manual actions. Rescore recalculates source fit; **Check tailored fit** recomputes the derived score from the approved snapshot and calls AI only on that explicit click.
- Neither action runs on open. Opening a job or the Tailoring tab only performs deterministic reads of stored state; no AI is called.
- Neither **Rescore** nor **Check tailored fit** sends email. Email is only sent from the explicit **Send email** confirmation in the Apply flow.

How to use it:

1. Open a job. The detail panel shows the source score ring and the compact **Derived tailored fit — job-specific** readout beside it.
2. In the **Tailoring** tab, add a job description and approve a tailored CV snapshot if you have not already.
3. Click **Check tailored fit** in the Tailoring tab. This explicitly calls AI to propose a score and notes, then validates the result against approved evidence before storing it.
4. Read the score, summary, per-requirement statuses, evidence references, and snapshot version in the tailored-fit panel. The detail-panel readout updates after the check completes.
5. If the snapshot, job description, evidence bank, or relevant profile fields change, the stored result is marked stale. Click **Check tailored fit** again to refresh it.

Common problems:

- **The detail panel says Not checked.** No tailored-fit result has been stored for this job yet. Approve a snapshot, then run **Check tailored fit**.
- **The readout says Stale.** Inputs changed since the last check. The stored score is still shown for context, but you must run **Check tailored fit** again; staleness is computed by a deterministic read and never triggers AI on its own.
- **A note has no evidence references.** References are stable IDs, not display labels. Deleting or renaming a Resume Studio item does not rewrite history. Recomputing drops invalid refs and reports a `covered` or `partial` note with no valid ref as `unsupported`; fix the evidence or wording, then recheck explicitly.
- **Check tailored fit fails while the LLM is unavailable.** This is an error state, not a score: the previous stored result remains and no background retry or AI call happens on open. Try the check again when the provider is available.
- **Check tailored fit is disabled.** A job description and an approved tailored CV snapshot are required first.
- **I ran Rescore but tailored fit did not change.** Expected: Rescore affects only source fit. Use **Check tailored fit** for the derived score.

Related pages:

- [Tailoring review workflow](/docs/next/features/orchestrator#tailoring-review-workflow)
- [Tailored CV snapshots](/docs/next/features/orchestrator#tailored-cv-snapshots)
- [Resume Studio](/docs/next/features/design-resume)
- [Career Evidence Bank in Settings](/docs/next/features/settings)
- [Pipeline Run](/docs/next/features/pipeline-run)

### Generating PDFs

PDF generation renders the most recently approved tailored CV snapshot and applies paper size and renderer settings to it. Previously generated PDFs become stale when fingerprint `v2` ships; regenerate them after upgrading.

PDF generation uses:

- base resume selected from RxResume
- job description
- tailored summary/headline/skills/projects
- the configured PDF renderer (`rxresume` export or local LaTeX via `tectonic`)

Common paths:

- Discovered to finalization: `POST /api/jobs/actions` with `{ "action": "move_to_ready", "jobIds": ["<jobId>"] }`
- Ready regeneration: `POST /api/jobs/:id/generate-pdf`
- In the UI: open a job's **Tailoring** tab, choose **Generate PDF**, then **Preview PDF** to open the generated file in a popup dialog on the current page. **Preview PDF** appears once the job has a generated PDF.

### Applying with the tailored CV

1. Open a ready job and select the **Apply** tab.
2. Click **Apply now** to open the review-and-send dialog. The same dialog is available as **Email recruiter** in the **More actions** menu.
3. Review the generated **Cover letter**. Editing it updates the **Message** below automatically; the message is sent as plain text with a short sign-off.
4. Use **Preview PDF** in the dialog to inspect the tailored CV in a popup without leaving the current page.
5. Check the confirmation box and click **Send email**.

Nothing is sent until you confirm. The recipient defaults to a matched tracked recruitment email; when none exists, JobOps uses the first valid address from the job's `emails` field or job description and labels it in the dialog for verification. Sending requires a generated tailored PDF and Microsoft Graph with delegated `Mail.Send` consent. See [Microsoft Graph OAuth Setup](/docs/next/getting-started/microsoft-graph-oauth-setup).

### Regenerating PDFs after edits (copy-pasteable examples)

If JD or tailoring changes, regenerate PDF to keep output in sync.

```bash
curl -X PATCH "http://localhost:3001/api/jobs/<jobId>" \
  -H "content-type: application/json" \
  -d '{
    "jobDescription": "<new JD>",
    "tailoredSummary": "<optional>",
    "tailoredHeadline": "<optional>",
    "tailoredSkills": [{"name":"Backend","keywords":["TypeScript","Node.js"]}],
    "selectedProjectIds": "p1,p2"
  }'
```

```bash
curl -X POST "http://localhost:3001/api/jobs/<jobId>/summarize?force=true"
curl -X POST "http://localhost:3001/api/jobs/<jobId>/generate-pdf"
```

### External payload and sanitization defaults

- LLM prompts send minimized profile/job fields.
- Webhooks are sanitized and whitelisted by default.
- Logs and error details are redacted/truncated by default.
- Correlation fields include `requestId`, and when available `pipelineRunId` and `jobId`.

## Common problems

### Job is stuck in `processing`

- `processing` is transient; failures generally revert the job to `discovered`.
- Check run logs and retry generation.

### PDF does not reflect recent edits

- Run summarize with `force=true` after changing the JD/tailoring.
- Regenerate PDF after summarize completes.

### Notes do not appear as expected

- Make sure you are on the dedicated job page, not the orchestrator detail panel.
- Confirm the note was saved after entering both a title and note content.
- If markdown looks plain, check for unsupported formatting or paste the note into the saved view again after editing.

### Reopen skipped/applied jobs

- Patch `status` back to `discovered` to return the job to the active queue.

### Date filter returns no jobs

- Open `Filters` and confirm at least one date dimension is selected.
- Check that your date range matches the lifecycle timestamp you care about.

## Related pages

- [Job Search Bar](/docs/next/features/job-search-bar)
- [Pipeline Run](/docs/next/features/pipeline-run)
- [Ghostwriter](/docs/next/features/ghostwriter)
- [Reactive Resume](/docs/next/features/reactive-resume)
- [Post-Application Tracking](/docs/next/features/post-application-tracking)
