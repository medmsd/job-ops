import * as api from "@client/api";
import type {
  DesignResumeJson,
  Job,
  TailoredFitResult,
  TailoredFitState,
  TailoredResumeSnapshot,
} from "@shared/types.js";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TailoringWorkspace } from "./TailoringWorkspace";

const mocks = vi.hoisted(() => ({
  openJobPdf: vi.fn(),
  sectionProps: { current: null as Record<string, any> | null },
}));

vi.mock("@client/api", () => ({
  approveTailoredSnapshot: vi.fn(),
  generateDesignResumeFieldSuggestion: vi.fn(),
  generateJobPdf: vi.fn().mockResolvedValue({}),
  getCurrentTailoredSnapshot: vi.fn(),
  getResumeProjectsCatalog: vi.fn().mockResolvedValue([]),
  getTailoredFit: vi.fn().mockResolvedValue({
    result: null,
    isStale: false,
    reason: "not_checked",
  }),
  computeTailoredFit: vi.fn().mockResolvedValue({}),
  getTailoredSnapshots: vi.fn(),
  getTailoringPlan: vi.fn(),
  restoreTailoredSnapshot: vi.fn(),
  saveTailoredSnapshot: vi.fn(),
  summarizeJob: vi.fn(),
  updateJob: vi.fn().mockImplementation(async (_id, payload) => payload),
}));

vi.mock("@client/api/settings-profile", () => ({
  getDesignResumeAssetContentBlob: vi.fn(),
}));

vi.mock("../design-resume/DesignResumeFieldAssistant", () => ({
  DesignResumeFieldAssistant: () => null,
}));

vi.mock("../design-resume/RichTextEditor", () => ({
  RichTextEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (next: string) => void;
  }) => (
    <textarea
      aria-label="Rich text content"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ),
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
    tailoredResumeSnapshotId: "snapshot-1",
    tailoredResumeVersion: 1,
    ...overrides,
  }) as Job;

const generatedSkills = JSON.stringify([
  { name: "Backend", keywords: ["Java"] },
]);

const snapshotResumeJson = {
  basics: {
    name: "Mohamed Mseddi",
    headline: "Saved headline",
    email: "candidate@example.com",
    phone: "",
    location: "",
    website: { url: "" },
  },
  summary: { content: "<p>Saved summary</p>" },
  sections: {
    skills: {
      items: [{ id: "skill-1", name: "Backend", keywords: ["Java"] }],
    },
  },
} as unknown as DesignResumeJson;

const makeSnapshot = (
  overrides: Partial<TailoredResumeSnapshot> = {},
): TailoredResumeSnapshot =>
  ({
    id: "snapshot-1",
    jobId: "job-1",
    version: 1,
    status: "approved",
    origin: "approved",
    resumeJson: snapshotResumeJson,
    changes: [
      {
        path: "basics.headline",
        label: "Headline",
        kind: "changed",
        before: "Base headline",
        after: "Saved headline",
      },
    ],
    ats: null,
    model: null,
    baseResumeDocumentId: null,
    baseResumeRevision: null,
    generatedAt: 1,
    createdAt: "2026-11-22T10:00:00.000Z",
    updatedAt: "2026-11-22T10:00:00.000Z",
    ...overrides,
  }) as TailoredResumeSnapshot;

const mockSnapshot = makeSnapshot();

const fitResult: TailoredFitResult = {
  score: 42,
  summary: "Tailored to Java backend requirements.",
  notes: [
    {
      requirement: "Build Java services",
      status: "covered",
      explanation: "Covered by the payments-platform project.",
      evidenceRefs: ["project:payments-platform"],
    },
  ],
  snapshotId: "snapshot-1",
  snapshotVersion: 1,
  inputHash: "input-hash-1",
  computedAt: 1,
  model: null,
};

const makeFitState = (
  overrides: Partial<TailoredFitState> = {},
): TailoredFitState => ({
  result: null,
  isStale: false,
  reason: "not_checked",
  ...overrides,
});

beforeEach(() => {
  vi.mocked(api.getTailoredFit).mockResolvedValue(makeFitState());
  vi.mocked(api.computeTailoredFit).mockResolvedValue(makeJob());
});

