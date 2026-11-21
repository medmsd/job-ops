import { logger } from "@infra/logger";
import { trackServerProductEvent } from "@infra/product-analytics";
import { getAllJobs } from "@server/repositories/jobs";
import {
  getPostApplicationIntegration,
  updatePostApplicationIntegrationSyncState,
  upsertConnectedPostApplicationIntegration,
} from "@server/repositories/post-application-integrations";
import {
  getPostApplicationMessageByExternalId,
  upsertPostApplicationMessage,
} from "@server/repositories/post-application-messages";
import {
  completePostApplicationSyncRun,
  startPostApplicationSyncRun,
} from "@server/repositories/post-application-sync-runs";
import { transitionStage } from "@server/services/applicationTracking";
import { resolveStageTransitionForTarget } from "@server/services/post-application/stage-target";
import type { PostApplicationRouterStageTarget } from "@shared/types";
import { classifyWithSmartRouter, minifyActiveJobs } from "./email-router";
import type { GraphCredentials } from "./graph-api";
import {
  buildEmailText,
  listGraphMessages,
  resolveGraphAccessToken,
} from "./graph-api";

const DEFAULT_SEARCH_DAYS = 90;
const DEFAULT_MAX_MESSAGES = 100;

export type GraphSyncSummary = {
  discovered: number;
  relevant: number;
  classified: number;
  errored: number;
};

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseGraphCredentials(
  credentials: Record<string, unknown> | null,
): GraphCredentials | null {
  if (!credentials) return null;
  const refreshToken = asString(credentials.refreshToken);
  if (!refreshToken) return null;

  const accessToken = asString(credentials.accessToken) ?? undefined;
  const expiryDate =
    typeof credentials.expiryDate === "number" &&
    Number.isFinite(credentials.expiryDate)
      ? credentials.expiryDate
      : undefined;

  return {
    refreshToken,
    accessToken,
    expiryDate,
    scope: asString(credentials.scope) ?? undefined,
    tokenType: asString(credentials.tokenType) ?? undefined,
    email: asString(credentials.email) ?? undefined,
  };
}

function resolveProcessingStatus(input: {
  isAutoLinked: boolean;
  isPendingMatch: boolean;
  isRelevantOrphan: boolean;
}): "auto_linked" | "pending_user" | "ignored" {
  if (input.isAutoLinked) return "auto_linked";
  if (input.isPendingMatch || input.isRelevantOrphan) return "pending_user";
  return "ignored";
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

async function createAutoStageEvent(args: {
  jobId: string;
  stageTarget: PostApplicationRouterStageTarget;
  receivedAt: number;
  note: string;
}): Promise<void> {
  void trackServerProductEvent(
    "tracking_email_matched",
    {
      provider: "graph",
      match_mode: "auto_link",
      stage_target: args.stageTarget,
      result: "success",
    },
    { urlPath: "/tracking-inbox" },
  );

  const transition = resolveStageTransitionForTarget(args.stageTarget);
  if (transition.toStage === "no_change") return;

  const eventLabel =
    args.stageTarget === "applied"
      ? "Email received"
      : `Logged from email: ${args.stageTarget}`;

  transitionStage(
    args.jobId,
    transition.toStage,
    Math.floor(args.receivedAt / 1000),
    {
      actor: "system",
      eventType: "status_update",
      eventLabel,
      note: args.note,
      reasonCode: transition.reasonCode ?? "post_application_auto_linked",
    },
    transition.outcome,
  );
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, concurrency) }).map(
    async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) return;
        await worker(next);
      }
    },
  );
  await Promise.all(workers);
}

