import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppError } from "@infra/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getJobById: vi.fn(),
  saveJobCoverLetter: vi.fn(),
  listMessages: vi.fn(),
  pdfExists: vi.fn(),
  getPdfPath: vi.fn(),
  getProfile: vi.fn(),
  createLlm: vi.fn(),
  resolveModel: vi.fn(),
  callJson: vi.fn(),
  getIntegration: vi.fn(),
  updateSyncState: vi.fn(),
  resolveToken: vi.fn(),
  sendMail: vi.fn(),
  createSentEmail: vi.fn(),
  updateProvenance: vi.fn(),
  getScope: vi.fn(),
}));

vi.mock("@server/repositories/jobs", () => ({
  getJobById: mocks.getJobById,
  saveJobCoverLetter: mocks.saveJobCoverLetter,
}));
vi.mock("@server/repositories/post-application-messages", () => ({
  listPostApplicationMessagesForJob: mocks.listMessages,
}));
vi.mock("@server/services/pdf", () => ({
  pdfExists: mocks.pdfExists,
  getPdfPath: mocks.getPdfPath,
}));
vi.mock("@server/services/profile", () => ({ getProfile: mocks.getProfile }));
vi.mock("@server/services/modelSelection", () => ({
  createConfiguredLlmService: mocks.createLlm,
  resolveLlmModel: mocks.resolveModel,
}));
vi.mock("@server/repositories/post-application-integrations", () => ({
  getPostApplicationIntegration: mocks.getIntegration,
  updatePostApplicationIntegrationSyncState: mocks.updateSyncState,
}));
vi.mock("@server/repositories/post-application-sent-emails", () => ({
  createPostApplicationSentEmail: mocks.createSentEmail,
  updatePostApplicationSentEmailProvenance: mocks.updateProvenance,
}));
vi.mock("@server/tenancy/private-scope", () => ({
  getPrivateDataScope: mocks.getScope,
  privateDataScopeFilter: vi.fn(),
}));
vi.mock("@server/services/post-application/ingestion/graph-api", () => ({
  GRAPH_SEND_SCOPES:
    "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send",
  resolveGraphAccessToken: mocks.resolveToken,
  sendGraphMail: mocks.sendMail,
}));

import {
  buildCoverLetterMessages,
  generateJobCoverLetter,
  jobEmailCandidates,
  normalizeRecipientAddress,
  previewRecruiterEmail,
  sendRecruiterEmail,
} from "./recruiter-email";
import { clearRecruiterEmailPreviews } from "./recruiter-email-store";

const COVER_LETTER = "Dear hiring team, I am applying for this role.";

const jobWith = (overrides: Record<string, unknown> = {}) => ({
  id: "job-1",
  title: "Software Engineer",
  employer: "Acme",
  location: "London",
  jobDescription: "Build things",
  tailoredHeadline: "Engineer",
  tailoredSummary: "Experienced engineer",
  tailoredSkills: "TypeScript",
  coverLetter: COVER_LETTER,
  ...overrides,
});

