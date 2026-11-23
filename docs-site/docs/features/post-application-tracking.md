---
id: post-application-tracking
title: Post-Application Tracking
description: Gmail and Outlook tracking inbox, smart routing, review workflow, and preview-and-confirm recruiter emails with a tailored resume attached.
sidebar_position: 3
---

## What it is

The Tracking Inbox monitors Gmail or Outlook (Microsoft Graph) for job-application responses and updates timelines. After a resume is tailored, it can also prepare an application email to a tracked recruiter for your review and explicit confirmation.

![Tracking Inbox review queue](/img/features/tracking-inbox.png)

### Overview

1. Scans connected Gmail or Microsoft Graph mailboxes every 30 minutes
2. Checks the last 7 days, up to 50 messages per account per run
3. Classifies only newly discovered messages and matches them to active jobs
4. Queues every relevant response as **Needs review** with a suggested job and stage
5. Changes job status only when you click **Approve** in the Tracking Inbox
6. Shows a pending-response badge on the job page that opens the filtered inbox
7. Prepares a recruiter email from the saved cover letter and tailored PDF, sent only after you confirm

## Why it exists

Application replies and recruiter outreach arrive by email, and manually copying every detail into the job timeline is repetitive. Matching feeds the review queue; your approvals keep the timeline current. The recruiter-email action closes the loop: once a resume is tailored, you can respond from the same job record with the correct PDF attached, without giving up control of what is sent.

## How to use it

### Smart router and review flow

```mermaid
flowchart TD
    A[Application response arrives in Gmail or Outlook] --> B[Smart Router or sent-message thread match]
    B --> C{Is it relevant?}
    C -->|No| D[Ignored]
    C -->|Yes| E[Stored as Needs review]
    E --> F[You review the suggested job and stage]
    F -->|Approve| G[Job timeline and status update]
    F -->|Ignore| H[Message marked ignored]
```

No job status changes without explicit approval, including 100% confidence matches. Rejections, interview invitations, offers, generic updates, and replies to emails sent by JobOps all follow the same review-first path.

### Setup

#### Prerequisites

1. Gmail account with application emails, or an Outlook mailbox to track via Microsoft Graph
2. Provider OAuth credentials (Google, or a Microsoft Entra app registration)

#### Configure OAuth

Microsoft Graph is the default provider. Register a Microsoft Entra app and set:

```bash
GRAPH_OAUTH_CLIENT_ID=your-application-client-id
GRAPH_OAUTH_CLIENT_SECRET=your-client-secret
GRAPH_OAUTH_TENANT_ID=common
GRAPH_OAUTH_REDIRECT_URI=https://your-domain.com/oauth/graph/callback
```

Then connect in UI via **Tracking Inbox → Connect**. The provider selector is preselected to `Microsoft Graph`.

