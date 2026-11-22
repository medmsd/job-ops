import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import type { CareerEvidenceValues } from "@client/pages/settings/types";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import {
  type CareerEvidenceAchievement,
  type CareerEvidenceBank,
  type CareerEvidenceCoreSkill,
  createEmptyCareerEvidenceBank,
} from "@shared/types/career-evidence.js";
import type { ResumeProjectCatalogItem } from "@shared/types.js";
import { AlertTriangle, Plus, RotateCcw, Trash2 } from "lucide-react";
import type React from "react";
import { useCallback, useMemo } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type CareerEvidenceSectionProps = {
  values: CareerEvidenceValues;
  isLoading: boolean;
  isSaving: boolean;
  profileProjects: ResumeProjectCatalogItem[];
  layoutMode?: "accordion" | "panel";
};

type StringListKey =
  | "targetRoles"
  | "alwaysInclude"
  | "neverClaim"
  | "preferredTerms"
  | "avoidTerms";

const toLines = (values: string[]): string => values.join("\n");
const fromLines = (value: string): string[] =>
  value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

const fromCsv = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

function findDanglingRefs(
  bank: CareerEvidenceBank,
  profileProjects: ResumeProjectCatalogItem[],
): string[] {
  const known = new Set<string>([
    ...profileProjects.flatMap((project) => [
      project.id,
      `project:${project.id}`,
    ]),
    ...bank.achievements.flatMap((achievement) => [
      achievement.id,
      `bank:${achievement.id}`,
    ]),
  ]);
  const refs = [
    ...bank.coreSkills.flatMap((skill) => skill.evidence),
    ...bank.achievements.flatMap((achievement) => achievement.evidence),
  ];
  return Array.from(new Set(refs.filter((ref) => !known.has(ref))));
}

