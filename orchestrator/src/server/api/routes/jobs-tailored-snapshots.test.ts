import type { Server } from "node:http";
import type { TailoredResumeSnapshot } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

const mocks = vi.hoisted(() => ({
  approveSnapshot: vi.fn(),
  getLatestApprovedForJob: vi.fn(),
  listForJob: vi.fn(),
  restoreSnapshot: vi.fn(),
  saveSnapshotEdit: vi.fn(),
}));

vi.mock("@server/services/tailored-resume", () => ({
  approveSnapshot: mocks.approveSnapshot,
  restoreSnapshot: mocks.restoreSnapshot,
  saveSnapshotEdit: mocks.saveSnapshotEdit,
}));

vi.mock("@server/repositories/tailored-resumes", () => ({
  getLatestApprovedForJob: mocks.getLatestApprovedForJob,
  listForJob: mocks.listForJob,
}));

const AUTH_ENV = {
  BASIC_AUTH_USER: "admin",
  BASIC_AUTH_PASSWORD: "secret",
  JWT_SECRET: "an-explicit-jwt-secret-with-at-least-32-chars",
  JOBOPS_TEST_AUTH_BYPASS: "0",
};

const RESUME_JSON = { basics: { name: "Ada" } };

function makeSnapshot(version: number): TailoredResumeSnapshot {
  return {
    id: `snap_${version}`,
    jobId: "job_1",
    version,
    status: "approved",
    origin: "approved",
    resumeJson: RESUME_JSON,
    changes: [],
    ats: null,
    model: null,
    baseResumeDocumentId: null,
    baseResumeRevision: null,
    generatedAt: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as TailoredResumeSnapshot;
}

const SNAPSHOT_V1 = makeSnapshot(1);
const SNAPSHOT_V2 = makeSnapshot(2);

describe.sequential("tailored snapshot API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer({
      env: AUTH_ENV,
    }));
    mocks.approveSnapshot.mockReset();
    mocks.getLatestApprovedForJob.mockReset();
    mocks.listForJob.mockReset();
    mocks.restoreSnapshot.mockReset();
    mocks.saveSnapshotEdit.mockReset();

    mocks.approveSnapshot.mockResolvedValue(SNAPSHOT_V1);
    mocks.getLatestApprovedForJob.mockResolvedValue(SNAPSHOT_V1);
    mocks.listForJob.mockResolvedValue([SNAPSHOT_V1, SNAPSHOT_V2]);
    mocks.restoreSnapshot.mockResolvedValue(SNAPSHOT_V2);
    mocks.saveSnapshotEdit.mockResolvedValue(SNAPSHOT_V2);
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

  async function expectCrossTenantNotFound(
    token: string,
    jobId: string,
    path: string,
    method: "GET" | "POST" | "PATCH",
    body?: unknown,
  ): Promise<void> {
    const res = await fetch(`${baseUrl}/api/jobs/${jobId}${path}`, {
      method,
      headers: authHeaders(token),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = (await res.json()) as {
      ok?: boolean;
      error?: { code?: string };
    };
    expect(res.status).toBe(404);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("NOT_FOUND");
  }

  it("approves a snapshot with the standard contract and echoes x-request-id", async () => {
    const token = await login("admin", "secret");
    const jobId = await createJob(token, "Java engineer");

    const res = await fetch(
      `${baseUrl}/api/jobs/${jobId}/tailored-snapshots/approve`,
      {
        method: "POST",
        headers: authHeaders(token, { "x-request-id": "snapshot-req-1" }),
      },
    );
    const body = (await res.json()) as {
      ok?: boolean;
      data?: TailoredResumeSnapshot;
      error?: { code?: string };
      meta?: { requestId?: string };
    };

    expect(res.status).toBe(201);
    expect(res.headers.get("x-request-id")).toBe("snapshot-req-1");
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(SNAPSHOT_V1);
    expect(body.meta?.requestId).toBe("snapshot-req-1");
    expect(mocks.approveSnapshot).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({ requestOrigin: expect.any(String) }),
    );
  });

  it("returns the current snapshot and the snapshot list", async () => {
    const token = await login("admin", "secret");
    const jobId = await createJob(token, "Java engineer");

    const currentRes = await fetch(
      `${baseUrl}/api/jobs/${jobId}/tailored-snapshots/current`,
      { headers: authHeaders(token) },
    );
    const currentBody = (await currentRes.json()) as {
      ok?: boolean;
      data?: TailoredResumeSnapshot;
    };
    expect(currentRes.status).toBe(200);
    expect(currentBody.ok).toBe(true);
    expect(currentBody.data).toEqual(SNAPSHOT_V1);
    expect(mocks.getLatestApprovedForJob).toHaveBeenCalledWith(jobId);

    const listRes = await fetch(
      `${baseUrl}/api/jobs/${jobId}/tailored-snapshots`,
      { headers: authHeaders(token) },
    );
    const listBody = (await listRes.json()) as {
      ok?: boolean;
      data?: TailoredResumeSnapshot[];
    };
    expect(listRes.status).toBe(200);
    expect(listBody.ok).toBe(true);
    expect(listBody.data).toEqual([SNAPSHOT_V1, SNAPSHOT_V2]);
    expect(mocks.listForJob).toHaveBeenCalledWith(jobId, 10);
  });

  it("rejects an invalid resumeJson payload with 400 INVALID_REQUEST", async () => {
    const token = await login("admin", "secret");
    const jobId = await createJob(token, "Java engineer");

    const res = await fetch(
      `${baseUrl}/api/jobs/${jobId}/tailored-snapshots/snap_1`,
      {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ resumeJson: "not-an-object" }),
      },
    );
    const body = (await res.json()) as {
      ok?: boolean;
      error?: { code?: string };
    };

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("INVALID_REQUEST");
    expect(mocks.saveSnapshotEdit).not.toHaveBeenCalled();
  });

  it("saves an edit and restores a snapshot, returning the new snapshot", async () => {
    const token = await login("admin", "secret");
    const jobId = await createJob(token, "Java engineer");

    const patchRes = await fetch(
      `${baseUrl}/api/jobs/${jobId}/tailored-snapshots/snap_1`,
      {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ resumeJson: RESUME_JSON }),
      },
    );
    const patchBody = (await patchRes.json()) as {
      ok?: boolean;
      data?: TailoredResumeSnapshot;
    };
    expect(patchRes.status).toBe(200);
    expect(patchBody.ok).toBe(true);
    expect(patchBody.data).toEqual(SNAPSHOT_V2);
    expect(mocks.saveSnapshotEdit).toHaveBeenCalledWith(
      jobId,
      "snap_1",
      RESUME_JSON,
    );

    const restoreRes = await fetch(
      `${baseUrl}/api/jobs/${jobId}/tailored-snapshots/snap_1/restore`,
      {
        method: "POST",
        headers: authHeaders(token),
      },
    );
    const restoreBody = (await restoreRes.json()) as {
      ok?: boolean;
      data?: TailoredResumeSnapshot;
    };
    expect(restoreRes.status).toBe(201);
    expect(restoreBody.ok).toBe(true);
    expect(restoreBody.data).toEqual(SNAPSHOT_V2);
    expect(mocks.restoreSnapshot).toHaveBeenCalledWith(jobId, "snap_1");
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
      `${baseUrl}/api/jobs/${jobId}/tailored-snapshots/approve`,
      {
        method: "POST",
        headers: authHeaders(token),
      },
    );
    const body = (await res.json()) as {
      ok?: boolean;
      error?: { code?: string };
    };

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("INVALID_REQUEST");
    expect(mocks.approveSnapshot).not.toHaveBeenCalled();
  });

  it("returns 404 NOT_FOUND for cross-tenant reads and mutations", async () => {
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

    await expectCrossTenantNotFound(
      bobToken,
      adminJobId,
      "/tailored-snapshots/current",
      "GET",
    );
    await expectCrossTenantNotFound(
      bobToken,
      adminJobId,
      "/tailored-snapshots",
      "GET",
    );
    await expectCrossTenantNotFound(
      bobToken,
      adminJobId,
      "/tailored-snapshots/approve",
      "POST",
    );
    await expectCrossTenantNotFound(
      bobToken,
      adminJobId,
      "/tailored-snapshots/snap_1",
      "PATCH",
      { resumeJson: RESUME_JSON },
    );
    await expectCrossTenantNotFound(
      bobToken,
      adminJobId,
      "/tailored-snapshots/snap_1/restore",
      "POST",
    );

    const bobJobId = await createJob(bobToken, "Java engineer");
    await expectCrossTenantNotFound(
      adminToken,
      bobJobId,
      "/tailored-snapshots/current",
      "GET",
    );

    expect(mocks.approveSnapshot).not.toHaveBeenCalled();
    expect(mocks.saveSnapshotEdit).not.toHaveBeenCalled();
    expect(mocks.restoreSnapshot).not.toHaveBeenCalled();
    expect(mocks.getLatestApprovedForJob).not.toHaveBeenCalled();
    expect(mocks.listForJob).not.toHaveBeenCalled();
  });
});
