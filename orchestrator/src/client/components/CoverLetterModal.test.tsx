import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoverLetterModal } from "./CoverLetterModal";

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  save: vi.fn(),
  buildPdf: vi.fn(),
}));

vi.mock("@client/api", () => ({
  generateJobCoverLetter: mocks.generate,
  saveJobCoverLetter: mocks.save,
}));

vi.mock("@client/lib/cover-letter-pdf", () => ({
  buildCoverLetterPdf: mocks.buildPdf,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

const result = {
  jobId: "job-1",
  coverLetter: "Dear hiring team, please consider my application.",
  filename: "Mohamed Mseddi Cover Letter Acme.txt",
};

describe("CoverLetterModal", () => {
  let clickedAnchor: HTMLAnchorElement | null = null;
  const createObjectURL = vi.fn(() => "blob:cover-letter");
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    clickedAnchor = null;
    mocks.generate.mockResolvedValue(result);
    mocks.save.mockResolvedValue(result);
    mocks.buildPdf.mockReturnValue(
      new Blob(["%PDF-1.4"], { type: "application/pdf" }),
    );
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectURL,
      configurable: true,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clickedAnchor = this;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads a saved letter on open without calling the AI", () => {
    render(
      <CoverLetterModal
        open
        onOpenChange={vi.fn()}
        jobId="job-1"
        jobTitle="Engineer"
        employer="Acme"
        savedLetter="Saved letter."
      />,
    );

    expect(screen.getByLabelText("Generated cover letter")).toHaveValue(
      "Saved letter.",
    );
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /regenerate/i }),
    ).toBeInTheDocument();
  });

  it("generates only when the user asks, and keeps the letter editable", async () => {
    render(
      <CoverLetterModal
        open
        onOpenChange={vi.fn()}
        jobId="job-1"
        jobTitle="Engineer"
        employer="Acme"
      />,
    );

    expect(screen.getByLabelText("Generated cover letter")).toHaveValue("");
    expect(mocks.generate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));
    await waitFor(() => {
      expect(screen.getByLabelText("Generated cover letter")).toHaveValue(
        result.coverLetter,
      );
    });
    expect(mocks.generate).toHaveBeenCalledWith("job-1");

    fireEvent.change(screen.getByLabelText("Generated cover letter"), {
      target: { value: "Edited letter." },
    });
    expect(screen.getByLabelText("Generated cover letter")).toHaveValue(
      "Edited letter.",
    );
  });

  it("saves edits explicitly without generating another letter", async () => {
    const onSaved = vi.fn();
    render(
      <CoverLetterModal
        open
        onOpenChange={vi.fn()}
        jobId="job-1"
        employer="Acme"
        savedLetter="Original letter."
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText("Generated cover letter"), {
      target: { value: "Edited letter." },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledWith("job-1", "Edited letter.");
    });
    expect(onSaved).toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("downloads the edited letter with the company filename", async () => {
    render(
      <CoverLetterModal
        open
        onOpenChange={vi.fn()}
        jobId="job-1"
        employer="Acme"
        savedLetter="Original letter."
      />,
    );

    fireEvent.change(screen.getByLabelText("Generated cover letter"), {
      target: { value: "Edited letter." },
    });
    fireEvent.click(screen.getByRole("button", { name: /download \.txt/i }));

    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: "text/plain;charset=utf-8" }),
    );
    expect(clickedAnchor?.download).toBe(
      "Mohamed Mseddi Cover Letter Acme.txt",
    );
    expect(clickedAnchor?.href).toBe("blob:cover-letter");
  });

  it("downloads the edited letter as a PDF with a matching filename", async () => {
    render(
      <CoverLetterModal
        open
        onOpenChange={vi.fn()}
        jobId="job-1"
        employer="Acme"
        savedLetter="Original letter."
      />,
    );

    fireEvent.change(screen.getByLabelText("Generated cover letter"), {
      target: { value: "Edited letter." },
    });
    fireEvent.click(screen.getByRole("button", { name: /download \.pdf/i }));

    expect(mocks.buildPdf).toHaveBeenCalledWith("Edited letter.");
    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: "application/pdf" }),
    );
    expect(clickedAnchor?.download).toBe(
      "Mohamed Mseddi Cover Letter Acme.pdf",
    );
  });

  it("regenerates when requested and shows failures", async () => {
    render(
      <CoverLetterModal
        open
        onOpenChange={vi.fn()}
        jobId="job-1"
        employer="Acme"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));
    await waitFor(() => {
      expect(screen.getByLabelText("Generated cover letter")).toHaveValue(
        result.coverLetter,
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    await waitFor(() => {
      expect(mocks.generate).toHaveBeenCalledTimes(2);
    });

    mocks.generate.mockRejectedValueOnce(new Error("LLM unavailable"));
    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    await waitFor(() => {
      expect(screen.getByText("LLM unavailable")).toBeInTheDocument();
    });
  });
});
