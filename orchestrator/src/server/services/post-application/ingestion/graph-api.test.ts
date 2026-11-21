import type { AppError } from "@infra/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildGraphMessagesUrl,
  buildLatestGraphMessageUrl,
  extractGraphBodyText,
  fetchLatestGraphMessage,
  GRAPH_SEND_SCOPES,
  isLikelyRecruitmentMessage,
  normalizeGraphMessage,
  resolveGraphAccessToken,
  resolveGraphAuthority,
  sendGraphMail,
} from "./graph-api";

describe("graph api", () => {
  const originalClientId = process.env.GRAPH_OAUTH_CLIENT_ID;
  const originalClientSecret = process.env.GRAPH_OAUTH_CLIENT_SECRET;
  const originalTenant = process.env.GRAPH_OAUTH_TENANT_ID;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env.GRAPH_OAUTH_CLIENT_ID = "client-id";
    process.env.GRAPH_OAUTH_CLIENT_SECRET = "client-secret";
    process.env.GRAPH_OAUTH_TENANT_ID = "common";
  });

  afterEach(() => {
    process.env.GRAPH_OAUTH_CLIENT_ID = originalClientId;
    process.env.GRAPH_OAUTH_CLIENT_SECRET = originalClientSecret;
    process.env.GRAPH_OAUTH_TENANT_ID = originalTenant;
    vi.restoreAllMocks();
  });

  it("uses the tenant from configuration", () => {
    expect(resolveGraphAuthority()).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0",
    );
    process.env.GRAPH_OAUTH_TENANT_ID = "tenant-123";
    expect(resolveGraphAuthority()).toBe(
      "https://login.microsoftonline.com/tenant-123/oauth2/v2.0",
    );
  });

  it("maps token refresh abort to REQUEST_TIMEOUT", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(
      new DOMException("Aborted", "AbortError"),
    );

    await expect(
      resolveGraphAccessToken({ refreshToken: "refresh-token" }),
    ).rejects.toMatchObject({
      status: 408,
      code: "REQUEST_TIMEOUT",
    } satisfies Partial<AppError>);
  });

  it("throws when token refresh fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ error: "invalid_grant" }),
    } as unknown as Response);

    await expect(
      resolveGraphAccessToken({ refreshToken: "refresh-token" }),
    ).rejects.toThrow("Microsoft Graph token refresh failed with HTTP 401");
  });

  it("surfaces only the OAuth code and AADSTS id on a consent failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({
        error: "invalid_grant",
        error_description:
          "AADSTS65001: user msedd@example.com has not consented to Mail.Send",
      }),
    } as unknown as Response);

    await expect(
      resolveGraphAccessToken(
        { refreshToken: "refresh-token" },
        GRAPH_SEND_SCOPES,
      ),
    ).rejects.toThrow(
      "Microsoft Graph token refresh failed with HTTP 400 (invalid_grant AADSTS65001).",
    );
  });

  it("persists a rotated refresh token on success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        access_token: "new-access-token",
        refresh_token: "rotated-refresh-token",
        expires_in: 1200,
      }),
    } as unknown as Response);

    const refreshed = await resolveGraphAccessToken({
      refreshToken: "old-refresh-token",
    });

    expect(refreshed.accessToken).toBe("new-access-token");
    expect(refreshed.refreshToken).toBe("rotated-refresh-token");
    expect(refreshed.expiryDate).toBeGreaterThan(Date.now());
  });

  it("reuses a valid token when send scopes are already granted", async () => {
    const existing = {
      refreshToken: "refresh-token",
      accessToken: "valid-access-token",
      expiryDate: Date.now() + 600_000,
      scope: GRAPH_SEND_SCOPES,
    };

    await expect(
      resolveGraphAccessToken(existing, GRAPH_SEND_SCOPES),
    ).resolves.toBe(existing);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refreshes when Mail.Send is missing from the granted scopes", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        access_token: "send-access-token",
        refresh_token: "rotated-refresh-token",
        expires_in: 1200,
        scope: GRAPH_SEND_SCOPES,
      }),
    } as unknown as Response);

    const refreshed = await resolveGraphAccessToken(
      {
        refreshToken: "refresh-token",
        accessToken: "read-only-token",
        expiryDate: Date.now() + 600_000,
        scope: "https://graph.microsoft.com/Mail.Read",
      },
      GRAPH_SEND_SCOPES,
    );

    expect(refreshed.accessToken).toBe("send-access-token");
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain("Mail.Send");
  });

  it("sends mail through /me/sendMail with a single recipient and attachment", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 202,
      text: vi.fn().mockResolvedValue(""),
    } as unknown as Response);

    await sendGraphMail({
      token: "send-token",
      to: "recruiter@example.com",
      subject: "Application",
      body: "Hello",
      attachment: {
        name: "resume.pdf",
        contentType: "application/pdf",
        contentBytes: "JVBERi0=",
      },
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    expect(init.method).toBe("POST");
    const payload = JSON.parse(String(init.body)) as {
      message: {
        toRecipients: Array<{ emailAddress: { address: string } }>;
        attachments: Array<{ name: string; contentBytes: string }>;
      };
      saveToSentItems: boolean;
    };
    expect(payload.message.toRecipients).toHaveLength(1);
    expect(payload.message.toRecipients[0]?.emailAddress.address).toBe(
      "recruiter@example.com",
    );
    expect(payload.message.attachments[0]).toMatchObject({
      name: "resume.pdf",
      contentBytes: "JVBERi0=",
    });
    expect(payload.saveToSentItems).toBe(true);
  });

  it("maps failed Graph sends to a sanitized upstream error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: vi.fn().mockResolvedValue("secret upstream details"),
    } as unknown as Response);

    await expect(
      sendGraphMail({
        token: "send-token",
        to: "recruiter@example.com",
        subject: "Application",
        body: "Hello",
        attachment: {
          name: "resume.pdf",
          contentType: "application/pdf",
          contentBytes: "JVBERi0=",
        },
      }),
    ).rejects.toMatchObject({
      status: 502,
      code: "UPSTREAM_ERROR",
    } satisfies Partial<AppError>);
  });

  it("builds a filtered, ordered messages URL", () => {
    const url = new URL(buildGraphMessagesUrl(30, 250));

    expect(url.origin + url.pathname).toBe(
      "https://graph.microsoft.com/v1.0/me/messages",
    );
    expect(url.searchParams.get("$filter")).toContain("receivedDateTime ge");
    expect(url.searchParams.get("$orderby")).toBe("receivedDateTime desc");
    expect(url.searchParams.get("$top")).toBe("100");
    expect(url.searchParams.get("$select")).toContain("bodyPreview");
  });

  it("extracts text from plain and html bodies", () => {
    expect(
      extractGraphBodyText({ contentType: "text", content: "hello   world" }),
    ).toBe("hello world");
    const html = extractGraphBodyText({
      contentType: "html",
      content: "<p>Thank you for applying</p>",
    });
    expect(html).toContain("Thank you for applying");
  });

  it("normalizes and filters recruitment messages", () => {
    const message = normalizeGraphMessage({
      id: "AAMkAGUAAA=",
      conversationId: "conversation-1",
      subject: "Your application",
      bodyPreview: "Application received",
      receivedDateTime: "2026-01-02T10:00:00Z",
      from: {
        emailAddress: {
          address: "Careers@Example.com",
          name: "Example Careers",
        },
      },
      body: { contentType: "text", content: "Thanks for applying" },
    });

    expect(message).toMatchObject({
      id: "AAMkAGUAAA=",
      conversationId: "conversation-1",
      fromAddress: "careers@example.com",
      fromDomain: "example.com",
      senderName: "Example Careers",
      subject: "Your application",
    });
    expect(message && isLikelyRecruitmentMessage(message)).toBe(true);
  });

  it("excludes newsletters", () => {
    const message = normalizeGraphMessage({
      id: "newsletter-1",
      subject: "Weekly newsletter",
      bodyPreview: "",
      body: { contentType: "text", content: "" },
    });
    expect(message && isLikelyRecruitmentMessage(message)).toBe(false);
  });

  it("builds an unfiltered, latest-only messages URL", () => {
    const url = new URL(buildLatestGraphMessageUrl());

    expect(url.origin + url.pathname).toBe(
      "https://graph.microsoft.com/v1.0/me/messages",
    );
    expect(url.searchParams.get("$orderby")).toBe("receivedDateTime desc");
    expect(url.searchParams.get("$top")).toBe("1");
    expect(url.searchParams.get("$filter")).toBeNull();
  });

  it("fetches the latest message without recruitment keyword filtering", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        value: [
          {
            id: "latest-1",
            subject: "Weekend plans",
            bodyPreview: "Are we still on for lunch?",
            receivedDateTime: "2026-02-01T10:00:00Z",
            from: {
              emailAddress: {
                address: "Friend@Example.com",
                name: "A Friend",
              },
            },
            webLink: "https://outlook.office.com/mail/id/latest-1",
          },
        ],
      }),
    } as unknown as Response);

    const message = await fetchLatestGraphMessage("access-token");

    expect(message).toMatchObject({
      id: "latest-1",
      subject: "Weekend plans",
      fromAddress: "friend@example.com",
      senderName: "A Friend",
      webLink: "https://outlook.office.com/mail/id/latest-1",
    });
    expect(message && isLikelyRecruitmentMessage(message)).toBe(false);
  });

  it("returns null when the mailbox is empty", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ value: [] }),
    } as unknown as Response);

    await expect(fetchLatestGraphMessage("access-token")).resolves.toBeNull();
  });
});
