import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

const { generateTailoringPlan } = vi.hoisted(() => ({
  generateTailoringPlan: vi.fn(),
}));

vi.mock("@server/services/tailoring-plan", () => ({ generateTailoringPlan }));

const AUTH_ENV = {
  BASIC_AUTH_USER: "admin",
  BASIC_AUTH_PASSWORD: "secret",
  JWT_SECRET: "an-explicit-jwt-secret-with-at-least-32-chars",
  JOBOPS_TEST_AUTH_BYPASS: "0",
};

const PLAN_RESULT = {
  items: [
    {
      jdRequirement: "Java",
      evidenceRefs: ["project:payments-platform"],
      proposedWording: "Java services",
      targetField: "summary",
      supportLevel: "strong",
      status: "ready",
      userDecision: "pending",
    },
  ],
  check: {
    blocked: [],
    unsupported: ["graphql"],
    covered: ["java"],
    missingEvidenceRefs: [],
  },
};

describe.sequential("POST /api/jobs/:id/tailoring-plan", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer({
      env: AUTH_ENV,
    }));
    generateTailoringPlan.mockReset();
    generateTailoringPlan.mockResolvedValue({
      success: true,
      data: PLAN_RESULT,
    });
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
    const body = (await res.json()) as { data: { token: string } };
    return body.data.token;
  }

  function authHeaders(token: string, extra: Record<string, string> = {}) {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  async function createJob(token: string, description: string): Promise<string> {
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
    const body = (await res.json()) as { ok: boolean; data: { id: string } };
    return body.data.id;
  }

  it("returns the standard contract and honors x-request-id", async () => {
    const token = await login("admin", "secret");
    const jobId = await createJob(token, "Java engineer");

    const res = await fetch(
      `${baseUrl}/api/jobs/${jobId}/tailoring-plan`,
      {
        method: "POST",
        headers: authHeaders(token, { "x-request-id": "evidence-req-1" }),
        body: JSON.stringify({ text: "Java services" }),
      },
    );
    const body = (await res.json()) as {
      ok: boolean;
      data?: typeof PLAN_RESULT;
      error?: { code?: string };
      meta?: { requestId?: string };
    };

    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("evidence-req-1");
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(PLAN_RESULT);
    expect(body.meta?.requestId).toBe("evidence-req-1");
    expect(generateTailoringPlan).toHaveBeenCalledWith(
      expect.objectContaining({ currentText: "Java services" }),
    );
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

    const res = await fetch(
      `${baseUrl}/api/jobs/${jobId}/tailoring-plan`,
      {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({}),
      },
    );
    const body = (await res.json()) as {
      ok?: boolean;
      error?: { code?: string };
    };

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("INVALID_REQUEST");
    expect(generateTailoringPlan).not.toHaveBeenCalled();
  });

  it("returns 404 for a job in another tenant", async () => {
    const adminToken = await login("admin", "secret");
    const jobId = await createJob(adminToken, "Java engineer");

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

    const res = await fetch(
      `${baseUrl}/api/jobs/${jobId}/tailoring-plan`,
      {
        method: "POST",
        headers: authHeaders(bobToken),
        body: JSON.stringify({}),
      },
    );

    expect(res.status).toBe(404);
    expect(generateTailoringPlan).not.toHaveBeenCalled();
  });
});