describe("TailoringWorkspace snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getCurrentTailoredSnapshot).mockResolvedValue(mockSnapshot);
    vi.mocked(api.getTailoredSnapshots).mockResolvedValue([mockSnapshot]);
    vi.mocked(api.approveTailoredSnapshot).mockResolvedValue(mockSnapshot);
    vi.mocked(api.saveTailoredSnapshot).mockResolvedValue(mockSnapshot);
    vi.mocked(api.restoreTailoredSnapshot).mockResolvedValue(mockSnapshot);
    vi.mocked(api.getResumeProjectsCatalog).mockResolvedValue([]);
    vi.mocked(api.updateJob).mockResolvedValue(makeJob());
  });

  it("does not call AI or snapshot approval on open", () => {
    render(
      <TailoringWorkspace
        mode="editor"
        job={makeJob({ tailoredSkills: generatedSkills })}
        onUpdate={vi.fn()}
      />,
    );

    expect(api.summarizeJob).not.toHaveBeenCalled();
    expect(api.approveTailoredSnapshot).not.toHaveBeenCalled();
    expect(api.generateDesignResumeFieldSuggestion).not.toHaveBeenCalled();
    expect(api.getCurrentTailoredSnapshot).toHaveBeenCalledWith("job-1");
    expect(api.getTailoredSnapshots).toHaveBeenCalledWith("job-1");
  });

  it("only offers Approve snapshot when the job has a description", async () => {
    vi.mocked(api.getCurrentTailoredSnapshot).mockResolvedValue(null);
    const withoutDescription = makeJob({
      jobDescription: null,
      tailoredSkills: generatedSkills,
      tailoredResumeSnapshotId: null,
      tailoredResumeVersion: null,
    });
    const { rerender } = render(
      <TailoringWorkspace
        mode="editor"
        job={withoutDescription}
        onUpdate={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /approve snapshot/i }),
    ).not.toBeInTheDocument();

    rerender(
      <TailoringWorkspace
        mode="editor"
        job={makeJob({
          tailoredSkills: generatedSkills,
          tailoredResumeSnapshotId: null,
          tailoredResumeVersion: null,
        })}
        onUpdate={vi.fn()}
      />,
    );

    const approveButton = await screen.findByRole("button", {
      name: /approve snapshot/i,
    });
    await waitFor(() => expect(approveButton).toBeEnabled());
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(api.approveTailoredSnapshot).toHaveBeenCalledTimes(1);
      expect(api.approveTailoredSnapshot).toHaveBeenCalledWith("job-1");
    });
  });

  it("gates Generate PDF on the current approved snapshot and version", async () => {
    const { unmount } = render(
      <TailoringWorkspace
        mode="editor"
        job={makeJob({
          tailoredSkills: generatedSkills,
          tailoredResumeSnapshotId: null,
          tailoredResumeVersion: null,
        })}
        onUpdate={vi.fn()}
      />,
    );

    const blockedButton = await screen.findByRole("button", {
      name: /generate pdf/i,
    });
    expect(blockedButton).toBeDisabled();
    expect(
      await screen.findByText(
        "Approve a tailored CV snapshot before generating a PDF.",
      ),
    ).toBeInTheDocument();
    unmount();

    render(
      <TailoringWorkspace
        mode="editor"
        job={makeJob({ tailoredSkills: generatedSkills })}
        onUpdate={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /generate pdf/i }),
      ).toBeEnabled();
    });
  });

  it("opens the full CV editor and saves edits as a new version", async () => {
    const updated = makeSnapshot({
      id: "snapshot-2",
      version: 2,
      resumeJson: {
        ...snapshotResumeJson,
        basics: {
          ...snapshotResumeJson.basics,
          headline: "Edited headline",
        },
      } as unknown as DesignResumeJson,
    });
    vi.mocked(api.saveTailoredSnapshot).mockResolvedValue(updated);
    vi.mocked(api.getTailoredSnapshots).mockResolvedValue([
      updated,
      mockSnapshot,
    ]);

    render(
      <TailoringWorkspace
        mode="editor"
        job={makeJob({ tailoredSkills: generatedSkills })}
        onUpdate={vi.fn()}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /open full tailored cv/i }),
    );

    expect(
      await screen.findByText("Changes from baseline"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "Edited headline" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save edits/i }));

    await waitFor(() => {
      expect(api.saveTailoredSnapshot).toHaveBeenCalledWith(
        "job-1",
        "snapshot-1",
        expect.objectContaining({
          basics: expect.objectContaining({ headline: "Edited headline" }),
        }),
      );
    });
    expect(api.summarizeJob).not.toHaveBeenCalled();
    expect(api.generateDesignResumeFieldSuggestion).not.toHaveBeenCalled();
  });
});

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
      expect(
        screen.getByRole("button", { name: "accept summary" }),
      ).toBeEnabled();
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
      expect(
        screen.getByRole("button", { name: "keep summary" }),
      ).toBeEnabled();
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

  const planResult = (check: { blocked: string[]; unsupported: string[] }) => ({
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
    vi.mocked(api.getCurrentTailoredSnapshot).mockResolvedValue(mockSnapshot);
    vi.mocked(api.getTailoredSnapshots).mockResolvedValue([mockSnapshot]);
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
    expect(api.approveTailoredSnapshot).not.toHaveBeenCalled();
    expect(api.generateDesignResumeFieldSuggestion).not.toHaveBeenCalled();
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
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /generate pdf/i }),
      ).toBeEnabled();
    });

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
    expect(screen.getByRole("button", { name: /generate pdf/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "edit summary" }));
    expect(
      screen.getByRole("button", { name: /generate pdf/i }),
    ).toBeDisabled();
  });
});

