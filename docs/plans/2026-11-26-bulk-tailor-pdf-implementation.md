# Bulk Tailor + PDF Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use godmode:task-runner to implement this plan task-by-task.

**Goal:** Add a count input + button on the discovered-jobs toolbar that AI-tailors the first N filtered discovered jobs, generates their PDFs, and moves them to Ready by reusing the existing `move_to_ready` bulk action.

**Architecture:** No server or API changes. The existing `move_to_ready` job action already runs `processJob()` (AI tailoring → PDF → Ready) through a streaming endpoint with progress and per-job failure reporting. The work is: let `runJobAction` accept explicit job IDs, add a small clamped numeric control, render it only on the discovered tab, and pass `activeJobs.slice(0, N)` into the existing action.

**Tech Stack:** React + TypeScript, Vitest + Testing Library, shadcn-style `Button`/`Input`, sonner toasts, existing SSE job-action endpoint, Docusaurus docs.

**Execution note:** This repository's established workflow commits directly to `main` and pushes only to the `fork` remote; no worktree is created for this change.

---

### Task 1: Allow explicit job IDs in `runJobAction`

**Files:**
- Modify: `orchestrator/src/client/pages/orchestrator/useJobSelectionActions.tsx:119-129`
- Test: `orchestrator/src/client/pages/orchestrator/useJobSelectionActions.test.ts`

**Step 1: Write the failing test**

Append to `useJobSelectionActions.test.ts` inside the existing `describe`:

```ts
  it("runs an action against explicitly supplied job IDs, deduped and in order", async () => {
    const activeJobs = [
      createJob({ id: "job-1", status: "discovered" }),
      createJob({ id: "job-2", status: "discovered" }),
      createJob({ id: "job-3", status: "discovered" }),
    ];
    const loadJobs = vi.fn().mockResolvedValue(undefined);
    mockStreamJobAction({
      action: "move_to_ready",
      requested: 2,
      succeeded: 2,
      failed: 0,
      results: [
        {
          jobId: "job-3",
          ok: true,
          job: createJob({ id: "job-3", status: "ready" }),
        },
        {
          jobId: "job-1",
          ok: true,
          job: createJob({ id: "job-1", status: "ready" }),
        },
      ],
    });

    const { result } = renderHook(() =>
      useJobSelectionActions({
        activeJobs,
        activeTab: "discovered",
        loadJobs,
      }),
    );

    await act(async () => {
      await result.current.runJobAction("move_to_ready", [
        "job-3",
        "job-1",
        "job-3",
      ]);
    });

    expect(api.streamJobAction).toHaveBeenCalledWith(
      { action: "move_to_ready", jobIds: ["job-3", "job-1"] },
      expect.any(Object),
    );
  });
```

**Step 2: Run test to verify failure**

Run: `npm --workspace orchestrator exec vitest run src/client/pages/orchestrator/useJobSelectionActions.test.ts`
Expected: FAIL — `streamJobAction` receives `jobIds: []` because the hook ignores the second argument.

**Step 3: Minimal implementation**

In `useJobSelectionActions.tsx`, change only the function head and first line:

```ts
  const runJobAction = useCallback(
    async (action: JobAction, explicitJobIds?: string[]) => {
      const selectedAtStart = explicitJobIds
        ? Array.from(new Set(explicitJobIds))
        : Array.from(selectedJobIds);
```

Leave the remaining body and the dependency array `[activeTab, selectedJobIds, loadJobs]` unchanged. Existing callers pass one argument and keep working.

**Step 4: Run tests to verify pass**

Run: `npm --workspace orchestrator exec vitest run src/client/pages/orchestrator/useJobSelectionActions.test.ts`
Expected: PASS (all existing tests plus the new one).

**Step 5: Commit**

```bash
git add orchestrator/src/client/pages/orchestrator/useJobSelectionActions.tsx orchestrator/src/client/pages/orchestrator/useJobSelectionActions.test.ts
git commit -m "feat: allow explicit job IDs in bulk job actions"
```

---

### Task 2: Add the pure limit/ID helper with tests

