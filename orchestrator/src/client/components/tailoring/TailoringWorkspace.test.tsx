import * as api from "@client/api";
import type { Job } from "@shared/types.js";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TailoringWorkspace } from "./TailoringWorkspace";

const mocks = vi.hoisted(() => ({
  openJobPdf: vi.fn(),
  sectionProps: { current: null as Record<string, any> | null },
}));

vi.mock("@client/api", () => ({
  generateJobPdf: vi.fn().mockResolvedValue({}),
  getResumeProjectsCatalog: vi.fn().mockResolvedValue([]),
  getTailoringPlan: vi.fn(),
  summarizeJob: vi.fn(),
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
  TailoringSections: (props: Record<string, any>) => {
    mocks.sectionProps.current = props;
    return (
      <div data-testid="tailoring-sections">
        <button
          type="button"
          onClick={() => props.onSummaryChange("Manual summary")}
        >
          edit summary
        </button>
        <button
          type="button"
          onClick={() => props.onAcceptSuggestion("summary")}
        >
          accept summary
        </button>
        <button
          type="button"
          onClick={() => props.onKeepCurrentSuggestion("summary")}
        >
          keep summary
        </button>
        <button type="button" onClick={() => props.onCheckEvidence()}>
          check evidence
        </button>
        <button type="button" onClick={() => props.onAcceptPlanItem(0)}>
          accept plan item
        </button>
      </div>
    );
  },
}));

const makeJob = (overrides: Partial<Job> = {}): Job =>
  ({
    id: "job-1",
    title: "Software Engineer",
    employer: "Example Co",
    status: "ready",
    tailoredSummary: "Saved summary",
    tailoredHeadline: "Saved headline",
    tailoredSkills: "[]",
    jobDescription: "Job description",
    selectedProjectIds: "",
    tracerLinksEnabled: false,
    pdfPath: "data/pdfs/job-1.pdf",
    ...overrides,
  }) as Job;

const generatedSkills = JSON.stringify([
  { name: "Backend", keywords: ["Java"] },
]);

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
    expect(api.summarizeJob).not.toHaveBeenCalled();
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

describe("TailoringWorkspace generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sectionProps.current = null;
    vi.mocked(api.summarizeJob).mockResolvedValue(
      makeJob({
        tailoredSummary: "AI summary",
        tailoredHeadline: "AI headline",
        tailoredSkills: generatedSkills,
      }),
    );
    vi.mocked(api.updateJob).mockResolvedValue(makeJob());
    vi.mocked(api.getResumeProjectsCatalog).mockResolvedValue([]);
  });

  const generateAll = async () => {
    fireEvent.click(screen.getByRole("button", { name: /generate all/i }));
    await waitFor(() => {
      expect(api.summarizeJob).toHaveBeenCalledWith("job-1", {
        force: true,
        fields: ["summary", "headline", "skills"],
      });
    });
  };

  it("keeps manual edits and stores AI wording as a review suggestion", async () => {
    render(
      <TailoringWorkspace mode="editor" job={makeJob()} onUpdate={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "edit summary" }));
    await generateAll();

    await waitFor(() => {
      expect(mocks.sectionProps.current?.suggestions.summary).toBeDefined();
    });
    expect(mocks.sectionProps.current?.summary).toBe("Manual summary");
    expect(mocks.sectionProps.current?.suggestions.summary).toMatchObject({
      current: "Manual summary",
      suggested: "AI summary",
      label: "Summary",
    });
    expect(api.updateJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ tailoredSummary: "Manual summary" }),
    );
  });

  it("keeps manual edits after autosave refreshes the job prop", async () => {
    const AutosavingHarness = () => {
      const [job, setJob] = useState(() => makeJob());
      return (
        <TailoringWorkspace
          mode="editor"
          job={job}
          onUpdate={(updated) => {
            if (updated) setJob(updated);
          }}
        />
      );
    };
    vi.mocked(api.updateJob).mockResolvedValue(
      makeJob({ tailoredSummary: "Manual summary" }),
    );

    render(<AutosavingHarness />);
    fireEvent.click(screen.getByRole("button", { name: "edit summary" }));
    await waitFor(
      () => {
        expect(api.updateJob).toHaveBeenCalledWith(
          "job-1",
          expect.objectContaining({ tailoredSummary: "Manual summary" }),
        );
      },
      { timeout: 3000 },
    );

    await generateAll();

    await waitFor(() => {
      expect(mocks.sectionProps.current?.suggestions.summary).toBeDefined();
    });
    expect(mocks.sectionProps.current?.summary).toBe("Manual summary");
    expect(mocks.sectionProps.current?.suggestions.summary).toMatchObject({
      current: "Manual summary",
      suggested: "AI summary",
    });
  });

  it("applies AI output to fields that were not manually edited", async () => {
    render(
      <TailoringWorkspace mode="editor" job={makeJob()} onUpdate={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "edit summary" }));
    await generateAll();

    await waitFor(() => {
      expect(mocks.sectionProps.current?.headline).toBe("AI headline");
    });
    expect(mocks.sectionProps.current?.skillsDraft).toHaveLength(1);
    expect(mocks.sectionProps.current?.suggestions.headline).toBeUndefined();
  });

  it("allows accepting an AI suggestion", async () => {
    render(
      <TailoringWorkspace mode="editor" job={makeJob()} onUpdate={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "edit summary" }));
    await generateAll();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "accept summary" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "accept summary" }));

    await waitFor(() => {
      expect(mocks.sectionProps.current?.summary).toBe("AI summary");
    });
    expect(mocks.sectionProps.current?.suggestions.summary).toBeUndefined();
  });

  it("allows keeping the manual version and dismissing the suggestion", async () => {
    render(
      <TailoringWorkspace mode="editor" job={makeJob()} onUpdate={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "edit summary" }));
    await generateAll();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "keep summary" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "keep summary" }));

    await waitFor(() => {
      expect(mocks.sectionProps.current?.suggestions.summary).toBeUndefined();
    });
    expect(mocks.sectionProps.current?.summary).toBe("Manual summary");
  });
});

