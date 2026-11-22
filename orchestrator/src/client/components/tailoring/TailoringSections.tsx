import { TokenizedInput } from "@client/pages/orchestrator/TokenizedInput";
import { resolveResumeProjectSelection } from "@shared/resume-projects";
import type {
  ResumeProjectCatalogItem,
  ResumeProjectsSettings,
  TailoringPlanResult,
} from "@shared/types.js";
import {
  CheckCircle2,
  Circle,
  CircleAlert,
  Info,
  Loader2,
  Plus,
  Redo2,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import type React from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Tip } from "@/client/components/Tip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ProjectSelector } from "../discovered-panel/ProjectSelector";
import type { EditableSkillGroup } from "../tailoring-utils";
import { parseTailoredSkills } from "../tailoring-utils";
import {
  applySummaryTextareaHeight,
  formatTextCount,
  shouldPreserveManualHeight,
  TAILOR_TEXTAREA_MIN_HEIGHT_PX,
  type TextCountMode,
} from "./summary-text-metrics";

export type TailoringReviewKey = "summary" | "headline" | "skills";

export interface TailoringBaseline {
  summary: string;
  headline: string;
  skillsJson: string;
}

export interface TailoringSuggestion {
  current: string;
  suggested: string;
  label: string;
}

export type TailoringSuggestions = Partial<
  Record<TailoringReviewKey, TailoringSuggestion>
>;

interface TailoringSectionsProps {
  catalog: ResumeProjectCatalogItem[];
  isCatalogLoading: boolean;
  summary: string;
  headline: string;
  jobDescription: string;
  skillsDraft: EditableSkillGroup[];
  selectedIds: Set<string>;
  resumeProjectsSettings?: ResumeProjectsSettings | null;
  isResumeProjectsSettingsLoading?: boolean;
  tracerLinksEnabled: boolean;
  tracerEnableBlocked: boolean;
  tracerEnableBlockedReason: string | null;
  tracerReadinessChecking?: boolean;
  generatingSection: "summary" | "headline" | "skills" | null;
  isGeneratingProjects: boolean;
  openSkillGroupId: string;
  disableInputs: boolean;
  suggestions: TailoringSuggestions;
  originalBaseline: TailoringBaseline;
  onAcceptSuggestion: (key: TailoringReviewKey) => void;
  onKeepCurrentSuggestion: (key: TailoringReviewKey) => void;
  onUndoOriginalSuggestion: (key: TailoringReviewKey) => void;
  onGenerateSummary: () => void;
  onGenerateHeadline: () => void;
  onGenerateSkills: () => void;
  onGenerateProjects: () => void;
  onSummaryChange: (value: string) => void;
  onHeadlineChange: (value: string) => void;
  onUndoSummary: () => void;
  onUndoHeadline: () => void;
  onUndoSkills: () => void;
  onRedoSummary: () => void;
  onRedoHeadline: () => void;
  onRedoSkills: () => void;
  canUndoSummary: boolean;
  canUndoHeadline: boolean;
  canUndoSkills: boolean;
  canRedoSummary: boolean;
  canRedoHeadline: boolean;
  canRedoSkills: boolean;
  undoDisabledReason?: string | null;
  onDescriptionChange: (value: string) => void;
  onSkillGroupOpenChange: (value: string) => void;
  onAddSkillGroup: () => void;
  onUpdateSkillGroup: (
    id: string,
    key: "name" | "keywordsText",
    value: string,
  ) => void;
  onRemoveSkillGroup: (id: string) => void;
  onToggleProject: (id: string) => void;
  onTracerLinksEnabledChange: (value: boolean) => void;
  plan?: TailoringPlanResult | null;
  planLoading?: boolean;
  onCheckEvidence?: () => void;
  onAcceptPlanItem?: (index: number) => void;
  onEditPlanItem?: (index: number, wording: string) => void;
  onRejectPlanItem?: (index: number) => void;
}

type SectionState =
  | "ready"
  | "review"
  | "missing"
  | "optional"
  | "source"
  | "none";

type NoSelectedProjectsReason =
  | "projects-loading"
  | "settings-loading"
  | "no-projects"
  | "no-project-slots"
  | "selection-empty";

type NoSelectedProjectsInfoCopy = {
  reason: NoSelectedProjectsReason;
  title: string;
  description: string;
};

