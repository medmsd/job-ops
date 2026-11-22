import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TailoringRulesStrip } from "./TailoringRulesStrip";

describe("TailoringRulesStrip", () => {
  it("shows a loading state while settings load", () => {
    render(<TailoringRulesStrip isLoading />);

    expect(screen.getByText(/loading tailoring rules/i)).toBeInTheDocument();
  });

  it("shows default rules when no settings are available", () => {
    render(<TailoringRulesStrip />);

    expect(screen.getByText(/default rules/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /edit in settings/i }),
    ).toHaveAttribute("href", "/settings");
  });

  it("shows the effective writing rules", () => {
    render(
      <TailoringRulesStrip
        language="Match job description"
        tone="confident"
        formality="medium"
        constraints="Keep summaries concise"
        doNotUse="synergy, game-changer"
        summaryMaxWords={45}
        maxKeywordsPerSkill={8}
      />,
    );

    expect(screen.getByText(/match job description/i)).toBeInTheDocument();
    expect(screen.getByText(/confident/i)).toBeInTheDocument();
    expect(screen.getByText(/medium/i)).toBeInTheDocument();
    expect(screen.getByText(/max 45 words/i)).toBeInTheDocument();
    expect(screen.getByText(/max 8 keywords/i)).toBeInTheDocument();
    expect(screen.getByText(/keep summaries concise/i)).toBeInTheDocument();
    expect(screen.getByText(/synergy, game-changer/i)).toBeInTheDocument();
  });
});
