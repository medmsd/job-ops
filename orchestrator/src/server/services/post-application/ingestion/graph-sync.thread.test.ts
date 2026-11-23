import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getIntegration: vi.fn(),
  resolveToken: vi.fn(),
  listMessages: vi.fn(),
  getAllJobs: vi.fn(),
  classify: vi.fn(),
  findByThread: vi.fn(),
  upsert: vi.fn(),
  startRun: vi.fn(),
  completeRun: vi.fn(),
  updateSyncState: vi.fn(),
  getExistingMessage: vi.fn(),
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
  getPostApplicationMessageByExternalId: mocks.getExistingMessage,
  upsertPostApplicationMessage: mocks.upsert,
}));

vi.mock("@server/repositories/post-application-sent-emails", () => ({
  findPostApplicationSentEmailByThread: mocks.findByThread,
}));

vi.mock("@server/repositories/post-application-sync-runs", () => ({
  startPostApplicationSyncRun: mocks.startRun,
  completePostApplicationSyncRun: mocks.completeRun,
}));

vi.mock("@server/repositories/jobs", () => ({
  getAllJobs: mocks.getAllJobs,
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

describe("graph ingestion thread provenance", () => {
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
    mocks.getExistingMessage.mockResolvedValue(null);
    mocks.getAllJobs.mockResolvedValue([
      { id: "job-1", title: "Engineer", employer: "Acme" },
    ]);
    mocks.listMessages.mockResolvedValue([
      {
        id: "graph-reply-1",
        conversationId: "conversation-1",
        internetMessageId: "<reply@example.com>",
        inReplyTo: ["<sent@example.com>"],
        references: ["<sent@example.com>"],
        fromAddress: "careers@example.com",
        fromDomain: "example.com",
        senderName: "Acme Careers",
        subject: "RE: Application for Engineer",
        receivedAt: 1_700_000_000_000,
        snippet: "Update",
        body: "Application update",
        webLink: null,
      },
    ]);
    mocks.classify.mockResolvedValue({
      isRelevant: true,
      confidence: 80,
      bestMatchId: "job-1",
      stageTarget: "interview",
      messageType: "interview",
      reason: "router fallback",
      stageEventPayload: { suggestedStageTarget: "interview" },
    });
    mocks.upsert.mockImplementation(async (input: Record<string, unknown>) => ({
      message: { ...input, id: "msg-1" },
      wasCreated: true,
      previousProcessingStatus: null,
      autoLinkTransitioned: false,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses a sent-email thread match instead of the router and still stays pending_user", async () => {
    mocks.findByThread.mockResolvedValue({
      id: "sent-1",
      jobId: "job-1",
      provider: "graph",
      internetMessageId: "<sent@example.com>",
      graphMessageId: "graph-message-1",
      sentAt: 1_699_999_000_000,
    });

    await runGraphIngestionSync({
      accountKey: "default",
      maxMessages: 1,
      searchDays: 7,
    });

    expect(mocks.findByThread).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "graph",
        inReplyTo: ["<sent@example.com>"],
        references: ["<sent@example.com>"],
        graphConversationId: "conversation-1",
      }),
    );
    expect(mocks.classify).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        matchedJobId: "job-1",
        processingStatus: "pending_user",
        classificationPayload: expect.objectContaining({
          method: "thread_match",
        }),
      }),
    );
  });

  it("falls back to the router for legacy rows without provenance", async () => {
    mocks.findByThread.mockResolvedValue(null);

    await runGraphIngestionSync({
      accountKey: "default",
      maxMessages: 1,
      searchDays: 7,
    });

    expect(mocks.classify).toHaveBeenCalledOnce();
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        classificationPayload: expect.objectContaining({
          method: "smart_router",
        }),
        processingStatus: "pending_user",
      }),
    );
  });
});
