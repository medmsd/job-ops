import { randomUUID } from "node:crypto";
import type {
  PostApplicationProvider,
  PostApplicationSentEmail,
  PostApplicationSentEmailStatus,
} from "@shared/types";
import { and, desc, eq } from "drizzle-orm";
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
  status: PostApplicationSentEmailStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  sentAt: number | null;
};

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
    status: input.status,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    sentAt: input.sentAt,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
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
