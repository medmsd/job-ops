import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { JobPdfViewerModal } from "./JobPdfViewerModal";

interface JobPdfViewerContextValue {
  openJobPdf: (
    jobId: string,
    jobTitle?: string | null,
    downloadFilename?: string,
  ) => void;
}

const JobPdfViewerContext = createContext<JobPdfViewerContextValue | null>(
  null,
);

interface JobPdfViewerProviderProps {
  children: React.ReactNode;
}

export function JobPdfViewerProvider({
  children,
}: JobPdfViewerProviderProps): React.ReactElement {
  const [viewer, setViewer] = useState<{
    open: boolean;
    jobId: string | null;
    jobTitle: string | null;
    downloadFilename: string | null;
  }>({ open: false, jobId: null, jobTitle: null, downloadFilename: null });

  const openJobPdf = useCallback(
    (jobId: string, jobTitle?: string | null, downloadFilename?: string) => {
      setViewer({
        open: true,
        jobId,
        jobTitle: jobTitle ?? null,
        downloadFilename: downloadFilename ?? null,
      });
    },
    [],
  );

  const handleOpenChange = useCallback((open: boolean) => {
    setViewer((current) => ({ ...current, open }));
  }, []);

  const value = useMemo(() => ({ openJobPdf }), [openJobPdf]);

  return (
    <JobPdfViewerContext.Provider value={value}>
      {children}
      <JobPdfViewerModal
        open={viewer.open}
        onOpenChange={handleOpenChange}
        jobId={viewer.jobId}
        jobTitle={viewer.jobTitle}
        downloadFilename={viewer.downloadFilename ?? undefined}
      />
    </JobPdfViewerContext.Provider>
  );
}

export function useJobPdfViewer(): JobPdfViewerContextValue {
  const context = useContext(JobPdfViewerContext);
  if (!context) {
    throw new Error("useJobPdfViewer must be used inside JobPdfViewerProvider");
  }
  return context;
}
