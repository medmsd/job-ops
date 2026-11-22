import type React from "react";

interface TailoringRulesStripProps {
  language?: string | null;
  tone?: string | null;
  formality?: string | null;
  constraints?: string | null;
  doNotUse?: string | null;
  summaryMaxWords?: number | null;
  maxKeywordsPerSkill?: number | null;
  isLoading?: boolean;
}

const tokens = (value: string | null | undefined) =>
  (value ?? "")
    .split(/[\n,]/g)
    .map((token) => token.trim())
    .filter(Boolean);

const RuleChip: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/50 bg-muted/20 px-2 py-0.5 text-[10px] text-muted-foreground">
    <span className="font-semibold text-foreground/75">{label}:</span>
    <span className="truncate">{value}</span>
  </span>
);

export const TailoringRulesStrip: React.FC<TailoringRulesStripProps> = ({
  language,
  tone,
  formality,
  constraints,
  doNotUse,
  summaryMaxWords,
  maxKeywordsPerSkill,
  isLoading = false,
}) => {
  if (isLoading) {
    return (
      <div className="rounded-md border border-border/45 bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground">
        Loading tailoring rules...
      </div>
    );
  }

  const values = [
    language ? { label: "Language", value: language } : null,
    tone ? { label: "Tone", value: tone } : null,
    formality ? { label: "Formality", value: formality } : null,
    summaryMaxWords
      ? { label: "Summary", value: `Max ${summaryMaxWords} words` }
      : null,
    maxKeywordsPerSkill
      ? { label: "Skills", value: `Max ${maxKeywordsPerSkill} keywords` }
      : null,
  ].filter((value): value is { label: string; value: string } => Boolean(value));
  const avoidTokens = tokens(doNotUse);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/45 bg-muted/10 px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
        Writing rules
      </span>
      {values.length === 0 && avoidTokens.length === 0 && !constraints ? (
        <span className="text-[11px] text-muted-foreground">Default rules</span>
      ) : (
        <>
          {values.map((value) => (
            <RuleChip key={value.label} label={value.label} value={value.value} />
          ))}
          {constraints ? (
            <RuleChip label="Constraints" value={constraints} />
          ) : null}
          {avoidTokens.length > 0 ? (
            <RuleChip label="Avoid" value={avoidTokens.join(", ")} />
          ) : null}
        </>
      )}
      <a
        href="/settings"
        className="ml-auto text-[11px] font-medium text-primary hover:underline"
      >
        Edit in Settings
      </a>
    </div>
  );
};
