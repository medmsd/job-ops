import * as api from "@client/api";
import { useProfile } from "@client/hooks/useProfile";
import { useSettings } from "@client/hooks/useSettings";
import { useTracerReadiness } from "@client/hooks/useTracerReadiness";
import { resolveResumeProjectSelection } from "@shared/resume-projects";
import { tailoredResumeFilename } from "@shared/tailored-document-filenames.js";
import type {
  Job,
  TailoredFitState,
  TailoredResumeSnapshot,
  TailoringPlanResult,
} from "@shared/types.js";
import { CHAT_STYLE_MANUAL_LANGUAGE_LABELS } from "@shared/types.js";
import {
  Check,
  CircleAlert,
  Eye,
  FileEdit,
  FileText,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import type React from "react";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useJobPdfViewer } from "@/client/components/pdf/JobPdfViewerProvider";
import { Tip } from "@/client/components/Tip";
import { formatUserFacingError } from "@/client/lib/error-format";
import { showErrorToast } from "@/client/lib/error-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fromEditableSkillGroups,
  getOriginalHeadline,
  getOriginalSkills,
  getOriginalSummary,
  parseTailoredSkills,
  serializeTailoredSkills,
  toEditableSkillGroups,
} from "../tailoring-utils";
import { getTailoringReadiness } from "./rules";
import { TailoredCvEditor } from "./TailoredCvEditor";
import { TailoredFitSummary } from "./TailoredFitSummary";
import { TailoringRulesStrip } from "./TailoringRulesStrip";
import type {
  TailoringBaseline,
  TailoringReviewKey,
  TailoringSuggestions,
} from "./TailoringSections";
import { TailoringSections } from "./TailoringSections";
import {
  getTailoringSavePayloadKey,
  type TailoringSavePayload,
  useTailoringDraft,
} from "./useTailoringDraft";

interface TailoringWorkspaceBaseProps {
  job: Job;
  onDirtyChange?: (isDirty: boolean) => void;
}

interface TailoringWorkspaceEditorProps extends TailoringWorkspaceBaseProps {
  mode: "editor";
  onUpdate: (job?: Job) => void | Promise<void>;
  onRegisterSave?: (save: () => Promise<void>) => void;
  onBeforeGenerate?: () => boolean | Promise<boolean>;
}

type TailoringWorkspaceProps = TailoringWorkspaceEditorProps;
type TailoringSectionsProps = ComponentProps<typeof TailoringSections>;

type AutosaveStatus = "saved" | "unsaved" | "saving" | "error";
type TailoringGenerateTarget =
  | "all"
  | "summary"
  | "headline"
  | "skills"
  | "projects";

const AutosaveStatusIcon: React.FC<{ status: AutosaveStatus }> = ({
  status,
}) => {
  const copy =
    status === "saving"
      ? "Saving..."
      : status === "unsaved"
        ? "Unsaved changes"
        : status === "error"
          ? "Save failed"
          : "Saved";
  const iconClassName =
    status === "error"
      ? "text-rose-300"
      : status === "unsaved"
        ? "text-amber-300"
        : status === "saving"
          ? "text-muted-foreground"
          : "text-emerald-400/80";

  return (
    <Tip content={<p>{copy}</p>}>
      <span
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground"
        role="img"
        aria-label={copy}
      >
        {status === "saving" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : status === "error" || status === "unsaved" ? (
          <CircleAlert className={`h-3.5 w-3.5 ${iconClassName}`} />
        ) : (
          <Check className={`h-3.5 w-3.5 ${iconClassName}`} />
        )}
      </span>
    </Tip>
  );
};

const normalizeSkillsJson = (value: string | null | undefined) =>
  serializeTailoredSkills(parseTailoredSkills(value));

const TAILORING_REVIEW_KEYS: TailoringReviewKey[] = [
  "summary",
  "headline",
  "skills",
];

const TAILORING_REVIEW_LABELS: Record<TailoringReviewKey, string> = {
  summary: "Summary",
  headline: "Headline",
  skills: "Tailored skills",
};

const getReviewValue = (
  baseline: TailoringBaseline,
  key: TailoringReviewKey,
): string => (key === "skills" ? baseline.skillsJson : baseline[key]);

const toBaselineFromJob = (job: Job): TailoringBaseline => ({
  summary: job.tailoredSummary ?? "",
  headline: job.tailoredHeadline ?? "",
  skillsJson: normalizeSkillsJson(job.tailoredSkills),
});

const toSavePayloadFromJob = (job: Job): TailoringSavePayload => ({
  tailoredSummary: job.tailoredSummary ?? "",
  tailoredHeadline: job.tailoredHeadline ?? "",
  tailoredSkills: normalizeSkillsJson(job.tailoredSkills),
  jobDescription: job.jobDescription ?? "",
  selectedProjectIds: job.selectedProjectIds ?? "",
  tracerLinksEnabled: Boolean(job.tracerLinksEnabled),
});

