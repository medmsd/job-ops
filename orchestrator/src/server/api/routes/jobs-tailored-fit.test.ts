import type { Server } from "node:http";
import type { Job, TailoredResumeSnapshot } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

const mocks = vi.hoisted(() => ({
  callJson: vi.fn(),
  resolveLlmModel: vi.fn(),
  createConfiguredLlmService: vi.fn(),
  getLatestApprovedForJob: vi.fn(),
  withHostedUsageReservation: vi.fn(),
}));

vi.mock("@server/services/modelSelection", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@server/services/modelSelection")>();
  return {
    ...actual,
    resolveLlmModel: mocks.resolveLlmModel,
    createConfiguredLlmService: mocks.createConfiguredLlmService,
  };
});

vi.mock("@server/services/hosted-usage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@server/services/hosted-usage")>();
  return {
    ...actual,
    withHostedUsageReservation: mocks.withHostedUsageReservation,
  };
});

vi.mock("@server/repositories/tailored-resumes", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@server/repositories/tailored-resumes")
    >();
  return {
    ...actual,
    getLatestApprovedForJob: mocks.getLatestApprovedForJob,
  };
});

const AUTH_ENV = {
  BASIC_AUTH_USER: "admin",
  BASIC_AUTH_PASSWORD: "secret",
  JWT_SECRET: "an-explicit-jwt-secret-with-at-least-32-chars",
  JOBOPS_TEST_AUTH_BYPASS: "0",
};

const SNAPSHOT = {
  id: "snap_fit_1",
  jobId: "job_1",
  version: 1,
  status: "approved",
  resumeJson: {},
} as unknown as TailoredResumeSnapshot;

const LLM_RESULT = {
  score: 88,
  summary: "Strong fit",
  notes: [
    {
      requirement: "Java",
      status: "covered",
      explanation: "Java experience is shown",
      evidenceRefs: [],
    },
  ],
};

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: { code?: string; message?: string };
  meta?: { requestId?: string };
};