**Files:**
- Create: `orchestrator/src/client/pages/orchestrator/bulkTailorPdf.ts`
- Test: `orchestrator/src/client/pages/orchestrator/bulkTailorPdf.test.ts`

**Step 1: Write the failing tests**

```ts
import { createJob } from "@shared/testing/factories.js";
import { describe, expect, it } from "vitest";
import {
  BULK_TAILOR_MAX,
  clampBulkTailorLimit,
  getBulkTailorJobIds,
} from "./bulkTailorPdf";

describe("clampBulkTailorLimit", () => {
  it("defaults invalid values to 10", () => {
    expect(clampBulkTailorLimit(Number.NaN)).toBe(10);
    expect(clampBulkTailorLimit(Number.POSITIVE_INFINITY)).toBe(10);
  });

  it("clamps below the minimum and above the maximum", () => {
    expect(clampBulkTailorLimit(0)).toBe(1);
    expect(clampBulkTailorLimit(-7)).toBe(1);
    expect(clampBulkTailorLimit(501)).toBe(BULK_TAILOR_MAX);
    expect(clampBulkTailorLimit(25)).toBe(25);
  });

  it("truncates fractional values", () => {
    expect(clampBulkTailorLimit(3.9)).toBe(3);
  });
});

describe("getBulkTailorJobIds", () => {
  it("takes only the first N jobs in the given order", () => {
    const jobs = [
      createJob({ id: "job-1" }),
      createJob({ id: "job-2" }),
      createJob({ id: "job-3" }),
    ];

    expect(getBulkTailorJobIds(jobs, 2)).toEqual(["job-1", "job-2"]);
    expect(getBulkTailorJobIds(jobs, 99)).toEqual([
      "job-1",
      "job-2",
      "job-3",
    ]);
  });
});
```

**Step 2: Run tests to verify failure**

Run: `npm --workspace orchestrator exec vitest run src/client/pages/orchestrator/bulkTailorPdf.test.ts`
Expected: FAIL — module `./bulkTailorPdf` does not exist.

**Step 3: Minimal implementation**

Create `bulkTailorPdf.ts`:

```ts
import type { JobListItem } from "@shared/types.js";

export const BULK_TAILOR_DEFAULT = 10;
export const BULK_TAILOR_MIN = 1;
export const BULK_TAILOR_MAX = 500;

export function clampBulkTailorLimit(value: number): number {
  if (!Number.isFinite(value)) return BULK_TAILOR_DEFAULT;
  return Math.min(
    BULK_TAILOR_MAX,
    Math.max(BULK_TAILOR_MIN, Math.trunc(value)),
  );
}

export function getBulkTailorJobIds(
  jobs: JobListItem[],
  limit: number,
): string[] {
  return jobs.slice(0, clampBulkTailorLimit(limit)).map((job) => job.id);
}
```

**Step 4: Run tests to verify pass**

Run: `npm --workspace orchestrator exec vitest run src/client/pages/orchestrator/bulkTailorPdf.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add orchestrator/src/client/pages/orchestrator/bulkTailorPdf.ts orchestrator/src/client/pages/orchestrator/bulkTailorPdf.test.ts
git commit -m "feat: add bulk tailor limit helpers"
```

---

### Task 3: Build the `BulkTailorPdfControl` UI component

**Files:**
- Create: `orchestrator/src/client/pages/orchestrator/BulkTailorPdfControl.tsx`
- Test: `orchestrator/src/client/pages/orchestrator/BulkTailorPdfControl.test.tsx`

**Step 1: Write the failing tests**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BulkTailorPdfControl } from "./BulkTailorPdfControl";

