import * as api from "@client/api";
import {
  BasicsSection,
  SummarySection,
} from "@client/components/design-resume/DesignResumeInlineSections";
import type { ItemDefinition } from "@client/components/design-resume/definitions";
import { ITEM_DEFINITIONS } from "@client/components/design-resume/definitions";
import { ItemDialog } from "@client/components/design-resume/ItemDialog";
import {
  asArray,
  asRecord,
  getDesignResumeDialogItem,
  setByPath,
  toText,
} from "@client/components/design-resume/utils";
import type {
  DesignResumeDocument,
  DesignResumeJson,
  TailoredResumeChange,
  TailoredResumeSnapshot,
} from "@shared/types";
import { Loader2, Pencil, Plus, RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { showErrorToast } from "@/client/lib/error-toast";
import { Button } from "@/components/ui/button";

type TailoredCvEditorProps = {
  jobId: string;
  snapshot: TailoredResumeSnapshot;
  versions: TailoredResumeSnapshot[];
  onSaved: (snapshot: TailoredResumeSnapshot, versions: TailoredResumeSnapshot[]) => void;
  onRestored: (snapshot: TailoredResumeSnapshot, versions: TailoredResumeSnapshot[]) => void;
};

type EditorDialogState = {
  definition: ItemDefinition;
  index: number | null;
};

const CHANGE_PREVIEW_LIMIT = 160;

function previewValue(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : value == null
        ? "—"
        : JSON.stringify(value) ?? "—";
  if (text.length <= CHANGE_PREVIEW_LIMIT) return text;
  return `${text.slice(0, CHANGE_PREVIEW_LIMIT - 1)}…`;
}

function cloneResumeJson(resumeJson: DesignResumeJson): DesignResumeJson {
  return structuredClone(resumeJson) as DesignResumeJson;
}

export const TailoredCvEditor: React.FC<TailoredCvEditorProps> = ({
  jobId,
  snapshot,
  versions,
  onSaved,
  onRestored,
}) => {
  const [draft, setDraft] = useState<DesignResumeJson>(() =>
    cloneResumeJson(snapshot.resumeJson),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<EditorDialogState | null>(null);

  // A different approved version becomes the new local baseline; unsaved edits
  // for the previous version are intentionally discarded.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the current version changes
  useEffect(() => {
    setDraft(cloneResumeJson(snapshot.resumeJson));
    setDirty(false);
    setDialog(null);
  }, [snapshot.id, snapshot.version]);

  const applyDraft = useCallback(
    (updater: (current: DesignResumeJson) => DesignResumeJson) => {
      setDraft((current) => updater(current));
      setDirty(true);
    },
    [],
  );

  const update = useCallback(
    (path: string, value: unknown) => {
      applyDraft((current) =>
        setByPath(current as Record<string, unknown>, path, value) as DesignResumeJson,
      );
    },
    [applyDraft],
  );

  const sections = useMemo(
    () => asRecord(draft.sections) ?? {},
    [draft.sections],
  );

  const getItems = useCallback(
    (key: string): Record<string, unknown>[] =>
      asArray(asRecord(sections[key])?.items).map(
        (entry) => asRecord(entry) ?? {},
      ),
    [sections],
  );

  const dialogItem = useMemo(() => {
    if (!dialog) return null;
    if (dialog.index === null) return dialog.definition.createItem();
    return getDesignResumeDialogItem(
      { resumeJson: draft } as DesignResumeDocument,
      dialog.definition,
      dialog.index,
    );
  }, [dialog, draft]);

  const handleSaveItem = useCallback(
    (item: Record<string, unknown>) => {
      if (!dialog) return;
      const targetIndex = dialog.index ?? -1;
      applyDraft((current) => {
        const currentItems = asArray(
          asRecord(asRecord(current.sections)?.[dialog.definition.key])?.items,
        );
        const nextItems =
          targetIndex < 0
            ? [...currentItems, item]
            : currentItems.map((entry, index) =>
                index === targetIndex ? item : entry,
              );
        return setByPath(
          current as Record<string, unknown>,
          `sections.${dialog.definition.key}.items`,
          nextItems,
        ) as DesignResumeJson;
      });
      setDialog(null);
    },
    [applyDraft, dialog],
  );

  const handleSaveEdits = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const saved = await api.saveTailoredSnapshot(jobId, snapshot.id, draft);
      const refreshedVersions = await api.getTailoredSnapshots(jobId);
      setDraft(cloneResumeJson(saved.resumeJson));
      setDirty(false);
      toast.success(`Tailored CV v${saved.version} saved`);
      onSaved(saved, refreshedVersions);
    } catch (error) {
      showErrorToast(error, "Failed to save tailored CV changes");
    } finally {
      setSaving(false);
    }
  }, [dirty, draft, jobId, onSaved, saving, snapshot.id]);

  const handleRestore = useCallback(
    async (version: TailoredResumeSnapshot) => {
      if (saving) return;
      setSaving(true);
      try {
        const restored = await api.restoreTailoredSnapshot(jobId, version.id);
        const refreshedVersions = await api.getTailoredSnapshots(jobId);
        setDraft(cloneResumeJson(restored.resumeJson));
        setDirty(false);
        toast.success(`Restored as tailored CV v${restored.version}`);
        onRestored(restored, refreshedVersions);
      } catch (error) {
        showErrorToast(error, "Failed to restore tailored CV version");
      } finally {
        setSaving(false);
      }
    },
    [jobId, onRestored, saving],
  );

  const basics = useMemo(() => asRecord(draft.basics) ?? {}, [draft.basics]);
  const summary = useMemo(() => asRecord(draft.summary) ?? {}, [draft.summary]);

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border/60 bg-muted/20 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Tailored content
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Edits stay local until you save them as a new version.
            </p>
          </div>
          <span className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground">
            v{snapshot.version}
          </span>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-lg border border-border/60 bg-background/60 p-4">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Basics
            </h4>
            <BasicsSection
              resumeJson={draft}
              basics={basics}
              onUpdateBasics={(path, value) => update(`basics.${path}`, value)}
            />
          </div>
          <div className="rounded-lg border border-border/60 bg-background/60 p-4">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Summary
            </h4>
            <SummarySection
              resumeJson={draft}
              summary={summary}
              onUpdateSummary={(key, value) => update(`summary.${key}`, value)}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">CV items</h3>
          <p className="text-[11px] text-muted-foreground">
            Add or edit items directly in this tailored version.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {ITEM_DEFINITIONS.map((definition) => {
            const items = getItems(definition.key);
            return (
              <div
                key={definition.key}
                data-testid={`tailored-cv-items-${definition.key}`}
                className="rounded-lg border border-border/60 bg-background/50 p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-medium text-foreground">
                      {definition.title}
                    </h4>
                    <p className="text-[11px] text-muted-foreground">
                      {items.length} item{items.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Add ${definition.singularTitle}`}
                    onClick={() => setDialog({ definition, index: null })}
                    disabled={saving}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add
                  </Button>
                </div>
                {items.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
                    No items yet.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {items.map((item, index) => {
                      const primary = toText(
                        item[definition.primaryField],
                        "Untitled",
                      );
                      const secondary = definition.secondaryField
                        ? toText(item[definition.secondaryField])
                        : "";
                      return (
                        <li
                          key={toText(item.id, `${definition.key}-${index}`)}
                          className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-2.5 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-foreground">
                              {primary}
                            </p>
                            {secondary ? (
                              <p className="truncate text-[11px] text-muted-foreground">
                                {secondary}
                              </p>
                            ) : null}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            aria-label={`Edit ${definition.singularTitle} ${index + 1}`}
                            onClick={() => setDialog({ definition, index })}
                            disabled={saving}
                          >
                            <Pencil className="mr-1 h-3.5 w-3.5" />
                            Edit
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section
        aria-labelledby="tailored-cv-changes-heading"
        data-testid="baseline-changes"
        className="rounded-lg border border-border/60 bg-muted/20 p-4"
      >
        <h3
          id="tailored-cv-changes-heading"
          className="text-sm font-semibold text-foreground"
        >
          Changes from baseline
        </h3>
        {snapshot.changes.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No changes were recorded for this version.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {snapshot.changes.map((change: TailoredResumeChange, index) => (
              <li
                key={`${change.path}-${index}`}
                className="rounded-md border border-border/50 bg-background/60 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {change.kind}
                  </span>
                  <span className="text-xs font-medium text-foreground">
                    {change.label}
                  </span>
                </div>
                <p className="mt-1 break-words text-[11px] leading-5 text-muted-foreground">
                  <span className="line-through">
                    {previewValue(change.before)}
                  </span>
                  <span className="mx-1.5 text-foreground/60">→</span>
                  <span>{previewValue(change.after)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border/60 bg-background/50 p-4">
        <h3 className="text-sm font-semibold text-foreground">Version history</h3>
        {versions.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No versions are available yet.
          </p>
        ) : (
          <ol className="mt-3 divide-y divide-border/50">
            {versions.map((version) => (
              <li
                key={version.id}
                data-testid="tailored-cv-version-row"
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-foreground">
                    v{version.version}
                  </span>
                  <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                    {version.origin}
                  </span>
                  <time
                    dateTime={version.createdAt}
                    className="text-muted-foreground"
                  >
                    {version.createdAt}
                  </time>
                  <span className="text-muted-foreground">
                    {version.changes.length} change
                    {version.changes.length === 1 ? "" : "s"}
                  </span>
                </div>
                {version.version < snapshot.version ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    onClick={() => void handleRestore(version)}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    Restore v{version.version}
                  </Button>
                ) : (
                  <span className="text-[11px] text-emerald-300/80">
                    Current
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="flex items-center justify-end gap-3">
        {dirty ? (
          <span className="text-[11px] text-amber-300">Unsaved edits</span>
        ) : null}
        <Button
          type="button"
          onClick={() => void handleSaveEdits()}
          disabled={!dirty || saving}
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save edits
        </Button>
      </div>

      {dialog ? (
        <ItemDialog
          open
          title={`${dialog.index === null ? "Add" : "Edit"} ${dialog.definition.singularTitle}`}
          description={dialog.definition.description}
          item={dialogItem}
          fields={dialog.definition.fields}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          onSave={handleSaveItem}
        />
      ) : null}
    </div>
  );
};