const sectionClass =
  "overflow-hidden rounded-md border border-border/55 bg-background/25 px-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]";
const triggerClass =
  "min-h-11 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/20 hover:no-underline data-[state=open]:border-b data-[state=open]:border-border/45";
const inputClass =
  "w-full rounded-md border border-border/60 bg-background/65 px-3 py-2 text-sm leading-6 ring-offset-background placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const actionButtonClass =
  "h-7 border-border/60 bg-background/45 px-2 text-[11px] text-muted-foreground hover:bg-muted/35 hover:text-foreground";

const stateCopy: Record<
  SectionState,
  { label: string; icon: React.ElementType; className: string }
> = {
  ready: {
    label: "Ready",
    icon: CheckCircle2,
    className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  },
  review: {
    label: "Needs review",
    icon: CircleAlert,
    className: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  },
  missing: {
    label: "Missing",
    icon: Circle,
    className: "border-rose-500/20 bg-rose-500/10 text-rose-300",
  },
  optional: {
    label: "Optional",
    icon: Circle,
    className: "border-border/60 bg-muted/20 text-muted-foreground",
  },
  none: {
    label: "None",
    icon: Circle,
    className: "border-border/60 bg-muted/20 text-muted-foreground",
  },
  source: {
    label: "Source",
    icon: Circle,
    className: "border-sky-500/20 bg-sky-500/10 text-sky-300",
  },
};

const textHasValue = (value: string) => value.trim().length > 0;

const sectionStateForText = (value: string): SectionState =>
  textHasValue(value) ? "ready" : "missing";

const parseSkillGroupKeywordsInput = (input: string): string[] =>
  input
    .split(/[\n,]/g)
    .map((keyword) => keyword.trim())
    .filter(Boolean);

const skillGroupHasKeywords = (keywordsText: string) =>
  parseSkillGroupKeywordsInput(keywordsText).length > 0;

const skillGroupNeedsReview = (group: EditableSkillGroup) =>
  !textHasValue(group.name) || !skillGroupHasKeywords(group.keywordsText);

