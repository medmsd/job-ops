import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import {
  type CareerEvidenceBank,
  createEmptyCareerEvidenceBank,
} from "@shared/types/career-evidence.js";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { CareerEvidenceSection } from "./CareerEvidenceSection";

const BANK: CareerEvidenceBank = {
  targetRoles: ["Senior Java Backend Engineer"],
  coreSkills: [
    {
      name: "Java",
      years: 8,
      level: "expert",
      evidence: ["project:payments-platform"],
      aliases: ["JVM"],
    },
  ],
  achievements: [
    {
      id: "ev-latency",
      text: "Reduced p95 latency",
      metric: "77%",
      evidence: ["project:payments-platform"],
    },
  ],
  alwaysInclude: ["REST APIs"],
  neverClaim: ["Kubernetes administrator"],
  preferredTerms: ["Spring Boot"],
  avoidTerms: ["ninja"],
};

type HarnessProps = {
  bank?: CareerEvidenceBank | null;
  danglingRef?: string;
};

const CareerEvidenceHarness: React.FC<HarnessProps> = ({
  bank = BANK,
  danglingRef,
}) => {
  const seeded = bank ?? createEmptyCareerEvidenceBank();
  const withDangling: CareerEvidenceBank = danglingRef
    ? {
        ...seeded,
        coreSkills: seeded.coreSkills.map((skill) => ({
          ...skill,
          evidence: [danglingRef],
        })),
      }
    : seeded;
  const methods = useForm<UpdateSettingsInput>({
    defaultValues: { careerEvidence: withDangling },
  });

  return (
    <FormProvider {...methods}>
      <CareerEvidenceSection
        values={{ effective: withDangling, default: createEmptyCareerEvidenceBank() }}
        isLoading={false}
        isSaving={false}
        profileProjects={[
          {
            id: "payments-platform",
            name: "Payments Platform",
            description: "",
            date: "",
            isVisibleInBase: true,
          },
        ]}
        layoutMode="panel"
      />
    </FormProvider>
  );
};

describe("CareerEvidenceSection", () => {
  it("renders seeded evidence without calling AI", () => {
    render(<CareerEvidenceHarness />);

    expect(screen.getByDisplayValue("Senior Java Backend Engineer")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Java")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Reduced p95 latency")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Kubernetes administrator")).toBeInTheDocument();
  });

  it("adds and removes skill rows", () => {
    render(<CareerEvidenceHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    expect(screen.getByDisplayValue("Java")).toBeInTheDocument();

    const removeButtons = screen.getAllByRole("button", { name: "Remove skill" });
    fireEvent.click(removeButtons[0]);
    expect(removeButtons).toHaveLength(2);
  });

  it("warns about dangling evidence references", () => {
    render(<CareerEvidenceHarness danglingRef="project:deleted-project" />);

    expect(screen.getByTestId("dangling-evidence-refs")).toHaveTextContent(
      "project:deleted-project",
    );
  });

  it("does not warn for references that resolve", () => {
    render(<CareerEvidenceHarness />);

    expect(screen.queryByTestId("dangling-evidence-refs")).not.toBeInTheDocument();
  });
});
