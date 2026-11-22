import type { TailoringPlanResult } from "./career-evidence";
import type { DesignResumeJson } from "./design-resume";

export type TailoredResumeStatus = "approved" | "superseded";
export type TailoredResumeOrigin = "approved" | "restored";

export interface TailoredResumeChange {
  path: string;
  label: string;
  kind: "added" | "changed" | "removed" | "visibility";
  before: unknown;
  after: unknown;
}

export interface TailoredResumeSnapshot {
  id: string;
  jobId: string;
  version: number;
  status: TailoredResumeStatus;
  origin: TailoredResumeOrigin;
  resumeJson: DesignResumeJson;
  changes: TailoredResumeChange[];
  ats: TailoringPlanResult["check"] | null;
  model: string | null;
  baseResumeDocumentId: string | null;
  baseResumeRevision: number | null;
  generatedAt: number;
  createdAt: string;
  updatedAt: string;
}
