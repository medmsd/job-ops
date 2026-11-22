import { readFile, stat } from "node:fs/promises";
import {
  AppError,
  conflict,
  notFound,
  serviceUnavailable,
  unprocessableEntity,
  upstreamError,
} from "@infra/errors";
import { logger } from "@infra/logger";
import * as jobsRepo from "@server/repositories/jobs";
import * as integrationsRepo from "@server/repositories/post-application-integrations";
import { listPostApplicationMessagesForJob } from "@server/repositories/post-application-messages";
import * as sentEmailsRepo from "@server/repositories/post-application-sent-emails";
import type {
  JsonSchemaDefinition,
  LlmMessage,
} from "@server/services/llm/types";
import {
  createConfiguredLlmService,
  resolveLlmModel,
} from "@server/services/modelSelection";
import { getPdfPath, pdfExists } from "@server/services/pdf";
import {
  GRAPH_SEND_SCOPES,
  type GraphCredentials,
  resolveGraphAccessToken,
  sendGraphMail,
} from "@server/services/post-application/ingestion/graph-api";
import { getProfile } from "@server/services/profile";
import {
  tailoredCoverLetterFilename,
  tailoredResumeFilename,
} from "@shared/tailored-document-filenames.js";
import {
  type JobCoverLetterResult,
  type PostApplicationMessage,
  RECRUITER_EMAIL_ATTACHMENT_LIMIT_BYTES,
  type RecruiterEmailPreview,
  type RecruiterEmailSendRequest,
  type RecruiterEmailSendResult,
} from "@shared/types";
import {
  consumeRecruiterEmailPreview,
  createRecruiterEmailPreview,
} from "./recruiter-email-store";

const GRAPH_ACCOUNT_KEY = "default";

const COVER_LETTER_SCHEMA: JsonSchemaDefinition = {
  name: "recruiter_cover_letter",
  schema: {
    type: "object",
    properties: {
      coverLetter: {
        type: "string",
        description:
          "A concise, professional cover letter ready to paste into an email.",
      },
    },
    required: ["coverLetter"],
    additionalProperties: false,
  },
};

function truncate(value: string | null | undefined, max: number): string {
  const normalized = (value ?? "").trim();
  return normalized.length <= max
    ? normalized
    : `${normalized.slice(0, max)}\n[content truncated]`;
}

/**
 * Conservative single-recipient validation. Display names, lists, headers and
 * whitespace are rejected so no hidden BCC or injection can be introduced.
 */
export function normalizeRecipientAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 254) return null;
  if (/[\s<>"',;]/.test(candidate)) return null;
  if (candidate.split("@").length !== 2) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(candidate)) return null;
  return candidate.toLowerCase();
}

export function recipientDomain(address: string): string {
  const at = address.lastIndexOf("@");
  return at >= 0 ? address.slice(at + 1) : "unknown";
}

const EMAIL_CANDIDATE_PATTERN =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Recover a recruiter address from the job itself when the Tracking Inbox has
 * no matched message. `emails` may be comma separated; a manually edited
 * description may contain the address in prose. Only bare, validated addresses
 * are accepted, and the preview remains editable so an ambiguous match can be
 * corrected before the explicit send confirmation.
 */
export function jobEmailCandidates(job: {
  emails?: string | null;
  jobDescription?: string | null;
}): string[] {
  const candidates: string[] = [];
  for (const raw of [job.emails, job.jobDescription]) {
    if (!raw) continue;
    for (const match of raw.match(EMAIL_CANDIDATE_PATTERN) ?? []) {
      const address = normalizeRecipientAddress(match);
      if (address && !candidates.includes(address)) candidates.push(address);
    }
  }
  return candidates;
}

