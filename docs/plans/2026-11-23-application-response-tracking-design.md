# Application Response Tracking Design — Automatic Inbox Sync with Review-First Updates

Date: 2026-11-23
Status: Approved (plan A; background AI allowed for this feature only)
Parent plan: `docs/plans/2026-11-22-tailoring-v2-plan.md` (Phase 4 task 3, feedback loop)
Related: `docs/plans/2026-11-22-job-page-apply-button-design.md`

## What it is

An extension of the existing **Tracking Inbox** that automatically reads the connected Outlook (Microsoft Graph) mailbox for responses to job applications, classifies them, matches them to the right job, and proposes a status change for the user to approve.

## Why it exists

Today, application responses (for example a rejection received today) require a manual check of the mailbox and a manual job status update. The Tracking Inbox already has the hard parts: Graph OAuth, mail ingestion, an LLM router that classifies relevance and stage target, job matching, and a review → apply path that writes status through `transitionStage()`. What is missing:

1. Sync only runs when the user presses **Sync**; there is no scheduler.
2. The existing high-confidence path (`>= 95`) auto-applies a stage transition, which conflicts with the review-first decision for this feature.
3. Emails sent by the app do not persist the Graph message/thread ID, so replies to those applications cannot be matched by thread.
4. The job page does not surface pending responses, so the user has to remember to visit the Tracking Inbox.

## Scope

In scope:

1. A tenant/workspace-aware background sync scheduler for connected mail integrations.
2. Review-first handling of every detected application outcome (no silent job status change).
3. Persistence of Graph send/thread identifiers so replies to app-sent applications match reliably.
4. A pending-response indicator on the job page that links to the filtered Tracking Inbox.
5. Tests and user-facing docs.

Out of scope:

- Any change to source suitability scoring, Rescore, or tailoring.
- Automatic sending, bulk sending, hidden BCC, or extra attachments.
- Implementing the IMAP adapter (still a stub). Auto-sync covers the functional Gmail and Graph providers.
- New LLM classification logic; reuse the existing smart router.
- Automatic job status changes without explicit approval.
- Changing the review-first recruiter email send flow.

## Decisions (approved)

1. **Provider:** use the already-connected mailbox. For this user that is Microsoft Graph (Outlook). Gmail is supported automatically because it uses the same ingestion/review pipeline.
2. **Background AI exception:** the project rule "AI only on explicit user actions" is overridden **for this feature only**. The scheduler may fetch and classify new mail without a click. Job *changes* still require explicit approval. All other flows keep the original rule.
3. **Review-first:** ingestion sets `processingStatus: "pending_user"` for every relevant message, including high-confidence matches. The existing `approvePostApplicationInboxItem()` path is the only writer of job status for responses.
4. **Schedule:** every 30 minutes, starting at server boot. Fixed interval for v1 (no new setting). The window is the last 7 days with at most 50 messages per account per run; these are constants in the scheduler.
5. **Tenancy:** a dedicated scheduler-scoped repository method enumerates connected integrations globally, but each sync runs inside `runWithRequestContext()` with that row's `tenantId`, `userId`, and a generated request ID. All existing repositories then apply their normal private-data scope. Cross-tenant isolation is a required test.
6. **Locking:** an in-memory lock keyed by `(tenantId, provider, accountKey)` prevents overlapping syncs. A per-account failure is logged with structured context and never aborts other accounts.
7. **Idempotency:** the existing `externalMessageId` unique index and terminal-status protection in `upsertPostApplicationMessage()` are the source of truth. Repeated runs must not create duplicate messages or duplicate stage events.
8. **Thread provenance:** `sendGraphMail()` is changed to create the message as a draft and then send it, so the Graph `id` and `internetMessageId` are known. These are stored in two new nullable columns on `post_application_sent_emails`. Sync matches by `conversationId`/`internetMessageId` first; otherwise it falls back to the existing router. Thread matches are still `pending_user`.
9. **Mixed apply methods:** external applications continue to rely on sender domain, subject, job title/company, and the LLM router. No assumption is made that every application was sent through the app.
10. **LLM cost control:** only messages that are new (created by this run) are classified. Existing messages are never reclassified by the scheduler.

## Data model

Add to `post_application_sent_emails`:

| Column | Type | Notes |
| --- | --- | --- |
| `graph_message_id` | `TEXT` | Graph message `id` returned when the draft is created; nullable for legacy rows and non-Graph providers |
| `internet_message_id` | `TEXT` | RFC 5322 `internetMessageId`, used to match `In-Reply-To`/`References` and Graph thread replies |

