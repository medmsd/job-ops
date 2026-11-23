import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getIntegration: vi.fn(),
  resolveToken: vi.fn(),
  listMessages: vi.fn(),
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

vi.mock("./graph-api", () => ({
  buildEmailText: vi.fn(() => "email text"),
  listGraphMessages: mocks.listMessages,
  resolveGraphAccessToken: mocks.resolveToken,
}));

import { runGraphIngestionSync } from "./graph-sync";

describe("graph ingestion review-first behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getIntegration.mockResolvedValue({
      id: "int-1",
      provider: "graph",
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
    mocks.listMessages.mockResolvedValue([
      {
        id: "graph-msg-1",
        conversationId: "conversation-1",
        fromAddress: "careers@example.com",
        fromDomain: "example.com",
        senderName: "Acme Careers",
        subject: "Your application",
        receivedAt: 1_700_000_000_000,
        snippet: "Update",
        body: "Application update",
        webLink: null,
      },
    ]);
    mocks.classify.mockResolvedValue({
      isRelevant: true,
      confidence: 99,
      bestMatchId: "job-1",
      stageTarget: "rejection",
      messageType: "rejection",
      reason: "strong match",
      stageEventPayload: { suggestedStageTarget: "rejection" },
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
    const summary = await runGraphIngestionSync({
      accountKey: "default",
      maxMessages: 1,
      searchDays: 7,
    });

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "graph",
        matchedJobId: "job-1",
        processingStatus: "pending_user",
      }),
    );
    expect(mocks.transitionStage).not.toHaveBeenCalled();
    expect(summary).toEqual({
      discovered: 1,
      relevant: 1,
      classified: 1,
      errored: 0,
    });
  });

  it("keeps irrelevant messages ignored", async () => {
    mocks.classify.mockResolvedValue({
      isRelevant: false,
      confidence: 10,
      bestMatchId: null,
      stageTarget: "no_change",
      messageType: "other",
      reason: "not application related",
      stageEventPayload: null,
    });

    await runGraphIngestionSync({ accountKey: "default" });

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ processingStatus: "ignored" }),
    );
    expect(mocks.transitionStage).not.toHaveBeenCalled();
  });
});
