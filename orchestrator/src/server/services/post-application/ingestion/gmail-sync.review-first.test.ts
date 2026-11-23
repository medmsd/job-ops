import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getIntegration: vi.fn(),
  resolveToken: vi.fn(),
  listMessageIds: vi.fn(),
  getMessageMetadata: vi.fn(),
  getMessageFull: vi.fn(),
  getAllJobs: vi.fn(),
  classify: vi.fn(),
  upsert: vi.fn(),
  startRun: vi.fn(),
  completeRun: vi.fn(),
  updateSyncState: vi.fn(),
  transitionStage: vi.fn(),
}));

vi.mock("@infra/product-analytics", () => ({
  trackServerProductEvent: vi.fn().mockResolvedValue(false),
}));

vi.mock("@server/repositories/post-application-integrations", () => ({
  getPostApplicationIntegration: mocks.getIntegration,
  updatePostApplicationIntegrationSyncState: mocks.updateSyncState,
  upsertConnectedPostApplicationIntegration: vi.fn(),
}));

vi.mock("@server/repositories/post-application-messages", () => ({
  getPostApplicationMessageByExternalId: vi.fn().mockResolvedValue(null),
  upsertPostApplicationMessage: mocks.upsert,
}));

vi.mock("@server/repositories/post-application-sync-runs", () => ({
  startPostApplicationSyncRun: mocks.startRun,
  completePostApplicationSyncRun: mocks.completeRun,
}));

vi.mock("@server/repositories/jobs", () => ({
  getAllJobs: mocks.getAllJobs,
}));

vi.mock("@server/services/applicationTracking", () => ({
  transitionStage: mocks.transitionStage,
}));

vi.mock("./email-router", () => ({
  classifyWithSmartRouter: mocks.classify,
  minifyActiveJobs: vi.fn((jobs: Array<{ id: string }>) =>
    jobs.map((job) => ({ id: job.id })),
  ),
}));

vi.mock("./gmail-api", () => ({
  buildEmailText: vi.fn(() => "email text"),
  extractBodyText: vi.fn(() => "Application update"),
  getMessageFull: mocks.getMessageFull,
  getMessageMetadata: mocks.getMessageMetadata,
  listMessageIds: mocks.listMessageIds,
  resolveGmailAccessToken: mocks.resolveToken,
}));

import { runGmailIngestionSync } from "./gmail-sync";

describe("gmail ingestion review-first behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getIntegration.mockResolvedValue({
      id: "int-1",
      provider: "gmail",
      accountKey: "default",
      status: "connected",
      credentials: { refreshToken: "refresh-token" },
    });
    mocks.resolveToken.mockResolvedValue({
      refreshToken: "refresh-token",
      accessToken: "access-token",
      expiryDate: Date.now() + 3_600_000,
    });
    mocks.startRun.mockResolvedValue({ id: "run-1" });
    mocks.completeRun.mockResolvedValue({ id: "run-1" });
    mocks.updateSyncState.mockResolvedValue({ id: "int-1" });
    mocks.getAllJobs.mockResolvedValue([
      { id: "job-1", title: "Engineer", employer: "Acme" },
    ]);
    mocks.listMessageIds.mockResolvedValue([{ id: "gmail-msg-1" }]);
    mocks.getMessageMetadata.mockResolvedValue({
      id: "gmail-msg-1",
      threadId: "thread-1",
      snippet: "Update",
      headers: [
        { name: "From", value: "Careers <careers@example.com>" },
        { name: "Subject", value: "Your application" },
        { name: "Date", value: "Mon, 1 Jan 2026 10:00:00 +0000" },
      ],
    });
    mocks.getMessageFull.mockResolvedValue({ payload: {} });
    mocks.classify.mockResolvedValue({
      isRelevant: true,
      confidence: 100,
      bestMatchId: "job-1",
      stageTarget: "offer",
      messageType: "offer",
      reason: "exact match",
      stageEventPayload: { suggestedStageTarget: "offer" },
    });
    mocks.upsert.mockImplementation(async (input: Record<string, unknown>) => ({
      message: { ...input, id: "msg-1" },
      wasCreated: true,
      previousProcessingStatus: null,
      autoLinkTransitioned: true,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores a high-confidence match as pending_user without changing job status", async () => {
    await runGmailIngestionSync({
      accountKey: "default",
      maxMessages: 1,
      searchDays: 7,
    });

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "gmail",
        matchedJobId: "job-1",
        processingStatus: "pending_user",
      }),
    );
    expect(mocks.transitionStage).not.toHaveBeenCalled();
  });

  it("keeps irrelevant messages ignored", async () => {
    mocks.classify.mockResolvedValue({
      isRelevant: false,
      confidence: 5,
      bestMatchId: null,
      stageTarget: "no_change",
      messageType: "other",
      reason: "not application related",
      stageEventPayload: null,
    });

    await runGmailIngestionSync({ accountKey: "default" });

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ processingStatus: "ignored" }),
    );
    expect(mocks.transitionStage).not.toHaveBeenCalled();
  });
});
