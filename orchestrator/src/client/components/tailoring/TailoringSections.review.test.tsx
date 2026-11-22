import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TailoringSections } from "./TailoringSections";

type Props = React.ComponentProps<typeof TailoringSections>;

const renderReviewSections = (
  overrides: Partial<Props> = {},
) => {
  const props: Props = {
    catalog: [],
    isCatalogLoading: false,
    summary: "Manual summary",
    headline: "Manual headline",
    jobDescription: "Build APIs",
    skillsDraft: [],
    selectedIds: new Set(),
    tracerLinksEnabled: false,
    tracerEnableBlocked: false,
    tracerEnableBlockedReason: null,
    generatingSection: null,
    isGeneratingProjects: false,
    openSkillGroupId: "",
    disableInputs: false,
    suggestions: {
      summary: {
        current: "Manual summary",
        suggested: "AI summary",
        label: "Summary",
      },
    },
    originalBaseline: {
      summary: "Original summary",
      headline: "Original headline",
      skillsJson: JSON.stringify([
        { name: "Backend", keywords: ["Java", "Spring Boot"] },
      ]),
    },
    onAcceptSuggestion: vi.fn(),
    onKeepCurrentSuggestion: vi.fn(),
    onUndoOriginalSuggestion: vi.fn(),
    onGenerateSummary: vi.fn(),
    onGenerateHeadline: vi.fn(),
    onGenerateSkills: vi.fn(),
    onGenerateProjects: vi.fn(),
    onSummaryChange: vi.fn(),
    onHeadlineChange: vi.fn(),
    onUndoSummary: vi.fn(),
    onUndoHeadline: vi.fn(),
    onUndoSkills: vi.fn(),
    onRedoSummary: vi.fn(),
    onRedoHeadline: vi.fn(),
    onRedoSkills: vi.fn(),
    canUndoSummary: false,
    canUndoHeadline: false,
    canUndoSkills: false,
    canRedoSummary: false,
    canRedoHeadline: false,
    canRedoSkills: false,
    onDescriptionChange: vi.fn(),
    onSkillGroupOpenChange: vi.fn(),
    onAddSkillGroup: vi.fn(),
    onUpdateSkillGroup: vi.fn(),
    onRemoveSkillGroup: vi.fn(),
    onToggleProject: vi.fn(),
    onTracerLinksEnabledChange: vi.fn(),
    ...overrides,
  };

  return { props, view: render(<TailoringSections {...props} />) };
};

describe("TailoringSections review layer", () => {
  it("shows the manual value, AI suggestion, and review actions", () => {
    renderReviewSections();

    fireEvent.click(
      screen.getByRole("button", { name: "Review AI suggestions" }),
    );

    expect(screen.getByText("Manual summary")).toBeInTheDocument();
    expect(screen.getByText("AI summary")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Use AI draft for Summary",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Keep mine for Summary" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Undo to original for Summary" }),
    ).toBeInTheDocument();
  });

  it("wires review actions without generating content itself", () => {
    const onAcceptSuggestion = vi.fn();
    const onKeepCurrentSuggestion = vi.fn();
    const onUndoOriginalSuggestion = vi.fn();
    const onGenerateSummary = vi.fn();
    renderReviewSections({
      onAcceptSuggestion,
      onKeepCurrentSuggestion,
      onUndoOriginalSuggestion,
      onGenerateSummary,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Review AI suggestions" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Use AI draft for Summary" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Keep mine for Summary" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Undo to original for Summary" }),
    );

    expect(onAcceptSuggestion).toHaveBeenCalledWith("summary");
    expect(onKeepCurrentSuggestion).toHaveBeenCalledWith("summary");
    expect(onUndoOriginalSuggestion).toHaveBeenCalledWith("summary");
    expect(onGenerateSummary).not.toHaveBeenCalled();
  });

  it("shows the Resume Studio baseline for comparison", () => {
    renderReviewSections();

    fireEvent.click(
      screen.getByRole("button", { name: "Resume Studio baseline" }),
    );

    expect(screen.getAllByText("Original summary").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Original headline").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Backend: Java, Spring Boot/),
    ).toBeInTheDocument();
  });
});
