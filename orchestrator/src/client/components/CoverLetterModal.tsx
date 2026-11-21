import * as api from "@client/api";
import { buildCoverLetterPdf } from "@client/lib/cover-letter-pdf";
import { coverLetterPdfFilename } from "@shared/tailored-document-filenames.js";
import type { JobCoverLetterResult } from "@shared/types.js";
import { Download, FileText, Loader2, RefreshCcw } from "lucide-react";
import React from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface CoverLetterModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobTitle?: string | null;
  employer?: string | null;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function downloadTextFile(contents: string, filename: string): void {
  downloadBlob(
    new Blob([contents], { type: "text/plain;charset=utf-8" }),
    filename,
  );
}

export const CoverLetterModal: React.FC<CoverLetterModalProps> = ({
  open,
  onOpenChange,
  jobId,
  jobTitle,
  employer,
}) => {
  const [result, setResult] = React.useState<JobCoverLetterResult | null>(null);
  const [letter, setLetter] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const generate = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const generated: JobCoverLetterResult =
        await api.generateJobCoverLetter(jobId);
      setResult(generated);
      setLetter(generated.coverLetter);
    } catch (reason: unknown) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Failed to generate the cover letter.",
      );
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  React.useEffect(() => {
    if (!open) {
      setResult(null);
      setLetter("");
      setError(null);
      return;
    }
    void generate();
  }, [generate, open]);

  const handleDownloadTxt = () => {
    if (!letter.trim()) return;
    downloadTextFile(letter, result?.filename ?? "cover-letter.txt");
    toast.success("Cover letter downloaded");
  };

  const handleDownloadPdf = () => {
    if (!letter.trim()) return;
    downloadBlob(
      buildCoverLetterPdf(letter),
      coverLetterPdfFilename(result?.filename ?? "cover-letter.txt"),
    );
    toast.success("Cover letter downloaded as PDF");
  };

  const description = jobTitle
    ? `Drafted from the tailored resume for ${jobTitle}${employer ? ` at ${employer}` : ""}.`
    : "Drafted from the tailored resume and job description.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generate cover letter</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2" data-testid="cover-letter-modal">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="generated-cover-letter">Cover letter</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void generate()}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-1.5 size-3.5" />
                )}
                Regenerate
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadTxt}
                disabled={loading || !letter.trim()}
              >
                <FileText className="mr-1.5 size-3.5" />
                Download .txt
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleDownloadPdf}
                disabled={loading || !letter.trim()}
              >
                <Download className="mr-1.5 size-3.5" />
                Download .pdf
              </Button>
            </div>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Textarea
            id="generated-cover-letter"
            aria-label="Generated cover letter"
            value={letter}
            onChange={(event) => setLetter(event.target.value)}
            rows={14}
            placeholder={
              loading
                ? "Generating cover letter…"
                : "No cover letter generated."
            }
            disabled={loading}
          />
          <p className="text-xs text-muted-foreground">
            Edit the text above before downloading. Save it as plain text or as
            a PDF, then paste or attach it when applying manually.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