describe("TailoringWorkspace tailored fit", () => {
  const readyJob = () => makeJob({ tailoredSkills: generatedSkills });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sectionProps.current = null;
    vi.mocked(api.getCurrentTailoredSnapshot).mockResolvedValue(mockSnapshot);
    vi.mocked(api.getTailoredSnapshots).mockResolvedValue([mockSnapshot]);
    vi.mocked(api.updateJob).mockResolvedValue(readyJob());
    vi.mocked(api.getTailoredFit).mockResolvedValue(makeFitState());
    vi.mocked(api.computeTailoredFit).mockResolvedValue(readyJob());
  });

  it("reads tailored fit on open without starting AI or a compute", () => {
    render(
      <TailoringWorkspace mode="editor" job={readyJob()} onUpdate={vi.fn()} />,
    );

    expect(api.getTailoredFit).toHaveBeenCalledWith("job-1");
    expect(api.computeTailoredFit).not.toHaveBeenCalled();
    expect(api.summarizeJob).not.toHaveBeenCalled();
    expect(api.generateDesignResumeFieldSuggestion).not.toHaveBeenCalled();
    expect(
      screen.getByText("Derived tailored fit — job-specific"),
    ).toBeInTheDocument();
  });

  it("computes tailored fit only after the explicit Check tailored fit action", async () => {
    const updatedJob = makeJob({ tailoredFitScore: fitResult.score });
    const onUpdate = vi.fn();
    vi.mocked(api.computeTailoredFit).mockResolvedValue(updatedJob);
    vi.mocked(api.getTailoredFit)
      .mockResolvedValueOnce(makeFitState())
      .mockResolvedValue(makeFitState({ result: fitResult, reason: null }));

    render(
      <TailoringWorkspace mode="editor" job={readyJob()} onUpdate={onUpdate} />,
    );

    expect(api.computeTailoredFit).not.toHaveBeenCalled();
    const checkButton = await screen.findByRole("button", {
      name: "Check tailored fit",
    });
    await waitFor(() => expect(checkButton).toBeEnabled());
    fireEvent.click(checkButton);

    await waitFor(() => {
      expect(api.computeTailoredFit).toHaveBeenCalledTimes(1);
      expect(api.computeTailoredFit).toHaveBeenCalledWith("job-1");
    });
    expect(onUpdate).toHaveBeenCalledWith(updatedJob);
    await waitFor(() => expect(api.getTailoredFit).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("42/100")).toBeInTheDocument();
    expect(api.summarizeJob).not.toHaveBeenCalled();
  });

  it("disables the check and explains a missing job description or snapshot", async () => {
    vi.mocked(api.getCurrentTailoredSnapshot).mockResolvedValue(null);
    const { unmount } = render(
      <TailoringWorkspace
        mode="editor"
        job={makeJob({
          jobDescription: null,
          tailoredSkills: generatedSkills,
          tailoredResumeSnapshotId: null,
          tailoredResumeVersion: null,
        })}
        onUpdate={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Check tailored fit" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Add a job description to check tailored fit."),
    ).toBeInTheDocument();
    unmount();

    render(
      <TailoringWorkspace
        mode="editor"
        job={makeJob({
          id: "job-2",
          tailoredSkills: generatedSkills,
          tailoredResumeSnapshotId: null,
          tailoredResumeVersion: null,
        })}
        onUpdate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Check tailored fit" }),
      ).toBeDisabled();
      expect(
        screen.getByText(
          "Approve a tailored CV snapshot to check tailored fit.",
        ),
      ).toBeInTheDocument();
    });
    expect(api.computeTailoredFit).not.toHaveBeenCalled();
  });

  it("shows a stale warning when the stored tailored fit is stale", async () => {
    vi.mocked(api.getTailoredFit).mockResolvedValue(
      makeFitState({
        result: fitResult,
        isStale: true,
        reason: "inputs_changed",
      }),
    );

    render(
      <TailoringWorkspace mode="editor" job={readyJob()} onUpdate={vi.fn()} />,
    );

    expect(
      await screen.findByText(
        /inputs changed since the last tailored-fit check/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("42/100")).toBeInTheDocument();
  });

  it("shows the derived score rather than the source suitability score", async () => {
    vi.mocked(api.getTailoredFit).mockResolvedValue(
      makeFitState({ result: fitResult, reason: null }),
    );

    render(
      <TailoringWorkspace
        mode="editor"
        job={makeJob({ suitabilityScore: 99, tailoredSkills: generatedSkills })}
        onUpdate={vi.fn()}
      />,
    );

    expect(await screen.findByText("42/100")).toBeInTheDocument();
    expect(screen.queryByText(/99/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Derived tailored fit — job-specific"),
    ).toBeInTheDocument();
    expect(screen.getByText(/project:payments-platform/)).toBeInTheDocument();
  });
});
