/** Microsoft Graph caps inline file attachments at roughly 4 MB. */
export const RECRUITER_EMAIL_ATTACHMENT_LIMIT_BYTES = 4 * 1024 * 1024;

export interface RecruiterEmailAttachmentPreview {
  name: string;
  size: number;
  type: "application/pdf";
}

export interface RecruiterEmailPreview {
  previewToken: string;
  jobId: string;
  messageId: string | null;
  /** Where the recipient came from: a matched Tracking Inbox email or the job's own details. */
  recipientSource?: "tracked" | "job";
  to: string;
  subject: string;
  body: string;
  coverLetter: string;
  attachments: RecruiterEmailAttachmentPreview[];
  expiresAt: number;
}

export interface RecruiterEmailSendRequest {
  previewToken: string;
  to?: string;
  subject?: string;
  body?: string;
}

export interface RecruiterEmailSendResult {
  jobId: string;
  sentAt: number;
  to: string;
  subject: string;
  attachmentNames: string[];
  sentEmailId: string;
}

export interface JobCoverLetterResult {
  jobId: string;
  coverLetter: string;
  filename: string;
}

export const POST_APPLICATION_SENT_EMAIL_STATUSES = ["sent", "failed"] as const;
export type PostApplicationSentEmailStatus =
  (typeof POST_APPLICATION_SENT_EMAIL_STATUSES)[number];

export interface PostApplicationSentEmail {
  id: string;
  tenantId: string;
  userId: string | null;
  jobId: string;
  integrationId: string | null;
  provider: "gmail" | "imap" | "graph";
  toAddress: string;
  subject: string;
  messageId: string | null;
  status: PostApplicationSentEmailStatus;
  errorCode: string | null;
  errorMessage: string | null;
  sentAt: number | null;
  createdAt: string;
  updatedAt: string;
}
