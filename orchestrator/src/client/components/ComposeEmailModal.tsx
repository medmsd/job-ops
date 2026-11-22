import * as api from "@client/api";
import { useJobPdfViewer } from "@client/components/pdf/JobPdfViewerProvider";
import { tailoredResumeFilename } from "@shared/tailored-document-filenames.js";
import type {
  RecruiterEmailPreview,
  RecruiterEmailSendResult,
} from "@shared/types.js";
import { AlertTriangle, Eye, Loader2, Send } from "lucide-react";
import React, { useState } from "react";
import { toast } from "sonner";
import { showErrorToast } from "@/client/lib/error-toast";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ComposeEmailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobTitle?: string | null;
  employer?: string | null;
  onSent?: (result: RecruiterEmailSendResult) => void;
}

export const ComposeEmailModal: React.FC<ComposeEmailModalProps> = ({
  open,
  onOpenChange,
  jobId,
  jobTitle,
  employer,
  onSent,
}) => {
  const { openJobPdf } = useJobPdfViewer();
  const [preview, setPreview] = useState<RecruiterEmailPreview | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [bodySuffix, setBodySuffix] = useState("\n\nKind regards,");
  const [body, setBody] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = React.useCallback(() => {
    setPreview(null);
    setTo("");
    setSubject("");
    setCoverLetter("");
    setBodySuffix("\n\nKind regards,");
    setBody("");
    setConfirmed(false);
    setError(null);
  }, []);

  React.useEffect(() => {
    if (!open) {
      reset();
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .previewJobRecruiterEmail(jobId)
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setTo(result.to);
        setSubject(result.subject);
        setCoverLetter(result.coverLetter);
        setBodySuffix(
          result.body.startsWith(result.coverLetter)
            ? result.body.slice(result.coverLetter.length)
            : "\n\nKind regards,",
        );
        setBody(result.body);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "Failed to prepare the email preview.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [jobId, open, reset]);

  const handleCoverLetterChange = React.useCallback(
    (value: string) => {
      setCoverLetter(value);
      setBody(`${value.trim()}${bodySuffix}`);
    },
    [bodySuffix],
  );

  const handleSend = React.useCallback(async () => {
    if (!preview || !confirmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await api.sendJobRecruiterEmail(jobId, {
        previewToken: preview.previewToken,
        to,
        subject,
        body,
      });
      toast.success("Email sent", {
        description: `Your application email was sent to ${result.to}.`,
      });
      onOpenChange(false);
      onSent?.(result);
    } catch (reason: unknown) {
      showErrorToast(reason, "Failed to send email");
      setError(
        reason instanceof Error
          ? reason.message
          : "The email could not be sent. Please try again.",
      );
    } finally {
      setSending(false);
    }
  }, [
    body,
    confirmed,
    jobId,
    onOpenChange,
    onSent,
    preview,
    sending,
    subject,
    to,
  ]);

  const attachment = preview?.attachments[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Email recruiter</DialogTitle>
          <DialogDescription>
            Review and edit the application email
            {jobTitle ? ` for ${jobTitle}` : ""} below. Nothing is sent until
            you explicitly confirm.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating cover letter and preparing attachment...
          </div>
        )}

        {!loading && error && !preview && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!loading && preview && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="recruiter-email-to">To</Label>
              <Input
                id="recruiter-email-to"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                autoComplete="off"
              />
              {preview.recipientSource === "job" && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  This address came from the job details, not a tracked
                  recruiter email. Verify it before sending.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Single recipient only. No BCC is added.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="recruiter-email-subject">Subject</Label>
              <Input
                id="recruiter-email-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="recruiter-email-cover-letter">Cover letter</Label>
              <Textarea
                id="recruiter-email-cover-letter"
                value={coverLetter}
                onChange={(event) =>
                  handleCoverLetterChange(event.target.value)
                }
                rows={10}
              />
              <p className="text-xs text-muted-foreground">
                Edit the letter here. The email message below stays in sync and
                is sent as plain text; the CV is attached as a PDF.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="recruiter-email-body">Message</Label>
              <Textarea
                id="recruiter-email-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={10}
              />
              <p className="text-xs text-muted-foreground">
                This is the exact text that will be sent. You can edit it
                directly after editing the cover letter.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <span>
                {attachment
                  ? `Attachment: ${attachment.name} (${(attachment.size / 1024 / 1024).toFixed(2)} MB)`
                  : "Preparing tailored PDF attachment…"}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  openJobPdf(jobId, jobTitle, tailoredResumeFilename(employer))
                }
              >
                <Eye className="mr-1.5 size-3.5" />
                Preview PDF
              </Button>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                I have reviewed this email and want to send it to{" "}
                <strong>{to || "the recipient"}</strong>.
              </span>
            </label>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSend()}
            disabled={!preview || !confirmed || sending}
          >
            {sending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Send email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
