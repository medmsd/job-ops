/** Owner name used for downloadable application documents. */
export const APPLICATION_DOCUMENT_OWNER = "Mohamed Mseddi";

function safeDocumentPart(value: string | null | undefined, fallback: string) {
  const withoutControlChars = (value ?? "")
    .normalize("NFKC")
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  const cleaned = withoutControlChars
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120);

  return cleaned || fallback;
}

export function tailoredResumeFilename(
  companyName: string | null | undefined,
  ownerName: string | null | undefined = APPLICATION_DOCUMENT_OWNER,
): string {
  return `${safeDocumentPart(ownerName, APPLICATION_DOCUMENT_OWNER)} Resume ${safeDocumentPart(companyName, "Company")}.pdf`;
}

export function tailoredCoverLetterFilename(
  companyName: string | null | undefined,
  ownerName: string | null | undefined = APPLICATION_DOCUMENT_OWNER,
): string {
  return `${safeDocumentPart(ownerName, APPLICATION_DOCUMENT_OWNER)} Cover Letter ${safeDocumentPart(companyName, "Company")}.txt`;
}

/** PDF counterpart of a generated plain-text cover letter filename. */
export function coverLetterPdfFilename(textFilename: string): string {
  return /\.txt$/i.test(textFilename)
    ? `${textFilename.slice(0, -4)}.pdf`
    : `${textFilename}.pdf`;
}