describe("TailoringWorkspace evidence review", () => {
  const readyJob = () => makeJob({ tailoredSkills: generatedSkills });

  const planResult = (check: {
    blocked: string[];
    unsupported: string[];
  }) => ({
    items: [
      {
        jdRequirement: "Build Java services",
        evidenceRefs: ["project:payments-platform"],
        proposedWording: "Built Java services",
        targetField: "summary",
        supportLevel: "strong",
        status: "ready",
        userDecision: "pending",
      },
    ],
    check: {
      blocked: check.blocked,
      unsupported: check.unsupported,
      covered: [],
      missingEvidenceRefs: [],
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sectionProps.current = null;
    vi.mocked(api.updateJob).mockResolvedValue(readyJob());
    vi.mocked(api.getResumeProjectsCatalog).mockResolvedValue([]);
    vi.mocked(api.getTailoringPlan).mockResolvedValue(
      planResult({ blocked: [], unsupported: [] }) as never,
    );
  });

  it("does not call AI or the evidence check when the workspace opens", () => {
    render(
      <TailoringWorkspace mode="editor" job={readyJob()} onUpdate={vi.fn()} />,
    );

    expect(api.summarizeJob).not.toHaveBeenCalled();
    expect(api.getTailoringPlan).not.toHaveBeenCalled();
  });

  it("loads a plan only after the explicit Check evidence action", async () => {
    render(
      <TailoringWorkspace mode="editor" job={readyJob()} onUpdate={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "check evidence" }));

    await waitFor(() => {
      expect(api.getTailoringPlan).toHaveBeenCalledWith(
        "job-1",
        expect.stringContaining("Saved summary"),
      );
    });
    expect(mocks.sectionProps.current?.plan.items).toHaveLength(1);
  });

  it("applies accepted plan wording without silent generation", async () => {
    render(
      <TailoringWorkspace mode="editor" job={readyJob()} onUpdate={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "check evidence" }));
    await waitFor(() => {
      expect(mocks.sectionProps.current?.plan).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "accept plan item" }));

    await waitFor(() => {
      expect(mocks.sectionProps.current?.summary).toContain(
        "Built Java services",
      );
    });
    expect(api.summarizeJob).not.toHaveBeenCalled();
  });

  it("hard-blocks neverClaim terms even after acknowledgment", async () => {
    vi.mocked(api.getTailoringPlan).mockResolvedValue(
      planResult({
        blocked: ["Kubernetes administrator"],
        unsupported: [],
      }) as never,
    );
    render(
      <TailoringWorkspace mode="editor" job={readyJob()} onUpdate={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: /generate pdf/i }),
    ).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "check evidence" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Kubernetes administrator",
      );
    });

    expect(
      screen.getByRole("button", { name: /generate pdf/i }),
    ).toBeDisabled();
    expect(
      screen.queryByLabelText(/I have reviewed the unsupported claims/i),
    ).not.toBeInTheDocument();
  });

  it("requires acknowledgment for unsupported claims and resets it on edits", async () => {
    vi.mocked(api.getTailoringPlan).mockResolvedValue(
      planResult({ blocked: [], unsupported: ["graphql"] }) as never,
    );
    render(
      <TailoringWorkspace mode="editor" job={readyJob()} onUpdate={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "check evidence" }));
    const acknowledgment = await screen.findByLabelText(
      /I have reviewed the unsupported claims/i,
    );
    expect(
      screen.getByRole("button", { name: /generate pdf/i }),
    ).toBeDisabled();

    fireEvent.click(acknowledgment);
    expect(
      screen.getByRole("button", { name: /generate pdf/i }),
    ).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "edit summary" }));
    expect(
      screen.getByRole("button", { name: /generate pdf/i }),
    ).toBeDisabled();
  });
});