describe.sequential("tailored-fit API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer({
      env: AUTH_ENV,
    }));
    mocks.callJson.mockReset();
    mocks.resolveLlmModel.mockReset();
    mocks.createConfiguredLlmService.mockReset();
    mocks.getLatestApprovedForJob.mockReset();
    mocks.withHostedUsageReservation.mockReset();

    mocks.resolveLlmModel.mockReturnValue("test-model");
    mocks.createConfiguredLlmService.mockReturnValue({
      callJson: mocks.callJson,
      getProvider: () => "test-provider",
    });
    mocks.callJson.mockResolvedValue({ success: true, data: LLM_RESULT });
    mocks.getLatestApprovedForJob.mockResolvedValue(SNAPSHOT);
    mocks.withHostedUsageReservation.mockImplementation(
      async (
        _args: unknown,
        work: () => Promise<{ result: Job; usedUnits: number }>,
      ) => (await work()).result,
    );
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  async function login(username: string, password: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiEnvelope<{ token: string }>;
    return body.data?.token ?? "";
  }

  function authHeaders(token: string, extra: Record<string, string> = {}) {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  async function createJob(
    token: string,
    description: string,
  ): Promise<string> {
    const res = await fetch(`${baseUrl}/api/manual-jobs/import`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        job: {
          title: "Backend Engineer",
          employer: "Acme",
          jobUrl: "https://example.com/jobs/backend-engineer",
          jobDescription: description,
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiEnvelope<{ id: string }>;
    return body.data?.id ?? "";
  }

  async function setSourceScore(token: string, jobId: string): Promise<void> {
    const res = await fetch(`${baseUrl}/api/jobs/${jobId}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ suitabilityScore: 42 }),
    });
    expect(res.status).toBe(200);
  }

  it("returns the standard contract and echoes x-request-id on GET and POST", async () => {
    const token = await login("admin", "secret");
    const jobId = await createJob(token, "Java engineer");
    await setSourceScore(token, jobId);

    const getRes = await fetch(`${baseUrl}/api/jobs/${jobId}/tailored-fit`, {
      headers: authHeaders(token, { "x-request-id": "fit-req-get" }),
    });
    const getBody = (await getRes.json()) as ApiEnvelope<{
      result: null;
      isStale: boolean;
      reason: string | null;
    }>;

    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("x-request-id")).toBe("fit-req-get");
    expect(getBody.ok).toBe(true);
    expect(getBody.data).toEqual({
      result: null,
      isStale: false,
      reason: "not_checked",
    });
    expect(getBody.meta?.requestId).toBe("fit-req-get");

    const postRes = await fetch(`${baseUrl}/api/jobs/${jobId}/tailored-fit`, {
      method: "POST",
      headers: authHeaders(token, { "x-request-id": "fit-req-post" }),
    });
    const postBody = (await postRes.json()) as ApiEnvelope<Job>;

    expect(postRes.status).toBe(200);
    expect(postRes.headers.get("x-request-id")).toBe("fit-req-post");
    expect(postBody.ok).toBe(true);
    expect(postBody.meta?.requestId).toBe("fit-req-post");
    expect(postBody.data?.tailoredFitScore).toBe(88);
    expect(postBody.data?.suitabilityScore).toBe(42);
    expect(mocks.getLatestApprovedForJob).toHaveBeenCalledWith(jobId);
  });

  it("GET is deterministic and never invokes the LLM", async () => {
    const token = await login("admin", "secret");
    const jobId = await createJob(token, "Java engineer");

    const first = await fetch(`${baseUrl}/api/jobs/${jobId}/tailored-fit`, {
      headers: authHeaders(token),
    });
    const second = await fetch(`${baseUrl}/api/jobs/${jobId}/tailored-fit`, {
      headers: authHeaders(token),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = (await first.json()) as ApiEnvelope<unknown>;
    const secondBody = (await second.json()) as ApiEnvelope<unknown>;
    expect(firstBody.data).toEqual(secondBody.data);
    expect(mocks.callJson).not.toHaveBeenCalled();
  });

  it("POST calls the LLM exactly once and preserves the source score", async () => {
    const token = await login("admin", "secret");
    const jobId = await createJob(token, "Java engineer");
    await setSourceScore(token, jobId);

    const res = await fetch(`${baseUrl}/api/jobs/${jobId}/tailored-fit`, {
      method: "POST",
      headers: authHeaders(token),
    });
    const body = (await res.json()) as ApiEnvelope<Job>;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mocks.callJson).toHaveBeenCalledTimes(1);
    expect(body.data?.tailoredFitScore).toBe(88);
    expect(body.data?.tailoredFitNotes).toEqual([
      {
        requirement: "Java",
        status: "unsupported",
        explanation: "Java experience is shown",
        evidenceRefs: [],
      },
    ]);
    expect(body.data?.suitabilityScore).toBe(42);
    expect(body.data?.pdfFreshness).toBeTruthy();
  });

  it("returns 400 INVALID_REQUEST when the job has no description", async () => {
    const token = await login("admin", "secret");
    const jobId = await createJob(token, "Java engineer");

    const patch = await fetch(`${baseUrl}/api/jobs/${jobId}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ jobDescription: "" }),
    });
    expect(patch.status).toBe(200);

    const res = await fetch(`${baseUrl}/api/jobs/${jobId}/tailored-fit`, {
      method: "POST",
      headers: authHeaders(token),
    });
    const body = (await res.json()) as ApiEnvelope<never>;

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("INVALID_REQUEST");
    expect(body.error?.message).toContain("Add a job description");
    expect(mocks.callJson).not.toHaveBeenCalled();
  });

  it("maps a missing approved snapshot to a clear INVALID_REQUEST error", async () => {
    const token = await login("admin", "secret");
    const jobId = await createJob(token, "Java engineer");
    mocks.getLatestApprovedForJob.mockResolvedValue(null);

    const res = await fetch(`${baseUrl}/api/jobs/${jobId}/tailored-fit`, {
      method: "POST",
      headers: authHeaders(token, { "x-request-id": "fit-req-no-snapshot" }),
    });
    const body = (await res.json()) as ApiEnvelope<never>;

    expect(res.status).toBe(400);
    expect(res.headers.get("x-request-id")).toBe("fit-req-no-snapshot");
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("INVALID_REQUEST");
    expect(body.error?.message).toContain(
      "Approve a tailored resume before checking tailored fit.",
    );
    expect(body.meta?.requestId).toBe("fit-req-no-snapshot");
    expect(mocks.callJson).not.toHaveBeenCalled();
  });

  it("returns 404 NOT_FOUND for cross-tenant job IDs", async () => {
    const adminToken = await login("admin", "secret");
    const adminJobId = await createJob(adminToken, "Java engineer");

    const created = await fetch(`${baseUrl}/api/workspaces/users`, {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        username: "bob",
        displayName: "Bob",
        password: "bob-secret",
      }),
    });
    expect(created.status).toBe(201);
    const bobToken = await login("bob", "bob-secret");

    const getRes = await fetch(
      `${baseUrl}/api/jobs/${adminJobId}/tailored-fit`,
      { headers: authHeaders(bobToken) },
    );
    const getBody = (await getRes.json()) as ApiEnvelope<never>;
    expect(getRes.status).toBe(404);
    expect(getBody.ok).toBe(false);
    expect(getBody.error?.code).toBe("NOT_FOUND");

    const postRes = await fetch(
      `${baseUrl}/api/jobs/${adminJobId}/tailored-fit`,
      { method: "POST", headers: authHeaders(bobToken) },
    );
    const postBody = (await postRes.json()) as ApiEnvelope<never>;
    expect(postRes.status).toBe(404);
    expect(postBody.ok).toBe(false);
    expect(postBody.error?.code).toBe("NOT_FOUND");
    expect(mocks.getLatestApprovedForJob).not.toHaveBeenCalled();
    expect(mocks.callJson).not.toHaveBeenCalled();
  });
});
