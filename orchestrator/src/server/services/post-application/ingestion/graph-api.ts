import { requestTimeout, upstreamError } from "@infra/errors";
import { normalizeWhitespace } from "@shared/utils/string";
import { convert } from "html-to-text";

export const GRAPH_HTTP_TIMEOUT_MS = 15_000;
export const GRAPH_MAIL_SCOPE = "https://graph.microsoft.com/Mail.Read";
export const GRAPH_SEND_MAIL_SCOPE = "https://graph.microsoft.com/Mail.Send";
export const GRAPH_SEND_SCOPES = `${GRAPH_MAIL_SCOPE} ${GRAPH_SEND_MAIL_SCOPE}`;

export type GraphCredentials = {
  refreshToken: string;
  accessToken?: string;
  expiryDate?: number;
  scope?: string;
  tokenType?: string;
  email?: string;
};

export type GraphMailMessage = {
  id: string;
  conversationId: string | null;
  internetMessageId: string | null;
  inReplyTo: string[];
  references: string[];
  fromAddress: string;
  fromDomain: string | null;
  senderName: string | null;
  subject: string;
  receivedAt: number;
  snippet: string;
  body: string;
  webLink: string | null;
};

type GraphEmailAddress = {
  address?: string;
  name?: string;
};

type GraphApiMessage = {
  id?: string;
  conversationId?: string;
  internetMessageId?: string;
  internetMessageHeaders?: Array<{ name?: string; value?: string }>;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  webLink?: string;
  from?: { emailAddress?: GraphEmailAddress };
  sender?: { emailAddress?: GraphEmailAddress };
  body?: { contentType?: string; content?: string };
};

type GraphMessagesPage = {
  value?: GraphApiMessage[];
  "@odata.nextLink"?: string;
};

export const GRAPH_SUBJECT_TERMS = [
  "application",
  "thank you for applying",
  "thanks for applying",
  "application received",
  "application submitted",
  "your application",
  "interview",
  "assessment",
  "coding challenge",
  "take-home",
  "availability",
  "offer",
  "offer letter",
  "referral",
  "recruiter",
  "hiring team",
  "regret to inform",
  "not moving forward",
  "not selected",
  "application unsuccessful",
  "moving forward with other candidates",
  "unable to proceed",
  "position has been filled",
  "hiring freeze",
  "position on hold",
  "withdrawn",
  "invitation",
  "updated invitation",
  "reschedule",
  "rescheduled",
  "next steps",
  "phone screen",
  "screening call",
  "let's chat",
  "quick chat",
];

export const GRAPH_FROM_TERMS = [
  "careers@",
  "jobs@",
  "recruiting@",
  "talent@",
  "no-reply@greenhouse.io",
  "no-reply@us.greenhouse-mail.io",
  "no-reply@ashbyhq.com",
  "notification@smartrecruiters.com",
  "@smartrecruiters.com",
  "@workablemail.com",
  "@hire.lever.co",
  "@myworkday.com",
  "@workdaymail.com",
  "@greenhouse.io",
  "@ashbyhq.com",
  "@calendly.com",
  "@savvycal.com",
  "calendar-notification@google.com",
];

export const GRAPH_BODY_TERMS = [
  "thank you for applying",
  "thanks for applying",
  "book a time",
  "book the best time",
  "schedule a call",
  "microsoft teams meeting",
  "calendly.com",
  "savvycal.com",
];

export const GRAPH_EXCLUDE_SUBJECT_TERMS = [
  "newsletter",
  "webinar",
  "course",
  "discount",
  "event invitation",
  "job search council",
  "matched new opportunities",
];

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function graphHeaderValues(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string,
): string[] {
  if (!headers) return [];
  return headers
    .filter(
      (header) => (header.name ?? "").toLowerCase() === name.toLowerCase(),
    )
    .map((header) => asString(header.value))
    .filter((value): value is string => Boolean(value));
}

function splitMessageIds(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((part) => asString(part.replace(/^<|>$/g, "")))
    .filter((part): part is string => Boolean(part));
}