describe("recruiter email service", () => {
  let tempDir: string;
  let pdfPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    clearRecruiterEmailPreviews();
    tempDir = await mkdtemp(join(tmpdir(), "jobops-recruiter-email-"));
    pdfPath = join(tempDir, "resume.pdf");
    await writeFile(pdfPath, "%PDF-1.4 fake application resume");

    mocks.getScope.mockReturnValue({
      scopeKey: "tenant-1:user-1",
      tenantId: "tenant-1",
      userId: "user-1",
    });
    mocks.getJobById.mockResolvedValue({
      id: "job-1",
      title: "Software Engineer",
      employer: "Acme",
      location: "London",
      jobDescription: "Build things",
      tailoredHeadline: "Engineer",
      tailoredSummary: "Experienced engineer",
      tailoredSkills: "TypeScript",
      coverLetter: COVER_LETTER,
    });
    mocks.saveJobCoverLetter.mockResolvedValue({
      id: "job-1",
      coverLetter: COVER_LETTER,
    });
    mocks.listMessages.mockResolvedValue({
      items: [
        {
          message: {
            id: "msg-1",
            provider: "graph",
            accountKey: "default",
            fromAddress: "Recruiter@Example.com",
            subject: "Your application",
          },
        },
      ],
      total: 1,
    });
    mocks.pdfExists.mockResolvedValue(true);
    mocks.getPdfPath.mockReturnValue(pdfPath);
    mocks.getProfile.mockResolvedValue({ basics: { name: "Jane Doe" } });
    mocks.createLlm.mockResolvedValue({ callJson: mocks.callJson });
    mocks.resolveModel.mockResolvedValue("qwen3:4b");
    mocks.callJson.mockResolvedValue({
      success: true,
      data: { coverLetter: COVER_LETTER },
    });
    mocks.getIntegration.mockResolvedValue({
      id: "int-1",
      status: "connected",
      credentials: { refreshToken: "refresh-token" },
    });
    mocks.updateSyncState.mockResolvedValue({ id: "int-1" });
    mocks.resolveToken.mockResolvedValue({
      refreshToken: "rotated-refresh-token",
      accessToken: "send-token",
      expiryDate: Date.now() + 3_600_000,
      scope:
        "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send",
    });
    mocks.sendMail.mockResolvedValue({
      id: "graph-message-1",
      internetMessageId: "<graph-message-1@example.com>",
    });
    mocks.createSentEmail.mockResolvedValue({ id: "sent-1" });
    mocks.updateProvenance.mockResolvedValue({
      id: "sent-1",
      graphMessageId: "graph-message-1",
      internetMessageId: "<graph-message-1@example.com>",
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("accepts a bare address and rejects display names, lists, and malformed values", () => {
    expect(normalizeRecipientAddress(" Recruiter@Example.com ")).toBe(
      "recruiter@example.com",
    );
    expect(
      normalizeRecipientAddress("Name <recruiter@example.com>"),
    ).toBeNull();
    expect(
      normalizeRecipientAddress("a@example.com, b@example.com"),
    ).toBeNull();
    expect(normalizeRecipientAddress("not-an-email")).toBeNull();
    expect(normalizeRecipientAddress(123)).toBeNull();
  });

  it("builds a plain-text cover-letter prompt without raw HTML or skill JSON", () => {
    const messages = buildCoverLetterMessages({
      jobTitle: "Engineer",
      employer: "Acme",
      location: "London",
      jobDescription:
        "<h2>Role</h2><p>Build <strong>things</strong>&nbsp;well.</p>",
      tailoredHeadline: "Engineer",
      tailoredSummary: "Experienced engineer",
      tailoredSkills: JSON.stringify([
        JSON.stringify({ name: "Backend", keywords: ["Java", "REST"] }),
        "React",
      ]),
      candidateName: "Jane Doe",
      recruiterSubject: "Application for Engineer",
    });

    const prompt = messages[1]?.content ?? "";

    expect(prompt).toContain('"jobDescription": "Role Build things well."');
    expect(prompt).toContain("Backend: Java, REST, React");
    expect(prompt).not.toContain("<h2>");
    expect(prompt).not.toContain('\\"name\\"');
    expect(prompt).toContain("Do not repeat any labels");
  });

  it("includes whitelisted evidence facts and neverClaim rules in the cover-letter prompt", () => {
    const messages = buildCoverLetterMessages({
      jobTitle: "Engineer",
      employer: "Acme",
      location: "London",
      jobDescription: "Java engineer",
      tailoredHeadline: "Engineer",
      tailoredSummary: "Experienced engineer",
      tailoredSkills: "Java",
      candidateName: "Jane Doe",
      recruiterSubject: "Application for Engineer",
      evidence: {
        targetRoles: ["Senior Java Engineer"],
        allowedSkills: ["Java", "Spring Boot"],
        neverClaim: ["Kubernetes administrator"],
      },
    });

    const systemPrompt = messages[0]?.content ?? "";
    const prompt = messages[1]?.content ?? "";

    expect(systemPrompt).toContain("facts.evidence.neverClaim");
    expect(prompt).toContain('"targetRoles": [');
    expect(prompt).toContain("Senior Java Engineer");
    expect(prompt).toContain("Kubernetes administrator");
    expect(prompt).not.toContain("evidenceNotes");
  });

  it("builds a preview from the matched email, tailored context, and PDF", async () => {
    const preview = await previewRecruiterEmail({ jobId: "job-1" });

    expect(preview).toMatchObject({
      jobId: "job-1",
      messageId: "msg-1",
      to: "recruiter@example.com",
    });
    expect(preview.coverLetter).toBe(COVER_LETTER);
    expect(preview.body).toContain(COVER_LETTER);
    expect(preview.body).toContain("Jane Doe");
    expect(preview.attachments).toEqual([
      {
        name: "Mohamed Mseddi Resume Acme.pdf",
        size: Buffer.byteLength("%PDF-1.4 fake application resume"),
        type: "application/pdf",
      },
    ]);
    expect(preview.expiresAt).toBeGreaterThan(Date.now());
    expect(preview).toMatchObject({ recipientSource: "tracked" });
  });

  it("prefers a tracked inbox email over addresses stored on the job", async () => {
    mocks.getJobById.mockResolvedValueOnce(
      jobWith({
        emails: "jobs@acme.com, careers@acme.com",
        jobDescription: "Contact recruiting@acme.com",
      }),
    );

    const preview = await previewRecruiterEmail({ jobId: "job-1" });

    expect(preview).toMatchObject({
      messageId: "msg-1",
      to: "recruiter@example.com",
      recipientSource: "tracked",
    });
  });

  it("falls back to the job email field when no tracked email is linked", async () => {
    mocks.listMessages.mockResolvedValueOnce({ items: [], total: 0 });
    mocks.getJobById.mockResolvedValueOnce(
      jobWith({ emails: "jobs@acme.com, careers@acme.com" }),
    );

    const preview = await previewRecruiterEmail({ jobId: "job-1" });

    expect(preview).toMatchObject({
      messageId: null,
      to: "jobs@acme.com",
      recipientSource: "job",
    });
  });

  it("falls back to an address in a manually edited job description", async () => {
    mocks.listMessages.mockResolvedValueOnce({ items: [], total: 0 });
    mocks.getJobById.mockResolvedValueOnce(
      jobWith({
        emails: null,
        jobDescription:
          "Interested? Email Samantha – sgoncalves@xccelerated.io for details.",
      }),
    );

    const preview = await previewRecruiterEmail({ jobId: "job-1" });

    expect(preview).toMatchObject({
      messageId: null,
      to: "sgoncalves@xccelerated.io",
      recipientSource: "job",
    });

    await sendRecruiterEmail({
      jobId: "job-1",
      request: { previewToken: preview.previewToken },
    });

    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "sgoncalves@xccelerated.io" }),
    );
  });

  it("extracts bare addresses from mailto links, HTML entities, and obfuscated text", () => {
    expect(
      jobEmailCandidates({
        emails: '<a href="mailto:sam&#64;acme.com">sam(at)acme[dot]com</a>',
        jobDescription: "Contact jobs@acme.com",
      }),
    ).toEqual(["sam@acme.com", "jobs@acme.com"]);
  });

  it("reduces a display-name contact to a single bare address", () => {
    expect(
      jobEmailCandidates({ emails: "Samantha <sgoncalves@xccelerated.io>" }),
    ).toEqual(["sgoncalves@xccelerated.io"]);
  });

  it("opens a manual-recipient preview when no tracked or job address exists", async () => {
    mocks.listMessages.mockResolvedValueOnce({ items: [], total: 0 });
    mocks.getJobById.mockResolvedValueOnce(
      jobWith({ emails: null, jobDescription: "No contact details." }),
    );

    const preview = await previewRecruiterEmail({ jobId: "job-1" });

    expect(preview).toMatchObject({
      jobId: "job-1",
      messageId: null,
      to: "",
      recipientSource: "manual",
    });
  });

  it("does not call the LLM when opening a preview without a saved cover letter", async () => {
    mocks.listMessages.mockResolvedValueOnce({ items: [], total: 0 });
    mocks.getJobById.mockResolvedValueOnce(
      jobWith({
        coverLetter: null,
        emails: null,
        jobDescription: "No contact details.",
      }),
    );

    const preview = await previewRecruiterEmail({ jobId: "job-1" });

    expect(preview).toMatchObject({
      coverLetter: "",
      body: "",
      to: "",
      recipientSource: "manual",
    });
    expect(mocks.createLlm).not.toHaveBeenCalled();
    expect(mocks.callJson).not.toHaveBeenCalled();
    expect(mocks.saveJobCoverLetter).not.toHaveBeenCalled();
  });

  it("sends to a manually entered address for a manual preview", async () => {
    mocks.listMessages.mockResolvedValueOnce({ items: [], total: 0 });
    mocks.getJobById.mockResolvedValueOnce(
      jobWith({ emails: null, jobDescription: "No contact details." }),
    );

    const preview = await previewRecruiterEmail({ jobId: "job-1" });
    await sendRecruiterEmail({
      jobId: "job-1",
      request: {
        previewToken: preview.previewToken,
        to: " samantha@acme.com ",
      },
    });

    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "samantha@acme.com" }),
    );
  });

  it("rejects sending a manual preview without a recipient address", async () => {
    mocks.listMessages.mockResolvedValueOnce({ items: [], total: 0 });
    mocks.getJobById.mockResolvedValueOnce(
      jobWith({ emails: null, jobDescription: "No contact details." }),
    );

    const preview = await previewRecruiterEmail({ jobId: "job-1" });

    await expect(
      sendRecruiterEmail({
        jobId: "job-1",
        request: { previewToken: preview.previewToken, to: "" },
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "UNPROCESSABLE_ENTITY",
    } satisfies Partial<AppError>);
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("generates a downloadable cover letter without a tracked email or PDF", async () => {
    const result = await generateJobCoverLetter({ jobId: "job-1" });

    expect(result).toEqual({
      jobId: "job-1",
      coverLetter: COVER_LETTER,
      filename: "Mohamed Mseddi Cover Letter Acme.txt",
    });
    expect(mocks.callJson).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("cover letter"),
          }),
        ]),
      }),
    );
    expect(mocks.listMessages).not.toHaveBeenCalled();
    expect(mocks.pdfExists).not.toHaveBeenCalled();
    expect(mocks.saveJobCoverLetter).toHaveBeenCalledWith(
      "job-1",
      COVER_LETTER,
    );
  });

  it("reuses a saved cover letter for the email preview without calling the LLM", async () => {
    mocks.getJobById.mockResolvedValueOnce({
      id: "job-1",
      title: "Software Engineer",
      employer: "Acme",
      location: "London",
      jobDescription: "Build things",
      tailoredHeadline: "Engineer",
      tailoredSummary: "Experienced engineer",
      tailoredSkills: "TypeScript",
      coverLetter: "Dear Acme, my edited letter.",
    });

    const preview = await previewRecruiterEmail({ jobId: "job-1" });

    expect(preview.coverLetter).toBe("Dear Acme, my edited letter.");
    expect(preview.body).toContain("Dear Acme, my edited letter.");
    expect(mocks.callJson).not.toHaveBeenCalled();
    expect(mocks.saveJobCoverLetter).not.toHaveBeenCalled();
  });

  it("rejects preview when no tailored PDF exists", async () => {
    mocks.pdfExists.mockResolvedValue(false);

    await expect(
      previewRecruiterEmail({ jobId: "job-1" }),
    ).rejects.toMatchObject({
      status: 422,
      code: "UNPROCESSABLE_ENTITY",
    } satisfies Partial<AppError>);
  });

  it("rejects an oversized PDF before sending", async () => {
    await writeFile(pdfPath, Buffer.alloc(5 * 1024 * 1024));

    await expect(
      previewRecruiterEmail({ jobId: "job-1" }),
    ).rejects.toMatchObject({
      status: 422,
      code: "UNPROCESSABLE_ENTITY",
    } satisfies Partial<AppError>);
  });

  it("sends edited content once and records the sent email", async () => {
    const preview = await previewRecruiterEmail({ jobId: "job-1" });

    const result = await sendRecruiterEmail({
      jobId: "job-1",
      request: {
        previewToken: preview.previewToken,
        to: "new.recruiter@example.com",
        subject: "Edited subject",
        body: "Edited body",
      },
    });

    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "new.recruiter@example.com",
        subject: "Edited subject",
        body: "Edited body",
      }),
    );
    expect(mocks.updateSyncState).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "graph",
        accountKey: "default",
        credentials: expect.objectContaining({
          refreshToken: "rotated-refresh-token",
        }),
      }),
    );
    expect(mocks.createSentEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        toAddress: "new.recruiter@example.com",
        status: "sent",
      }),
    );
    expect(mocks.updateProvenance).toHaveBeenCalledWith({
      id: "sent-1",
      graphMessageId: "graph-message-1",
      internetMessageId: "<graph-message-1@example.com>",
    });
    expect(result).toMatchObject({
      jobId: "job-1",
      to: "new.recruiter@example.com",
      subject: "Edited subject",
      sentEmailId: "sent-1",
    });
  });

  it("rejects reuse of a consumed preview token", async () => {
    const preview = await previewRecruiterEmail({ jobId: "job-1" });
    const request = { previewToken: preview.previewToken };

    await sendRecruiterEmail({ jobId: "job-1", request });
    await expect(
      sendRecruiterEmail({ jobId: "job-1", request }),
    ).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    } satisfies Partial<AppError>);
  });

  it("surfaces an actionable re-consent error when Mail.Send is missing", async () => {
    const preview = await previewRecruiterEmail({ jobId: "job-1" });
    mocks.resolveToken.mockRejectedValueOnce(
      new Error("Microsoft Graph token refresh failed with HTTP 400."),
    );

    await expect(
      sendRecruiterEmail({
        jobId: "job-1",
        request: { previewToken: preview.previewToken },
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      message: expect.stringContaining("Mail.Send") as string,
    } satisfies Partial<AppError>);
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("rejects an invalid edited recipient", async () => {
    const preview = await previewRecruiterEmail({ jobId: "job-1" });

    await expect(
      sendRecruiterEmail({
        jobId: "job-1",
        request: {
          previewToken: preview.previewToken,
          to: "Name <recruiter@example.com>",
        },
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "UNPROCESSABLE_ENTITY",
    } satisfies Partial<AppError>);
  });
});