function plainTextForPrompt(value: string | null | undefined): string {
  const text = (value ?? "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function formatSkillForPrompt(skill: unknown): string | null {
  if (typeof skill === "string") return skill.trim() || null;
  if (!skill || typeof skill !== "object") return null;

  const record = skill as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const keywords = Array.isArray(record.keywords)
    ? record.keywords
        .filter((keyword): keyword is string => typeof keyword === "string")
        .map((keyword) => keyword.trim())
        .filter(Boolean)
        .join(", ")
    : "";

  if (name && keywords) return `${name}: ${keywords}`;
  return name || keywords || null;
}

function skillsForPrompt(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "not provided";

  try {
    const parsed = JSON.parse(raw) as unknown;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const formatted = items
      .map((item) => {
        if (typeof item === "string") {
          try {
            return formatSkillForPrompt(JSON.parse(item) as unknown);
          } catch {
            return item.trim() || null;
          }
        }
        return formatSkillForPrompt(item);
      })
      .filter((item): item is string => Boolean(item));
    if (formatted.length > 0) return truncate(formatted.join(", "), 2000);
  } catch {
    // Tailored skills may be stored as plain text.
  }

  return truncate(plainTextForPrompt(raw), 2000) || "not provided";
}

export function buildCoverLetterMessages(input: {
  jobTitle: string;
  employer: string;
  location: string;
  jobDescription: string;
  tailoredHeadline: string;
  tailoredSummary: string;
  tailoredSkills: string;
  candidateName: string;
  recruiterSubject: string;
}): LlmMessage[] {
  const facts = {
    candidate: truncate(input.candidateName, 120) || "Candidate",
    role: truncate(input.jobTitle, 200) || "the advertised role",
    employer: truncate(input.employer, 200) || "the employer",
    location: truncate(input.location, 120) || "not specified",
    recruiterSubject: truncate(input.recruiterSubject, 200) || "not specified",
    tailoredHeadline: truncate(input.tailoredHeadline, 800) || "not provided",
    tailoredSummary: truncate(input.tailoredSummary, 3000) || "not provided",
    tailoredSkills: skillsForPrompt(input.tailoredSkills),
    jobDescription:
      truncate(plainTextForPrompt(input.jobDescription), 12000) ||
      "not provided",
  };

  return [
    {
      role: "system",
      content:
        "You are drafting a job application cover letter. Return only a JSON object matching the supplied schema. The coverLetter value must be the finished letter text: 2-3 short paragraphs, under 220 words, plain prose, a professional greeting, and a closing sentence about next steps. Use only the supplied facts. Do not invent details. Never echo the facts, labels, HTML, instructions, or schema in the letter.",
    },
    {
      role: "user",
      content: `Write the final cover letter for the following application.

Facts:
${JSON.stringify(facts, null, 2)}

Output rules:
- The coverLetter field must contain only the finished letter.
- Do not repeat any labels, fact values as a list, HTML, markdown, or a subject line.
- Write 2-3 short paragraphs under 220 words total.
- Start with a greeting and end with interest in discussing next steps.`,
    },
  ];
}

function sanitizeSingleLine(value: string, max: number): string {
  const single = value
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return single.length <= max ? single : single.slice(0, max);
}

function resolveSelectedMessage(
  messages: PostApplicationMessage[],
  messageId: string | null,
): PostApplicationMessage | null {
  if (!messageId) return messages[0] ?? null;
  return messages.find((message) => message.id === messageId) ?? null;
}

async function resolveCandidateName(): Promise<string> {
  try {
    const profile = await getProfile();
    return profile.basics?.name?.trim() || "Candidate";
  } catch {
    // The profile is optional context; fall back to a neutral name.
    return "Candidate";
  }
}

export async function generateJobCoverLetter(input: {
  jobId: string;
}): Promise<JobCoverLetterResult> {
  const job = await jobsRepo.getJobById(input.jobId);
  if (!job) throw notFound("Job not found");

  const candidateName = await resolveCandidateName();
  const coverLetter = await generateCoverLetter({
    jobId: job.id,
    messages: buildCoverLetterMessages({
      jobTitle: job.title ?? "",
      employer: job.employer ?? "",
      location: job.location ?? "",
      jobDescription: job.jobDescription ?? "",
      tailoredHeadline: job.tailoredHeadline ?? "",
      tailoredSummary: job.tailoredSummary ?? "",
      tailoredSkills: job.tailoredSkills ?? "",
      candidateName,
      recruiterSubject: `Application for ${job.title?.trim() || "the role"} - ${candidateName}`,
    }),
  });

  await jobsRepo.saveJobCoverLetter(job.id, coverLetter);

  logger.info("Job cover letter generated and saved", {
    route: "POST /api/jobs/:id/cover-letter",
    jobId: job.id,
  });

  return {
    jobId: job.id,
    coverLetter,
    filename: tailoredCoverLetterFilename(job.employer),
  };
}

/** Persist an edited cover letter without invoking the LLM. */
export async function saveJobCoverLetterForJob(input: {
  jobId: string;
  coverLetter: string | null;
}): Promise<JobCoverLetterResult> {
  const job = await jobsRepo.saveJobCoverLetter(input.jobId, input.coverLetter);
  if (!job) throw notFound("Job not found");

  return {
    jobId: job.id,
    coverLetter: job.coverLetter ?? "",
    filename: tailoredCoverLetterFilename(job.employer),
  };
}

async function generateCoverLetter(input: {
  jobId: string;
  messages: LlmMessage[];
}): Promise<string> {
  const [llm, model] = await Promise.all([
    createConfiguredLlmService(),
    resolveLlmModel(),
  ]);
  const result = await llm.callJson<{ coverLetter: string }>({
    model,
    messages: input.messages,
    jsonSchema: COVER_LETTER_SCHEMA,
    maxRetries: 1,
    retryDelayMs: 300,
    jobId: input.jobId,
  });

  if (!result.success) {
    throw upstreamError("Cover letter generation failed.", {
      reason: result.error,
    });
  }

  const coverLetter = result.data?.coverLetter?.trim();
  if (!coverLetter) {
    throw upstreamError("Cover letter generation returned an empty letter.");
  }
  return coverLetter;
}

async function readTailoredPdf(
  jobId: string,
  name: string,
): Promise<{
  name: string;
  bytes: Buffer;
  size: number;
}> {
  const pdfPath = getPdfPath(jobId);
  const [bytes, info] = await Promise.all([readFile(pdfPath), stat(pdfPath)]);
  if (info.size > RECRUITER_EMAIL_ATTACHMENT_LIMIT_BYTES) {
    throw unprocessableEntity(
      "The tailored PDF is larger than the 4 MB email attachment limit.",
    );
  }
  return { name, bytes, size: info.size };
}

function isReconsentRequired(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("invalid_scope") ||
    message.includes("invalid_grant") ||
    message.includes("aadsts65001") ||
    message.includes("consent") ||
    message.includes("http 400") ||
    message.includes("http 403")
  );
}