export function parseGraphReplyHeaders(message: GraphApiMessage): {
  inReplyTo: string[];
  references: string[];
} {
  const inReplyTo = graphHeaderValues(
    message.internetMessageHeaders,
    "In-Reply-To",
  ).flatMap(splitMessageIds);
  const references = graphHeaderValues(
    message.internetMessageHeaders,
    "References",
  ).flatMap(splitMessageIds);
  return {
    inReplyTo: Array.from(new Set(inReplyTo)),
    references: Array.from(new Set(references)),
  };
}

export async function fetchWithTimeout(
  url: string,
  args: { timeoutMs: number; init: RequestInit },
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);

  try {
    return await fetch(url, {
      ...args.init,
      signal: controller.signal,
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError"
    ) {
      throw requestTimeout(
        `Microsoft Graph request timed out after ${args.timeoutMs}ms for ${url}.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveGraphAuthority(): string {
  const tenant = asString(process.env.GRAPH_OAUTH_TENANT_ID) ?? "common";
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;
}

function normalizeGraphScopes(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(/\s+/)
      .map((scope) =>
        scope
          .trim()
          .toLowerCase()
          .replace(/^https:\/\/graph\.microsoft\.com\//, ""),
      )
      .filter(Boolean),
  );
}

function hasRequiredGraphScopes(
  granted: string | undefined,
  required: string,
): boolean {
  const grantedScopes = normalizeGraphScopes(granted);
  if (grantedScopes.size === 0) return false;
  return Array.from(normalizeGraphScopes(required)).every((scope) =>
    grantedScopes.has(scope),
  );
}

/**
 * Resolve a usable Graph access token. Read/sync callers keep the existing
 * behaviour; send callers pass `GRAPH_SEND_SCOPES` so a token that was only
 * granted Mail.Read is refreshed with Mail.Send included.
 */
export async function resolveGraphAccessToken(
  credentials: GraphCredentials,
  scopes: string = GRAPH_MAIL_SCOPE,
): Promise<GraphCredentials> {
  const now = Date.now();
  // Honor the legacy read-only path without changing sync behaviour. Send
  // callers explicitly require Mail.Send and must refresh when it is absent.
  const scopesAreUsable =
    scopes === GRAPH_MAIL_SCOPE ||
    hasRequiredGraphScopes(credentials.scope, scopes);
  if (
    credentials.accessToken &&
    credentials.expiryDate &&
    credentials.expiryDate > now + 60_000 &&
    scopesAreUsable
  ) {
    return credentials;
  }

  const clientId = asString(process.env.GRAPH_OAUTH_CLIENT_ID);
  const clientSecret = asString(process.env.GRAPH_OAUTH_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing GRAPH_OAUTH_CLIENT_ID or GRAPH_OAUTH_CLIENT_SECRET for Microsoft Graph token refresh.",
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: credentials.refreshToken,
    scope: scopes,
  });

  const response = await fetchWithTimeout(`${resolveGraphAuthority()}/token`, {
    timeoutMs: GRAPH_HTTP_TIMEOUT_MS,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  });
  const data = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  if (!response.ok) {
    // OAuth error codes and AADSTS identifiers are safe to surface; raw error
    // descriptions can contain account details and are deliberately discarded.
    const errorCode = asString(data?.error);
    const aadstsCode = asString(data?.error_description)?.match(
      /AADSTS\d+/,
    )?.[0];
    const detail = [errorCode, aadstsCode].filter(Boolean).join(" ");
    throw new Error(
      `Microsoft Graph token refresh failed with HTTP ${response.status}${detail ? ` (${detail})` : ""}.`,
    );
  }

  const accessToken = asString(data?.access_token);
  if (!accessToken) {
    throw new Error(
      "Microsoft Graph token refresh response did not include access_token.",
    );
  }

  const expiresIn =
    typeof data?.expires_in === "number" && Number.isFinite(data.expires_in)
      ? data.expires_in
      : 3600;
  // Microsoft rotates refresh tokens. Persist the replacement when present.
  const refreshToken =
    asString(data?.refresh_token) ?? credentials.refreshToken;

  return {
    ...credentials,
    refreshToken,
    accessToken,
    expiryDate: Date.now() + expiresIn * 1000,
    scope: asString(data?.scope) ?? credentials.scope,
    tokenType: asString(data?.token_type) ?? credentials.tokenType,
  };
}

export async function graphApi<T>(token: string, url: string): Promise<T> {
  const response = await fetchWithTimeout(url, {
    timeoutMs: GRAPH_HTTP_TIMEOUT_MS,
    init: {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "outlook.body-content-type=text",
      },
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Microsoft Graph API request failed (${response.status}).`);
  }
  return data as T;
}

/**
 * POST helper for Graph write operations. Error bodies are never read or
 * returned: callers only receive the HTTP status through a sanitized error.
 */
export async function graphApiPost<T>(
  token: string,
  url: string,
  body: unknown,
): Promise<T | null> {
  const response = await fetchWithTimeout(url, {
    timeoutMs: GRAPH_HTTP_TIMEOUT_MS,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  });

  if (!response.ok) {
    throw upstreamError(
      `Microsoft Graph API request failed (${response.status}).`,
    );
  }

  if (response.status === 204) return null;
  const text = await response.text().catch(() => "");
  if (!text.trim()) return null;
  return JSON.parse(text) as T;
}

export interface GraphSendMailAttachment {
  name: string;
  contentType: string;
  /** Base64-encoded file bytes. */
  contentBytes: string;
}

export interface GraphSendMailResult {
  id: string;
  internetMessageId: string | null;
}

export async function sendGraphMail(input: {
  token: string;
  to: string;
  subject: string;
  body: string;
  attachment: GraphSendMailAttachment;
}): Promise<GraphSendMailResult> {
  const draft = await graphApiPost<{ id?: string; internetMessageId?: string }>(
    input.token,
    "https://graph.microsoft.com/v1.0/me/messages",
    {
      subject: input.subject,
      body: { contentType: "Text", content: input.body },
      toRecipients: [{ emailAddress: { address: input.to } }],
      attachments: [
        {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: input.attachment.name,
          contentType: input.attachment.contentType,
          contentBytes: input.attachment.contentBytes,
        },
      ],
    },
  );

  const id = asString(draft?.id);
  if (!id) {
    throw upstreamError("Microsoft Graph did not return a draft message id.");
  }

  await graphApiPost<null>(
    input.token,
    `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(id)}/send`,
    {},
  );

  let internetMessageId = asString(draft?.internetMessageId);
  if (!internetMessageId) {
    const sent = await graphApi<{ internetMessageId?: string }>(
      input.token,
      `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(id)}?$select=id,internetMessageId`,
    );
    internetMessageId = asString(sent.internetMessageId);
  }

  return { id, internetMessageId };
}

export function buildGraphMessagesUrl(
  searchDays: number,
  maxMessages: number,
): string {
  const since = new Date(
    Date.now() - Math.max(1, searchDays) * 24 * 60 * 60 * 1000,
  ).toISOString();
  const select = [
    "id",
    "conversationId",
    "internetMessageId",
    "internetMessageHeaders",
    "subject",
    "bodyPreview",
    "receivedDateTime",
    "webLink",
    "from",
    "sender",
    "body",
  ].join(",");
  const params = new URLSearchParams({
    $select: select,
    $filter: `receivedDateTime ge ${since}`,
    $orderby: "receivedDateTime desc",
    $top: String(Math.min(100, Math.max(1, maxMessages))),
  });
  return `https://graph.microsoft.com/v1.0/me/messages?${params.toString()}`;
}

function cleanGraphHtml(html: string): string {
  return convert(html, {
    wordwrap: 130,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { ignoreHref: true } },
      { selector: "style", format: "skip" },
      { selector: "script", format: "skip" },
    ],
  });
}

