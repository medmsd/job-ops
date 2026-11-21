import { describe, expect, it } from "vitest";
import {
  buildCoverLetterPdf,
  buildCoverLetterPdfBytes,
} from "./cover-letter-pdf";

function readPdf(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
}

describe("buildCoverLetterPdf", () => {
  it("creates a PDF containing the letter text", () => {
    const letter =
      "Dear hiring team,\n\nPlease consider my application for the Engineer role.\n\nSincerely,\nMohamed Mseddi";
    const blob = buildCoverLetterPdf(letter);

    expect(blob.type).toBe("application/pdf");

    const raw = readPdf(buildCoverLetterPdfBytes(letter));
    expect(raw.startsWith("%PDF-1.4")).toBe(true);
    expect(raw).toContain("Dear hiring team,");
    expect(raw).toContain(
      "Please consider my application for the Engineer role.",
    );
    expect(raw).toContain("Mohamed Mseddi");
    expect(raw).toContain("%%EOF");
  });

  it("paginates long letters with consistent xref offsets", () => {
    const lines = Array.from(
      { length: 400 },
      (_, index) => `Line ${index + 1} of the cover letter.`,
    );
    const raw = readPdf(buildCoverLetterPdfBytes(lines.join("\n")));

    expect(raw.match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(1);

    const xrefStart = raw.search(/\bxref\n/);
    expect(Number(raw.match(/startxref\n(\d+)/)?.[1])).toBe(xrefStart);

    const offsets = Array.from(raw.matchAll(/^(\d{10}) 00000 n $/gm), (match) =>
      Number(match[1]),
    );
    expect(offsets.length).toBeGreaterThan(3);
    for (const offset of offsets) {
      expect(raw.slice(offset, offset + 8)).toMatch(/^\d+ 0 obj/);
    }
  });

  it("escapes PDF string characters and maps common unicode punctuation", () => {
    const raw = readPdf(
      buildCoverLetterPdfBytes(
        "Hello (world) \\ team \u2014 done \u2019yes\u2019",
      ),
    );

    expect(raw).toContain("Hello \\(world\\) \\\\ team \x97 done");
    expect(raw).toContain("\x92yes\x92");
  });
});
