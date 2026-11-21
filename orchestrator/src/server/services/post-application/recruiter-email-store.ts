import { randomBytes } from "node:crypto";
import { getPrivateDataScope } from "@server/tenancy/private-scope";

export type RecruiterEmailDraft = {
  jobId: string;
  messageId: string | null;
  accountKey: string;
  to: string;
  subject: string;
  body: string;
  coverLetter: string;
  attachmentName: string;
  attachmentSize: number;
  expiresAt: number;
};

type StoredPreview = RecruiterEmailDraft & {
  scopeKey: string;
  createdAt: number;
};

const previewStore = new Map<string, StoredPreview>();

function getPreviewTtlMs(): number {
  const parsed = Number.parseInt(
    process.env.RECRUITER_EMAIL_PREVIEW_TTL_MS ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10 * 60 * 1000;
}

function getPreviewMaxEntries(): number {
  const parsed = Number.parseInt(
    process.env.RECRUITER_EMAIL_PREVIEW_MAX_ENTRIES ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
}

function cleanupPreviews(): void {
  const now = Date.now();
  for (const [token, entry] of previewStore.entries()) {
    if (now >= entry.expiresAt) previewStore.delete(token);
  }
}

function enforcePreviewLimit(): void {
  const maxEntries = getPreviewMaxEntries();
  if (previewStore.size < maxEntries) return;

  const overflow = previewStore.size - maxEntries + 1;
  const oldest = Array.from(previewStore.entries()).sort(
    (a, b) => a[1].createdAt - b[1].createdAt,
  );
  for (const [token] of oldest.slice(0, overflow)) {
    previewStore.delete(token);
  }
}

/**
 * Store a short-lived, single-use draft. The cache key includes the tenant and
 * user scope so previews can never cross workspace/user boundaries.
 */
export function createRecruiterEmailPreview(
  draft: Omit<RecruiterEmailDraft, "expiresAt">,
): { previewToken: string; expiresAt: number } {
  cleanupPreviews();
  enforcePreviewLimit();

  const scope = getPrivateDataScope();
  const previewToken = randomBytes(24).toString("base64url");
  const createdAt = Date.now();
  const expiresAt = createdAt + getPreviewTtlMs();
  previewStore.set(`${scope.scopeKey}:${previewToken}`, {
    ...draft,
    scopeKey: scope.scopeKey,
    createdAt,
    expiresAt,
  });

  return { previewToken, expiresAt };
}

/**
 * Consume a preview exactly once. Expired, mismatched, and already-used tokens
 * all return null so the caller can map them to a single 409 CONFLICT.
 */
export function consumeRecruiterEmailPreview(
  previewToken: string,
): RecruiterEmailDraft | null {
  cleanupPreviews();
  const scope = getPrivateDataScope();
  const key = `${scope.scopeKey}:${previewToken}`;
  const entry = previewStore.get(key);
  if (!entry || entry.scopeKey !== scope.scopeKey) return null;

  previewStore.delete(key);
  if (Date.now() >= entry.expiresAt) return null;

  return {
    jobId: entry.jobId,
    messageId: entry.messageId,
    accountKey: entry.accountKey,
    to: entry.to,
    subject: entry.subject,
    body: entry.body,
    coverLetter: entry.coverLetter,
    attachmentName: entry.attachmentName,
    attachmentSize: entry.attachmentSize,
    expiresAt: entry.expiresAt,
  };
}

/** Test-only helper to keep module state from leaking between cases. */
export function clearRecruiterEmailPreviews(): void {
  previewStore.clear();
}
