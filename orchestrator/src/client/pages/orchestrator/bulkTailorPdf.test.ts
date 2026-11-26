import { createJob } from "@shared/testing/factories.js";
import { describe, expect, it } from "vitest";
import {
  BULK_TAILOR_MAX,
  clampBulkTailorLimit,
  getBulkTailorJobIds,
} from "./bulkTailorPdf";

describe("clampBulkTailorLimit", () => {
  it("defaults invalid values to 10", () => {
    expect(clampBulkTailorLimit(Number.NaN)).toBe(10);
    expect(clampBulkTailorLimit(Number.POSITIVE_INFINITY)).toBe(10);
  });

  it("clamps below the minimum and above the maximum", () => {
    expect(clampBulkTailorLimit(0)).toBe(1);
    expect(clampBulkTailorLimit(-7)).toBe(1);
    expect(clampBulkTailorLimit(501)).toBe(BULK_TAILOR_MAX);
    expect(clampBulkTailorLimit(25)).toBe(25);
  });

  it("truncates fractional values", () => {
    expect(clampBulkTailorLimit(3.9)).toBe(3);
  });
});

describe("getBulkTailorJobIds", () => {
  it("takes only the first N jobs in the given order", () => {
    const jobs = [
      createJob({ id: "job-1" }),
      createJob({ id: "job-2" }),
      createJob({ id: "job-3" }),
    ];

    expect(getBulkTailorJobIds(jobs, 2)).toEqual(["job-1", "job-2"]);
    expect(getBulkTailorJobIds(jobs, 99)).toEqual(["job-1", "job-2", "job-3"]);
  });
});
