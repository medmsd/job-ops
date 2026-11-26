import type { JobListItem } from "@shared/types.js";

export const BULK_TAILOR_DEFAULT = 10;
export const BULK_TAILOR_MIN = 1;
export const BULK_TAILOR_MAX = 500;

export function clampBulkTailorLimit(value: number): number {
  if (!Number.isFinite(value)) return BULK_TAILOR_DEFAULT;
  return Math.min(
    BULK_TAILOR_MAX,
    Math.max(BULK_TAILOR_MIN, Math.trunc(value)),
  );
}

export function getBulkTailorJobIds(
  jobs: JobListItem[],
  limit: number,
): string[] {
  return jobs.slice(0, clampBulkTailorLimit(limit)).map((job) => job.id);
}
