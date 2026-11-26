---
id: multi-select-and-bulk-actions
title: Multi-Select and Bulk Actions
description: Select multiple jobs with mouse or keyboard and run bulk actions like Move to Ready, Skip, or Recalculate match.
sidebar_position: 5
---

Multi-select lets you process many jobs at once instead of repeating the same action one-by-one.

## Why this exists

When you run discovery at scale, you often need to:

- skip batches of low-priority jobs
- move a shortlist to Ready quickly
- recalculate fit scores after settings/profile changes

Bulk actions reduce repetitive clicks, keep momentum high, and make triage runs faster.

## Mouse workflow

### Select jobs

1. Use the checkbox on each row to include/exclude a job.
2. Use **Select all filtered** to select jobs currently visible in the active filtered list.
3. Check the selected count in the list header.

### Run bulk actions

When one or more jobs are selected, a floating action bar appears at the bottom.

Available actions depend on selected job statuses:

- **Move to Ready**
- **Skip selected**
- **Recalculate match**
- **Clear** (clears selection)

### Bulk tailor and PDF (discovered tab)

On the **Discovered** tab, a toolbar control above the job list can process a batch without selecting rows:

1. Enter the number of jobs to process (default `10`, allowed range `1–500`).
2. Click **Tailor & generate PDF**.

The control processes the first N jobs in the current filtered/sorted order. Each job is AI-tailored against your approved Career Evidence Bank, a tailored PDF is generated, and the job moves to **Ready**. Jobs that fail stay selected so you can retry them. The button is disabled while a batch is running.

This uses the same engine as **Move to Ready**; it is an explicit action, so no AI runs when you merely open a job or the tailoring view.

## Keyboard workflow

Use shortcuts from the Jobs page:

- `x`: toggle select on the currently focused job
- `Esc`: clear current selection
- `r`: in `discovered`, move to Ready

`r` behavior with selection:

- if you have a multi-selection active, `r` runs the bulk **Move to Ready** action
- if nothing is selected, `r` runs move-to-ready for the single current job

## Important limits and behavior

- Bulk actions are capped at **500 jobs per run**.
- `Select all filtered` also respects the same 500-job cap.
- Selection resets when you switch tabs.
- If jobs disappear from the active filtered list, they are removed from selection automatically.

## Related pages

- [Keyboard Shortcuts](./keyboard-shortcuts)
- [Orchestrator](./orchestrator)
- [Find Jobs and Apply Workflow](../workflows/find-jobs-and-apply-workflow)
