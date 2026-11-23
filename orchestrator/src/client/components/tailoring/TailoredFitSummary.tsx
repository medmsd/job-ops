import type {
  Job,
  TailoredFitNoteStatus,
  TailoredFitState,
} from "@shared/types.js";
import { CircleAlert, Loader2, Sparkles } from "lucide-react";
import type React from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const FIT_LABEL = "Derived tailored fit — job-specific";

const NOTE_STATUS_LABELS: Record<TailoredFitNoteStatus, string> = {
  covered: "Covered",
  partial: "Partial",
  gap: "Gap",
  unsupported: "Unsupported",
};

const NOTE_STATUS_CLASSES: Record<TailoredFitNoteStatus, string> = {
  covered: "border-emerald-500/40 text-emerald-300",
  partial: "border-amber-500/40 text-amber-300",
  gap: "border-orange-500/40 text-orange-300",
  unsupported: "border-rose-500/40 text-rose-300",
};

const REASON_MESSAGES: Record<
  NonNullable<TailoredFitState["reason"]>,
  string
> = {
  no_description: "Add a job description before checking tailored fit.",
  no_snapshot: "Approve a tailored CV snapshot before checking tailored fit.",
  not_checked:
    "No tailored-fit check yet. Run Check tailored fit to score this job.",
  inputs_changed:
    "Inputs changed since the last tailored-fit check. Run Check tailored fit again.",
};

export interface TailoredFitSummaryProps {
  job: Job;
  state: TailoredFitState;
  isComputing: boolean;
  canCompute: boolean;
  disabledReason: string | null;
  onCompute: () => void | Promise<void>;
  variant?: "panel" | "compact";
}

export const TailoredFitSummary: React.FC<TailoredFitSummaryProps> = ({
  job,
  state,
  isComputing,
  canCompute,
  disabledReason,
  onCompute,
  variant = "panel",
}) => {
  const result = state.result;
  const regionLabel = `${FIT_LABEL} for ${job.title}`;

  if (variant === "compact") {
    return (
      <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-[11px] text-muted-foreground">
        <span>{FIT_LABEL}</span>
        <span aria-live="polite" className="font-semibold text-foreground">
          {result ? `${result.score}/100` : "Not checked"}
          {state.isStale ? (
            <span className="ml-1 text-amber-300" title="Stale tailored fit">
              • Stale
            </span>
          ) : null}
        </span>
      </div>
    );
  }

  const reasonMessage = state.reason ? REASON_MESSAGES[state.reason] : null;
  const showReasonAlert =
    !state.isStale &&
    reasonMessage !== null &&
    (!disabledReason || state.reason === "not_checked");

  return (
    <Card aria-label={regionLabel} className="border-border/60 bg-muted/20">
      <CardHeader className="px-4 pb-2 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">{FIT_LABEL}</CardTitle>
          {result ? (
            <Badge variant="outline" className="text-[10px]">
              Snapshot v{result.snapshotVersion}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4">
        <div aria-live="polite" className="space-y-2">
          {result ? (
            <>
              <p className="text-2xl font-semibold text-foreground">
                {result.score}/100
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                {result.summary}
              </p>
              {result.notes.length > 0 ? (
                <ul className="space-y-2">
                  {result.notes.map((note) => (
                    <li
                      key={`${note.requirement}-${note.status}`}
                      className="rounded-md border border-border/50 bg-background/50 p-2 text-xs"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={NOTE_STATUS_CLASSES[note.status]}
                        >
                          {NOTE_STATUS_LABELS[note.status]}
                        </Badge>
                        <span className="font-medium text-foreground">
                          {note.requirement}
                        </span>
                      </div>
                      <p className="mt-1 leading-5 text-muted-foreground">
                        {note.explanation}
                      </p>
                      {note.evidenceRefs.length > 0 ? (
                        <p className="mt-1 text-[11px] leading-4 text-muted-foreground/80">
                          Evidence: {note.evidenceRefs.join(", ")}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">
              {isComputing
                ? "Checking tailored fit..."
                : "No tailored-fit result yet."}
            </p>
          )}
        </div>

        {state.isStale ? (
          <Alert variant="warning" className="p-3">
            <CircleAlert className="h-4 w-4" />
            <AlertDescription className="text-xs leading-5">
              {REASON_MESSAGES.inputs_changed}
            </AlertDescription>
          </Alert>
        ) : null}
        {showReasonAlert ? (
          <Alert role="status" variant="warning" className="p-3">
            <CircleAlert className="h-4 w-4" />
            <AlertDescription className="text-xs leading-5">
              {reasonMessage}
            </AlertDescription>
          </Alert>
        ) : null}

        <Button
          type="button"
          onClick={() => void onCompute()}
          disabled={!canCompute || isComputing}
          variant="outline"
          size="sm"
        >
          {isComputing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          {isComputing ? "Checking tailored fit..." : "Check tailored fit"}
        </Button>
        {!canCompute && disabledReason ? (
          <p className="text-[11px] leading-4 text-amber-300/90">
            {disabledReason}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
};
