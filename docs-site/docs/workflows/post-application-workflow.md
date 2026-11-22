---
id: post-application-workflow
title: Post-Application Workflow
description: Track post-application progress manually, configure automatic Gmail or Outlook syncing, and email a recruiter after tailoring.
sidebar_position: 2
---

## Goal

After a job is marked `applied`, use this workflow to track what happens next.

You have three valid paths:

- **Manual tracking**: update stages/events yourself.
- **Automatic email sync**: let Gmail or Microsoft Graph ingestion route events into inbox/review flow.
- **Recruiter email**: after tailoring a resume, preview and send an application email with the tailored PDF attached.

## Option A: Manual event tracking

Use this when you want explicit, hands-on control for each job.

### Manual flow

1. Open an `applied` or `in_progress` job.
2. Record stage progress as events (screening, interview, offer, closed, etc.).
3. Keep notes/outcomes current as conversations progress.
4. Use In Progress Board for high-attention jobs in later stages.

### API example (manual stage transition)

```bash
curl -X POST "http://localhost:3001/api/jobs/<jobId>/stages" \
  -H "content-type: application/json" \
  -d '{
    "toStage": "technical_interview",
    "metadata": {
      "actor": "user",
      "eventType": "status_update",
      "eventLabel": "Moved to Technical Interview"
    }
  }'
```

## Option B: Automatic Gmail syncing

Use this when you want JobOps to ingest recruitment emails and suggest/apply updates.

### High-level flow

1. Connect Gmail provider.
2. Run sync (or scheduled sync, depending on setup).
3. Smart router scores message-to-job match.
4. High confidence updates are auto-linked.
5. Mid/low confidence items go to inbox for review.

### Configure Gmail sync

Set OAuth variables:

```bash
GMAIL_OAUTH_CLIENT_ID=...
GMAIL_OAUTH_CLIENT_SECRET=...
GMAIL_OAUTH_REDIRECT_URI=https://your-domain.com/oauth/gmail/callback
```

For exact Google Cloud steps and scope requirements, see:

- [Gmail OAuth Setup](/docs/next/getting-started/gmail-oauth-setup)

Outlook uses Microsoft Graph instead. Set `GRAPH_OAUTH_CLIENT_ID`, `GRAPH_OAUTH_CLIENT_SECRET`, and optionally `GRAPH_OAUTH_TENANT_ID` (defaults to `common`) and `GRAPH_OAUTH_REDIRECT_URI`, then select provider `Microsoft Graph` and click **Connect**. See [Microsoft Graph OAuth Setup](/docs/next/getting-started/microsoft-graph-oauth-setup).

Then in app:

1. Open Tracking Inbox / provider controls.
2. Start Gmail OAuth.
3. Complete consent.
4. Trigger sync and review inbox items.

### API examples (Gmail path)

```bash
# Start OAuth
curl "http://localhost:3001/api/post-application/providers/gmail/oauth/start?accountKey=default"
```

```bash
# Exchange authorization code
curl -X POST "http://localhost:3001/api/post-application/providers/gmail/oauth/exchange" \
  -H "content-type: application/json" \
  -d '{"accountKey":"default","state":"<state>","code":"<code>"}'
```

```bash
# Trigger provider sync action
curl -X POST "http://localhost:3001/api/post-application/providers/gmail/actions/sync" \
  -H "content-type: application/json" \
  -d '{"accountKey":"default","maxMessages":100,"searchDays":30}'
```

```bash
# Review inbox
curl "http://localhost:3001/api/post-application/inbox?provider=gmail&accountKey=default"
```

```bash
# Approve inbox item
curl -X POST "http://localhost:3001/api/post-application/inbox/<messageId>/approve" \
  -H "content-type: application/json" \
  -d '{"provider":"gmail","accountKey":"default"}'
```

```bash
# Deny inbox item
curl -X POST "http://localhost:3001/api/post-application/inbox/<messageId>/deny" \
  -H "content-type: application/json" \
  -d '{"provider":"gmail","accountKey":"default"}'
```

