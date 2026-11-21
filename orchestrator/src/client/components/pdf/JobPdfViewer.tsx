import * as api from "@client/api";
import { downloadJobPdf } from "@client/lib/private-pdf";
import { tailoredResumeFilename } from "@shared/tailored-document-filenames.js";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type ViewerState = "loading" | "ready" | "error";

export interface JobPdfViewerProps {
  jobId: string;
  onClose?: () => void;
  downloadFilename?: string;
}

/**
 * Shared pdf.js viewer used by both the standalone route and the in-app
 * preview dialog. pdf.js is imported dynamically so it stays out of the
 * initial bundle.
 */
export function JobPdfViewer({
  jobId,
  onClose,
  downloadFilename,
}: JobPdfViewerProps) {
  const [state, setState] = useState<ViewerState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [renderWidth, setRenderWidth] = useState(760);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());

  useEffect(() => {
    let cancelled = false;
    let loadedDocument: PDFDocumentProxy | null = null;

    setState("loading");
    setError(null);

    void (async () => {
      const blob = await api.getJobPdfBlob(jobId);
      const data = await blob.arrayBuffer();
      const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist");
      GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.mjs",
        import.meta.url,
      ).toString();
      const document = await getDocument({ data }).promise;
      loadedDocument = document;
      if (cancelled) {
        void document.destroy();
        return;
      }
      setPdfDocument(document);
      setPageCount(document.numPages);
      setState("ready");
    })().catch((cause: unknown) => {
      if (cancelled) return;
      setError(
        cause instanceof Error ? cause.message : "Could not load the PDF.",
      );
      setState("error");
    });

    return () => {
      cancelled = true;
      if (loadedDocument) void loadedDocument.destroy();
    };
  }, [jobId]);

  useEffect(() => {
    const container = containerRef.current;
    const updateWidth = () => {
      const availableWidth = container?.clientWidth || window.innerWidth - 96;
      setRenderWidth(Math.max(320, Math.min(900, availableWidth - 48)));
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    const observer =
      typeof ResizeObserver === "undefined" || !container
        ? null
        : new ResizeObserver(updateWidth);
    observer?.observe(container as HTMLDivElement);
    return () => {
      window.removeEventListener("resize", updateWidth);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!pdfDocument || renderWidth <= 0 || pageCount <= 0) return undefined;

    let cancelled = false;
    const scale = (renderWidth * zoom) / 612;
    const outputScale = Math.max(1, window.devicePixelRatio || 1);

    void (async () => {
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        if (cancelled) return;
        const canvas = canvasRefs.current.get(pageNumber);
        if (!canvas) continue;

        const page = await pdfDocument.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        const context = canvas.getContext("2d");
        if (!context) continue;

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
      }
    })().catch((cause: unknown) => {
      if (cancelled) return;
      setError(
        cause instanceof Error ? cause.message : "Could not render the PDF.",
      );
      setState("error");
    });

    return () => {
      cancelled = true;
    };
  }, [pageCount, pdfDocument, renderWidth, zoom]);

  const handleDownload = useCallback(() => {
    void downloadJobPdf(
      jobId,
      downloadFilename ?? tailoredResumeFilename(null),
    ).catch(() => {
      // The download helper already surfaces errors to the user.
    });
  }, [downloadFilename, jobId]);

  const setCanvasRef = useCallback(
    (pageNumber: number) => (element: HTMLCanvasElement | null) => {
      if (element) canvasRefs.current.set(pageNumber, element);
      else canvasRefs.current.delete(pageNumber);
    },
    [],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#d9d9d9]">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoom((current) => Math.max(0.5, current - 0.1))}
            disabled={state !== "ready"}
            aria-label="Zoom out"
          >
            −
          </Button>
          <span className="min-w-14 text-center text-sm tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoom((current) => Math.min(2, current + 0.1))}
            disabled={state !== "ready"}
            aria-label="Zoom in"
          >
            +
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleDownload}>
            Download
          </Button>
          {onClose ? (
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          ) : null}
        </div>
      </header>

      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 flex-col items-center gap-6 overflow-auto py-6"
      >
        {state === "loading" ? (
          <p className="text-sm text-muted-foreground">Loading PDF…</p>
        ) : null}
        {state === "error" ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error ?? "Could not load the PDF."}
          </div>
        ) : null}
        {Array.from({ length: pageCount }, (_, index) => index + 1).map(
          (pageNumber) => (
            <canvas
              key={pageNumber}
              ref={setCanvasRef(pageNumber)}
              aria-label={`Resume PDF page ${pageNumber}`}
              className="block rounded-sm bg-white shadow-lg"
            />
          ),
        )}
      </div>
    </div>
  );
}