No new table is required. Pending responses already live in `post_application_messages` with `processingStatus: "pending_user"`.

## Components

### Scheduler (`orchestrator/src/server/services/post-application/response-sync-scheduler.ts`)

- `startResponseSyncScheduler()` / `stopResponseSyncScheduler()`.
- Uses `setInterval` with `RESPONSE_SYNC_INTERVAL_MS = 30 * 60 * 1000`, plus an immediate run at boot guarded so it does not delay startup.
- `listConnectedPostApplicationIntegrationsForScheduler()` in `post-application-integrations.ts` returns the minimal scope tuple (tenantId, userId, provider, accountKey) for rows with `status: "connected"`.
- For each tuple, runs `runWithRequestContext()` then the existing provider sync action with bounded options.
- Tracks in-flight keys in a `Set`; clears in `finally`.
- Logs via `infra/logger.ts`: `{ requestId, tenantId, provider, accountKey, messagesDiscovered, messagesClassified, durationMs, status }`. Never logs raw message bodies, subjects, or addresses.

### Review-first ingestion change

- In `gmail-sync.ts` and `graph-sync.ts`, remove the `auto_linked` branch from `resolveProcessingStatus()`. Relevant matches and relevant orphans both become `pending_user`.
- Leave `ignored` for irrelevant messages unchanged.
- Existing manual approval and denial logic stays as-is, including `reasonCode` provenance.

### Thread provenance change

- `sendGraphMail()` returns `{ id, internetMessageId }` after `POST /me/messages` followed by `POST /me/messages/{id}/send`.
- `sendRecruiterEmail()` persists both values to the sent-email row via a repository update.
- In Graph ingestion, before classification, look up a sent-email row by `internetMessageId` or conversation/thread identifier. On a hit, set the suggested job and a `thread_match` reason without an LLM call, but still `pending_user`.

### Job page indicator

- In `JobEmailsPanel.tsx` (or the Apply tab where that panel is rendered), show a small badge with the count of `pending_user` messages for the current job and a link to `/tracking-inbox?jobId=<id>`.
- Tracking Inbox honors the `jobId` query parameter as an initial filter. Read-only; no status change from the link itself.

## Data flow

1. Scheduler tick → enumerate connected integrations.
2. Per account: set request context → fetch recent mail → upsert new messages only.
3. For each new relevant message: try thread match; otherwise run the existing smart router.
4. Store classification, proposed job, and `pending_user` status. No job row is written.
5. User opens Tracking Inbox (or follows the job-page badge) → reviews proposal → approves.
6. `approvePostApplicationInboxItem()` calls `transitionStage()` → job status/outcome changes with `reasonCode: "post_application_manual_linked"`.

## Error handling and privacy

- A failed account sync increments/updates `post_application_sync_runs` with `errorCode`/`errorMessage` and logs a sanitized error. Other accounts continue.
- Upstream Graph/Gmail response bodies are never thrown or logged.
- LLM prompts continue to send only minimal job fields and truncated email text, per the existing router.
- No raw email content is returned in error `details`.
- All new API responses (if any) follow `{ ok, data/error, meta.requestId }`.

## Testing strategy

- Scheduler: tenant enumeration, context propagation, per-account isolation, overlapping-run lock, idempotent repeat run, constants respected.
- Ingestion: all relevant outcomes are `pending_user`; irrelevant messages remain `ignored`; no `transitionStage()` call during ingestion.
- Thread provenance: send persists IDs; sync resolves by thread without LLM; legacy rows fall back to router.
- Repository migration: legacy `post_application_sent_emails` rows gain nullable columns.
- Job page badge and Tracking Inbox filter, using the existing Vitest + Testing Library conventions.
- Cross-tenant regression: two workspaces with connected accounts must not see or mutate each other's messages/jobs.

## Verification

1. Targeted tests for touched modules.
2. CI parity from `AGENTS.md`: touched-file Biome, type checks, client build, full `test:run`, docs build.
3. `graphify update .` and `npm run docker:rebuild:kiri`.
4. Live check: confirm scheduler starts, a connected account syncs without a manual click, detected responses appear as pending, approving one changes the job status, and no job changed without approval. Restore any test data.
5. Push only to `fork/main`; leave `origin/main` untouched.