## Option C: Email the recruiter after tailoring

Use this when a tracked recruitment email has been matched to a job and you want to reply with your tailored resume. This path uses Microsoft Graph (Outlook) only; it does not use Gmail.

### Prerequisites

1. **Microsoft Graph is connected** with delegated `Mail.Send` granted and consented. See [Microsoft Graph OAuth Setup](/docs/next/getting-started/microsoft-graph-oauth-setup).
2. **A recipient can be resolved**: either a recruitment email tracked and matched to the job in the Tracking Inbox (its `From` address is used), or a valid address in the job's `emails` field or job description. Addresses taken from job details are labelled in the preview so you can verify them.
3. **A tailored PDF exists** for the job. If the resume has not been tailored and generated, the **Apply now** / **Email recruiter** action is unavailable.

### Preview and confirm flow

1. Open the job, select the **Apply** tab, and click **Apply now** (or use **Email recruiter** in **More actions**).
2. JobOps generates a cover letter from the job details and tailored resume, then shows a preview with the recipient, subject, editable cover letter, message, and attached PDF. Use **Preview PDF** to inspect the CV in a popup on the current page.
3. Edit the recipient (single address only), subject, cover letter, and message as needed. Editing the cover letter updates the message automatically.
4. Check the confirmation box and click **Send email**. If the recipient was pre-filled from job details, verify it first — job-post text is untrusted.

Nothing is sent at the preview step. Sending requires the explicit confirmation checkbox. There is no auto-send, bulk send, scheduled send, or hidden BCC. The preview token is short-lived (10 minutes by default), single-use, and scoped to the signed-in user and workspace.

### API example

```bash
# 1. Preview (no email is sent)
curl -X POST "http://localhost:3001/api/jobs/<jobId>/email/preview" \
  -H "content-type: application/json" \
  -d '{"messageId":"<matchedMessageId>"}'

# 2. Confirm and send with the returned previewToken
curl -X POST "http://localhost:3001/api/jobs/<jobId>/email/send" \
  -H "content-type: application/json" \
  -d '{"previewToken":"<previewToken>","to":"recruiter@example.com","subject":"Application","body":"..."}'
```

The attachment is the tailored PDF JobOps already generated for that job. Files larger than 4 MB are rejected before a preview is created.

## Which option should you use?

- Choose **manual** if your volume is low and you want direct control.
- Choose **automatic sync** if your volume is higher and you want less repetitive triage.
- Choose **recruiter email** when you want to respond to a matched recruitment email with your tailored resume, with full preview control.
- Many users combine all three: auto-sync first, manual adjustments for edge cases, then email the recruiter after tailoring.

## Common problems

### Gmail connected but no messages appear

- Verify OAuth credentials and redirect URI.
- Confirm you are syncing the intended account key.
- Check search window (`searchDays`) and message cap (`maxMessages`).

### Wrong job matched

- Expected in lower-confidence buckets.
- Deny incorrect inbox items and apply manual stage updates where needed.

### I prefer not to grant Gmail access

- Use the manual tracking path only.
- The post-application workflow still works without Gmail integration.

### Email recruiter points to the wrong address

The recipient defaults to the `From` address of the matched tracked email. Edit the **To** field in the preview before confirming. Only one plain email address is accepted; display names and address lists are rejected.

### Sending fails with a Mail.Send permission message

The Graph connection was authorized before `Mail.Send` was added. Disconnect and reconnect Microsoft Graph, approve the permission on the consent screen, then retry. See [Re-consent after adding Mail.Send](/docs/next/getting-started/microsoft-graph-oauth-setup#re-consent-after-adding-mailsend).

## Related pages

- [Find Jobs and Apply Workflow](./find-jobs-and-apply-workflow)
- [Post-Application Tracking](../features/post-application-tracking)
- [In Progress Board](../features/in-progress-board)
- [Overview](../features/overview)