export const TailoringWorkspace: React.FC<TailoringWorkspaceProps> = (
  props,
) => {
  const { openJobPdf } = useJobPdfViewer();
  const {
    catalog,
    isCatalogLoading,
    summary,
    setSummary,
    headline,
    setHeadline,
    jobDescription,
    setJobDescription,
    selectedIds,
    selectedIdsCsv,
    tracerLinksEnabled,
    setTracerLinksEnabled,
    skillsDraft,
    setSkillsDraft,
    openSkillGroupId,
    setOpenSkillGroupId,
    skillsJson,
    isDirty,
    savedPayloadKey,
    applyIncomingDraft,
    markSavedSnapshot,
    markSavedJob,
    replaceSelectedProjects,
    handleAddSkillGroup,
    handleUpdateSkillGroup,
    handleRemoveSkillGroup,
  } = useTailoringDraft({
    job: props.job,
    onDirtyChange: props.onDirtyChange,
  });

  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("saved");
  const [generateTarget, setGenerateTarget] =
    useState<TailoringGenerateTarget | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [snapshot, setSnapshot] = useState<TailoredResumeSnapshot | null>(null);
  const [versions, setVersions] = useState<TailoredResumeSnapshot[]>([]);
  const [isCvEditorOpen, setIsCvEditorOpen] = useState(false);
  const [isApprovingSnapshot, setIsApprovingSnapshot] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  const saveAgainRef = useRef(false);
  const latestPayloadRef = useRef<TailoringSavePayload | null>(null);
  const persistedPayloadKeyRef = useRef(savedPayloadKey);
  const isMountedRef = useRef(true);
  const { profile, error: profileError } = useProfile();
  const { settings, isLoading: isSettingsLoading } = useSettings();
  const { readiness: tracerReadiness, isChecking: isTracerReadinessChecking } =
    useTracerReadiness();

  const originalValues = useMemo(() => {
    const skillsDraft = toEditableSkillGroups(getOriginalSkills(profile));
    return {
      summary: getOriginalSummary(profile),
      headline: getOriginalHeadline(profile),
      skillsDraft,
      skillsJson: serializeTailoredSkills(fromEditableSkillGroups(skillsDraft)),
    };
  }, [profile]);
  const canUseOriginalValues = Boolean(profile) && !profileError;
  const [aiBaseline, setAiBaseline] = useState<TailoringBaseline>(() =>
    toBaselineFromJob(props.job),
  );
  const [suggestions, setSuggestions] = useState<TailoringSuggestions>({});
  const [plan, setPlan] = useState<TailoringPlanResult | null>(null);
  const [isCheckingEvidence, setIsCheckingEvidence] = useState(false);
  const [checkedText, setCheckedText] = useState<string | null>(null);
  const [evidenceAcknowledged, setEvidenceAcknowledged] = useState(false);
  const [fitState, setFitState] = useState<TailoredFitState>({
    result: null,
    isStale: false,
    reason: "not_checked",
  });
  const [fitLoading, setFitLoading] = useState(false);
  const [isComputingFit, setIsComputingFit] = useState(false);

  const canComputeFit = Boolean(jobDescription.trim()) && Boolean(snapshot);
  const fitDisabledReason = !jobDescription.trim()
    ? "Add a job description to check tailored fit."
    : !snapshot
      ? "Approve a tailored CV snapshot to check tailored fit."
      : null;

  const currentEvidenceText = useMemo(
    () => `${summary}\n${headline}\n${skillsJson}`,
    [summary, headline, skillsJson],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset review state only when switching jobs
  useEffect(() => {
    setAiBaseline({
      summary: props.job.tailoredSummary ?? "",
      headline: props.job.tailoredHeadline ?? "",
      skillsJson: normalizeSkillsJson(props.job.tailoredSkills),
    });
    setSuggestions({});
    setPlan(null);
    setCheckedText(null);
    setEvidenceAcknowledged(false);
  }, [props.job.id]);

  // Tailored CV snapshots are loaded on job change only; a stale response must
  // never overwrite the state of a more recently opened job.
  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    setVersions([]);
    setIsCvEditorOpen(false);
    setSnapshotError(null);
    Promise.all([
      api.getCurrentTailoredSnapshot(props.job.id),
      api.getTailoredSnapshots(props.job.id),
    ])
      .then(([currentSnapshot, snapshotVersions]) => {
        if (cancelled) return;
        setSnapshot(currentSnapshot);
        setVersions(snapshotVersions ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setSnapshotError("Unable to load tailored CV versions.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.job.id]);

  // Tailored fit is a deterministic read on job open; it never triggers AI.
  useEffect(() => {
    let cancelled = false;
    setFitLoading(true);
    api
      .getTailoredFit(props.job.id)
      .then((nextFitState) => {
        if (!cancelled) setFitState(nextFitState);
      })
      .catch(() => {
        if (!cancelled) {
          setFitState({ result: null, isStale: false, reason: "not_checked" });
        }
      })
      .finally(() => {
        if (!cancelled) setFitLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.job.id]);

  // Any edit invalidates a previous acknowledgment; re-check before generating.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run only when the checked CV text changes
  useEffect(() => {
    setEvidenceAcknowledged(false);
  }, [currentEvidenceText]);

  const tracerEnableBlocked =
    !tracerLinksEnabled && !tracerReadiness?.canEnable;
  const tracerEnableBlockedReason =
    tracerReadiness?.canEnable === false
      ? (tracerReadiness.reason ??
        "Verify tracer links in Settings before enabling this job.")
      : null;

  const savePayload = useMemo<TailoringSavePayload>(
    () => ({
      tailoredSummary: summary,
      tailoredHeadline: headline,
      tailoredSkills: skillsJson,
      jobDescription,
      selectedProjectIds: selectedIdsCsv,
      tracerLinksEnabled,
    }),
    [
      summary,
      headline,
      skillsJson,
      jobDescription,
      selectedIdsCsv,
      tracerLinksEnabled,
    ],
  );
  const savePayloadKey = useMemo(
    () => getTailoringSavePayloadKey(savePayload),
    [savePayload],
  );

  useEffect(() => {
    latestPayloadRef.current = savePayload;
  }, [savePayload]);

  useEffect(() => {
    persistedPayloadKeyRef.current = savedPayloadKey;
  }, [savedPayloadKey]);

  const flushAutosaveRef = useRef<() => Promise<void>>(async () => {});

  const runAutosaveLoop = useCallback(async () => {
    const inFlight = saveInFlightRef.current;
    if (inFlight) {
      saveAgainRef.current = true;
      await inFlight;
      if (saveInFlightRef.current) return;
      if (
        !latestPayloadRef.current ||
        getTailoringSavePayloadKey(latestPayloadRef.current) ===
          persistedPayloadKeyRef.current
      ) {
        return;
      }
    }

    const savePromise = (async () => {
      try {
        do {
          saveAgainRef.current = false;
          const snapshot = latestPayloadRef.current;
          if (!snapshot) return;

          if (
            getTailoringSavePayloadKey(snapshot) ===
            persistedPayloadKeyRef.current
          ) {
            if (isMountedRef.current) setAutosaveStatus("saved");
            return;
          }

          if (isMountedRef.current) setAutosaveStatus("saving");
          const snapshotKey = getTailoringSavePayloadKey(snapshot);
          const updatedJob = await api.updateJob(props.job.id, snapshot);
          // Keep parent/cache in sync even if this editor already unmounted.
          void props.onUpdate(updatedJob);
          if (!isMountedRef.current) return;
          const updatedPayload = toSavePayloadFromJob(updatedJob);

          const latestStillMatchesSnapshot =
            latestPayloadRef.current &&
            getTailoringSavePayloadKey(latestPayloadRef.current) ===
              snapshotKey;
          if (latestStillMatchesSnapshot) {
            markSavedSnapshot(snapshot);
            latestPayloadRef.current = snapshot;
          } else {
            markSavedJob(updatedJob);
          }
          persistedPayloadKeyRef.current = latestStillMatchesSnapshot
            ? snapshotKey
            : getTailoringSavePayloadKey(updatedPayload);

          const latestKey = latestPayloadRef.current
            ? getTailoringSavePayloadKey(latestPayloadRef.current)
            : persistedPayloadKeyRef.current;
          if (isMountedRef.current) {
            setAutosaveStatus(
              latestKey === persistedPayloadKeyRef.current
                ? "saved"
                : "unsaved",
            );
          }
        } while (
          saveAgainRef.current ||
          (latestPayloadRef.current &&
            getTailoringSavePayloadKey(latestPayloadRef.current) !==
              persistedPayloadKeyRef.current)
        );
      } catch {
        if (isMountedRef.current) setAutosaveStatus("error");
        throw new Error("Autosave failed");
      } finally {
        saveInFlightRef.current = null;
      }
    })();

    saveInFlightRef.current = savePromise;
    await savePromise;
  }, [markSavedJob, markSavedSnapshot, props.job.id, props.onUpdate]);

  const flushAutosave = useCallback(async () => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    if (saveInFlightRef.current) {
      saveAgainRef.current = true;
      await saveInFlightRef.current;
    }
    const latestPayload = latestPayloadRef.current;
    if (
      latestPayload &&
      getTailoringSavePayloadKey(latestPayload) !==
        persistedPayloadKeyRef.current
    ) {
      await runAutosaveLoop();
    }
  }, [runAutosaveLoop]);

  flushAutosaveRef.current = flushAutosave;

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      void flushAutosaveRef.current();
    };
  }, []);

  useEffect(() => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    if (!isDirty || savePayloadKey === persistedPayloadKeyRef.current) {
      if (!saveInFlightRef.current) setAutosaveStatus("saved");
      return;
    }

    setAutosaveStatus("unsaved");
    if (saveInFlightRef.current) {
      saveAgainRef.current = true;
      return;
    }

    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void runAutosaveLoop().catch(() => {
        // The status state already reflects the failure; keep the draft local.
      });
    }, 800);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [isDirty, runAutosaveLoop, savePayloadKey]);

  useEffect(() => {
    if (!props.onRegisterSave) return;
    props.onRegisterSave(flushAutosave);
  }, [props.onRegisterSave, flushAutosave]);

  const handleGenerateTailoring = useCallback(
    async (target: TailoringGenerateTarget) => {
      try {
        setGenerateTarget(target);
        await flushAutosave();

        const requestedFields = TAILORING_REVIEW_KEYS.filter(
          (key) => target === "all" || key === target,
        );
        const beforeGeneration: TailoringBaseline = {
          summary,
          headline,
          skillsJson,
        };
        const manuallyEditedFields = requestedFields.filter(
          (key) =>
            getReviewValue(beforeGeneration, key) !==
            getReviewValue(aiBaseline, key),
        );

        const updatedJob = await api.summarizeJob(props.job.id, {
          force: true,
          fields:
            target === "all" ? ["summary", "headline", "skills"] : [target],
        });
        const aiDraft = toBaselineFromJob(updatedJob);
        const finalBaseline: TailoringBaseline = { ...aiDraft };
        for (const key of manuallyEditedFields) {
          const value = getReviewValue(beforeGeneration, key);
          if (key === "summary") finalBaseline.summary = value;
          else if (key === "headline") finalBaseline.headline = value;
          else finalBaseline.skillsJson = value;
        }

        if (manuallyEditedFields.length > 0) {
          await api.updateJob(props.job.id, {
            tailoredSummary: finalBaseline.summary,
            tailoredHeadline: finalBaseline.headline,
            tailoredSkills: finalBaseline.skillsJson,
            jobDescription,
            selectedProjectIds: selectedIdsCsv,
            tracerLinksEnabled,
          });
          setSuggestions((current) => {
            const next = { ...current };
            for (const key of manuallyEditedFields) {
              const currentValue = getReviewValue(beforeGeneration, key);
              const suggestedValue = getReviewValue(aiDraft, key);
              if (suggestedValue === currentValue) continue;
              next[key] = {
                current: currentValue,
                suggested: suggestedValue,
                label: TAILORING_REVIEW_LABELS[key],
              };
            }
            return next;
          });
        }

        applyIncomingDraft({
          ...updatedJob,
          tailoredSummary: finalBaseline.summary,
          tailoredHeadline: finalBaseline.headline,
          tailoredSkills: finalBaseline.skillsJson,
        });
        setAiBaseline(aiDraft);
        toast.success(
          target === "all"
            ? "Draft content generated"
            : `${target[0].toUpperCase()}${target.slice(1)} generated`,
          {
            description:
              manuallyEditedFields.length > 0
                ? "Manual edits were kept. Review the AI suggestions below."
                : undefined,
          },
        );
        await props.onUpdate();
      } catch (error) {
        showErrorToast(error, "AI generation failed");
      } finally {
        setGenerateTarget(null);
      }
    },
    [
      props.onUpdate,
      props.job.id,
      flushAutosave,
      applyIncomingDraft,
      summary,
      headline,
      skillsJson,
      aiBaseline,
      jobDescription,
      selectedIdsCsv,
      tracerLinksEnabled,
    ],
  );

  const handleSummarizeEditor = useCallback(async () => {
    await handleGenerateTailoring("all");
  }, [handleGenerateTailoring]);

  const handleGenerateSummary = useCallback(async () => {
    await handleGenerateTailoring("summary");
  }, [handleGenerateTailoring]);

  const handleGenerateHeadline = useCallback(async () => {
    await handleGenerateTailoring("headline");
  }, [handleGenerateTailoring]);

  const handleGenerateSkills = useCallback(async () => {
    await handleGenerateTailoring("skills");
  }, [handleGenerateTailoring]);

  const handleGenerateProjects = useCallback(async () => {
    await handleGenerateTailoring("projects");
  }, [handleGenerateTailoring]);

  const handleToggleProject = useCallback(
    (id: string) => {
      const resumeProjects = settings?.resumeProjects.value;
      if (!resumeProjects) return;
      const resolution = resolveResumeProjectSelection({
        catalog,
        resumeProjects,
        selectedProjectIds: [...selectedIds],
      });
      if (!resolution.aiSelectableIds.includes(id)) return;

      const mustIncludeSet = new Set(resolution.mustIncludeIds);
      const next = resolution.effectiveSelectedIds.filter(
        (projectId) => !mustIncludeSet.has(projectId),
      );
      const index = next.indexOf(id);
      if (index >= 0) next.splice(index, 1);
      else if (resolution.effectiveSelectedIds.length < resolution.targetCount)
        next.push(id);
      replaceSelectedProjects(next);
    },
    [
      catalog,
      replaceSelectedProjects,
      selectedIds,
      settings?.resumeProjects.value,
    ],
  );

  const handleGeneratePdf = useCallback(async () => {
    try {
      const shouldProceed = props.onBeforeGenerate
        ? await props.onBeforeGenerate()
        : true;
      if (shouldProceed === false) return;

      setIsGeneratingPdf(true);
      await flushAutosave();
      await api.generateJobPdf(props.job.id);
      toast.success("Resume PDF generated");
      await props.onUpdate();
    } catch (error) {
      const message = formatUserFacingError(error, "PDF generation failed");
      if (/tracer/i.test(message)) {
        toast.error("Tracer links are unavailable right now", {
          description: message,
        });
      } else {
        showErrorToast(error, "PDF generation failed");
      }
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [props.onBeforeGenerate, props.onUpdate, flushAutosave, props.job.id]);

  const handleApproveSnapshot = useCallback(async () => {
    if (!props.job.jobDescription?.trim() || isApprovingSnapshot) return;
    setSnapshotError(null);
    setIsApprovingSnapshot(true);
    try {
      await flushAutosave();
      const approved = await api.approveTailoredSnapshot(props.job.id);
      const refreshedVersions = await api.getTailoredSnapshots(props.job.id);
      setSnapshot(approved);
      setVersions(refreshedVersions ?? []);
      toast.success(`Tailored CV snapshot v${approved.version} approved`);
      await props.onUpdate();
    } catch (error) {
      setSnapshotError("Unable to approve the tailored CV snapshot.");
      showErrorToast(error, "Approval failed");
    } finally {
      setIsApprovingSnapshot(false);
    }
  }, [
    flushAutosave,
    isApprovingSnapshot,
    props.job.id,
    props.job.jobDescription,
    props.onUpdate,
  ]);

  const handleSnapshotSaved = useCallback(
    async (
      saved: TailoredResumeSnapshot,
      refreshedVersions: TailoredResumeSnapshot[],
    ) => {
      setSnapshot(saved);
      setVersions(refreshedVersions ?? []);
      await props.onUpdate();
    },
    [props.onUpdate],
  );

  const handleSnapshotRestored = useCallback(
    async (
      restored: TailoredResumeSnapshot,
      refreshedVersions: TailoredResumeSnapshot[],
    ) => {
      setSnapshot(restored);
      setVersions(refreshedVersions ?? []);
      await props.onUpdate();
    },
    [props.onUpdate],
  );

  const handleComputeFit = useCallback(async () => {
    if (!canComputeFit || isComputingFit) return;
    setIsComputingFit(true);
    try {
      await flushAutosave();
      const updatedJob = await api.computeTailoredFit(props.job.id);
      await props.onUpdate(updatedJob);
      const refreshed = await api.getTailoredFit(props.job.id);
      if (isMountedRef.current) setFitState(refreshed);
    } catch (error) {
      showErrorToast(error, "Tailored-fit check failed");
    } finally {
      if (isMountedRef.current) setIsComputingFit(false);
    }
  }, [
    canComputeFit,
    flushAutosave,
    isComputingFit,
    props.job.id,
    props.onUpdate,
  ]);

  const handlePreviewPdf = useCallback(() => {
    if (!props.job.pdfPath || isGeneratingPdf) return;
    openJobPdf(
      props.job.id,
      props.job.title,
      tailoredResumeFilename(props.job.employer),
    );
  }, [
    openJobPdf,
    props.job.id,
    props.job.employer,
    props.job.pdfPath,
    props.job.title,
    isGeneratingPdf,
  ]);

  const handleUndoSummary = useCallback(() => {
    setSummary(originalValues.summary);
  }, [originalValues.summary, setSummary]);

  const handleUndoHeadline = useCallback(() => {
    setHeadline(originalValues.headline);
  }, [originalValues.headline, setHeadline]);

  const handleUndoSkills = useCallback(() => {
    setSkillsDraft(originalValues.skillsDraft);
  }, [originalValues.skillsDraft, setSkillsDraft]);

  const handleRedoSummary = useCallback(() => {
    setSummary(aiBaseline.summary);
  }, [aiBaseline.summary, setSummary]);

  const handleRedoHeadline = useCallback(() => {
    setHeadline(aiBaseline.headline);
  }, [aiBaseline.headline, setHeadline]);

  const handleRedoSkills = useCallback(() => {
    setSkillsDraft(
      toEditableSkillGroups(parseTailoredSkills(aiBaseline.skillsJson)),
    );
  }, [aiBaseline.skillsJson, setSkillsDraft]);

  const dismissSuggestion = useCallback((key: TailoringReviewKey) => {
    setSuggestions((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const handleAcceptSuggestion = useCallback(
    (key: TailoringReviewKey) => {
      const suggestion = suggestions[key];
      if (!suggestion) return;
      if (key === "summary") setSummary(suggestion.suggested);
      else if (key === "headline") setHeadline(suggestion.suggested);
      else
        setSkillsDraft(
          toEditableSkillGroups(parseTailoredSkills(suggestion.suggested)),
        );
      dismissSuggestion(key);
    },
    [suggestions, setSummary, setHeadline, setSkillsDraft, dismissSuggestion],
  );

  const handleKeepCurrentSuggestion = useCallback(
    (key: TailoringReviewKey) => {
      dismissSuggestion(key);
    },
    [dismissSuggestion],
  );

  const handleUndoOriginalSuggestion = useCallback(
    (key: TailoringReviewKey) => {
      if (key === "summary") setSummary(originalValues.summary);
      else if (key === "headline") setHeadline(originalValues.headline);
      else setSkillsDraft(originalValues.skillsDraft);
      dismissSuggestion(key);
    },
    [
      originalValues,
      setSummary,
      setHeadline,
      setSkillsDraft,
      dismissSuggestion,
    ],
  );

  const handleCheckEvidence = useCallback(async () => {
    try {
      setIsCheckingEvidence(true);
      await flushAutosave();
      const result = await api.getTailoringPlan(
        props.job.id,
        currentEvidenceText,
      );
      setPlan(result);
      setCheckedText(currentEvidenceText);
      setEvidenceAcknowledged(false);
      toast.success("Evidence check complete", {
        description: "Review the plan below before applying any wording.",
      });
    } catch (error) {
      showErrorToast(error, "Evidence check failed");
    } finally {
      setIsCheckingEvidence(false);
    }
  }, [flushAutosave, props.job.id, currentEvidenceText]);

  const handleAcceptPlanItem = useCallback(
    (index: number) => {
      const item = plan?.items[index];
      if (!item) return;
      const wording = item.proposedWording.trim();
      if (!wording) return;

      if (item.targetField === "headline") {
        setHeadline(wording);
      } else if (item.targetField === "skills") {
        setSkillsDraft((current) => {
          const next = current.map((group) => ({ ...group }));
          if (next.length === 0) {
            next.push({
              id: `evidence-${index}`,
              name: "Tailored skills",
              keywordsText: wording,
            });
          } else {
            const existing = next[0].keywordsText.trim();
            next[0] = {
              ...next[0],
              keywordsText: existing ? `${existing}, ${wording}` : wording,
            };
          }
          return next;
        });
      } else {
        setSummary((current) => {
          const base = current.trim();
          if (!base) return wording;
          return `${base.replace(/[.\s]+$/, "")}. ${wording}`.trim();
        });
      }

      setPlan((current) =>
        current
          ? {
              ...current,
              items: current.items.map((entry, i) =>
                i === index ? { ...entry, userDecision: "accepted" } : entry,
              ),
            }
          : current,
      );
    },
    [plan, setSummary, setHeadline, setSkillsDraft],
  );

  const handleEditPlanItem = useCallback((index: number, wording: string) => {
    const cleaned = wording.trim();
    if (!cleaned) return;
    setPlan((current) =>
      current
        ? {
            ...current,
            items: current.items.map((entry, i) =>
              i === index
                ? { ...entry, proposedWording: cleaned, userDecision: "edited" }
                : entry,
            ),
          }
        : current,
    );
    setEvidenceAcknowledged(false);
  }, []);

  const handleRejectPlanItem = useCallback((index: number) => {
    setPlan((current) =>
      current
        ? {
            ...current,
            items: current.items.map((entry, i) =>
              i === index ? { ...entry, userDecision: "rejected" } : entry,
            ),
          }
        : current,
    );
  }, []);

  const disableInputs = Boolean(generateTarget) || isGeneratingPdf;
  const tailoringReadiness = useMemo(
    () =>
      getTailoringReadiness({
        summary,
        headline,
        skillsJson,
        jobDescription,
        selectedProjectIds: selectedIdsCsv,
        pdfFreshness: props.job.pdfFreshness,
        pdfRegenerating: props.job.pdfRegenerating,
        projectsAreLoading: isCatalogLoading || isSettingsLoading,
      }),
    [
      summary,
      headline,
      skillsJson,
      jobDescription,
      selectedIdsCsv,
      props.job.pdfFreshness,
      props.job.pdfRegenerating,
      isCatalogLoading,
      isSettingsLoading,
    ],
  );
  const isDraftReady = tailoringReadiness.canGeneratePdf;

  const evidenceCheck = plan?.check ?? null;
  const evidenceCheckStale =
    checkedText !== null && checkedText !== currentEvidenceText;
  const hasNeverClaimBlocker = (evidenceCheck?.blocked.length ?? 0) > 0;
  const hasUnsupportedClaims = (evidenceCheck?.unsupported.length ?? 0) > 0;
  const requiresAcknowledgment = !hasNeverClaimBlocker && hasUnsupportedClaims;
  const evidenceGateSatisfied =
    !evidenceCheckStale &&
    !hasNeverClaimBlocker &&
    (!requiresAcknowledgment || evidenceAcknowledged);
  const snapshotIsCurrent = Boolean(
    snapshot &&
      props.job.tailoredResumeSnapshotId === snapshot.id &&
      props.job.tailoredResumeVersion === snapshot.version &&
      autosaveStatus === "saved",
  );
  const canGeneratePdf =
    isDraftReady && evidenceGateSatisfied && snapshotIsCurrent;
  const showSnapshotGateMessage =
    !snapshotIsCurrent && isDraftReady && evidenceGateSatisfied;
  const showEvidenceGate = Boolean(
    evidenceCheck &&
      !evidenceCheckStale &&
      (hasNeverClaimBlocker || hasUnsupportedClaims),
  );

  const resolvedLanguage = useMemo(() => {
    const mode = settings?.chatStyleLanguageMode.value;
    if (mode === "match-job-description") return "Match job description";
    if (mode === "match-resume") return "Match resume";
    const manualLanguage = settings?.chatStyleManualLanguage.value;
    return manualLanguage
      ? (CHAT_STYLE_MANUAL_LANGUAGE_LABELS[manualLanguage] ?? manualLanguage)
      : null;
  }, [
    settings?.chatStyleLanguageMode.value,
    settings?.chatStyleManualLanguage.value,
  ]);

  const tailoringSectionsProps = useMemo<TailoringSectionsProps>(
    () => ({
      catalog,
      isCatalogLoading,
      summary,
      headline,
      jobDescription,
      skillsDraft,
      selectedIds,
      resumeProjectsSettings: settings?.resumeProjects.value ?? null,
      isResumeProjectsSettingsLoading: isSettingsLoading,
      tracerLinksEnabled,
      tracerEnableBlocked,
      tracerEnableBlockedReason,
      tracerReadinessChecking: isTracerReadinessChecking,
      generatingSection:
        generateTarget === "summary" ||
        generateTarget === "headline" ||
        generateTarget === "skills"
          ? generateTarget
          : null,
      isGeneratingProjects: generateTarget === "projects",
      openSkillGroupId,
      disableInputs,
      suggestions,
      originalBaseline: {
        summary: originalValues.summary,
        headline: originalValues.headline,
        skillsJson: originalValues.skillsJson,
      },
      onAcceptSuggestion: handleAcceptSuggestion,
      onKeepCurrentSuggestion: handleKeepCurrentSuggestion,
      onUndoOriginalSuggestion: handleUndoOriginalSuggestion,
      onGenerateSummary: handleGenerateSummary,
      onGenerateHeadline: handleGenerateHeadline,
      onGenerateSkills: handleGenerateSkills,
      onGenerateProjects: handleGenerateProjects,
      onSummaryChange: setSummary,
      onHeadlineChange: setHeadline,
      onUndoSummary: handleUndoSummary,
      onUndoHeadline: handleUndoHeadline,
      onUndoSkills: handleUndoSkills,
      onRedoSummary: handleRedoSummary,
      onRedoHeadline: handleRedoHeadline,
      onRedoSkills: handleRedoSkills,
      canUndoSummary:
        canUseOriginalValues && summary !== originalValues.summary,
      canUndoHeadline:
        canUseOriginalValues && headline !== originalValues.headline,
      canUndoSkills:
        canUseOriginalValues && skillsJson !== originalValues.skillsJson,
      canRedoSummary: summary !== aiBaseline.summary,
      canRedoHeadline: headline !== aiBaseline.headline,
      canRedoSkills: skillsJson !== aiBaseline.skillsJson,
      undoDisabledReason: canUseOriginalValues
        ? null
        : "Original base CV unavailable.",
      onDescriptionChange: setJobDescription,
      onSkillGroupOpenChange: setOpenSkillGroupId,
      onAddSkillGroup: handleAddSkillGroup,
      onUpdateSkillGroup: handleUpdateSkillGroup,
      onRemoveSkillGroup: handleRemoveSkillGroup,
      onToggleProject: handleToggleProject,
      onTracerLinksEnabledChange: setTracerLinksEnabled,
      plan,
      planLoading: isCheckingEvidence,
      onCheckEvidence: handleCheckEvidence,
      onAcceptPlanItem: handleAcceptPlanItem,
      onEditPlanItem: handleEditPlanItem,
      onRejectPlanItem: handleRejectPlanItem,
    }),
    [
      catalog,
      isCatalogLoading,
      summary,
      headline,
      jobDescription,
      skillsDraft,
      selectedIds,
      settings?.resumeProjects.value,
      isSettingsLoading,
      tracerLinksEnabled,
      tracerEnableBlocked,
      tracerEnableBlockedReason,
      isTracerReadinessChecking,
      generateTarget,
      openSkillGroupId,
      disableInputs,
      suggestions,
      handleAcceptSuggestion,
      handleKeepCurrentSuggestion,
      handleUndoOriginalSuggestion,
      handleGenerateSummary,
      handleGenerateHeadline,
      handleGenerateSkills,
      handleGenerateProjects,
      setSummary,
      setHeadline,
      handleUndoSummary,
      handleUndoHeadline,
      handleUndoSkills,
      handleRedoSummary,
      handleRedoHeadline,
      handleRedoSkills,
      canUseOriginalValues,
      originalValues,
      skillsJson,
      aiBaseline,
      setJobDescription,
      setOpenSkillGroupId,
      handleAddSkillGroup,
      handleUpdateSkillGroup,
      handleRemoveSkillGroup,
      handleToggleProject,
      setTracerLinksEnabled,
      plan,
      isCheckingEvidence,
      handleCheckEvidence,
      handleAcceptPlanItem,
      handleEditPlanItem,
      handleRejectPlanItem,
    ],
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]">
        <div
          className={`flex min-h-16 items-center justify-between gap-3 rounded-md border px-3 py-3 ${
            isDraftReady
              ? "border-emerald-500/20 bg-emerald-500/[0.04]"
              : "border-amber-500/20 bg-amber-500/[0.04]"
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
                isDraftReady
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-500/45 bg-amber-500/10 text-amber-300"
              }`}
            >
              {isDraftReady ? (
                <Check className="h-4 w-4" />
              ) : (
                <CircleAlert className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground/90">
                {isDraftReady ? "Draft ready" : "Draft incomplete"}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/75">
                {isDraftReady
                  ? "Ready for PDF generation. Review the optional sections before applying."
                  : `To generate a PDF, complete: ${tailoringReadiness.missingLabels
                      .filter((label) =>
                        [
                          "Tailored summary",
                          "Tailored headline",
                          "Tailored skills",
                        ].includes(label),
                      )
                      .join(", ")}.`}
              </p>
            </div>
          </div>
          <AutosaveStatusIcon status={autosaveStatus} />
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
          <Button
            onClick={handleSummarizeEditor}
            disabled={Boolean(generateTarget) || isGeneratingPdf}
            variant="outline"
            size="sm"
          >
            {generateTarget === "all" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4" />
            )}
            Generate all
          </Button>
          <div className="grid gap-1">
            <Button
              onClick={handleGeneratePdf}
              disabled={
                Boolean(generateTarget) || isGeneratingPdf || !canGeneratePdf
              }
              size="sm"
            >
              {isGeneratingPdf ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              Generate PDF
            </Button>
            {showSnapshotGateMessage ? (
              <p className="text-[11px] leading-4 text-amber-300/90">
                Approve a tailored CV snapshot before generating a PDF.
              </p>
            ) : null}
          </div>
          {props.job.jobDescription?.trim() ? (
            <Button
              onClick={() => void handleApproveSnapshot()}
              disabled={
                !tailoringReadiness.canGeneratePdf ||
                Boolean(generateTarget) ||
                isGeneratingPdf ||
                isApprovingSnapshot ||
                Boolean(evidenceCheck?.blocked.length)
              }
              variant="outline"
              size="sm"
            >
              {isApprovingSnapshot ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileEdit className="mr-2 h-4 w-4" />
              )}
              {snapshot ? "Update snapshot" : "Approve snapshot"}
            </Button>
          ) : null}
          {snapshot ? (
            <>
              <Button
                onClick={() => setIsCvEditorOpen(true)}
                disabled={autosaveStatus !== "saved"}
                variant="outline"
                size="sm"
              >
                <FileEdit className="mr-2 h-4 w-4" />
                Open full tailored CV
              </Button>
              <span className="self-center rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-center text-[11px] text-muted-foreground">
                v{snapshot.version}
              </span>
            </>
          ) : null}
          {snapshotError ? (
            <output className="text-[11px] leading-4 text-rose-300">
              {snapshotError}
            </output>
          ) : null}
          {props.job.pdfPath && (
            <Button
              onClick={handlePreviewPdf}
              disabled={Boolean(generateTarget) || isGeneratingPdf}
              variant="outline"
              size="sm"
            >
              <Eye className="h-4 w-4" />
              Preview PDF
            </Button>
          )}
        </div>
      </div>

      <TailoredFitSummary
        job={props.job}
        state={fitState}
        isComputing={isComputingFit}
        canCompute={canComputeFit && !fitLoading}
        disabledReason={fitDisabledReason}
        onCompute={handleComputeFit}
        variant="panel"
      />

      <TailoringRulesStrip
        language={resolvedLanguage}
        tone={settings?.chatStyleTone.value}
        formality={settings?.chatStyleFormality.value}
        constraints={settings?.chatStyleConstraints.value}
        doNotUse={settings?.chatStyleDoNotUse.value}
        summaryMaxWords={settings?.chatStyleSummaryMaxWords.value}
        maxKeywordsPerSkill={settings?.chatStyleMaxKeywordsPerSkill.value}
        isLoading={isSettingsLoading}
      />

      {showEvidenceGate && (
        <div
          role="alert"
          className="space-y-3 rounded-md border border-amber-500/25 bg-amber-500/[0.04] p-3"
        >
          <div className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground/90">
                Evidence check needs attention
              </p>
              {hasNeverClaimBlocker && (
                <p className="text-[11px] leading-5 text-rose-300">
                  Remove these blocked terms before generating a PDF:{" "}
                  {evidenceCheck?.blocked.join(", ")}. They cannot be
                  acknowledged away.
                </p>
              )}
              {hasUnsupportedClaims && (
                <p className="text-[11px] leading-5 text-amber-300/90">
                  These terms have no supporting evidence:{" "}
                  {evidenceCheck?.unsupported.join(", ")}. Only acknowledge them
                  if you can personally verify them.
                </p>
              )}
            </div>
          </div>
          {requiresAcknowledgment && (
            <label
              htmlFor="evidence-acknowledged"
              className="flex cursor-pointer items-center gap-2 text-xs text-foreground"
            >
              <Checkbox
                id="evidence-acknowledged"
                checked={evidenceAcknowledged}
                onCheckedChange={(checked) =>
                  setEvidenceAcknowledged(Boolean(checked))
                }
                disabled={disableInputs}
              />
              I have reviewed the unsupported claims and want to generate the
              PDF anyway.
            </label>
          )}
        </div>
      )}

      {evidenceCheckStale && (
        <output className="block rounded-md border border-amber-500/25 bg-amber-500/[0.04] p-3 text-[11px] leading-5 text-amber-300/90">
          The CV changed after the evidence check. Run Check evidence again
          before generating a PDF.
        </output>
      )}

      <TailoringSections {...tailoringSectionsProps} />

      <Dialog open={isCvEditorOpen} onOpenChange={setIsCvEditorOpen}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tailored CV — {props.job.title}</DialogTitle>
          </DialogHeader>
          {snapshot && (
            <TailoredCvEditor
              jobId={props.job.id}
              snapshot={snapshot}
              versions={versions}
              onSaved={handleSnapshotSaved}
              onRestored={handleSnapshotRestored}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