export async function runGraphIngestionSync(args: {
  accountKey: string;
  maxMessages?: number;
  searchDays?: number;
}): Promise<GraphSyncSummary> {
  const integration = await getPostApplicationIntegration(
    "graph",
    args.accountKey,
  );
  const parsedCredentials = parseGraphCredentials(
    integration?.credentials ?? null,
  );
  if (!integration || !parsedCredentials) {
    throw new Error(
      `Microsoft Graph account '${args.accountKey}' is not connected.`,
    );
  }

  const searchDays = Math.max(1, args.searchDays ?? DEFAULT_SEARCH_DAYS);
  const maxMessages = Math.max(1, args.maxMessages ?? DEFAULT_MAX_MESSAGES);

  const syncRun = await startPostApplicationSyncRun({
    provider: "graph",
    accountKey: args.accountKey,
    integrationId: integration.id,
  });

  let discovered = 0;
  let relevant = 0;
  let classified = 0;
  let matched = 0;
  let errored = 0;

  try {
    const resolvedCredentials =
      await resolveGraphAccessToken(parsedCredentials);
    if (!resolvedCredentials.accessToken) {
      throw new Error("Microsoft Graph sync failed to resolve access token.");
    }
    const accessToken = resolvedCredentials.accessToken;

    if (
      resolvedCredentials.accessToken !== parsedCredentials.accessToken ||
      resolvedCredentials.expiryDate !== parsedCredentials.expiryDate ||
      resolvedCredentials.refreshToken !== parsedCredentials.refreshToken
    ) {
      await upsertConnectedPostApplicationIntegration({
        provider: "graph",
        accountKey: args.accountKey,
        displayName: integration.displayName,
        credentials: {
          refreshToken: resolvedCredentials.refreshToken,
          accessToken: resolvedCredentials.accessToken,
          expiryDate: resolvedCredentials.expiryDate,
          scope: resolvedCredentials.scope,
          tokenType: resolvedCredentials.tokenType,
          email: resolvedCredentials.email,
        },
      });
    }

    const messages = await listGraphMessages(
      accessToken,
      searchDays,
      maxMessages,
    );
    const activeJobs = await getAllJobs([
      "applied",
      "in_progress",
      "processing",
    ]);
    const activeJobMinified = minifyActiveJobs(activeJobs);
    const activeJobIds = new Set(activeJobMinified.map((job) => job.id));
    const concurrency = Math.max(
      1,
      Number.parseInt(
        process.env.POST_APPLICATION_ROUTER_CONCURRENCY ?? "3",
        10,
      ) || 3,
    );

    await runWithConcurrency(messages, concurrency, async (message) => {
      discovered += 1;

      try {
        const existingMessage = await getPostApplicationMessageByExternalId(
          "graph",
          args.accountKey,
          message.id,
        );
        const from = message.senderName
          ? `${message.senderName} <${message.fromAddress}>`
          : message.fromAddress;
        const date = new Date(message.receivedAt).toISOString();

        if (existingMessage) {
          const { message: savedMessage, autoLinkTransitioned } =
            await upsertPostApplicationMessage({
              provider: "graph",
              accountKey: args.accountKey,
              integrationId: integration.id,
              syncRunId: syncRun.id,
              externalMessageId: message.id,
              externalThreadId: message.conversationId,
              fromAddress: message.fromAddress,
              fromDomain: message.fromDomain,
              senderName: message.senderName,
              subject: message.subject,
              receivedAt: message.receivedAt,
              snippet: message.snippet,
              classificationLabel: existingMessage.classificationLabel,
              classificationConfidence:
                existingMessage.classificationConfidence,
              classificationPayload: existingMessage.classificationPayload,
              relevanceLlmScore: existingMessage.relevanceLlmScore,
              relevanceDecision: existingMessage.relevanceDecision,
              matchedJobId: existingMessage.matchedJobId,
              matchConfidence: existingMessage.matchConfidence,
              stageTarget: existingMessage.stageTarget,
              messageType: existingMessage.messageType,
              stageEventPayload: existingMessage.stageEventPayload,
              processingStatus: existingMessage.processingStatus,
              existingMessage,
            });

          if (savedMessage.processingStatus !== "ignored") {
            relevant += 1;
          }
          classified += 1;
          if (savedMessage.matchedJobId) {
            matched += 1;
          }

          if (autoLinkTransitioned && savedMessage.matchedJobId) {
            await createAutoStageEvent({
              jobId: savedMessage.matchedJobId,
              stageTarget: savedMessage.stageTarget ?? "no_change",
              receivedAt: savedMessage.receivedAt,
              note: "Auto-created from Smart Router.",
            });
          }
          return;
        }

        const emailText = buildEmailText({
          from,
          subject: message.subject,
          date,
          body: message.body,
        });
        const routerResult = await classifyWithSmartRouter({
          emailText,
          activeJobs: activeJobMinified,
        });

        const matchedJobId =
          routerResult.bestMatchId && activeJobIds.has(routerResult.bestMatchId)
            ? routerResult.bestMatchId
            : null;
        const isAutoLinked = routerResult.confidence >= 95 && matchedJobId;
        const isPendingMatch = routerResult.confidence >= 50;
        const isRelevantOrphan = routerResult.isRelevant;
        const processingStatus = resolveProcessingStatus({
          isAutoLinked: Boolean(isAutoLinked),
          isPendingMatch,
          isRelevantOrphan,
        });

        const { message: savedMessage, autoLinkTransitioned } =
          await upsertPostApplicationMessage({
            provider: "graph",
            accountKey: args.accountKey,
            integrationId: integration.id,
            syncRunId: syncRun.id,
            externalMessageId: message.id,
            externalThreadId: message.conversationId,
            fromAddress: message.fromAddress,
            fromDomain: message.fromDomain,
            senderName: message.senderName,
            subject: message.subject,
            receivedAt: message.receivedAt,
            snippet: message.snippet,
            classificationLabel: routerResult.stageTarget,
            classificationConfidence: routerResult.confidence / 100,
            classificationPayload: {
              method: "smart_router",
              reason: routerResult.reason,
              stageTarget: routerResult.stageTarget,
            },
            relevanceLlmScore: routerResult.confidence,
            relevanceDecision: routerResult.isRelevant
              ? "relevant"
              : "not_relevant",
            matchedJobId: isAutoLinked || isPendingMatch ? matchedJobId : null,
            matchConfidence: routerResult.confidence,
            stageTarget: routerResult.stageTarget,
            messageType: routerResult.messageType,
            stageEventPayload: routerResult.stageEventPayload,
            processingStatus,
          });

        if (savedMessage.processingStatus !== "ignored") {
          relevant += 1;
        }
        classified += 1;
        if (savedMessage.matchedJobId) {
          matched += 1;
        }

        if (autoLinkTransitioned && savedMessage.matchedJobId) {
          await createAutoStageEvent({
            jobId: savedMessage.matchedJobId,
            stageTarget: savedMessage.stageTarget ?? "no_change",
            receivedAt: savedMessage.receivedAt,
            note: "Auto-created from Smart Router.",
          });
        }
      } catch (error) {
        errored += 1;
        logger.warn("Failed to ingest Microsoft Graph message", {
          provider: "graph",
          accountKey: args.accountKey,
          externalMessageId: message.id,
          syncRunId: syncRun.id,
          error: normalizeErrorMessage(error),
        });
      }
    });

    await completePostApplicationSyncRun({
      id: syncRun.id,
      status: "completed",
      messagesDiscovered: discovered,
      messagesRelevant: relevant,
      messagesClassified: classified,
      messagesMatched: matched,
      messagesErrored: errored,
    });
    await updatePostApplicationIntegrationSyncState({
      provider: "graph",
      accountKey: args.accountKey,
      lastSyncedAt: Date.now(),
      lastError: null,
      status: "connected",
    });

    return { discovered, relevant, classified, errored };
  } catch (error) {
    const errorMessage = normalizeErrorMessage(error);
    await completePostApplicationSyncRun({
      id: syncRun.id,
      status: "failed",
      messagesDiscovered: discovered,
      messagesRelevant: relevant,
      messagesClassified: classified,
      messagesMatched: matched,
      messagesErrored: errored,
      errorCode: "GRAPH_SYNC_FAILED",
      errorMessage,
    });
    await updatePostApplicationIntegrationSyncState({
      provider: "graph",
      accountKey: args.accountKey,
      lastSyncedAt: Date.now(),
      lastError: errorMessage,
      status: "error",
    });

    throw error;
  }
}
