import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { JobPdfViewer } from "./JobPdfViewer";

export interface JobPdfViewerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string | null;
  jobTitle?: string | null;
  downloadFilename?: string;
}

export function JobPdfViewerModal({
  open,
  onOpenChange,
  jobId,
  jobTitle,
  downloadFilename,
}: JobPdfViewerModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] max-h-[88vh] w-[min(96vw,1100px)] max-w-none flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle>Tailored resume preview</DialogTitle>
          <DialogDescription>
            {jobTitle
              ? `Generated PDF for ${jobTitle}`
              : "Review the generated PDF before applying."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          {open && jobId ? (
            <JobPdfViewer
              jobId={jobId}
              downloadFilename={downloadFilename}
              onClose={() => onOpenChange(false)}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
