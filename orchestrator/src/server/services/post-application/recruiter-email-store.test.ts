import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getScope: vi.fn() }));

vi.mock("@server/tenancy/private-scope", () => ({
  getPrivateDataScope: mocks.getScope,
}));

import {
  clearRecruiterEmailPreviews,
  consumeRecruiterEmailPreview,
  createRecruiterEmailPreview,
} from "./recruiter-email-store";

const draft = {
  jobId: "job-1",
  messageId: "msg-1",
  accountKey: "default",
  to: "recruiter@example.com",
  subject: "Application",
  body: "Hello",
  coverLetter: "Hello",
  attachmentName: "resume.pdf",
  attachmentSize: 1024,
};

describe("recruiter email preview store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRecruiterEmailPreviews();
    process.env.RECRUITER_EMAIL_PREVIEW_TTL_MS = "60000";
  });

  afterEach(() => {
    clearRecruiterEmailPreviews();
    delete process.env.RECRUITER_EMAIL_PREVIEW_TTL_MS;
    delete process.env.RECRUITER_EMAIL_PREVIEW_MAX_ENTRIES;
  });

  it("keeps tokens usable only in the workspace/user that created them", () => {
    mocks.getScope.mockReturnValue({
      scopeKey: "tenant-1:user-1",
      tenantId: "tenant-1",
      userId: "user-1",
    });
    const { previewToken } = createRecruiterEmailPreview(draft);

    mocks.getScope.mockReturnValue({
      scopeKey: "tenant-2:user-2",
      tenantId: "tenant-2",
      userId: "user-2",
    });
    expect(consumeRecruiterEmailPreview(previewToken)).toBeNull();

    mocks.getScope.mockReturnValue({
      scopeKey: "tenant-1:user-1",
      tenantId: "tenant-1",
      userId: "user-1",
    });
    expect(consumeRecruiterEmailPreview(previewToken)).toMatchObject({
      jobId: "job-1",
    });
  });

  it("consumes a token exactly once", () => {
    mocks.getScope.mockReturnValue({
      scopeKey: "tenant-1:user-1",
      tenantId: "tenant-1",
      userId: "user-1",
    });
    const { previewToken } = createRecruiterEmailPreview(draft);

    expect(consumeRecruiterEmailPreview(previewToken)).not.toBeNull();
    expect(consumeRecruiterEmailPreview(previewToken)).toBeNull();
  });

  it("expires a token after its TTL", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      mocks.getScope.mockReturnValue({
        scopeKey: "tenant-1:user-1",
        tenantId: "tenant-1",
        userId: "user-1",
      });
      const { previewToken } = createRecruiterEmailPreview(draft);

      vi.setSystemTime(new Date("2026-01-01T00:02:00Z"));
      expect(consumeRecruiterEmailPreview(previewToken)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