To use Gmail instead, set `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, and `GMAIL_OAUTH_REDIRECT_URI`, select `Gmail` in the provider selector, then click **Connect**.

Detailed setup guides:

- [Gmail OAuth Setup](/docs/next/getting-started/gmail-oauth-setup)
- [Microsoft Graph OAuth Setup](/docs/next/getting-started/microsoft-graph-oauth-setup)

### Using the inbox

- Review pending items in Tracking Inbox
- Approve to link/update timeline
- Ignore to mark non-relevant

### Check the connection

Select a connected provider in **Tracking Inbox** and click **View last email**
next to **Sync**. JobOps reads the single newest message directly from the
mailbox and shows its sender, subject, received time, and preview. This proves
the stored OAuth credentials can still reach the account, independently of sync
results and classification.

The check is read-only: nothing is sent, moved, or deleted. An empty mailbox
shows "no messages". The diagnostic supports Gmail and Microsoft Graph; IMAP is
not supported.

### Job emails tab

Open **Job → Emails** to review captured messages already linked to that job.

When a job has pending responses, the tab header shows a **pending** badge. The badge links to `/tracking-inbox?jobId=<jobId>` and applies a read-only job filter; following the link never approves or changes a message.

The tab is read-only. It shows stored metadata only: sender, subject, received
time, snippet, processing status, message type, match confidence, account label,
and a Gmail thread link when the stored message includes a Gmail thread ID.

It does not store full email bodies, re-fetch from Gmail, or expose review
actions. Use **Tracking Inbox** for approve/ignore decisions.

Confidence interpretation:

- `95-100%`: strong suggestion, still **Needs review**
- `50-94%`: **Needs review** with suggestion
- `<50%` but relevant: **Needs review** as an orphan
- Irrelevant: **Ignored**

Confidence describes suggestion quality only. Approval is always required.

### Email a recruiter

On a job with a generated tailored PDF, open the **Apply** tab in the orchestrator and click **Apply now**, use **Email recruiter** in the **More actions** menu, or open the job details page (`/job/<jobId>`) and click **Apply now** in the sidebar. JobOps loads the saved cover letter, then shows a preview you can edit. Opening the preview never calls the AI; use **Cover letter** and **Generate** first if you want a new draft.

- **To**: defaults to the `From` address of a matched Tracking Inbox email. If no email is matched, JobOps uses the first valid address from the job's `emails` field and then its job description (including `mailto:` links, HTML entities such as `&#64;`, and `(at)` / `[dot]` obfuscation). If none is found, the field opens empty for you to type the address. The preview labels addresses taken from job details or entered manually so you can verify them. Editable, but only a single plain email address is accepted. No BCC is added.
- **Cover letter**: editable. Changing it updates the **Message** below automatically.
- **Subject** and **Message**: editable; the saved cover letter plus a short sign-off is the initial message and is sent as plain text. If no cover letter is saved, the letter field starts empty and you can type one in the preview.
- **Preview PDF**: opens the tailored PDF in a popup dialog on the current page.
- **Attachment**: the tailored PDF already generated for that job. Files over 4 MB are rejected.

Nothing is sent when the preview is generated. The send button stays disabled until you check the confirmation box and click **Send email**. Preview tokens expire after 10 minutes by default, are single-use, and are scoped to the signed-in user and workspace. Sending requires Microsoft Graph with delegated `Mail.Send` granted and consented; see [Microsoft Graph OAuth Setup](/docs/next/getting-started/microsoft-graph-oauth-setup).

For a job whose details could not be fetched, add the recruiter address to the job description before opening **Apply now**. JobOps pre-fills it, but job-post text is untrusted: always verify the **To** field before confirming. If no address is found in the Tracking Inbox, the job's `emails` field, or the description, the preview opens with an empty **To** field and a warning: type the recruiter's address yourself, then check the confirmation box and click **Send email**. The send button rejects blank, multi-recipient, or malformed addresses.

```bash
# Preview (no side effects)
curl -X POST "http://localhost:3001/api/jobs/<jobId>/email/preview" \
  -H "content-type: application/json" \
  -d '{"messageId":"<matchedMessageId>"}'

# Confirm and send
curl -X POST "http://localhost:3001/api/jobs/<jobId>/email/send" \
  -H "content-type: application/json" \
  -d '{"previewToken":"<previewToken>","to":"recruiter@example.com","subject":"Application","body":"..."}'
```

There is no auto-send, bulk send, or scheduled send in this version.

### Manual application documents

If the job post has no recruiter email, you can still use the generated materials:

- The **Download PDF** action saves the tailored CV as `Mohamed Mseddi Resume {CompanyName}.pdf` (for example, `Mohamed Mseddi Resume Dwareapps.pdf`). The same filename is used for the email attachment when applying through JobOps.
- The **Cover letter** button (Apply tab) and **Cover letter** button (job page sidebar) open a letter drafted from the job description and tailored resume. Opening the dialog only loads the saved copy; it never calls the AI. Click **Generate** (or **Regenerate**) to create a fresh draft. Review or edit the text, then click **Save** to persist your changes for that job. Choose **Download .txt** to save `Mohamed Mseddi Cover Letter {CompanyName}.txt` or **Download .pdf** to save `Mohamed Mseddi Cover Letter {CompanyName}.pdf`. Both downloads use the text currently in the editor and the same company name as the tailored CV. A saved letter is also reused by the recruiter-email preview, which opens it without calling the AI.

