import type { Job } from "@shared/types.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TailoringWorkspace } from "./TailoringWorkspace";

const mocks = vi.hoisted(() => ({
  openJobPdf: vi.fn(),
}));

vi.mock("@client/api", () => ({
  generateJobPdf: vi.fn().mockResolvedValue({}),
  getResumeProjectsCatalog: vi.fn().mockResolvedValue([]),
  summarizeJob: vi.fn().mockResolvedValue({}),
  updateJob: vi.fn().mockImplementation(async (_id, payload) => payload),
}));

vi.mock("@client/hooks/useProfile", () => ({
  useProfile: () => ({ profile: null, error: null }),
}));

vi.mock("@client/hooks/useSettings", () => ({
  useSettings: () => ({ settings: null, isLoading: false }),
}));

vi.mock("@client/hooks/useTracerReadiness", () => ({
  useTracerReadiness: () => ({
    readiness: { canEnable: true },
    isChecking: false,
  }),
}));

vi.mock("@client/components/pdf/JobPdfViewerProvider", () => ({
  useJobPdfViewer: () => ({ openJobPdf: mocks.openJobPdf }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./TailoringSections", () => ({
  TailoringSections: () => <div data-testid="tailoring-sections" />,
}));

const makeJob = (overrides: Partial<Job> = {}): Job =>
  ({
    id: "job-1",
    title: "Software Engineer",
    employer: "Example Co",
    status: "ready",
    tailoredSummary: "Tailored summary",
    tailoredHeadline: "Tailored headline",
    tailoredSkills: "[]",
    jobDescription: "Job description",
    selectedProjectIds: "",
    tracerLinksEnabled: false,
    pdfPath: "data/pdfs/job-1.pdf",
    ...overrides,
  }) as Job;

describe("TailoringWorkspace PDF preview", () => {
  beforeEach(() => {
    mocks.openJobPdf.mockClear();
  });

  it("opens the generated PDF when Preview PDF is clicked", async () => {
    render(
      <TailoringWorkspace mode="editor" job={makeJob()} onUpdate={vi.fn()} />,
    );

    const previewButton = await screen.findByRole("button", {
      name: /preview pdf/i,
    });
    fireEvent.click(previewButton);

    expect(mocks.openJobPdf).toHaveBeenCalledWith(
      "job-1",
      "Software Engineer",
      "Mohamed Mseddi Resume Example Co.pdf",
    );
  });

  it("does not offer a preview before a PDF exists", () => {
    render(
      <TailoringWorkspace
        mode="editor"
        job={makeJob({ pdfPath: null })}
        onUpdate={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /preview pdf/i }),
    ).not.toBeInTheDocument();
  });
});