export async function previewRecruiterEmail(input: {
  jobId: string;
  messageId?: string | null;
}): Promise<RecruiterEmailPreview> {
  const job = await jobsRepo.getJobById(input.jobId);
  if (!job) throw notFound("Job not found");

  if (!(await pdfExists(job.id))) {
    throw unprocessableEntity(
      "Generate the tailored PDF for this job before emailing a recruiter.",
    );
  }

  const { items } = await listPostApplicationMessagesForJob(job.id, 100);
  const message = resolveSelectedMessage(
    items.map((item) => item.message),
    input.messageId ?? null,
  );

  let messageId: string | null = null;
  let accountKey = GRAPH_ACCOUNT_KEY;
  let recipientSource: "tracked" | "job" = "tracked";
  let sourceSubject = "";
  let to: string | null = null;

  if (message) {
    to = normalizeRecipientAddress(message.fromAddress);
    if (!to) {
      throw unprocessableEntity(
        "The matched email has no valid recruiter reply address.",
      );
    }
    messageId = message.id;
    accountKey =
      message.provider === "graph" ? message.accountKey : GRAPH_ACCOUNT_KEY;
    sourceSubject = message.subject ?? "";
  } else {
    // No tracked message: fall back to the job's own contact data. The user
    // still reviews and edits the recipient before any explicit confirmation.
    recipientSource = "job";
    to = jobEmailCandidates(job)[0] ?? null;
  }

  if (!to) {
    throw unprocessableEntity(
      "No recruitment email is linked to this job and no address was found in its details. Link one in the Tracking Inbox or add it to the job description first.",
    );
  }

  const pdfPath = getPdfPath(job.id);
  const pdfInfo = await stat(pdfPath);
  if (pdfInfo.size > RECRUITER_EMAIL_ATTACHMENT_LIMIT_BYTES) {
    throw unprocessableEntity(
      "The tailored PDF is larger than the 4 MB email attachment limit.",
    );
  }

  const candidateName = await resolveCandidateName();
  const attachmentName = tailoredResumeFilename(job.employer);

  const subject = sanitizeSingleLine(
    `Application for ${job.title?.trim() || "the role"} - ${candidateName}`,
    200,
  );
  const savedCoverLetter = job.coverLetter?.trim() ?? "";
  const coverLetter =
    savedCoverLetter ||
    (await generateCoverLetter({
      jobId: job.id,
      messages: buildCoverLetterMessages({
        jobTitle: job.title ?? "",
        employer: job.employer ?? "",
        location: job.location ?? "",
        jobDescription: job.jobDescription ?? "",
        tailoredHeadline: job.tailoredHeadline ?? "",
        tailoredSummary: job.tailoredSummary ?? "",
        tailoredSkills: job.tailoredSkills ?? "",
        candidateName,
        recruiterSubject: sourceSubject || subject,
      }),
    }));
  if (!savedCoverLetter) {
    await jobsRepo.saveJobCoverLetter(job.id, coverLetter);
  }
  const body = `${coverLetter.trim()}\n\nKind regards,\n${candidateName}`;

  const stored = createRecruiterEmailPreview({
    jobId: job.id,
    messageId,
    accountKey,
    to,
    subject,
    body,
    coverLetter,
    attachmentName,
    attachmentSize: pdfInfo.size,
  });

  logger.info("Recruiter email preview created", {
    route: "POST /api/jobs/:id/email/preview",
    jobId: job.id,
    messageId,
    recipientSource,
    recipientDomain: recipientDomain(to),
    attachmentName,
    attachmentSize: pdfInfo.size,
  });

  return {
    previewToken: stored.previewToken,
    jobId: job.id,
    messageId,
    recipientSource,
    to,
    subject,
    body,
    coverLetter,
    attachments: [
      {
        name: attachmentName,
        size: pdfInfo.size,
        type: "application/pdf",
      },
    ],
    expiresAt: stored.expiresAt,
  };
}