describe("BulkTailorPdfControl", () => {
  it("submits the entered limit", () => {
    const onProcess = vi.fn();
    render(
      <BulkTailorPdfControl
        jobCount={40}
        inFlight={false}
        onProcess={onProcess}
      />,
    );

    const input = screen.getByLabelText(
      "Number of discovered jobs to tailor",
    );
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.click(
      screen.getByRole("button", { name: /tailor & generate pdf/i }),
    );

    expect(onProcess).toHaveBeenCalledWith(12);
  });

  it("clamps the limit on blur", () => {
    render(
      <BulkTailorPdfControl
        jobCount={40}
        inFlight={false}
        onProcess={vi.fn()}
      />,
    );

    const input = screen.getByLabelText(
      "Number of discovered jobs to tailor",
    );
    fireEvent.change(input, { target: { value: "900" } });
    fireEvent.blur(input);

    expect(input).toHaveValue(500);
  });

  it("is disabled with no jobs or while an action is in flight", () => {
    const { rerender } = render(
      <BulkTailorPdfControl
        jobCount={0}
        inFlight={false}
        onProcess={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /tailor & generate pdf/i }),
    ).toBeDisabled();

    rerender(
      <BulkTailorPdfControl
        jobCount={40}
        inFlight={true}
        onProcess={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /tailor & generate pdf/i }),
    ).toBeDisabled();
  });
});
```

**Step 2: Run tests to verify failure**

Run: `npm --workspace orchestrator exec vitest run src/client/pages/orchestrator/BulkTailorPdfControl.test.tsx`
Expected: FAIL — component does not exist.

**Step 3: Minimal implementation**

Create `BulkTailorPdfControl.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as React from "react";
import {
  BULK_TAILOR_DEFAULT,
  clampBulkTailorLimit,
} from "./bulkTailorPdf";

export interface BulkTailorPdfControlProps {
  jobCount: number;
  inFlight: boolean;
  onProcess: (limit: number) => void;
}

export const BulkTailorPdfControl: React.FC<BulkTailorPdfControlProps> = ({
  jobCount,
  inFlight,
  onProcess,
}) => {
  const [limitText, setLimitText] = React.useState(
    String(BULK_TAILOR_DEFAULT),
  );
  const limit = clampBulkTailorLimit(Number(limitText));
  const disabled = jobCount === 0 || inFlight;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm">
        <div className="font-medium">Bulk tailor and PDF</div>
        <p className="text-xs text-muted-foreground">
          AI tailors the first N discovered jobs, generates each PDF, and moves
          them to Ready. {jobCount} discovered job
          {jobCount === 1 ? "" : "s"} available.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <label
          htmlFor="bulk-tailor-limit"
          className="text-xs text-muted-foreground"
        >
          Jobs
        </label>
        <Input
          id="bulk-tailor-limit"
          aria-label="Number of discovered jobs to tailor"
          type="number"
          min={1}
          max={500}
          className="w-20"
          value={limitText}
          disabled={disabled}
          onChange={(event) => setLimitText(event.target.value)}
          onBlur={() => setLimitText(String(limit))}
        />
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          onClick={() => onProcess(limit)}
        >
          Tailor &amp; generate PDF
        </Button>
      </div>
    </div>
  );
};
```

**Step 4: Run tests to verify pass**

Run: `npm --workspace orchestrator exec vitest run src/client/pages/orchestrator/BulkTailorPdfControl.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add orchestrator/src/client/pages/orchestrator/BulkTailorPdfControl.tsx orchestrator/src/client/pages/orchestrator/BulkTailorPdfControl.test.tsx
git commit -m "feat: add bulk tailor and PDF control"
```

---

### Task 4: Wire the control into the discovered tab

**Files:**
- Modify: `orchestrator/src/client/pages/orchestrator/OrchestratorJobsWorkspace.tsx` (props interface near lines 25-78; render near lines 147-177)
- Modify: `orchestrator/src/client/pages/orchestrator/OrchestratorJobWorkspaceContainer.tsx` (imports, callback, props near lines 218-276)

**Step 1: Add two props to `OrchestratorJobsWorkspaceProps`**

```ts
  bulkTailorPdfInFlight: boolean;
  onBulkTailorPdf: (limit: number) => void;