export function extractGraphBodyText(body: GraphApiMessage["body"]): string {
  const content = body?.content ?? "";
  if (!content.trim()) return "";
  const contentType = String(body?.contentType ?? "").toLowerCase();
  if (contentType.includes("html")) {
    return cleanGraphHtml(content).trim();
  }
  return normalizeWhitespace(content).trim();
}

export function normalizeGraphMessage(
  raw: GraphApiMessage,
): GraphMailMessage | null {
  const id = asString(raw.id);
  if (!id) return null;

  const emailAddress =
    raw.from?.emailAddress ?? raw.sender?.emailAddress ?? undefined;
  const fromAddress = asString(emailAddress?.address)?.toLowerCase() ?? "";
  const atIndex = fromAddress.indexOf("@");

  const replyHeaders = parseGraphReplyHeaders(raw);
  return {
    id,
    conversationId: asString(raw.conversationId),
    internetMessageId: asString(raw.internetMessageId),
    inReplyTo: replyHeaders.inReplyTo,
    references: replyHeaders.references,
    fromAddress,
    fromDomain: atIndex > 0 ? fromAddress.slice(atIndex + 1) : null,
    senderName: asString(emailAddress?.name),
    subject: asString(raw.subject) ?? "",
    receivedAt: (() => {
      const parsed = Date.parse(raw.receivedDateTime ?? "");
      return Number.isFinite(parsed) ? parsed : Date.now();
    })(),
    snippet: asString(raw.bodyPreview) ?? "",
    body: extractGraphBodyText(raw.body),
    webLink: asString(raw.webLink),
  };
}

