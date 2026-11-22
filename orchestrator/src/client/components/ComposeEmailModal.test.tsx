import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComposeEmailModal } from "./ComposeEmailModal";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  send: vi.fn(),
  openJobPdf: vi.fn(),
}));

vi.mock("@client/api", () => ({
  previewJobRecruiterEmail: mocks.preview,
  sendJobRecruiterEmail: mocks.send,
}));

vi.mock("@client/components/pdf/JobPdfViewerProvider", () => ({
  useJobPdfViewer: () => ({ openJobPdf: mocks.openJobPdf }),
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

const coverLetter = "Dear hiring team, please consider my application.";

const preview = {
  previewToken: "preview-token",
  jobId: "job-1",
  messageId: "msg-1",
  to: "recruiter@example.com",
  subject: "Application for Engineer",
  body: `${coverLetter}\n\nKind regards,\nMohamed`,
  coverLetter,
  attachments: [{ name: "resume.pdf", size: 1024, type: "application/pdf" }],
  expiresAt: Date.now() + 60_000,
};

describe("ComposeEmailModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.preview.mockResolvedValue(preview);
    mocks.send.mockResolvedValue({
      jobId: "job-1",
      sentAt: Date.now(),
      to: "recruiter@example.com",
      subject: preview.subject,
      attachmentNames: ["resume.pdf"],
      sentEmailId: "sent-1",
    });
  });

  it("loads the preview and requires explicit confirmation before sending", async () => {
    render(<ComposeEmailModal open onOpenChange={vi.fn()} jobId="job-1" />);

    await waitFor(() => {
      expect(screen.getByLabelText("To")).toHaveValue(preview.to);
    });
    expect(screen.getByLabelText("Subject")).toHaveValue(preview.subject);
    expect(screen.getByLabelText("Message")).toHaveValue(preview.body);

    const sendButton = screen.getByRole("button", { name: /send email/i });
    expect(sendButton).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(sendButton).toBeEnabled();

    fireEvent.click(sendButton);
    await waitFor(() => {
      expect(mocks.send).toHaveBeenCalledWith("job-1", {
        previewToken: "preview-token",
        to: preview.to,
        subject: preview.subject,
        body: preview.body,
      });
    });
  });

  it("warns when the recipient was taken from the job details", async () => {
    mocks.preview.mockResolvedValueOnce({
      ...preview,
      messageId: null,
      to: "sgoncalves@xccelerated.io",
      recipientSource: "job",
    });

    render(<ComposeEmailModal open onOpenChange={vi.fn()} jobId="job-1" />);

    await waitFor(() => {
      expect(screen.getByLabelText("To")).toHaveValue(
        "sgoncalves@xccelerated.io",
      );
    });
    expect(
      screen.getByText(
        /came from the job details, not a tracked recruiter email/i,
      ),
    ).toBeInTheDocument();
  });

  it("warns when the recipient must be entered manually and sends the typed address", async () => {
    mocks.preview.mockResolvedValueOnce({
      ...preview,
      messageId: null,
      to: "",
      recipientSource: "manual",
    });

    render(<ComposeEmailModal open onOpenChange={vi.fn()} jobId="job-1" />);

    await waitFor(() => {
      expect(screen.getByLabelText("To")).toHaveValue("");
    });
    expect(
      screen.getByText(/no recruiter address was found/i),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "manual.recruiter@example.com" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /send email/i }));

    await waitFor(() => {
      expect(mocks.send).toHaveBeenCalledWith(
        "job-1",
        expect.objectContaining({ to: "manual.recruiter@example.com" }),
      );
    });
  });

  it("keeps send disabled until a valid manual recipient is entered", async () => {
    mocks.preview.mockResolvedValueOnce({
      ...preview,
      messageId: null,
      to: "",
      recipientSource: "manual",
    });

    render(<ComposeEmailModal open onOpenChange={vi.fn()} jobId="job-1" />);

    const toInput = await screen.findByLabelText("To");
    expect(toInput).toHaveAttribute("placeholder", "name@company.com");
    fireEvent.click(screen.getByRole("checkbox"));

    const sendButton = screen.getByRole("button", { name: /send email/i });
    expect(sendButton).toBeDisabled();

    fireEvent.change(toInput, { target: { value: "not-an-email" } });
    expect(sendButton).toBeDisabled();

    fireEvent.change(toInput, {
      target: { value: "manual.recruiter@example.com" },
    });
    expect(sendButton).toBeEnabled();
  });

  it("warns when no cover letter is saved and requires one before sending", async () => {
    mocks.preview.mockResolvedValueOnce({
      ...preview,
      coverLetter: "",
      body: "",
    });

    render(<ComposeEmailModal open onOpenChange={vi.fn()} jobId="job-1" />);

    await waitFor(() => {
      expect(screen.getByLabelText("Cover letter")).toHaveValue("");
    });
    expect(screen.getByText(/no cover letter is saved/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox"));
    const sendButton = screen.getByRole("button", { name: /send email/i });
    expect(sendButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Cover letter"), {
      target: { value: "My own letter." },
    });
    expect(screen.getByLabelText("Message")).toHaveValue(
      "My own letter.\n\nKind regards,",
    );
    expect(sendButton).toBeEnabled();
  });

  it("sends edited recipient, subject, and body", async () => {
    render(<ComposeEmailModal open onOpenChange={vi.fn()} jobId="job-1" />);

    await waitFor(() => {
      expect(screen.getByLabelText("To")).toHaveValue(preview.to);
    });

    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "new.recruiter@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "Edited subject" },
    });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Edited body" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /send email/i }));

    await waitFor(() => {
      expect(mocks.send).toHaveBeenCalledWith(
        "job-1",
        expect.objectContaining({
          to: "new.recruiter@example.com",
          subject: "Edited subject",
          body: "Edited body",
        }),
      );
    });
  });

  it("shows the preview error when generation fails", async () => {
    mocks.preview.mockRejectedValueOnce(new Error("No matched email"));

    render(<ComposeEmailModal open onOpenChange={vi.fn()} jobId="job-1" />);

    await waitFor(() => {
      expect(screen.getByText("No matched email")).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /send email/i }),
    ).toBeDisabled();
  });

  it("edits the cover letter and keeps the sent message in sync", async () => {
    render(<ComposeEmailModal open onOpenChange={vi.fn()} jobId="job-1" />);

    await waitFor(() => {
      expect(screen.getByLabelText("Cover letter")).toHaveValue(coverLetter);
    });

    fireEvent.change(screen.getByLabelText("Cover letter"), {
      target: { value: "Edited cover letter body." },
    });

    expect(screen.getByLabelText("Message")).toHaveValue(
      "Edited cover letter body.\n\nKind regards,\nMohamed",
    );
  });

  it("opens the tailored CV in the in-app PDF popup", async () => {
    render(
      <ComposeEmailModal
        open
        onOpenChange={vi.fn()}
        jobId="job-1"
        jobTitle="Senior Engineer"
        employer="Dwareapps"
      />,
    );

    const previewPdfButton = await screen.findByRole("button", {
      name: /preview pdf/i,
    });
    fireEvent.click(previewPdfButton);

    expect(mocks.openJobPdf).toHaveBeenCalledWith(
      "job-1",
      "Senior Engineer",
      "Mohamed Mseddi Resume Dwareapps.pdf",
    );
  });
});
