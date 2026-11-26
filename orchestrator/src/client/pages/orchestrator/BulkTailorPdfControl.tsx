import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BULK_TAILOR_DEFAULT, clampBulkTailorLimit } from "./bulkTailorPdf";

export interface BulkTailorPdfControlProps {
  jobCount: number;
  inFlight: boolean;
  onProcess: (limit: number) => void;
}

export const BulkTailorPdfControl: React.FC<BulkTailorPdfControlProps> = ({
  jobCount,
  inFlight,
  onProcess,
}) => {
  const [limitText, setLimitText] = React.useState(String(BULK_TAILOR_DEFAULT));
  const limit = clampBulkTailorLimit(Number(limitText));
  const disabled = jobCount === 0 || inFlight;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm">
        <div className="font-medium">Bulk tailor and PDF</div>
        <p className="text-xs text-muted-foreground">
          AI tailors the first N discovered jobs, generates each PDF, and moves
          them to Ready. {jobCount} discovered job
          {jobCount === 1 ? "" : "s"} available.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <label
          htmlFor="bulk-tailor-limit"
          className="text-xs text-muted-foreground"
        >
          Jobs
        </label>
        <Input
          id="bulk-tailor-limit"
          aria-label="Number of discovered jobs to tailor"
          type="number"
          min={1}
          max={500}
          className="w-20"
          value={limitText}
          disabled={disabled}
          onChange={(event) => setLimitText(event.target.value)}
          onBlur={() => setLimitText(String(limit))}
        />
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          onClick={() => onProcess(limit)}
        >
          Tailor &amp; generate PDF
        </Button>
      </div>
    </div>
  );
};