No email is required or sent when generating, saving, or downloading these files.

```bash
# Generate a cover letter only (no email is sent); the result is saved
curl -X POST "http://localhost:3001/api/jobs/<jobId>/cover-letter" \
  -H "content-type: application/json" \
  -d '{}'

# Save edited text without calling the AI
curl -X PUT "http://localhost:3001/api/jobs/<jobId>/cover-letter" \
  -H "content-type: application/json" \
  -d '{"coverLetter":"Dear hiring team, ..."}'
```

## Privacy and security

- Gmail scope requested: `gmail.readonly` (`https://www.googleapis.com/auth/gmail.readonly`)
- Microsoft Graph scopes: `openid`, `offline_access`, `User.Read`, `Mail.Read`, and `Mail.Send` (only for sending after confirmation)
- Minimal profile and job fields are sent to the LLM for matching and cover-letter generation
- Email data stays local in your instance
- Graph send creates a draft and then sends it so the Graph message ID and RFC 5322 `internetMessageId` can be stored for future reply matching; no BCC is added, and upstream error bodies are never logged or returned

## API reference

| Method | Endpoint                                  | Description           |
| ------ | ----------------------------------------- | --------------------- |
| GET    | `/api/post-application/inbox`             | List pending messages |
| POST   | `/api/post-application/inbox/:id/approve` | Approve message       |
| POST   | `/api/post-application/inbox/:id/deny`    | Ignore message        |
| GET    | `/api/post-application/runs`              | List sync runs        |
| POST   | `/api/post-application/providers/:provider/last-message` | Read newest message for connection testing |
| GET    | `/api/jobs/:id/emails?limit=100`          | List job-linked email metadata |
| GET    | `/api/post-application/providers/gmail/oauth/start` | Start OAuth flow |
| POST   | `/api/post-application/providers/gmail/oauth/exchange` | Exchange OAuth code |
| POST   | `/api/jobs/:id/email/preview`         | Preview a recruiter email (no send) |
| POST   | `/api/jobs/:id/email/send`            | Confirm and send a previewed email |
| POST   | `/api/jobs/:id/cover-letter`          | Generate and save a cover letter  |
| PUT    | `/api/jobs/:id/cover-letter`          | Save edited cover letter text     |

## Common problems

- No refresh token: disconnect and reconnect the provider.
- Emails not appearing: check runs, OAuth config, and recruitment subjects.
- Wrong matches: possible in any confidence bucket; confidence is only a suggestion, so review before approving.
- "Reconnect Microsoft Graph to grant Mail.Send permission": `Mail.Send` was added after the Graph connection was authorized; disconnect, reconnect, and approve the permission.
- "Apply now" / "Email recruiter" disabled: tailor and generate the PDF for that job first.
- Empty **To** field with "No recruiter address was found": type the address manually in the preview, or add it to the job description / link a tracked email for future prefill.
- Wrong recipient pre-filled from job details: edit the **To** field in the preview; only your explicit confirmation sends the email.
- Preview token expired or already used: open **Apply now** again to generate a fresh preview.
- Pending response not shown on the job page: open Tracking Inbox and confirm the item is still `Needs review`; already decided items do not appear in the pending badge.
- Reply to an application sent by JobOps was not auto-matched: legacy sent emails created before thread provenance was stored fall back to normal job/title/domain matching and still require approval.

## Related pages

- [Microsoft Graph OAuth Setup](/docs/next/getting-started/microsoft-graph-oauth-setup)
- [Gmail OAuth Setup](/docs/next/getting-started/gmail-oauth-setup)
- [Post-Application Workflow](/docs/next/workflows/post-application-workflow)
- [In Progress Board](/docs/next/features/in-progress-board)