export async function sendRecruiterEmail(input: {
  jobId: string;
  request: RecruiterEmailSendRequest;
}): Promise<RecruiterEmailSendResult> {
  const draft = consumeRecruiterEmailPreview(input.request.previewToken);
  if (!draft || draft.jobId !== input.jobId) {
    throw conflict("The email preview is invalid, expired, or already used.");
  }

  const job = await jobsRepo.getJobById(input.jobId);
  if (!job) throw notFound("Job not found");

  const to = normalizeRecipientAddress(input.request.to ?? draft.to);
  if (!to) {
    throw unprocessableEntity("Enter a single valid recipient email address.");
  }
  const subject =
    input.request.subject !== undefined
      ? sanitizeSingleLine(input.request.subject, 200)
      : draft.subject;
  const body =
    input.request.body !== undefined ? input.request.body.trim() : draft.body;
  if (!subject) throw unprocessableEntity("Subject cannot be empty.");
  if (!body) throw unprocessableEntity("Email body cannot be empty.");

  const attachment = await readTailoredPdf(
    job.id,
    tailoredResumeFilename(job.employer),
  );

  const integration = await integrationsRepo.getPostApplicationIntegration(
    "graph",
    draft.accountKey,
  );
  if (
    !integration ||
    integration.status !== "connected" ||
    !integration.credentials
  ) {
    throw serviceUnavailable(
      "Microsoft Graph is not connected. Connect it in Settings before sending.",
    );
  }

  const credentials = integration.credentials as unknown as GraphCredentials;
  if (!credentials.refreshToken) {
    throw serviceUnavailable(
      "Reconnect Microsoft Graph to grant Mail.Send permission, then try again.",
    );
  }

  let resolved: GraphCredentials;
  try {
    resolved = await resolveGraphAccessToken(credentials, GRAPH_SEND_SCOPES);
  } catch (error) {
    logger.warn("Recruiter email token resolution failed", {
      route: "POST /api/jobs/:id/email/send",
      jobId: job.id,
      status: error instanceof AppError ? error.status : "unknown",
    });
    if (isReconsentRequired(error)) {
      throw serviceUnavailable(
        "Reconnect Microsoft Graph to grant Mail.Send permission, then try again.",
      );
    }
    throw upstreamError("Microsoft Graph could not provide a send token.");
  }

  // Microsoft rotates refresh tokens; persist immediately so a rotated token
  // is never lost if the follow-up send call fails.
  await integrationsRepo.updatePostApplicationIntegrationSyncState({
    provider: "graph",
    accountKey: draft.accountKey,
    credentials: {
      ...integration.credentials,
      refreshToken: resolved.refreshToken,
      ...(resolved.accessToken ? { accessToken: resolved.accessToken } : {}),
      ...(resolved.expiryDate ? { expiryDate: resolved.expiryDate } : {}),
      ...(resolved.scope ? { scope: resolved.scope } : {}),
      ...(resolved.tokenType ? { tokenType: resolved.tokenType } : {}),
    },
  });

  if (!resolved.accessToken) {
    throw serviceUnavailable(
      "Microsoft Graph did not return an access token for sending.",
    );
  }

  try {
    await sendGraphMail({
      token: resolved.accessToken,
      to,
      subject,
      body,
      attachment: {
        name: attachment.name,
        contentType: "application/pdf",
        contentBytes: attachment.bytes.toString("base64"),
      },
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : "unknown";
    logger.warn("Recruiter email Graph send failed", {
      route: "POST /api/jobs/:id/email/send",
      jobId: job.id,
      status,
      recipientDomain: recipientDomain(to),
      attachmentName: attachment.name,
      attachmentSize: attachment.size,
    });
    throw error instanceof AppError
      ? error
      : upstreamError("Microsoft Graph could not send the email.");
  }

  const sentAt = Date.now();
  const record = await sentEmailsRepo.createPostApplicationSentEmail({
    jobId: job.id,
    integrationId: integration.id,
    provider: "graph",
    toAddress: to,
    subject,
    messageId: draft.messageId,
    status: "sent",
    sentAt,
  });

  logger.info("Recruiter email sent", {
    route: "POST /api/jobs/:id/email/send",
    jobId: job.id,
    sentEmailId: record.id,
    recipientDomain: recipientDomain(to),
    attachmentName: attachment.name,
    attachmentSize: attachment.size,
    status: 202,
  });

  return {
    jobId: job.id,
    sentAt,
    to,
    subject,
    attachmentNames: [attachment.name],
    sentEmailId: record.id,
  };
}
