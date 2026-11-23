import { randomUUID } from "node:crypto";
import type {
  PostApplicationProvider,
  PostApplicationSentEmail,
  PostApplicationSentEmailStatus,
} from "@shared/types";
import { and, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { db, schema } from "../db";
import {
  getPrivateDataScope,
  privateDataScopeFilter,
} from "../tenancy/private-scope";

const { postApplicationSentEmails } = schema;

export type CreateSentEmailInput = {
  jobId: string;
  integrationId: string | null;
  provider: PostApplicationProvider;
  toAddress: string;
  subject: string;
  messageId: string | null;
  graphMessageId?: string | null;
  internetMessageId?: string | null;
  status: PostApplicationSentEmailStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  sentAt: number | null;
};

export type UpdatePostApplicationSentEmailProvenanceInput = {
  id: string;
  graphMessageId: string | null;
  internetMessageId: string | null;
};

export type FindPostApplicationSentEmailByThreadInput = {
  provider: PostApplicationProvider;
  internetMessageId?: string | null;
  inReplyTo?: string[] | null;
  references?: string[] | null;
  graphConversationId?: string | null;
};

function normalizeMessageId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .trim()
    .replace(/^[\s<]+|[\s>]+$/g, "")
    .trim()
    .toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function mapRow(
  row: typeof postApplicationSentEmails.$inferSelect,
): PostApplicationSentEmail {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    jobId: row.jobId,
    integrationId: row.integrationId,
    provider: row.provider as PostApplicationProvider,
    toAddress: row.toAddress,
    subject: row.subject,
    messageId: row.messageId,
    graphMessageId: row.graphMessageId,
    internetMessageId: row.internetMessageId,
    status: row.status as PostApplicationSentEmailStatus,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createPostApplicationSentEmail(
  input: CreateSentEmailInput,
): Promise<PostApplicationSentEmail> {
  const scope = getPrivateDataScope();
  const id = randomUUID();
  const nowIso = new Date().toISOString();
  await db.insert(postApplicationSentEmails).values({
    id,
    tenantId: scope.tenantId,
    userId: scope.userId,
    jobId: input.jobId,
    integrationId: input.integrationId,
    provider: input.provider,
    toAddress: input.toAddress,
    subject: input.subject,
    messageId: input.messageId,
    graphMessageId: input.graphMessageId ?? null,
    internetMessageId: input.internetMessageId ?? null,
    status: input.status,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    sentAt: input.sentAt,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  return {
    id,
    tenantId: scope.tenantId,
    userId: scope.userId,
    jobId: input.jobId,
    integrationId: input.integrationId,
    provider: input.provider,
    toAddress: input.toAddress,
    subject: input.subject,
    messageId: input.messageId,
    graphMessageId: input.graphMessageId ?? null,
    internetMessageId: input.internetMessageId ?? null,
    status: input.status,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    sentAt: input.sentAt,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export async function updatePostApplicationSentEmailProvenance(
  input: UpdatePostApplicationSentEmailProvenanceInput,
): Promise<PostApplicationSentEmail | null> {
  const rows = await db
    .update(postApplicationSentEmails)
    .set({
      graphMessageId: input.graphMessageId,
      internetMessageId: input.internetMessageId,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        privateDataScopeFilter(postApplicationSentEmails),
        eq(postApplicationSentEmails.id, input.id),
      ),
    )
    .returning();

  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function findPostApplicationSentEmailByThread(
  input: FindPostApplicationSentEmailByThreadInput,
): Promise<PostApplicationSentEmail | null> {
  const normalizedIds = [
    ...new Set(
      [
        input.internetMessageId,
        ...(input.inReplyTo ?? []),
        ...(input.references ?? []),
      ]
        .map(normalizeMessageId)
        .filter((id): id is string => id !== null),
    ),
  ];

  // Graph stores raw RFC 5322 ids (including angle brackets), while callers
  // supply normalized ids, so match both spellings.
  const lookupValues = [
    ...new Set([...normalizedIds, ...normalizedIds.map((id) => `<${id}>`)]),
  ];

  const filters: SQL[] = [];
  if (lookupValues.length > 0) {
    filters.push(
      inArray(postApplicationSentEmails.internetMessageId, lookupValues),
    );
  }

  const graphConversationId = input.graphConversationId?.trim();
  if (graphConversationId) {
    filters.push(
      eq(postApplicationSentEmails.graphMessageId, graphConversationId),
    );
  }

  if (filters.length === 0) {
    return null;
  }

  const rows = await db
    .select()
    .from(postApplicationSentEmails)
    .where(
      and(
        privateDataScopeFilter(postApplicationSentEmails),
        eq(postApplicationSentEmails.provider, input.provider),
        or(...filters),
      ),
    )
    .orderBy(desc(postApplicationSentEmails.sentAt))
    .limit(1);

  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function listPostApplicationSentEmailsForJob(
  jobId: string,
  limit = 50,
): Promise<PostApplicationSentEmail[]> {
  const rows = await db
    .select()
    .from(postApplicationSentEmails)
    .where(
      and(
        privateDataScopeFilter(postApplicationSentEmails),
        eq(postApplicationSentEmails.jobId, jobId),
      ),
    )
    .orderBy(desc(postApplicationSentEmails.sentAt))
    .limit(Math.min(Math.max(1, limit), 200));

  return rows.map(mapRow);
}