export const CareerEvidenceSection: React.FC<CareerEvidenceSectionProps> = ({
  values,
  isLoading,
  isSaving,
  profileProjects,
  layoutMode,
}) => {
  const { control, setValue } = useFormContext<UpdateSettingsInput>();
  const watched = useWatch({ control, name: "careerEvidence" });
  const bank = useMemo(
    () => watched ?? values.effective ?? createEmptyCareerEvidenceBank(),
    [watched, values.effective],
  );
  const disabled = isLoading || isSaving;
  const danglingRefs = useMemo(
    () => findDanglingRefs(bank, profileProjects),
    [bank, profileProjects],
  );

  const update = useCallback(
    (next: CareerEvidenceBank) => {
      setValue("careerEvidence", next, { shouldDirty: true });
    },
    [setValue],
  );

  const updateStringList = (key: StringListKey, input: string) => {
    update({ ...bank, [key]: fromLines(input) });
  };

  const updateSkill = (index: number, patch: Partial<CareerEvidenceCoreSkill>) => {
    update({
      ...bank,
      coreSkills: bank.coreSkills.map((skill, i) =>
        i === index ? { ...skill, ...patch } : skill,
      ),
    });
  };

  const updateAchievement = (
    index: number,
    patch: Partial<CareerEvidenceAchievement>,
  ) => {
    update({
      ...bank,
      achievements: bank.achievements.map((achievement, i) =>
        i === index ? { ...achievement, ...patch } : achievement,
      ),
    });
  };

  const knownRefHint = [
    ...profileProjects.map((project) => `project:${project.id}`),
    ...bank.achievements.map((achievement) => `bank:${achievement.id}`),
  ].join(", ");

  return (
    <SettingsSectionFrame
      mode={layoutMode}
      title="Career Evidence Bank"
      value="career-evidence"
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Store verified career facts that AI may use when tailoring a CV or
            writing a cover letter. AI can reorder and rephrase these facts, but
            it cannot invent claims that are not listed here or in Resume
            Studio.
          </p>
          <Alert>
            <AlertDescription>
              Evidence refs are stable IDs from Resume Studio, for example{" "}
              <code>project:payments-platform</code>. Bank-owned achievements use{" "}
              <code>bank:&lt;achievement-id&gt;</code>. Dangling refs are
              reported but never prevent saving.
            </AlertDescription>
          </Alert>
        </div>

        {danglingRefs.length > 0 && (
          <Alert variant="warning" data-testid="dangling-evidence-refs">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Missing evidence references</AlertTitle>
            <AlertDescription>
              These refs no longer resolve to a Resume Studio fact or bank
              achievement: {danglingRefs.join(", ")}. Claims linked only to
              these refs may be flagged as unsupported.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => update(values.default ?? createEmptyCareerEvidenceBank())}
          >
            <RotateCcw className="h-4 w-4" />
            Reset to default
          </Button>
        </div>

        <section className="space-y-3 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">Target roles</h3>
          <p className="text-xs text-muted-foreground">One role per line.</p>
          <Textarea
            aria-label="Target roles"
            value={toLines(bank.targetRoles)}
            onChange={(event) => updateStringList("targetRoles", event.target.value)}
            disabled={disabled}
            rows={3}
          />
        </section>

        <section className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Core skills</h3>
              <p className="text-xs text-muted-foreground">
                Skills with the evidence that supports them.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() =>
                update({
                  ...bank,
                  coreSkills: [
                    ...bank.coreSkills,
                    {
                      name: "",
                      years: null,
                      level: "",
                      evidence: [],
                      aliases: [],
                    },
                  ],
                })
              }
            >
              <Plus className="h-4 w-4" />
              Add skill
            </Button>
          </div>

          {bank.coreSkills.map((skill, index) => (
            <div key={`skill-${index}`} className="space-y-3 rounded-md border p-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor={`skill-name-${index}`}>Name</Label>
                  <Input
                    id={`skill-name-${index}`}
                    value={skill.name}
                    onChange={(event) =>
                      updateSkill(index, { name: event.target.value })
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`skill-years-${index}`}>Years</Label>
                  <Input
                    id={`skill-years-${index}`}
                    type="number"
                    min={0}
                    max={80}
                    value={skill.years ?? ""}
                    onChange={(event) =>
                      updateSkill(index, {
                        years:
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                      })
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`skill-level-${index}`}>Level</Label>
                  <Input
                    id={`skill-level-${index}`}
                    value={skill.level}
                    onChange={(event) =>
                      updateSkill(index, { level: event.target.value })
                    }
                    disabled={disabled}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`skill-aliases-${index}`}>
                    Aliases (comma separated)
                  </Label>
                  <Input
                    id={`skill-aliases-${index}`}
                    value={skill.aliases.join(", ")}
                    onChange={(event) =>
                      updateSkill(index, {
                        aliases: fromCsv(event.target.value),
                      })
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`skill-evidence-${index}`}>
                    Evidence refs (comma separated)
                  </Label>
                  <Input
                    id={`skill-evidence-${index}`}
                    value={skill.evidence.join(", ")}
                    onChange={(event) =>
                      updateSkill(index, {
                        evidence: fromCsv(event.target.value),
                      })
                    }
                    disabled={disabled}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() =>
                    update({
                      ...bank,
                      coreSkills: bank.coreSkills.filter((_, i) => i !== index),
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                  Remove skill
                </Button>
              </div>
            </div>
          ))}
          {bank.coreSkills.length === 0 && (
            <p className="text-xs text-muted-foreground">No core skills yet.</p>
          )}
          {knownRefHint && (
            <p className="text-xs text-muted-foreground">
              Known refs: {knownRefHint}
            </p>
          )}
        </section>

        <section className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Achievements</h3>
              <p className="text-xs text-muted-foreground">
                Verified results with their supporting evidence.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() =>
                update({
                  ...bank,
                  achievements: [
                    ...bank.achievements,
                    {
                      id: `ev-${Date.now()}`,
                      text: "",
                      metric: "",
                      evidence: [],
                    },
                  ],
                })
              }
            >
              <Plus className="h-4 w-4" />
              Add achievement
            </Button>
          </div>

          {bank.achievements.map((achievement, index) => (
            <div key={`achievement-${index}`} className="space-y-3 rounded-md border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={`achievement-id-${index}`}>ID</Label>
                  <Input
                    id={`achievement-id-${index}`}
                    value={achievement.id}
                    onChange={(event) =>
                      updateAchievement(index, { id: event.target.value })
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`achievement-metric-${index}`}>Metric</Label>
                  <Input
                    id={`achievement-metric-${index}`}
                    value={achievement.metric}
                    onChange={(event) =>
                      updateAchievement(index, { metric: event.target.value })
                    }
                    disabled={disabled}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`achievement-text-${index}`}>Fact</Label>
                <Textarea
                  id={`achievement-text-${index}`}
                  value={achievement.text}
                  onChange={(event) =>
                    updateAchievement(index, { text: event.target.value })
                  }
                  disabled={disabled}
                  rows={2}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`achievement-evidence-${index}`}>
                  Evidence refs (comma separated)
                </Label>
                <Input
                  id={`achievement-evidence-${index}`}
                  value={achievement.evidence.join(", ")}
                  onChange={(event) =>
                    updateAchievement(index, {
                      evidence: fromCsv(event.target.value),
                    })
                  }
                  disabled={disabled}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() =>
                    update({
                      ...bank,
                      achievements: bank.achievements.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                  Remove achievement
                </Button>
              </div>
            </div>
          ))}
          {bank.achievements.length === 0 && (
            <p className="text-xs text-muted-foreground">No achievements yet.</p>
          )}
        </section>

        <section className="space-y-3 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">Claim rules</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["alwaysInclude", "Always include (one per line)"],
                ["neverClaim", "Never claim (one per line)"],
                ["preferredTerms", "Preferred terms (one per line)"],
                ["avoidTerms", "Avoid terms (one per line)"],
              ] as Array<[StringListKey, string]>
            ).map(([key, label]) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`evidence-${key}`}>{label}</Label>
                <Textarea
                  id={`evidence-${key}`}
                  value={toLines(bank[key])}
                  onChange={(event) => updateStringList(key, event.target.value)}
                  disabled={disabled}
                  rows={4}
                />
              </div>
            ))}
          </div>
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Never claim blocks PDF generation</AlertTitle>
            <AlertDescription>
              If tailored content contains a term from "Never claim", PDF
              generation is blocked until it is removed. Unsupported claims show
              a warning that you must acknowledge.
            </AlertDescription>
          </Alert>
        </section>
      </div>
    </SettingsSectionFrame>
  );
};
