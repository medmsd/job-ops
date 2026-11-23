import type { DesignResumeJson, TailoredResumeSnapshot } from "@shared/types";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TailoredCvEditor } from "./TailoredCvEditor";

const mocks = vi.hoisted(() => ({
  getTailoredSnapshots: vi.fn(),
  restoreTailoredSnapshot: vi.fn(),
  saveTailoredSnapshot: vi.fn(),
  summarizeJob: vi.fn(),
  generateDesignResumeFieldSuggestion: vi.fn(),
}));

vi.mock("@client/api", () => ({
  generateDesignResumeFieldSuggestion:
    mocks.generateDesignResumeFieldSuggestion,
  getTailoredSnapshots: mocks.getTailoredSnapshots,
  restoreTailoredSnapshot: mocks.restoreTailoredSnapshot,
  saveTailoredSnapshot: mocks.saveTailoredSnapshot,
  summarizeJob: mocks.summarizeJob,
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
    placeholder,
  }: {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      aria-label="Rich text content"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ),
}));

const longBefore = `Before headline ${"x".repeat(220)}`;
const truncatedBefore = `${longBefore.slice(0, 159)}…`;

const resumeJson = {
  basics: {
    name: "Mohamed Mseddi",
    headline: "Original headline",
    email: "candidate@example.com",
    phone: "",
    location: "",
    website: { url: "" },
  },
  summary: { content: "<p>Original summary</p>" },
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
    id: "snapshot-10",
    jobId: "job-1",
    version: 10,
    status: "approved",
    origin: "approved",
    resumeJson,
    changes: [
      {
        path: "basics.headline",
        label: "Headline",
        kind: "changed",
        before: longBefore,
        after: "Tailored headline",
      },
      {
        path: "summary.content",
        label: "Summary",
        kind: "changed",
        before: "Original summary",
        after: "Tailored summary",
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

const versions = Array.from({ length: 10 }, (_, index) => {
  const version = 10 - index;
  return makeSnapshot({
    id: `snapshot-${version}`,
    version,
    changes: version === 10 ? makeSnapshot().changes : [],
  });
});

const renderEditor = (onSaved = vi.fn(), onRestored = vi.fn()) =>
  render(
    <TailoredCvEditor
      jobId="job-1"
      snapshot={makeSnapshot()}
      versions={versions}
      onSaved={onSaved}
      onRestored={onRestored}
    />,
  );

describe("TailoredCvEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders change labels, truncated previews, and ten version rows without fetching", () => {
    renderEditor();

    const changes = within(screen.getByTestId("baseline-changes"));
    expect(changes.getByText("Headline")).toBeInTheDocument();
    expect(changes.getByText("Summary")).toBeInTheDocument();
    expect(changes.getByText(truncatedBefore)).toBeInTheDocument();
    expect(changes.queryByText(longBefore)).not.toBeInTheDocument();
    expect(screen.getAllByTestId("tailored-cv-version-row")).toHaveLength(10);

    expect(mocks.saveTailoredSnapshot).not.toHaveBeenCalled();
    expect(mocks.getTailoredSnapshots).not.toHaveBeenCalled();
    expect(mocks.restoreTailoredSnapshot).not.toHaveBeenCalled();
    expect(mocks.summarizeJob).not.toHaveBeenCalled();
    expect(mocks.generateDesignResumeFieldSuggestion).not.toHaveBeenCalled();
  });

  it("enables Save edits after an edit and saves the edited resume JSON as a new version", async () => {
    const onSaved = vi.fn();
    const saved = makeSnapshot({
      id: "snapshot-11",
      version: 11,
      resumeJson: {
        ...resumeJson,
        basics: { ...resumeJson.basics, headline: "Edited headline" },
      } as unknown as DesignResumeJson,
    });
    mocks.saveTailoredSnapshot.mockResolvedValue(saved);
    mocks.getTailoredSnapshots.mockResolvedValue([saved, ...versions]);
    renderEditor(onSaved);

    const saveButton = screen.getByRole("button", { name: /save edits/i });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "Edited headline" },
    });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mocks.saveTailoredSnapshot).toHaveBeenCalledWith(
        "job-1",
        "snapshot-10",
        expect.objectContaining({
          basics: expect.objectContaining({ headline: "Edited headline" }),
        }),
      );
    });
    expect(mocks.getTailoredSnapshots).toHaveBeenCalledWith("job-1");
    expect(onSaved).toHaveBeenCalledWith(saved, [saved, ...versions]);
    expect(mocks.summarizeJob).not.toHaveBeenCalled();
    expect(mocks.generateDesignResumeFieldSuggestion).not.toHaveBeenCalled();
  });

  it("restores an older version as a new version and refreshes history", async () => {
    const onRestored = vi.fn();
    const restored = makeSnapshot({
      id: "snapshot-11",
      version: 11,
      origin: "restored",
    });
    const refreshed = [restored, ...versions];
    mocks.restoreTailoredSnapshot.mockResolvedValue(restored);
    mocks.getTailoredSnapshots.mockResolvedValue(refreshed);
    renderEditor(vi.fn(), onRestored);

    fireEvent.click(screen.getByRole("button", { name: "Restore v2" }));

    await waitFor(() => {
      expect(mocks.restoreTailoredSnapshot).toHaveBeenCalledWith(
        "job-1",
        "snapshot-2",
      );
    });
    expect(mocks.getTailoredSnapshots).toHaveBeenCalledWith("job-1");
    expect(onRestored).toHaveBeenCalledWith(restored, refreshed);
    expect(mocks.summarizeJob).not.toHaveBeenCalled();
    expect(mocks.generateDesignResumeFieldSuggestion).not.toHaveBeenCalled();
  });

  it("writes an edited item into the local draft via ItemDialog", async () => {
    mocks.saveTailoredSnapshot.mockResolvedValue(makeSnapshot());
    mocks.getTailoredSnapshots.mockResolvedValue(versions);
    renderEditor();

    const skillsSection = screen.getByTestId("tailored-cv-items-skills");
    fireEvent.click(
      within(skillsSection).getByRole("button", {
        name: "Edit Skill group 1",
      }),
    );

    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText(/^Name/), {
      target: { value: "Languages" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save item" }));

    fireEvent.click(screen.getByRole("button", { name: /save edits/i }));
    await waitFor(() => {
      expect(mocks.saveTailoredSnapshot).toHaveBeenCalledWith(
        "job-1",
        "snapshot-10",
        expect.objectContaining({
          sections: expect.objectContaining({
            skills: expect.objectContaining({
              items: expect.arrayContaining([
                expect.objectContaining({ name: "Languages" }),
              ]),
            }),
          }),
        }),
      );
    });
  });
});