```

Add them to the destructured parameter list too.

**Step 2: Import and render the control after `OrchestratorFilters`**

Add import next to the other `./` component imports:

```ts
import { BulkTailorPdfControl } from "./BulkTailorPdfControl";
```

Insert immediately after the closing `/>` of `<OrchestratorFilters ... />` and before the job-grid `<div>`:

```tsx
      {activeTab === "discovered" && (
        <BulkTailorPdfControl
          jobCount={activeJobs.length}
          inFlight={bulkTailorPdfInFlight}
          onProcess={onBulkTailorPdf}
        />
      )}
```

**Step 3: Wire the container callback**

Add imports:

```ts
import { getBulkTailorJobIds } from "./bulkTailorPdf";
```

Insert after `useJobSelectionActions(...)` (around line 106):

```ts
  const handleBulkTailorPdf = useCallback(
    (limit: number) => {
      const jobIds = getBulkTailorJobIds(activeJobs, limit);
      if (jobIds.length === 0) return;
      void runJobAction("move_to_ready", jobIds);
    },
    [activeJobs, runJobAction],
  );
```

Pass to `OrchestratorJobsWorkspace` next to the other props:

```tsx
          bulkTailorPdfInFlight={jobActionInFlight !== null}
          onBulkTailorPdf={handleBulkTailorPdf}
```

**Step 4: Verify types and targeted tests**

Run: `npm --workspace orchestrator exec tsc --noEmit -p tsconfig.json`
Run: `npm --workspace orchestrator exec vitest run src/client/pages/orchestrator`
Expected: PASS with no type errors.

**Step 5: Commit**

```bash
git add orchestrator/src/client/pages/orchestrator/OrchestratorJobsWorkspace.tsx orchestrator/src/client/pages/orchestrator/OrchestratorJobWorkspaceContainer.tsx
git commit -m "feat: wire bulk tailor control into discovered tab"
```

---

### Task 5: Document the new control

**Files:**
- Modify: `docs-site/docs/features/multi-select-and-bulk-actions.md`

**Step 1: Add a section after "Run bulk actions"**

```md
### Bulk tailor and PDF (discovered tab)

On the **Discovered** tab, a toolbar control above the job list can process a batch without selecting rows:

1. Enter the number of jobs to process (default `10`, allowed range `1–500`).
2. Click **Tailor & generate PDF**.

The control processes the first N jobs in the current filtered/sorted order. Each job is AI-tailored against your approved Career Evidence Bank, a tailored PDF is generated, and the job moves to **Ready**. Jobs that fail stay selected so you can retry them. The button is disabled while a batch is running.

This uses the same engine as **Move to Ready**; it is an explicit action, so no AI runs when you merely open a job or the tailoring view.
```

**Step 2: Correct the existing cap line to match the code**

Replace:

```md
- Bulk actions are capped at **100 jobs per run**.
- `Select all filtered` also respects the same 100-job cap.
```

with:

```md
- Bulk actions are capped at **500 jobs per run**.
- `Select all filtered` also respects the same 500-job cap.
```

**Step 3: Verify docs build**

Run: `npm --workspace docs-site run build`
Expected: PASS.

**Step 4: Commit**

```bash
git add docs-site/docs/features/multi-select-and-bulk-actions.md
git commit -m "docs: document bulk tailor and PDF control"
```

---

### Task 6: Full verification

**Files:** none (verification only)

Run all CI-parity checks from `AGENTS.md`:

```bash
./orchestrator/node_modules/.bin/biome ci --formatter-enabled=false .
npm run check:types:shared
npm --workspace orchestrator run check:types
npm --workspace gradcracker-extractor run check:types
npm --workspace ukvisajobs-extractor run check:types
npm --workspace orchestrator run build:client
npm --workspace orchestrator run test:run
```

Then:

```bash
graphify update .
git status -sb
```

Expected: all checks pass; working tree clean after the commits above. If tests fail with a `better-sqlite3` ABI mismatch, run `npm --workspace orchestrator rebuild better-sqlite3` and rerun.

No commit for this task.

---

### Execution handoff

After the plan is saved, choose one:

1. **Delegated execution (this session):** fresh subagent per task with a reviewer after each task.
2. **Separate session:** open a new session with `godmode:task-runner` for batch execution with checkpoints.
