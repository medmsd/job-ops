export type TailoredFitNoteStatus =
  | "covered"
  | "partial"
  | "gap"
  | "unsupported";

export interface TailoredFitNote {
  requirement: string;
  status: TailoredFitNoteStatus;
  explanation: string;
  evidenceRefs: string[];
}

export interface TailoredFitResult {
  score: number;
  summary: string;
  notes: TailoredFitNote[];
  snapshotId: string;
  snapshotVersion: number;
  inputHash: string;
  computedAt: number;
  model: string | null;
}

export interface TailoredFitState {
  result: TailoredFitResult | null;
  isStale: boolean;
  reason:
    | "no_description"
    | "no_snapshot"
    | "not_checked"
    | "inputs_changed"
    | null;
}
