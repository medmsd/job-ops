import { logger } from "@infra/logger";
import {
  disconnectPostApplicationIntegration,
  getPostApplicationIntegration,
  upsertConnectedPostApplicationIntegration,
} from "@server/repositories/post-application-integrations";
import { runGraphIngestionSync } from "@server/services/post-application/ingestion/graph-sync";
import type { PostApplicationIntegration } from "@shared/types";
import { providerInvalidRequest } from "./errors";
import type {
  PostApplicationProviderActionResult,
  PostApplicationProviderAdapter,
  PostApplicationProviderConnectArgs,
  PostApplicationProviderDisconnectArgs,
  PostApplicationProviderStatusArgs,
  PostApplicationProviderSyncArgs,
} from "./types";

type GraphCredentialPayload = {
  refreshToken: string;
  accessToken?: string;
  expiryDate?: number;
  scope?: string;
  tokenType?: string;
  email?: string;
  displayName?: string;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function parseGraphCredentials(
  args: PostApplicationProviderConnectArgs,
): GraphCredentialPayload {
  const raw = args.payload?.payload;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw providerInvalidRequest(
      "Microsoft Graph connect requires payload credentials in body.payload.",
    );
  }

  const refreshToken = asString((raw as Record<string, unknown>).refreshToken);
  if (!refreshToken) {
    throw providerInvalidRequest(
      "Microsoft Graph connect requires a non-empty refreshToken in body.payload.refreshToken.",
    );
  }

  return {
    refreshToken,
    accessToken: asString((raw as Record<string, unknown>).accessToken),
    expiryDate: asNumber((raw as Record<string, unknown>).expiryDate),
    scope: asString((raw as Record<string, unknown>).scope),
    tokenType: asString((raw as Record<string, unknown>).tokenType),
    email: asString((raw as Record<string, unknown>).email),
    displayName: asString((raw as Record<string, unknown>).displayName),
  };
}

function toPublicIntegration(
  integration: PostApplicationIntegration | null,
): PostApplicationIntegration | null {
  if (!integration) return null;

  const credentials = integration.credentials ?? {};
  return {
    ...integration,
    credentials: {
      hasRefreshToken:
        typeof credentials.refreshToken === "string" &&
        credentials.refreshToken.length > 0,
      hasAccessToken:
        typeof credentials.accessToken === "string" &&
        credentials.accessToken.length > 0,
      scope: asString(credentials.scope) ?? null,
      tokenType: asString(credentials.tokenType) ?? null,
      expiryDate: asNumber(credentials.expiryDate) ?? null,
      email: asString(credentials.email) ?? null,
    },
  };
}

function buildStatus(
  accountKey: string,
  integration: PostApplicationIntegration | null,
  message?: string,
): PostApplicationProviderActionResult {
  const publicIntegration = toPublicIntegration(integration);
  const hasRefreshToken = Boolean(
    publicIntegration?.credentials?.hasRefreshToken,
  );

  return {
    status: {
      provider: "graph",
      accountKey,
      connected: publicIntegration?.status === "connected" && hasRefreshToken,
      integration: publicIntegration,
    },
    message,
  };
}

export const graphProvider: PostApplicationProviderAdapter = {
  key: "graph",
  async connect(
    args: PostApplicationProviderConnectArgs,
  ): Promise<PostApplicationProviderActionResult> {
    const credentials = parseGraphCredentials(args);
    const displayName =
      credentials.displayName ??
      credentials.email ??
      `Microsoft Graph (${args.accountKey})`;

    const integration = await upsertConnectedPostApplicationIntegration({
      provider: "graph",
      accountKey: args.accountKey,
      displayName,
      credentials: {
        refreshToken: credentials.refreshToken,
        ...(credentials.accessToken
          ? { accessToken: credentials.accessToken }
          : {}),
        ...(typeof credentials.expiryDate === "number"
          ? { expiryDate: credentials.expiryDate }
          : {}),
        ...(credentials.scope ? { scope: credentials.scope } : {}),
        ...(credentials.tokenType ? { tokenType: credentials.tokenType } : {}),
        ...(credentials.email ? { email: credentials.email } : {}),
      },
    });

    logger.info("Microsoft Graph integration connected", {
      provider: "graph",
      accountKey: args.accountKey,
      initiatedBy: args.initiatedBy ?? null,
      integrationId: integration.id,
    });

    return buildStatus(
      args.accountKey,
      integration,
      "Microsoft Graph integration connected.",
    );
  },

  async status(
    args: PostApplicationProviderStatusArgs,
  ): Promise<PostApplicationProviderActionResult> {
    const integration = await getPostApplicationIntegration(
      "graph",
      args.accountKey,
    );
    if (!integration) {
      return buildStatus(
        args.accountKey,
        null,
        "Microsoft Graph provider is not connected.",
      );
    }

    return buildStatus(args.accountKey, integration);
  },

  async sync(
    args: PostApplicationProviderSyncArgs,
  ): Promise<PostApplicationProviderActionResult> {
    const integration = await getPostApplicationIntegration(
      "graph",
      args.accountKey,
    );
    if (!integration) {
      throw providerInvalidRequest(
        `Microsoft Graph account '${args.accountKey}' is not connected.`,
      );
    }

    const summary = await runGraphIngestionSync({
      accountKey: args.accountKey,
      maxMessages: args.payload?.maxMessages,
      searchDays: args.payload?.searchDays,
    });

    const refreshedIntegration = await getPostApplicationIntegration(
      "graph",
      args.accountKey,
    );
    logger.info("Microsoft Graph sync completed", {
      provider: "graph",
      accountKey: args.accountKey,
      initiatedBy: args.initiatedBy ?? null,
      integrationId: integration.id,
      discovered: summary.discovered,
      relevant: summary.relevant,
      classified: summary.classified,
      errored: summary.errored,
    });

    return buildStatus(
      args.accountKey,
      refreshedIntegration,
      `Sync complete: discovered=${summary.discovered}, relevant=${summary.relevant}, classified=${summary.classified}, errored=${summary.errored}.`,
    );
  },

  async disconnect(
    args: PostApplicationProviderDisconnectArgs,
  ): Promise<PostApplicationProviderActionResult> {
    const integration = await getPostApplicationIntegration(
      "graph",
      args.accountKey,
    );
    const disconnected = await disconnectPostApplicationIntegration(
      "graph",
      args.accountKey,
    );
    logger.info("Microsoft Graph integration disconnected", {
      provider: "graph",
      accountKey: args.accountKey,
      initiatedBy: args.initiatedBy ?? null,
      integrationId: disconnected?.id ?? integration?.id ?? null,
    });

    return buildStatus(
      args.accountKey,
      disconnected,
      "Microsoft Graph disconnected locally. Remove the app's permissions in your Microsoft account to revoke it fully.",
    );
  },
};
