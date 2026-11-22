# Job Page Apply Button Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use godmode:task-runner to implement this plan task-by-task.

**Goal:** Add an **Apply now** action to the job details page sidebar that opens the existing recruiter-email compose flow for non-applied jobs.

**Architecture:** `JobPage` owns modal state and renders `ComposeEmailModal`; `JobPageRightSidebar` receives an `onApply` callback and a disabled reason and renders the button in its Actions panel. No new service or email logic is introduced.

**Tech Stack:** React 19, TypeScript, shadcn/ui `Button`, `TooltipWhenDisabled`, lucide-react icons, Vitest + Testing Library.

---

### Task 1: Sidebar Apply button (TDD)

**Files:**
- Modify: `orchestrator/src/client/pages/job-page/JobPageRightSidebar.test.tsx`
- Modify: `orchestrator/src/client/pages/job-page/JobPageRightSidebar.tsx`

**Step 1: Write the failing test**

Add `fireEvent` to the existing Testing Library import, add `onApply={noop}` and `applyDisabledReason={job.pdfPath ? null : "Generate a tailored PDF first."}` to the `renderRightSidebar` helper, then add:

```tsx
it("offers Apply now above Mark Applied for non-applied jobs with a PDF", () => {
  const onApply = vi.fn();
  renderRightSidebar({}, { onApply });

  const apply = screen.getByRole("button", { name: /apply now/i });
  const markApplied = screen.getByRole("button", { name: /mark applied/i });
  expect(apply).toBeEnabled();
  expect(
    apply.compareDocumentPosition(markApplied) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  fireEvent.click(apply);
  expect(onApply).toHaveBeenCalledTimes(1);
});

it("hides Apply now once the job is applied", () => {
  renderRightSidebar({ status: "applied" });

  expect(screen.queryByRole("button", { name: /apply now/i })).toBeNull();
});

it("disables Apply now and explains when no tailored PDF exists", () => {
  renderRightSidebar({ pdfPath: null, pdfFreshness: "missing" });

  const apply = screen.getByRole("button", { name: /apply now/i });
  expect(apply).toBeDisabled();
  expect(screen.getByText(/generate a tailored pdf first/i)).toBeInTheDocument();
});
```

Allow a second `props` argument on the helper:

```tsx
function renderRightSidebar(
  overrides: Parameters<typeof createJob>[0] = {},
  props: Partial<React.ComponentProps<typeof JobPageRightSidebar>> = {},
) {
  const job = createJob({ status: "ready", pdfPath: "data/pdfs/resume_job-1.pdf", pdfFreshness: "stale", ...overrides });
  return render(
    <JobPageRightSidebar
      job={job}
      tasks={[]}
      jobLink={job.jobUrl}
      isDiscovered={job.status === "discovered"}
      isReady={job.status === "ready"}
      isApplied={job.status === "applied"}
      isInProgress={job.status === "in_progress"}
      canLogEvents={false}
      isBusy={false}
      isUploadingPdf={false}
      pdfActionsDisabled={false}
      pdfRegeneratingReason={null}
      pdfViewLabel="View old PDF"
      pdfDownloadLabel="Download old PDF"
      onStartTailoring={noop}
      onMarkApplied={noop}
      onOpenLogEvent={noop}
      onEditTailoring={noop}
      onViewPdf={noop}
      onDownloadPdf={noop}
      onGenerateCoverLetter={noop}
      onUploadPdf={noop}
      onRegeneratePdf={noop}
      onSkip={noop}
      onOpenEditDetails={noop}
      onViewJobDescription={noop}
      onCopyJobInfo={noop}
      onRescore={noop}
      onCheckSponsor={noop}
      onApply={noop}
      applyDisabledReason={job.pdfPath ? null : "Generate a tailored PDF first."}
      {...props}
    />,
  );
}
```

**Step 2: Run the test to verify failure**

Run:

```bash
npm --workspace orchestrator run test:run -- src/client/pages/job-page/JobPageRightSidebar.test.tsx
```

Expected: FAIL because `onApply`/`applyDisabledReason` are unknown props and no Apply button exists.

**Step 3: Implement the minimal sidebar change**

Add `Mail` to the lucide-react import, add these props to `JobPageRightSidebarProps`, destructure them in the component, and insert this block immediately before the existing `isReady` / `Mark Applied` block:

```tsx
  onApply: () => void;
  applyDisabledReason: string | null;
```

