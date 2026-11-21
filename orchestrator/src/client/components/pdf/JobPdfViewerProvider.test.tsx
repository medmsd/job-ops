import { act, renderHook } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { JobPdfViewerProvider, useJobPdfViewer } from "./JobPdfViewerProvider";

interface ModalProps {
  open: boolean;
  jobId: string | null;
  jobTitle: string | null;
  downloadFilename?: string;
  onOpenChange: (open: boolean) => void;
}

const observed = vi.hoisted(() => ({
  props: null as ModalProps | null,
}));

vi.mock("./JobPdfViewerModal", () => ({
  JobPdfViewerModal: (props: ModalProps) => {
    observed.props = props;
    return <div data-testid="viewer-modal" />;
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <JobPdfViewerProvider>{children}</JobPdfViewerProvider>
);

describe("JobPdfViewerProvider", () => {
  it("opens the in-app viewer modal with the selected job", () => {
    const { result } = renderHook(() => useJobPdfViewer(), { wrapper });

    act(() => {
      result.current.openJobPdf(
        "job-1",
        "Senior Engineer",
        "Mohamed Mseddi Resume Acme.pdf",
      );
    });

    expect(observed.props).toMatchObject({
      open: true,
      jobId: "job-1",
      jobTitle: "Senior Engineer",
      downloadFilename: "Mohamed Mseddi Resume Acme.pdf",
    });
  });

  it("closes the modal through the dialog callback", () => {
    const { result } = renderHook(() => useJobPdfViewer(), { wrapper });

    act(() => {
      result.current.openJobPdf("job-2");
    });
    act(() => {
      observed.props?.onOpenChange(false);
    });

    expect(observed.props).toMatchObject({ open: false, jobId: "job-2" });
  });
});
