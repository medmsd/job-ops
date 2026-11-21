/**
 * Minimal PDF writer for generated cover letters.
 *
 * Uses the standard Helvetica Type 1 font with WinAnsi encoding, which every
 * PDF reader provides. Keeping this local avoids a round trip to the server
 * for text the user may still be editing, and avoids adding a PDF dependency
 * to a project that currently only reads PDFs.
 */

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 56;
const TOP_Y = 772;
const BOTTOM_Y = 56;
const FONT_SIZE = 11;
const LEADING = 15.5;
const MAX_LINE_CHARS = 88;
const MAX_LINES_PER_PAGE = Math.floor((TOP_Y - BOTTOM_Y) / LEADING);

/** Unicode characters that have a defined WinAnsi (Windows-1252) byte. */
const WIN_ANSI_MAP: Record<string, number> = {
  "€": 0x80,
  "‚": 0x82,
  ƒ: 0x83,
  "„": 0x84,
  "…": 0x85,
  "†": 0x86,
  "‡": 0x87,
  ˆ: 0x88,
  "‰": 0x89,
  Š: 0x8a,
  "‹": 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "˜": 0x98,
  "™": 0x99,
  š: 0x9a,
  "›": 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

/** All PDF syntax in this writer is ASCII, so a direct byte cast is enough. */
function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function encodeWinAnsi(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0x3f;
    const mapped = WIN_ANSI_MAP[character];
    if (mapped !== undefined) {
      bytes.push(mapped);
    } else if (
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xff)
    ) {
      bytes.push(code);
    } else {
      bytes.push(0x3f);
    }
  }
  return new Uint8Array(bytes);
}

function pdfTextString(text: string): Uint8Array {
  const encoded = encodeWinAnsi(text);
  const escaped: number[] = [];
  for (const byte of encoded) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
      escaped.push(0x5c);
    }
    escaped.push(byte);
  }
  return new Uint8Array(escaped);
}

function wrapLetter(text: string): string[] {
  const lines: string[] = [];
  const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/);

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) continue;
    let current = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      if (!current) {
        current = word;
      } else if (current.length + 1 + word.length <= MAX_LINE_CHARS) {
        current = `${current} ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    lines.push("");
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length > 0 ? lines : [""];
}

function buildContentStream(lines: string[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const add = (value: string | Uint8Array) => {
    parts.push(typeof value === "string" ? asciiBytes(value) : value);
  };

  add(`BT\n/F1 ${FONT_SIZE} Tf\n${LEADING} TL\n${MARGIN_X} ${TOP_Y} Td\n`);
  for (const line of lines) {
    if (line) {
      add("(");
      add(pdfTextString(line));
      add(") Tj\n");
    }
    add("T*\n");
  }
  add("ET\n");

  const length = parts.reduce((total, part) => total + part.length, 0);
  const stream = new Uint8Array(length);
  let position = 0;
  for (const part of parts) {
    stream.set(part, position);
    position += part.length;
  }
  return stream;
}

/** Build the PDF bytes for a cover letter. */
export function buildCoverLetterPdfBytes(
  text: string,
): Uint8Array<ArrayBuffer> {
  const lines = wrapLetter(text);
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += MAX_LINES_PER_PAGE) {
    pages.push(lines.slice(index, index + MAX_LINES_PER_PAGE));
  }

  const catalogObject = 1;
  const pagesObject = 2;
  const pageObject = (index: number) => 3 + index * 2;
  const contentObject = (index: number) => 4 + index * 2;
  const fontObject = 3 + pages.length * 2;
  const objectCount = fontObject;

  const chunks: Uint8Array[] = [];
  const offsets: number[] = new Array(objectCount + 1).fill(0);
  let length = 0;
  const push = (value: string | Uint8Array) => {
    const chunk = typeof value === "string" ? asciiBytes(value) : value;
    chunks.push(chunk);
    length += chunk.length;
  };
  const writeObject = (number: number, writeBody: () => void) => {
    offsets[number] = length;
    push(`${number} 0 obj\n`);
    writeBody();
    push("endobj\n");
  };

  push("%PDF-1.4\n");

  writeObject(catalogObject, () => {
    push(`<< /Type /Catalog /Pages ${pagesObject} 0 R >>\n`);
  });

  writeObject(pagesObject, () => {
    const kids = pages.map((_, index) => `${pageObject(index)} 0 R`).join(" ");
    push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\n`);
  });

  pages.forEach((pageLines, index) => {
    writeObject(pageObject(index), () => {
      push(
        `<< /Type /Page /Parent ${pagesObject} 0 R ` +
          `/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 ${fontObject} 0 R >> >> ` +
          `/Contents ${contentObject(index)} 0 R >>\n`,
      );
    });

    writeObject(contentObject(index), () => {
      const stream = buildContentStream(pageLines);
      push(`<< /Length ${stream.length} >>\nstream\n`);
      push(stream);
      push("endstream\n");
    });
  });

  writeObject(fontObject, () => {
    push(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica " +
        "/Encoding /WinAnsiEncoding >>\n",
    );
  });

  const xrefOffset = length;
  push(`xref\n0 ${objectCount + 1}\n`);
  push("0000000000 65535 f \n");
  for (let number = 1; number <= objectCount; number += 1) {
    push(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${objectCount + 1} /Root ${catalogObject} 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`,
  );

  const pdf = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {
    pdf.set(chunk, position);
    position += chunk.length;
  }
  return pdf;
}

/** Build a downloadable PDF containing the supplied cover letter text. */
export function buildCoverLetterPdf(text: string): Blob {
  return new Blob([buildCoverLetterPdfBytes(text)], {
    type: "application/pdf",
  });
}