```tsx
        {!isApplied && !isInProgress && (
          <TooltipWhenDisabled
            reason={applyDisabledReason}
            className="w-full"
          >
            <Button
              size="sm"
              className="w-full justify-start"
              onClick={onApply}
              disabled={isBusy || Boolean(applyDisabledReason)}
            >
              <Mail className="mr-1.5 h-3.5 w-3.5" />
              Apply now
            </Button>
          </TooltipWhenDisabled>
        )}
```

**Step 4: Run the test to verify it passes**

Run:

```bash
npm --workspace orchestrator run test:run -- src/client/pages/job-page/JobPageRightSidebar.test.tsx
```

Expected: PASS with 5 tests.

**Step 5: Commit**

```bash
git add orchestrator/src/client/pages/job-page/JobPageRightSidebar.tsx orchestrator/src/client/pages/job-page/JobPageRightSidebar.test.tsx
git commit -m "feat: add Apply now action to job sidebar"
```

---

### Task 2: Wire the modal in JobPage

**Files:**
- Modify: `orchestrator/src/client/pages/JobPage.tsx`

**Step 1: Add imports and state**

Near the existing component imports:

```tsx
import { ComposeEmailModal } from "@client/components/ComposeEmailModal";
```

Next to `isCoverLetterOpen` state:

```tsx
  const [isComposeEmailOpen, setIsComposeEmailOpen] = React.useState(false);
```

**Step 2: Pass sidebar props**

Add to the `<JobPageRightSidebar ... />` call:

```tsx
              onApply={() => setIsComposeEmailOpen(true)}
              applyDisabledReason={
                !job.pdfPath
                  ? "Generate a tailored PDF first."
                  : pdfRegeneratingReason
              }
```

**Step 3: Render the modal**

Immediately before the existing `<CoverLetterModal ... />`:

```tsx
      {job ? (
        <ComposeEmailModal
          open={isComposeEmailOpen}
          onOpenChange={setIsComposeEmailOpen}
          jobId={job.id}
          jobTitle={job.title}
          employer={job.employer}
          onSent={() => void loadData()}
        />
      ) : null}
```

**Step 4: Verify types and focused tests**

Run:

```bash
npm --workspace orchestrator run check:types
npm --workspace orchestrator run test:run -- src/client/pages/job-page/JobPageRightSidebar.test.tsx src/client/pages/JobPage.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add orchestrator/src/client/pages/JobPage.tsx
git commit -m "feat: open recruiter email from job page Apply now"
```

---

### Task 3: Documentation and full verification

**Files:**
- Modify: `docs-site/docs/features/post-application-tracking.md`

**Step 1: Document the new entry point**

In the recruiter-email section, update the entry-point sentence to include the job details page:

```md
On a job with a generated tailored PDF, open the **Apply** tab in the orchestrator and click **Apply now**, use **Email recruiter** in the **More actions** menu, or open the job details page (`/job/<jobId>`) and click **Apply now** in the sidebar.
```

**Step 2: Run required checks**

Run from the repository root:

```bash
./orchestrator/node_modules/.bin/biome check docs-site/docs/features/post-application-tracking.md orchestrator/src/client/pages/JobPage.tsx orchestrator/src/client/pages/job-page/JobPageRightSidebar.tsx orchestrator/src/client/pages/job-page/JobPageRightSidebar.test.tsx
npm run check:types:shared
npm --workspace orchestrator run check:types
npm --workspace gradcracker-extractor run check:types
npm --workspace ukvisajobs-extractor run check:types
npm --workspace orchestrator run build:client
npm --workspace orchestrator run test:run
npm run docs:build
```

Expected: all pass. The repo-wide `biome ci .` check may still fail on pre-existing CRLF/LF differences in untouched files; touched files must be clean.

**Step 3: Live browser verification**

Rebuild and open the job page:

```bash
npm run docker:rebuild:kiri
```

Then at `http://localhost:3005/job/cd28c22b-3eac-4fca-9832-d8d2974d457e`:

- Confirm **Apply now** appears above **Mark Applied** and is enabled because the job has a PDF.
- Click it and confirm the **Email recruiter** dialog opens.
- Close with **Cancel**; confirm no email was sent and the page is still clickable.
- Confirm an applied job does not show the button.

**Step 4: Commit**

```bash
git add docs-site/docs/features/post-application-tracking.md
git commit -m "docs: document job page Apply now action"
```

---

### Task 4: Push

**Files:** none

**Step 1: Push only to the fork**

```bash
git push fork main
```

Expected: `main -> main` updates `https://github.com/medmsd/job-ops.git`; `origin` is not pushed.
