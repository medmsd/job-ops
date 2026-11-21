import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

const AUTH_ENV = {
  BASIC_AUTH_USER: "admin",
  BASIC_AUTH_PASSWORD: "secret",
  JWT_SECRET: "an-explicit-jwt-secret-with-at-least-32-chars",
  JOBOPS_TEST_AUTH_BYPASS: "0",
};

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  send: vi.fn(),
  coverLetter: vi.fn(),
  saveCoverLetter: vi.fn(),
}));

vi.mock("@server/services/post-application/recruiter-email", () => ({
  generateJobCoverLetter: mocks.coverLetter,
  saveJobCoverLetterForJob: mocks.saveCoverLetter,
  previewRecruiterEmail: mocks.preview,
  sendRecruiterEmail: mocks.send,
}));

describe.sequential("Job recruiter email routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
    mocks.preview.mockResolvedValue({
      previewToken: "preview-token",
      jobId: "job-1",
      messageId: "msg-1",
      to: "recruiter@example.com",
      subject: "Application",
      body: "Hello",
      coverLetter: "Hello",
      attachments: [{ name: "resume.pdf", size: 100, type: "application/pdf" }],
      expiresAt: Date.now() + 60_000,
    });
    mocks.send.mockResolvedValue({
      jobId: "job-1",
      sentAt: Date.now(),
      to: "recruiter@example.com",
      subject: "Application",
      attachmentNames: ["resume.pdf"],
      sentEmailId: "sent-1",
    });
    mocks.coverLetter.mockResolvedValue({
      jobId: "job-1",
      coverLetter: "Dear hiring team, please consider my application.",
      filename: "Mohamed Mseddi Cover Letter Acme.txt",
    });
    mocks.saveCoverLetter.mockResolvedValue({
      jobId: "job-1",
      coverLetter: "Edited letter",
      filename: "Mohamed Mseddi Cover Letter Acme.txt",
    });
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("returns a preview in the standard API envelope", async () => {
    const res = await fetch(`${baseUrl}/api/jobs/job-1/email/preview`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req-preview-1",
      },
      body: JSON.stringify({ messageId: "msg-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("req-preview-1");
    expect(body).toMatchObject({
      ok: true,
      data: { previewToken: "preview-token" },
      meta: { requestId: "req-preview-1" },
    });
    expect(mocks.preview).toHaveBeenCalledWith({
      jobId: "job-1",
      messageId: "msg-1",
    });
  });

  it("rejects an invalid preview payload with 400", async () => {
    const res = await fetch(`${baseUrl}/api/jobs/job-1/email/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId: 42 }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
      meta: { requestId: expect.any(String) },
    });
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("generates a cover letter in the standard API envelope", async () => {
    const res = await fetch(`${baseUrl}/api/jobs/job-1/cover-letter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: {
        jobId: "job-1",
        filename: "Mohamed Mseddi Cover Letter Acme.txt",
      },
      meta: { requestId: expect.any(String) },
    });
    expect(mocks.coverLetter).toHaveBeenCalledWith({ jobId: "job-1" });
  });

  it("maps cover letter failures to the standard error envelope", async () => {
    mocks.coverLetter.mockRejectedValueOnce(new Error("generation failed"));

    const res = await fetch(`${baseUrl}/api/jobs/job-1/cover-letter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR" },
      meta: { requestId: expect.any(String) },
    });
  });

  it("saves an edited cover letter without generating a new one", async () => {
    const res = await fetch(`${baseUrl}/api/jobs/job-1/cover-letter`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coverLetter: "  Edited letter  " }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      data: { jobId: "job-1", coverLetter: "Edited letter" },
      meta: { requestId: expect.any(String) },
    });
    expect(mocks.saveCoverLetter).toHaveBeenCalledWith({
      jobId: "job-1",
      coverLetter: "  Edited letter  ",
    });
    expect(mocks.coverLetter).not.toHaveBeenCalled();
  });

  it("rejects an oversized cover letter save with 400", async () => {
    const res = await fetch(`${baseUrl}/api/jobs/job-1/cover-letter`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coverLetter: "x".repeat(20_001) }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(mocks.saveCoverLetter).not.toHaveBeenCalled();
  });

  it("sends only after an explicit confirm request and returns 202", async () => {
    const res = await fetch(`${baseUrl}/api/jobs/job-1/email/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewToken: "preview-token" }),
    });
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body).toMatchObject({
      ok: true,
      data: { sentEmailId: "sent-1" },
      meta: { requestId: expect.any(String) },
    });
  });

  it("rejects a send request without a preview token", async () => {
    const res = await fetch(`${baseUrl}/api/jobs/job-1/email/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("maps service conflicts to the standard error envelope", async () => {
    mocks.send.mockRejectedValueOnce(new Error("expired preview"));

    const res = await fetch(`${baseUrl}/api/jobs/job-1/email/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewToken: "preview-token" }),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(typeof body.meta.requestId).toBe("string");
  });
});

describe.sequential("Job recruiter email routes require authentication", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer({
      env: AUTH_ENV,
    }));
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it.each([
    ["email/preview", { messageId: "msg-1" }],
    ["email/send", { previewToken: "preview-token" }],
    ["cover-letter", {}],
  ])("rejects unauthenticated %s requests", async (action, payload) => {
    const res = await fetch(`${baseUrl}/api/jobs/job-1/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "UNAUTHORIZED" },
      meta: { requestId: expect.any(String) },
    });
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.coverLetter).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated cover letter save requests", async () => {
    const res = await fetch(`${baseUrl}/api/jobs/job-1/cover-letter`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coverLetter: "Edited letter" }),
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "UNAUTHORIZED" },
      meta: { requestId: expect.any(String) },
    });
    expect(mocks.saveCoverLetter).not.toHaveBeenCalled();
  });
});
