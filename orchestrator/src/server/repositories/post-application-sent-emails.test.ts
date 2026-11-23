import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RequestContextModule = typeof import("@infra/request-context");

const scopeA = { requestId: "test-a", tenantId: "tenant-a", userId: "user-a" };
const scopeB = { requestId: "test-b", tenantId: "tenant-b", userId: "user-b" };

describe.sequential("post-application sent-email provenance", () => {
  let tempDir: string;
  let db: Awaited<typeof import("../db/index")>["db"];
  let schema: Awaited<typeof import("../db/index")>["schema"];
  let repo: Awaited<typeof import("./post-application-sent-emails")>;
  let runWithRequestContext: RequestContextModule["runWithRequestContext"];

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-sent-email-provenance-"));
    process.env.DATA_DIR = tempDir;
    process.env.NODE_ENV = "test";

    await import("../db/migrate");
    ({ db, schema } = await import("../db/index"));

    await db.insert(schema.tenants).values([
      { id: "tenant-a", name: "Tenant A", slug: "tenant-a" },
      { id: "tenant-b", name: "Tenant B", slug: "tenant-b" },
    ]);
    await db.insert(schema.users).values([
      { id: "user-a", username: "user-a" },
      { id: "user-b", username: "user-b" },
    ]);
    await db.insert(schema.jobs).values([
      {
        id: "job-a",
        tenantId: "tenant-a",
        source: "manual",
        title: "Engineer A",
        employer: "Acme A",
        jobUrl: "https://example.test/job-a",
      },
      {
        id: "job-b",
        tenantId: "tenant-b",
        source: "manual",
        title: "Engineer B",
        employer: "Acme B",
        jobUrl: "https://example.test/job-b",
      },
    ]);

    repo = await import("./post-application-sent-emails");
    ({ runWithRequestContext } = await import("@infra/request-context"));
  });

  afterEach(async () => {
    const { closeDb } = await import("../db/index");
    closeDb();
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("adds nullable legacy columns and scopes provenance reads and writes", async () => {
    const raw = new Database(join(tempDir, "jobs.db"));
    const columns = raw
      .prepare("PRAGMA table_info(post_application_sent_emails)")
      .all() as Array<{ name: string }>;
    raw.close();

    expect(columns.map((column) => column.name)).toContain("graph_message_id");
    expect(columns.map((column) => column.name)).toContain(
      "internet_message_id",
    );

    const a = await runWithRequestContext(scopeA, () =>
      repo.createPostApplicationSentEmail({
        jobId: "job-a",
        integrationId: null,
        provider: "graph",
        toAddress: "recruiter-a@example.com",
        subject: "Application A",
        messageId: "tracked-msg-a",
        status: "sent",
        sentAt: 1_700_000_000_000,
        graphMessageId: "graph-message-a",
        internetMessageId: "<message-a@example.com>",
      }),
    );
    const b = await runWithRequestContext(scopeB, () =>
      repo.createPostApplicationSentEmail({
        jobId: "job-b",
        integrationId: null,
        provider: "graph",
        toAddress: "recruiter-b@example.com",
        subject: "Application B",
        messageId: "tracked-msg-b",
        status: "sent",
        sentAt: 1_700_000_100_000,
        graphMessageId: "graph-message-a",
        internetMessageId: "<message-a@example.com>",
      }),
    );

    expect(a).toMatchObject({
      graphMessageId: "graph-message-a",
      internetMessageId: "<message-a@example.com>",
    });
    expect(b).toMatchObject({
      graphMessageId: "graph-message-a",
      internetMessageId: "<message-a@example.com>",
    });

    const updatedA = await runWithRequestContext(scopeA, () =>
      repo.updatePostApplicationSentEmailProvenance({
        id: a.id,
        graphMessageId: "graph-message-a-updated",
        internetMessageId: "<message-a-updated@example.com>",
      }),
    );
    expect(updatedA).toMatchObject({
      id: a.id,
      graphMessageId: "graph-message-a-updated",
      internetMessageId: "<message-a-updated@example.com>",
    });

    const blockedUpdate = await runWithRequestContext(scopeB, () =>
      repo.updatePostApplicationSentEmailProvenance({
        id: a.id,
        graphMessageId: "cross-tenant-write",
        internetMessageId: "<cross-tenant@example.com>",
      }),
    );
    expect(blockedUpdate).toBeNull();

    const threadA = await runWithRequestContext(scopeA, () =>
      repo.findPostApplicationSentEmailByThread({
        provider: "graph",
        internetMessageId: "<other@example.com>",
        inReplyTo: ["<message-a-updated@example.com>"],
        references: [],
        graphConversationId: null,
      }),
    );
    expect(threadA?.id).toBe(a.id);

    const threadB = await runWithRequestContext(scopeB, () =>
      repo.findPostApplicationSentEmailByThread({
        provider: "graph",
        internetMessageId: null,
        inReplyTo: ["<message-a@example.com>"],
        references: [],
        graphConversationId: null,
      }),
    );
    expect(threadB?.id).toBe(b.id);

    const unchangedB = await runWithRequestContext(scopeB, () =>
      repo.listPostApplicationSentEmailsForJob("job-b", 10),
    );
    expect(unchangedB[0]).toMatchObject({
      graphMessageId: "graph-message-a",
      internetMessageId: "<message-a@example.com>",
    });
  });
});
