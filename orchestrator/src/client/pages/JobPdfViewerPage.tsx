import { JobPdfViewer } from "@client/components/pdf/JobPdfViewer";
import { useParams } from "react-router-dom";

export function JobPdfViewerPage() {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#d9d9d9] p-6 text-sm text-muted-foreground">
        Missing job id.
      </div>
    );
  }

  return (
    <div className="h-screen">
      <JobPdfViewer jobId={id} onClose={() => window.close()} />
    </div>
  );
}
