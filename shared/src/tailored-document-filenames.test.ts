import { describe, expect, it } from "vitest";
import {
  tailoredCoverLetterFilename,
  tailoredResumeFilename,
} from "./tailored-document-filenames";

describe("tailored document filenames", () => {
  it("uses the requested readable resume filename", () => {
    expect(tailoredResumeFilename("Dwareapps")).toBe(
      "Mohamed Mseddi Resume Dwareapps.pdf",
    );
  });

  it("uses a matching cover letter filename", () => {
    expect(tailoredCoverLetterFilename("Dwareapps")).toBe(
      "Mohamed Mseddi Cover Letter Dwareapps.txt",
    );
  });

  it("removes unsafe path characters and falls back for missing companies", () => {
    expect(tailoredResumeFilename("  Acme\\Corp: Ltd/ ")).toBe(
      "Mohamed Mseddi Resume Acme Corp Ltd.pdf",
    );
    expect(tailoredResumeFilename(null)).toBe(
      "Mohamed Mseddi Resume Company.pdf",
    );
  });

  it("honors an explicit owner name", () => {
    expect(tailoredResumeFilename("Acme", "Jane Doe")).toBe(
      "Jane Doe Resume Acme.pdf",
    );
  });
});
