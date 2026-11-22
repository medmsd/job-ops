# Job Page Apply Button Design

Date: 2026-11-22

## What it is

Add an **Apply** action to the job details page at `/job/:id`. The button opens the existing recruiter-email compose modal so the user can review the recipient, subject, cover letter, and tailored CV attachment before explicitly sending.

## Why it exists

The orchestrator already has an **Apply now** action, but the job details page only exposes **Mark Applied**. Users browsing a single job cannot start the actual application email flow from that page.

## Behavior

- Show the button in the right sidebar **Actions** panel above **Mark Applied** for every job that is not `applied` or `in_progress`.
- Disable the button when the job has no `pdfPath` or when its tailored PDF is regenerating. Use the existing `TooltipWhenDisabled` pattern with a reason such as “Generate a tailored PDF first.”
- Clicking the button opens `ComposeEmailModal` with the current job id, title, and employer.
- Keep **Mark Applied** as a separate manual action. A successful email send refreshes job data but does not change job status automatically.
- Reuse existing components, icons, loading state, and toast conventions; do not add a new dependency or a second email flow.

## Files

- `orchestrator/src/client/pages/JobPage.tsx`: add modal state, render `ComposeEmailModal`, pass sidebar props, refresh on send.
- `orchestrator/src/client/pages/job-page/JobPageRightSidebar.tsx`: add the button and its disabled reason.
- `orchestrator/src/client/pages/job-page/JobPageRightSidebar.test.tsx`: cover visibility, disabled state, and click handler.
- `docs-site/docs/features/post-application-tracking.md`: document the new entry point.

## Verification

- Targeted tests for the sidebar and job page.
- Required CI-parity checks from `AGENTS.md`.
- Browser check on `/job/cd28c22b-3eac-4fca-9832-d8d2974d457e` for disabled/enabled states and modal opening without sending email.