export function isLikelyRecruitmentMessage(message: GraphMailMessage): boolean {
  const subject = message.subject.toLowerCase();
  const fromAddress = message.fromAddress.toLowerCase();
  const body = message.body.toLowerCase();

  if (GRAPH_EXCLUDE_SUBJECT_TERMS.some((term) => subject.includes(term))) {
    return false;
  }

  return (
    GRAPH_SUBJECT_TERMS.some((term) => subject.includes(term)) ||
    GRAPH_FROM_TERMS.some((term) => fromAddress.includes(term)) ||
    GRAPH_BODY_TERMS.some((term) => body.includes(term))
  );
}

export async function listGraphMessages(
  token: string,
  searchDays: number,
  maxMessages: number,
): Promise<GraphMailMessage[]> {
  const messages: GraphMailMessage[] = [];
  let nextUrl: string | undefined = buildGraphMessagesUrl(
    searchDays,
    maxMessages,
  );
  const seen = new Set<string>();

  while (nextUrl && messages.length < maxMessages) {
    const page: GraphMessagesPage = await graphApi<GraphMessagesPage>(
      token,
      nextUrl,
    );

    for (const raw of page.value ?? []) {
      const message = normalizeGraphMessage(raw);
      if (!message || seen.has(message.id)) continue;
      seen.add(message.id);
      if (!isLikelyRecruitmentMessage(message)) continue;
      messages.push(message);
      if (messages.length >= maxMessages) break;
    }

    nextUrl =
      messages.length >= maxMessages
        ? undefined
        : (page["@odata.nextLink"] ?? undefined);
  }

  return messages;
}

/**
 * Build a URL for the single most recent mailbox message. Unlike
 * `buildGraphMessagesUrl`, this applies no date or keyword filtering so the
 * diagnostic shows whatever the connection actually sees.
 */
export function buildLatestGraphMessageUrl(): string {
  const select = [
    "id",
    "conversationId",
    "subject",
    "bodyPreview",
    "receivedDateTime",
    "webLink",
    "from",
    "sender",
  ].join(",");
  const params = new URLSearchParams({
    $select: select,
    $orderby: "receivedDateTime desc",
    $top: "1",
  });
  return `https://graph.microsoft.com/v1.0/me/messages?${params.toString()}`;
}

/**
 * Fetch the latest message directly from Graph, without recruitment keyword
 * filtering. Used by the tracking inbox connection diagnostic.
 */
export async function fetchLatestGraphMessage(
  token: string,
): Promise<GraphMailMessage | null> {
  const page: GraphMessagesPage = await graphApi<GraphMessagesPage>(
    token,
    buildLatestGraphMessageUrl(),
  );
  const raw = page.value?.[0];
  return raw ? normalizeGraphMessage(raw) : null;
}

export function buildEmailText(input: {
  from: string;
  subject: string;
  date: string;
  body: string;
}): string {
  return `From: ${input.from}
Subject: ${input.subject}
Date: ${input.date}
Body:
${input.body}`.trim();
}
