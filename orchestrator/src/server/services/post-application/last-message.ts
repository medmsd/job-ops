import { AppError, serviceUnavailable, upstreamError } from "@infra/errors";
import { logger } from "@infra/logger";
import {
  getPostApplicationIntegration,
  upsertConnectedPostApplicationIntegration,
} from "@server/repositories/post-application-integrations";
import type {
  PostApplicationLastMessagePreview,
  PostApplicationProvider,
} from "@shared/types";
import {
  fetchLatestGmailMessage,
  resolveGmailAccessToken,
} from "./ingestion/gmail-api";
import { headerValue, parseFromHeader } from "./ingestion/gmail-sync";
import {
  fetchLatestGraphMessage,
  resolveGraphAccessToken,
} from "./ingestion/graph-api";

type StoredCredentials = {
  refreshToken: string;
  accessToken?: string;
  expiryDate?: number;
  scope?: string;
  tokenType?: string;
  email?: string;
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

function parseCredentials(raw: unknown): StoredCredentials | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const refreshToken = asString(record.refreshToken);
  if (!refreshToken) return null;

  return {
    refreshToken,
    accessToken: asString(record.accessToken),
    expiryDate: asNumber(record.expiryDate),
    scope: asString(record.scope),
    tokenType: asString(record.tokenType),
    email: asString(record.email),
  };
}

async function persistRefreshedCredentials(args: {
  provider: "graph" | "gmail";
  accountKey: string;
  displayName: string | null | undefined;
  before: StoredCredentials;
  after: StoredCredentials;
}): Promise<void> {
  const { before, after } = args;
  if (
    before.accessToken === after.accessToken &&
    before.expiryDate === after.expiryDate &&
    before.refreshToken === after.refreshToken
  ) {
    return;
  }

  await upsertConnectedPostApplicationIntegration({
    provider: args.provider,
    accountKey: args.accountKey,
    displayName: args.displayName,
    credentials: after,
  });
}

/**
 * Fetch the most recent message straight from the mail provider. This is a
 * read-only connection diagnostic: it proves the stored OAuth credentials can
 * still reach the mailbox, independently of sync/classification state.
 */
export async function getLastProviderMessage(input: {
  provider: PostApplicationProvider;
  accountKey: string;
}): Promise<PostApplicationLastMessagePreview | null> {
  const { provider, accountKey } = input;

  if (provider === "imap") {
    throw serviceUnavailable(
      "The last-email diagnostic is not available for IMAP accounts. Use Gmail or Microsoft Graph.",
    );
  }

  const integration = await getPostApplicationIntegration(provider, accountKey);
  const credentials = parseCredentials(integration?.credentials ?? null);
  if (!integration || !credentials) {
    const label = provider === "graph" ? "Microsoft Graph" : "Gmail";
    throw serviceUnavailable(
      `The ${label} account '${accountKey}' is not connected.`,
    );
  }

  try {
    if (provider === "graph") {
      const resolved = await resolveGraphAccessToken(credentials);
      await persistRefreshedCredentials({
        provider,
        accountKey,
        displayName: integration.displayName,
        before: credentials,
        after: resolved,
      });
      if (!resolved.accessToken) {
        throw new Error("Microsoft Graph access token is missing.");
      }
      const message = await fetchLatestGraphMessage(resolved.accessToken);
      if (!message) return null;
      return {
        id: message.id,
        fromAddress: message.fromAddress,
        senderName: message.senderName,
        subject: message.subject,
        receivedAt: message.receivedAt,
        snippet: message.snippet,
        webLink: message.webLink,
      };
    }

    const resolved = await resolveGmailAccessToken(credentials);
    await persistRefreshedCredentials({
      provider,
      accountKey,
      displayName: integration.displayName,
      before: credentials,
      after: resolved,
    });
    if (!resolved.accessToken) {
      throw new Error("Gmail access token is missing.");
    }
    const message = await fetchLatestGmailMessage(resolved.accessToken);
    if (!message) return null;

    const from = parseFromHeader(headerValue(message.headers, "From"));
    const receivedAt = Date.parse(headerValue(message.headers, "Date"));
    return {
      id: message.id,
      fromAddress: from.fromAddress,
      senderName: from.senderName,
      subject: headerValue(message.headers, "Subject"),
      receivedAt: Number.isFinite(receivedAt) ? receivedAt : Date.now(),
      snippet: message.snippet,
      webLink: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(message.id)}`,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.warn(
      "Failed to fetch the latest email for the connection diagnostic",
      {
        provider,
        accountKey,
        integrationId: integration.id,
        error: error instanceof Error ? error.message : "unknown error",
      },
    );
    throw upstreamError(
      "Could not fetch the latest email. Check the connection and try again.",
    );
  }
}
