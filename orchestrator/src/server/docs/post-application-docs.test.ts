import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest's jsdom environment rewrites import.meta.url to a non-file scheme, so
// resolve from the orchestrator workspace cwd (set by `npm --workspace orchestrator`).
const featureDocs = resolve(
  process.cwd(),
  "../docs-site/docs/features/post-application-tracking.md",
);
const workflowDocs = resolve(
  process.cwd(),
  "../docs-site/docs/workflows/post-application-workflow.md",
);

describe("post-application tracking docs", () => {
  it("describes review-first background response sync", () => {
    const feature = readFileSync(featureDocs, "utf8");
    const workflow = readFileSync(workflowDocs, "utf8");

    expect(feature).toContain("every 30 minutes");
    expect(feature).toContain("last 7 days");
    expect(feature).toContain("50 messages per account");
    expect(feature).toContain("Needs review");
    expect(feature).toContain(
      "No job status changes without explicit approval",
    );
    expect(feature).toContain("pending-response badge");
    expect(feature).toContain("/tracking-inbox?jobId=");
    expect(feature).toContain("apply only to that job's pending messages");
    expect(feature).not.toContain("Auto-linked to job");
    expect(feature).not.toContain("auto-processed");

    expect(workflow).toContain("every 30 minutes");
    expect(workflow).toContain("Needs review");
    expect(workflow).toContain("Approve to update the job timeline");
  });
});
