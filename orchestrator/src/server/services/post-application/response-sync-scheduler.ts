import { randomUUID } from "node:crypto";
import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import {
  listConnectedPostApplicationIntegrationsForScheduler,
  type SchedulerIntegrationScope,
} from "@server/repositories/post-application-integrations";
import { executePostApplicationProviderAction } from "@server/services/post-application/providers/service";

export const RESPONSE_SYNC_INTERVAL_MS = 30 * 60 * 1000;
export const RESPONSE_SYNC_SEARCH_DAYS = 7;
export const RESPONSE_SYNC_MAX_MESSAGES = 50;

type SyncLogger = {
  info: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
};

type ResponseSyncDeps = {
  listIntegrations: () => Promise<SchedulerIntegrationScope[]>;
  executeProviderAction: typeof executePostApplicationProviderAction;
  now: () => number;
  log: SyncLogger;
};

type ResponseSyncSummary = {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

const defaultDeps: ResponseSyncDeps = {
  listIntegrations: listConnectedPostApplicationIntegrationsForScheduler,
  executeProviderAction: executePostApplicationProviderAction,
  now: () => Date.now(),
  log: logger,
};

const inFlight = new Set<string>();
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let immediateTimer: ReturnType<typeof setTimeout> | null = null;

function lockKey(integration: SchedulerIntegrationScope): string {
  return `${integration.tenantId}|${integration.provider}|${integration.accountKey}`;
}

function requestContextFor(
  integration: SchedulerIntegrationScope,
  requestId: string,
) {
  return {
    requestId,
    tenantId: integration.tenantId,
    // Pass the key explicitly so an ambient caller's userId cannot leak in
    // through runWithRequestContext's spread merge when this scope has none.
    userId: integration.userId ?? undefined,
  };
}

export function parseSyncCounts(message: string | undefined): {
  messagesDiscovered: number;
  messagesClassified: number;
} {
  const discovered = Number.parseInt(
    message?.match(/discovered=(\d+)/)?.[1] ?? "0",
    10,
  );
  const classified = Number.parseInt(
    message?.match(/classified=(\d+)/)?.[1] ?? "0",
    10,
  );
  return {
    messagesDiscovered: Number.isFinite(discovered) ? discovered : 0,
    messagesClassified: Number.isFinite(classified) ? classified : 0,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

export async function runResponseSyncOnce(
  deps: Partial<ResponseSyncDeps> = {},
): Promise<ResponseSyncSummary> {
  const resolved: ResponseSyncDeps = { ...defaultDeps, ...deps };
  const summary: ResponseSyncSummary = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  let integrations: SchedulerIntegrationScope[];
  try {
    integrations = await resolved.listIntegrations();
  } catch (error) {
    // Enumeration runs on bare `void` timer callbacks; never let a transient
    // DB failure reject into an unhandled rejection that could kill the process.
    resolved.log.warn("Response sync enumeration failed", {
      status: "failed",
      error: errorMessage(error),
    });
    return summary;
  }

  const tasks: Promise<void>[] = [];

  for (const integration of integrations) {
    if (integration.provider === "imap") continue;

    const key = lockKey(integration);
    if (inFlight.has(key)) {
      summary.skipped += 1;
      resolved.log.info("Response sync skipped: already in flight", {
        tenantId: integration.tenantId,
        provider: integration.provider,
        accountKey: integration.accountKey,
      });
      continue;
    }

    inFlight.add(key);
    summary.attempted += 1;

    const task = (async () => {
      const requestId = randomUUID();
      const startedAt = resolved.now();
      try {
        const actionResult = await runWithRequestContext(
          requestContextFor(integration, requestId),
          () =>
            resolved.executeProviderAction({
              provider: integration.provider,
              action: "sync",
              accountKey: integration.accountKey,
              initiatedBy: "response-sync-scheduler",
              syncPayload: {
                maxMessages: RESPONSE_SYNC_MAX_MESSAGES,
                searchDays: RESPONSE_SYNC_SEARCH_DAYS,
              },
            }),
        );
        const counts = parseSyncCounts(actionResult.message);

        resolved.log.info("Response sync completed", {
          requestId,
          tenantId: integration.tenantId,
          provider: integration.provider,
          accountKey: integration.accountKey,
          messagesDiscovered: counts.messagesDiscovered,
          messagesClassified: counts.messagesClassified,
          durationMs: resolved.now() - startedAt,
          status: "completed",
        });
        summary.succeeded += 1;
      } catch (error) {
        resolved.log.warn("Response sync failed", {
          requestId,
          tenantId: integration.tenantId,
          provider: integration.provider,
          accountKey: integration.accountKey,
          durationMs: resolved.now() - startedAt,
          status: "failed",
          error: errorMessage(error),
        });
        summary.failed += 1;
      } finally {
        inFlight.delete(key);
      }
    })();

    tasks.push(task);
  }

  await Promise.all(tasks);
  return summary;
}

export function startResponseSyncScheduler(): void {
  if (intervalTimer || immediateTimer) return;

  immediateTimer = setTimeout(() => {
    immediateTimer = null;
    void runResponseSyncOnce();
  }, 0);
  intervalTimer = setInterval(() => {
    void runResponseSyncOnce();
  }, RESPONSE_SYNC_INTERVAL_MS);
}

export function stopResponseSyncScheduler(): void {
  if (immediateTimer) {
    clearTimeout(immediateTimer);
    immediateTimer = null;
  }
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}
