import { createJob } from "@shared/testing/factories.js";
import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { JobPageRightSidebar } from "./JobPageRightSidebar";

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
  }: {
    children: ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

const noop = vi.fn();

function renderRightSidebar(
  overrides: Parameters<typeof createJob>[0] = {},
  props: Partial<React.ComponentProps<typeof JobPageRightSidebar>> = {},
) {
  const job = createJob({
    status: "ready",
    pdfPath: "data/pdfs/resume_job-1.pdf",
    pdfFreshness: "stale",
    ...overrides,
  });

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
      onApply={noop}
      applyDisabledReason={
        job.pdfPath ? null : "Generate a tailored PDF first."
      }
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
      {...props}
    />,
  );
}

describe("JobPageRightSidebar actions", () => {
  it("includes the orchestrator detail menu actions on the job page", () => {
    renderRightSidebar();

    expect(
      screen.getByRole("button", { name: /edit details/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /view job description/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /copy job info/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^rescore$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /replace pdf/i }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: /view old pdf/i }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /download old pdf/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^cover letter$/i }),
    ).toBeInTheDocument();
  });

  it("uses upload wording when the job has no resume PDF", () => {
    renderRightSidebar({ pdfPath: null, pdfFreshness: "missing" });

    expect(
      screen.getAllByRole("button", { name: /upload pdf/i }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /download pdf/i })).toBeNull();
  });

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
    expect(
      screen.getByText(/generate a tailored pdf first/i),
    ).toBeInTheDocument();
  });
});