const excerpt = (value: string, maxLength = 240) => {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return "Empty";
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1).trimEnd()}…`
    : normalized;
};

const formatReviewValue = (key: TailoringReviewKey, value: string) => {
  if (key !== "skills") return excerpt(value);
  const groups = parseTailoredSkills(value);
  if (groups.length === 0) return "Empty";
  return excerpt(
    groups
      .map(
        (group) =>
          `${group.name || "Untitled group"}: ${group.keywords.join(", ")}`,
      )
      .join(" | "),
  );
};

export function getNoSelectedProjectsInfo(args: {
  catalog: ResumeProjectCatalogItem[];
  isCatalogLoading: boolean;
  selectedIds: Set<string>;
  resumeProjectsSettings?: ResumeProjectsSettings | null;
  isResumeProjectsSettingsLoading?: boolean;
}): NoSelectedProjectsInfoCopy | null {
  if (args.isCatalogLoading) {
    return {
      reason: "projects-loading",
      title: "Projects are still loading",
      description:
        "Project options are still loading. Wait a moment before deciding whether this job has no selected projects.",
    };
  }

  if (args.catalog.length === 0) {
    return {
      reason: "no-projects",
      title: "No projects found",
      description:
        "No projects were found in your base resume. Add projects to your resume to include them here.",
    };
  }

  if (args.isResumeProjectsSettingsLoading) {
    return {
      reason: "settings-loading",
      title: "Project settings are still loading",
      description:
        "Project options are available, but selection settings are still loading. Wait a moment or select projects manually below.",
    };
  }

  const settings = args.resumeProjectsSettings;
  if (!settings) {
    return {
      reason: "settings-loading",
      title: "Project settings are still loading",
      description: "Project choices will appear when settings finish loading.",
    };
  }

  const resolution = resolveResumeProjectSelection({
    catalog: args.catalog,
    resumeProjects: settings,
    selectedProjectIds: [...args.selectedIds],
  });
  if (resolution.effectiveSelectedIds.length > 0) return null;

  if (resolution.targetCount === 0) {
    return {
      reason: "no-project-slots",
      title: "No project slots available",
      description:
        "Project settings currently allow 0 projects. Increase the target to include projects.",
    };
  }

  return {
    reason: "selection-empty",
    title: "No projects selected",
    description:
      resolution.aiSelectableIds.length === 0
        ? "No projects are marked Must include or AI can select in Settings."
        : "Choose projects below or use Pick again with AI.",
  };
}

const SectionTriggerLabel: React.FC<{
  title: string;
  state: SectionState;
  badgeLabel?: string;
  badgeAdornment?: React.ReactNode;
  count?: number;
  children?: React.ReactNode;
}> = ({ title, state, badgeLabel, badgeAdornment, count, children }) => {
  const copy = stateCopy[state];
  const resolvedBadgeLabel =
    badgeLabel ??
    `${copy.label}${typeof count === "number" && count > 0 ? ` ${count}` : ""}`;

  return (
    <span className="flex min-w-0 flex-1 items-center justify-between gap-3 pr-2">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-semibold text-foreground/85">
          {title}
        </span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none",
            copy.className,
          )}
        >
          {resolvedBadgeLabel}
        </span>
        {badgeAdornment}
      </span>
      {children ? (
        <span className="hidden shrink-0 items-center gap-1 sm:flex">
          {children}
        </span>
      ) : null}
    </span>
  );
};

const NoSelectedProjectsInfo = ({
  info,
}: {
  info: NoSelectedProjectsInfoCopy;
}) => (
  <Tip
    content={
      <>
        <div className="font-semibold text-foreground">{info.title}</div>
        <div className="mt-1 text-muted-foreground">{info.description}</div>
      </>
    }
    contentClassName="max-w-72 text-left text-xs leading-5"
  >
    <span
      aria-label={info.title}
      className="inline-flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted/40 hover:text-foreground"
      role="img"
    >
      <Info className="h-3.5 w-3.5" />
      <span className="sr-only">{info.description}</span>
    </span>
  </Tip>
);

export const TailoringSections: React.FC<TailoringSectionsProps> = ({
  catalog,
  isCatalogLoading,
  summary,
  headline,
  jobDescription,
  skillsDraft,
  selectedIds,
  resumeProjectsSettings,
  isResumeProjectsSettingsLoading = false,
  tracerLinksEnabled,
  tracerEnableBlocked,
  tracerEnableBlockedReason,
  tracerReadinessChecking = false,
  generatingSection,
  isGeneratingProjects,
  openSkillGroupId,
  disableInputs,
  suggestions,
  originalBaseline,
  onAcceptSuggestion,
  onKeepCurrentSuggestion,
  onUndoOriginalSuggestion,
  onGenerateSummary,
  onGenerateHeadline,
  onGenerateSkills,
  onGenerateProjects,
  onSummaryChange,
  onHeadlineChange,
  onUndoSummary,
  onUndoHeadline,
  onUndoSkills,
  onRedoSummary,
  onRedoHeadline,
  onRedoSkills,
  canUndoSummary,
  canUndoHeadline,
  canUndoSkills,
  canRedoSummary,
  canRedoHeadline,
  canRedoSkills,
  undoDisabledReason = null,
  onDescriptionChange,
  onSkillGroupOpenChange,
  onAddSkillGroup,
  onUpdateSkillGroup,
  onRemoveSkillGroup,
  onToggleProject,
  onTracerLinksEnabledChange,
  plan = null,
  planLoading = false,
  onCheckEvidence,
  onAcceptPlanItem,
  onEditPlanItem,
  onRejectPlanItem,
}) => {
  const [keywordDrafts, setKeywordDrafts] = useState<Record<string, string>>(
    {},
  );
  const [editingPlanIndex, setEditingPlanIndex] = useState<number | null>(null);
  const [planEditDraft, setPlanEditDraft] = useState("");
  const [summaryCountMode, setSummaryCountMode] =
    useState<TextCountMode>("words");
  const summaryFocusedRef = useRef(false);
  const summaryTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const summaryAutoHeightRef = useRef<number | null>(null);
  const summaryResizeObserverRef = useRef<ResizeObserver | null>(null);
  const tracerToggleDisabled =
    disableInputs || (!tracerLinksEnabled && tracerEnableBlocked);
  const generateTooltip = "Generate";
  const undoTooltip = "Undo to template";
  const redoTooltip = "Redo to AI draft";
  const suggestionKeys = (
    ["summary", "headline", "skills"] as const
  ).filter((key) => Boolean(suggestions[key]));
  const visiblePlanItems = (plan?.items ?? [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.userDecision !== "rejected");
  const skillsState: SectionState =
    skillsDraft.length === 0
      ? "none"
      : skillsDraft.some(skillGroupNeedsReview)
        ? "review"
        : "ready";
  const projectResolution = useMemo(
    () =>
      resumeProjectsSettings
        ? resolveResumeProjectSelection({
            catalog,
            resumeProjects: resumeProjectsSettings,
            selectedProjectIds: [...selectedIds],
          })
        : null,
    [catalog, resumeProjectsSettings, selectedIds],
  );
  const selectedProjectCount =
    projectResolution?.effectiveSelectedIds.length ?? 0;
  const projectsState: SectionState =
    selectedProjectCount > 0 ? "ready" : "none";
  const noSelectedProjectsInfo = getNoSelectedProjectsInfo({
    catalog,
    isCatalogLoading,
    selectedIds,
    resumeProjectsSettings,
    isResumeProjectsSettingsLoading,
  });
  const syncSummaryTextareaHeight = useCallback(() => {
    const textarea = summaryTextareaRef.current;
    if (!textarea) return;
    if (
      summaryAutoHeightRef.current !== null &&
      shouldPreserveManualHeight(
        summaryAutoHeightRef.current,
        Number.parseFloat(textarea.style.height),
      )
    ) {
      return;
    }
    // While focused, keep trailing blank lines so Enter can grow the box.
    summaryAutoHeightRef.current = applySummaryTextareaHeight(
      textarea,
      !summaryFocusedRef.current,
    );
  }, []);

  const setSummaryTextareaRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      summaryResizeObserverRef.current?.disconnect();
      summaryResizeObserverRef.current = null;
      summaryTextareaRef.current = node;
      summaryAutoHeightRef.current = null;
      if (!node) return;
      // Accordion remounts the field without changing `summary`, so measure here.
      syncSummaryTextareaHeight();
      if (typeof ResizeObserver === "undefined") return;
      let lastWidth = node.clientWidth;
      const observer = new ResizeObserver(() => {
        if (node.clientWidth === lastWidth) return;
        lastWidth = node.clientWidth;
        syncSummaryTextareaHeight();
      });
      observer.observe(node);
      summaryResizeObserverRef.current = observer;
    },
    [syncSummaryTextareaHeight],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: summary is the intentional trigger
  useLayoutEffect(() => {
    syncSummaryTextareaHeight();
  }, [summary, syncSummaryTextareaHeight]);

  return (
    <Accordion type="multiple" className="space-y-2">
      <AccordionItem value="summary" className={sectionClass}>
        <AccordionTrigger className={triggerClass} aria-label="Summary">
          <SectionTriggerLabel
            title="Summary"
            state={sectionStateForText(summary)}
          />
        </AccordionTrigger>
        <AccordionContent className="px-3 pb-3 pt-3">
          <div className="mb-2 flex justify-end gap-1">
            <Tip asChild clickBehavior="none" content={generateTooltip}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={actionButtonClass}
                onClick={onGenerateSummary}
                disabled={disableInputs}
                aria-label="Generate summary"
              >
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                {generatingSection === "summary"
                  ? "Generating..."
                  : generateTooltip}
              </Button>
            </Tip>
            <Tip asChild clickBehavior="none" content={undoTooltip}>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onUndoSummary}
                disabled={disableInputs || !canUndoSummary}
                aria-label={undoTooltip}
                title={
                  !canUndoSummary
                    ? (undoDisabledReason ?? undefined)
                    : undefined
                }
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
            </Tip>
            <Tip asChild clickBehavior="none" content={redoTooltip}>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onRedoSummary}
                disabled={disableInputs || !canRedoSummary}
                aria-label={redoTooltip}
              >
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
            </Tip>
          </div>
          <div className="relative">
            <Tip
              asChild
              clickBehavior="none"
              content={
                summaryCountMode === "words"
                  ? "Toggle to characters"
                  : "Toggle to words"
              }
            >
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn(
                  actionButtonClass,
                  "absolute right-1.5 top-1.5 z-10 h-auto border-0 bg-background/80 px-1 py-0.5 tabular-nums shadow-none underline-offset-2 hover:underline",
                )}
                onClick={() =>
                  setSummaryCountMode((current) =>
                    current === "words" ? "characters" : "words",
                  )
                }
              >
                {formatTextCount(summary, summaryCountMode)}
              </Button>
            </Tip>
            <label htmlFor="tailor-summary-edit" className="sr-only">
              Tailored Summary
            </label>
            <textarea
              id="tailor-summary-edit"
              ref={setSummaryTextareaRef}
              className={`${inputClass} resize-y overflow-y-auto pt-7`}
              style={{ minHeight: TAILOR_TEXTAREA_MIN_HEIGHT_PX }}
              value={summary}
              onChange={(event) => onSummaryChange(event.target.value)}
              onFocus={() => {
                summaryFocusedRef.current = true;
                syncSummaryTextareaHeight();
              }}
              onBlur={() => {
                summaryFocusedRef.current = false;
                syncSummaryTextareaHeight();
              }}
              placeholder="Write a tailored summary for this role, or generate with AI..."
              disabled={disableInputs}
            />
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="headline" className={sectionClass}>
        <AccordionTrigger className={triggerClass} aria-label="Headline">
          <SectionTriggerLabel
            title="Headline"
            state={sectionStateForText(headline)}
          />
        </AccordionTrigger>
        <AccordionContent className="px-3 pb-3 pt-3">
          <div className="mb-2 flex justify-end gap-1">
            <Tip asChild clickBehavior="none" content={generateTooltip}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={actionButtonClass}
                onClick={onGenerateHeadline}
                disabled={disableInputs}
                aria-label="Generate headline"
              >
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                {generatingSection === "headline"
                  ? "Generating..."
                  : generateTooltip}
              </Button>
            </Tip>
            <Tip asChild clickBehavior="none" content={undoTooltip}>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onUndoHeadline}
                disabled={disableInputs || !canUndoHeadline}
                aria-label={undoTooltip}
                title={
                  !canUndoHeadline
                    ? (undoDisabledReason ?? undefined)
                    : undefined
                }
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
            </Tip>
            <Tip asChild clickBehavior="none" content={redoTooltip}>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onRedoHeadline}
                disabled={disableInputs || !canRedoHeadline}
                aria-label={redoTooltip}
              >
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
            </Tip>
          </div>
          <label htmlFor="tailor-headline-edit" className="sr-only">
            Tailored Headline
          </label>
          <input
            id="tailor-headline-edit"
            type="text"
            className={inputClass}
            value={headline}
            onChange={(event) => onHeadlineChange(event.target.value)}
            placeholder="Write a concise headline tailored to this role..."
            disabled={disableInputs}
          />
        </AccordionContent>
      </AccordionItem>

      {suggestionKeys.length > 0 && (
        <AccordionItem value="review" className={sectionClass}>
          <AccordionTrigger
            className={triggerClass}
            aria-label="Review AI suggestions"
          >
            <SectionTriggerLabel
              title="Review AI suggestions"
              state="review"
              count={suggestionKeys.length}
            />
          </AccordionTrigger>
          <AccordionContent className="space-y-3 px-3 pb-3 pt-3">
            <p className="text-[11px] leading-5 text-muted-foreground">
              Manual edits are kept. AI wording is shown here until you accept
              it. Suggestions use the job description and your approved profile
              facts; verify every claim before accepting.
            </p>
            {suggestionKeys.map((key) => {
              const suggestion = suggestions[key];
              if (!suggestion) return null;
              return (
                <div
                  key={key}
                  className="space-y-2 rounded-md border border-amber-500/20 bg-amber-500/[0.04] p-3"
                >
                  <div className="text-xs font-semibold text-foreground/90">
                    {suggestion.label}
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Your version
                    </div>
                    <p className="text-[11px] leading-5 text-foreground/80">
                      {formatReviewValue(key, suggestion.current)}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-300/80">
                      AI suggestion
                    </div>
                    <p className="text-[11px] leading-5 text-foreground/80">
                      {formatReviewValue(key, suggestion.suggested)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className={actionButtonClass}
                      onClick={() => onAcceptSuggestion(key)}
                      disabled={disableInputs}
                      aria-label={`Use AI draft for ${suggestion.label}`}
                    >
                      Use AI draft
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className={actionButtonClass}
                      onClick={() => onKeepCurrentSuggestion(key)}
                      disabled={disableInputs}
                      aria-label={`Keep mine for ${suggestion.label}`}
                    >
                      Keep mine
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className={actionButtonClass}
                      onClick={() => onUndoOriginalSuggestion(key)}
                      disabled={disableInputs}
                      aria-label={`Undo to original for ${suggestion.label}`}
                    >
                      Undo to original
                    </Button>
                  </div>
                </div>
              );
            })}
          </AccordionContent>
        </AccordionItem>
      )}

      <AccordionItem value="evidence-review" className={sectionClass}>
        <AccordionTrigger className={triggerClass} aria-label="Evidence review">
          <SectionTriggerLabel
            title="Evidence review"
            state={
              plan
                ? plan.check.blocked.length > 0 ||
                  plan.check.unsupported.length > 0
                  ? "review"
                  : "ready"
                : "optional"
            }
            count={
              plan ? visiblePlanItems.length : undefined
            }
          />
        </AccordionTrigger>
        <AccordionContent className="space-y-3 px-3 pb-3 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-prose text-[11px] leading-5 text-muted-foreground">
              Check each job-description requirement against your approved
              evidence. Accept, edit, or reject every item yourself - nothing is
              applied silently.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={actionButtonClass}
              onClick={onCheckEvidence}
              disabled={disableInputs || planLoading || !jobDescription.trim()}
              aria-label="Check evidence"
            >
              {planLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Check evidence
            </Button>
          </div>

          {!plan && (
            <p className="text-[11px] text-muted-foreground">
              No evidence check yet. Run one to see grounded wording suggestions.
            </p>
          )}

          {visiblePlanItems.map(({ item, index }) => (
            <div
              key={`evidence-${index}`}
              className="space-y-2 rounded-md border border-border/60 bg-background/40 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs font-semibold text-foreground/90">
                  {item.jdRequirement}
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold",
                    item.supportLevel === "strong"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : item.supportLevel === "partial"
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                        : "border-rose-500/30 bg-rose-500/10 text-rose-300",
                  )}
                >
                  {item.supportLevel}
                </span>
              </div>
              {item.evidenceRefs.length > 0 && (
                <p className="text-[10px] leading-4 text-muted-foreground">
                  Evidence: {item.evidenceRefs.join(", ")}
                </p>
              )}
              {editingPlanIndex === index ? (
                <textarea
                  aria-label={`Edit proposed wording for requirement ${index + 1}`}
                  className={`${inputClass} min-h-[80px]`}
                  value={planEditDraft}
                  onChange={(event) => setPlanEditDraft(event.target.value)}
                  disabled={disableInputs}
                />
              ) : (
                <p className="text-[11px] leading-5 text-foreground/80">
                  {item.proposedWording}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {editingPlanIndex === index ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      className={actionButtonClass}
                      aria-label={`Save evidence edit ${index + 1}`}
                      onClick={() => {
                        onEditPlanItem?.(index, planEditDraft);
                        setEditingPlanIndex(null);
                      }}
                      disabled={disableInputs}
                    >
                      Save edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className={actionButtonClass}
                      aria-label={`Cancel evidence edit ${index + 1}`}
                      onClick={() => setEditingPlanIndex(null)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      className={actionButtonClass}
                      aria-label={`Accept evidence item ${index + 1}`}
                      onClick={() => onAcceptPlanItem?.(index)}
                      disabled={
                        disableInputs || item.userDecision === "accepted"
                      }
                    >
                      {item.userDecision === "accepted" ? "Accepted" : "Accept"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className={actionButtonClass}
                      aria-label={`Edit evidence item ${index + 1}`}
                      onClick={() => {
                        setEditingPlanIndex(index);
                        setPlanEditDraft(item.proposedWording);
                      }}
                      disabled={disableInputs}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className={actionButtonClass}
                      aria-label={`Reject evidence item ${index + 1}`}
                      onClick={() => onRejectPlanItem?.(index)}
                      disabled={disableInputs}
                    >
                      Reject
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="skills" className={sectionClass}>
        <AccordionTrigger className={triggerClass} aria-label="Tailored Skills">
          <SectionTriggerLabel
            title="Tailored Skills"
            state={skillsState}
            count={skillsDraft.length > 0 ? skillsDraft.length : undefined}
          />
        </AccordionTrigger>
        <AccordionContent className="px-3 pb-3 pt-3">
          <div className="flex flex-wrap items-center justify-end gap-2 pb-2">
            <Tip asChild clickBehavior="none" content={generateTooltip}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={actionButtonClass}
                onClick={onGenerateSkills}
                disabled={disableInputs}
                aria-label="Generate skills"
              >
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                {generatingSection === "skills"
                  ? "Generating..."
                  : generateTooltip}
              </Button>
            </Tip>
            <Tip asChild clickBehavior="none" content={undoTooltip}>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onUndoSkills}
                disabled={disableInputs || !canUndoSkills}
                aria-label={undoTooltip}
                title={
                  !canUndoSkills ? (undoDisabledReason ?? undefined) : undefined
                }
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
            </Tip>
            <Tip asChild clickBehavior="none" content={redoTooltip}>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onRedoSkills}
                disabled={disableInputs || !canRedoSkills}
                aria-label={redoTooltip}
              >
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
            </Tip>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={actionButtonClass}
              onClick={onAddSkillGroup}
              disabled={disableInputs}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add Skill Group
            </Button>
          </div>

          {skillsDraft.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 bg-background/40 px-3 py-4 text-center text-[11px] text-muted-foreground">
              No skill groups yet. Add one to tailor keywords for this role.
            </div>
          ) : (
            <Accordion
              type="single"
              collapsible
              value={openSkillGroupId}
              onValueChange={onSkillGroupOpenChange}
              className="space-y-2"
            >
              {skillsDraft.map((group, index) => (
                <AccordionItem
                  key={group.id}
                  value={group.id}
                  className="rounded-md border border-border/55 bg-background/45 px-0"
                >
                  <AccordionTrigger className="px-3 py-2 text-[11px] font-medium hover:bg-muted/20 hover:no-underline">
                    {group.name.trim() || `Skill Group ${index + 1}`}
                  </AccordionTrigger>
                  <AccordionContent className="px-3 pb-3 pt-2">
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <label
                          htmlFor={`tailor-skill-group-name-${group.id}`}
                          className="text-[11px] font-medium text-muted-foreground"
                        >
                          Category
                        </label>
                        <input
                          id={`tailor-skill-group-name-${group.id}`}
                          type="text"
                          className={inputClass}
                          value={group.name}
                          onChange={(event) =>
                            onUpdateSkillGroup(
                              group.id,
                              "name",
                              event.target.value,
                            )
                          }
                          placeholder="Backend, Frontend, Infrastructure..."
                          disabled={disableInputs}
                        />
                      </div>

                      <div className="space-y-1">
                        <label
                          htmlFor={`tailor-skill-group-keywords-${group.id}`}
                          className="text-[11px] font-medium text-muted-foreground"
                        >
                          Keywords (comma-separated)
                        </label>
                        <TokenizedInput
                          id={`tailor-skill-group-keywords-${group.id}`}
                          values={parseSkillGroupKeywordsInput(
                            group.keywordsText,
                          )}
                          draft={keywordDrafts[group.id] ?? ""}
                          parseInput={parseSkillGroupKeywordsInput}
                          onDraftChange={(value) =>
                            setKeywordDrafts((current) => ({
                              ...current,
                              [group.id]: value,
                            }))
                          }
                          onValuesChange={(values) =>
                            onUpdateSkillGroup(
                              group.id,
                              "keywordsText",
                              values.join(", "),
                            )
                          }
                          placeholder="TypeScript, Node.js, REST APIs..."
                          helperText="Press Enter, comma, or paste a list to add keywords."
                          removeLabelPrefix="Remove keyword"
                          disabled={disableInputs}
                        />
                      </div>

                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                          onClick={() => onRemoveSkillGroup(group.id)}
                          disabled={disableInputs}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="baseline" className={sectionClass}>
        <AccordionTrigger className={triggerClass} aria-label="Resume Studio baseline">
          <SectionTriggerLabel title="Resume Studio baseline" state="source" />
        </AccordionTrigger>
        <AccordionContent className="space-y-3 px-3 pb-3 pt-3">
          <p className="text-[11px] leading-5 text-muted-foreground">
            Compared with the Resume Studio baseline. This is for review only;
            edit fields above.
          </p>
          <div className="space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Original summary
            </div>
            <p className="text-[11px] leading-5 text-foreground/80">
              {formatReviewValue("summary", originalBaseline.summary)}
            </p>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Original headline
            </div>
            <p className="text-[11px] leading-5 text-foreground/80">
              {formatReviewValue("headline", originalBaseline.headline)}
            </p>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Original skill categories
            </div>
            <p className="text-[11px] leading-5 text-foreground/80">
              {formatReviewValue("skills", originalBaseline.skillsJson)}
            </p>
          </div>
        </AccordionContent>
      </AccordionItem>

      {!isCatalogLoading && catalog.length > 0 && (
        <AccordionItem value="projects" className={sectionClass}>
          <AccordionTrigger
            className={triggerClass}
            aria-label="Selected Projects"
          >
            <SectionTriggerLabel
              title="Selected Projects"
              state={projectsState}
              badgeLabel={
                selectedProjectCount > 0
                  ? String(selectedProjectCount)
                  : undefined
              }
              badgeAdornment={
                noSelectedProjectsInfo ? (
                  <NoSelectedProjectsInfo info={noSelectedProjectsInfo} />
                ) : null
              }
            />
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3 pt-3">
            {projectResolution ? (
              <>
                <div className="mb-2 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className={actionButtonClass}
                    onClick={onGenerateProjects}
                    disabled={disableInputs}
                  >
                    <Sparkles className="mr-1 h-3.5 w-3.5" />
                    {isGeneratingProjects ? "Picking..." : "Pick again with AI"}
                  </Button>
                </div>
                <ProjectSelector
                  catalog={catalog}
                  resolution={projectResolution}
                  onToggle={onToggleProject}
                  disabled={disableInputs}
                />
              </>
            ) : (
              <p className="py-3 text-xs text-muted-foreground">
                Project settings are still loading.
              </p>
            )}
          </AccordionContent>
        </AccordionItem>
      )}

      <AccordionItem value="tracer-links" className={sectionClass}>
        <AccordionTrigger className={triggerClass} aria-label="Tracer Links">
          <SectionTriggerLabel
            title="Tracer Links"
            state={tracerLinksEnabled ? "ready" : "optional"}
          />
        </AccordionTrigger>
        <AccordionContent className="px-3 pb-3 pt-3">
          <div className="rounded-md border border-border/60 bg-background/55 p-3">
            <label
              htmlFor="tailor-tracer-links-enabled"
              className="flex cursor-pointer items-center gap-3"
            >
              <Checkbox
                id="tailor-tracer-links-enabled"
                checked={tracerLinksEnabled}
                onCheckedChange={(checked) =>
                  onTracerLinksEnabledChange(Boolean(checked))
                }
                disabled={tracerToggleDisabled}
              />
              <span className="text-sm font-medium text-foreground">
                Enable tracer links for this job
              </span>
            </label>
            <p className="mt-2 text-xs text-muted-foreground">
              {tracerReadinessChecking
                ? "Checking tracer-link readiness..."
                : "When enabled, outgoing resume links are rewritten to JobOps tracer links on the next PDF generation. Existing PDFs are unchanged."}
            </p>
            {tracerEnableBlockedReason && !tracerLinksEnabled ? (
              <p className="mt-2 text-xs text-destructive">
                Tracer links are unavailable: {tracerEnableBlockedReason}
              </p>
            ) : null}
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="job-description" className={sectionClass}>
        <AccordionTrigger className={triggerClass} aria-label="Job Description">
          <SectionTriggerLabel
            title="Job Description"
            state={
              sectionStateForText(jobDescription) === "ready"
                ? "source"
                : "missing"
            }
          />
        </AccordionTrigger>
        <AccordionContent className="px-3 pb-3 pt-3">
          <label htmlFor="tailor-jd-edit" className="sr-only">
            Job Description
          </label>
          <textarea
            id="tailor-jd-edit"
            className={`${inputClass} min-h-[120px] max-h-[250px]`}
            value={jobDescription}
            onChange={(event) => onDescriptionChange(event.target.value)}
            placeholder="The raw job description..."
            disabled={disableInputs}
          />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};
