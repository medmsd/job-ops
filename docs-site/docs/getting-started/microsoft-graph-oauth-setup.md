---
id: microsoft-graph-oauth-setup
title: Microsoft Graph OAuth Setup
description: Step-by-step Microsoft Entra setup for Outlook email tracking and recruiter email sending, with exact scopes, redirect URI, and environment variables.
sidebar_position: 5
---

## What it is

This guide configures Microsoft Graph OAuth so JobOps can read recruitment emails from an Outlook mailbox (personal Outlook.com or Microsoft 365) for the Tracking Inbox and, optionally, send a tailored application email to a recruiter from that same mailbox.

## Why it exists

Outlook no longer accepts basic IMAP username/password authentication. JobOps uses delegated Microsoft Graph OAuth with refresh tokens, so the connection survives access-token expiry without storing your password. The setup is easy to misconfigure (wrong redirect URI, missing `offline_access`, wrong tenant), so the exact values are documented here.

## How to use it

### 1) Register an app in Microsoft Entra ID

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com/) → **Applications → App registrations** → **New registration**. (A free Entra account is enough; no paid Azure subscription is required.)
2. Name it, for example `JobOps Tracking Inbox`.
3. For **Supported account types**, choose **Accounts in any organizational directory and personal Microsoft accounts** if you use a personal Outlook.com address. Choose **Accounts in this organizational directory only** if you only use a work/school mailbox.
4. Set the **Web** redirect URI to:
   - Local: `http://localhost:3005/oauth/graph/callback`
   - Production: `https://your-domain.com/oauth/graph/callback`
5. Click **Register**.
6. Copy the **Application (client) ID** from the overview page.
7. Go to **Certificates & secrets → Client secrets → New client secret**, create one, and copy its **Value** immediately (it is hidden afterwards).
8. Go to **API permissions → Add a permission → Microsoft Graph → Delegated permissions** and add:
   - `Mail.Read`
   - `Mail.Send` (required only if you want to use **Email recruiter**; see [Re-consent after adding Mail.Send](#re-consent-after-adding-mailsend))
   - `User.Read`
   - `offline_access`
   - `openid` (listed as **OpenID** under Delegated permissions)
9. Click **Grant admin consent** only if your tenant requires it. For personal accounts, the user consent screen during connection is sufficient.

Notes:

- The redirect URI must match exactly, including trailing slash and port.
- `offline_access` is what causes Microsoft to issue a refresh token. Without it, reconnecting is required every hour.
- `Mail.Read` is required because JobOps reads the message body for classification. `Mail.ReadBasic` is not sufficient.
- `Mail.Send` is a delegated permission used only when you confirm an email in **Email recruiter**. JobOps never sends mail automatically. Read-only tracking works without it.

### 2) Set environment variables

In your JobOps `.env` (or Compose environment):

```bash
GRAPH_OAUTH_CLIENT_ID=your-application-client-id
GRAPH_OAUTH_CLIENT_SECRET=your-client-secret-value
# Optional. Defaults to common, which supports personal and work/school accounts.
GRAPH_OAUTH_TENANT_ID=common
# Optional. Defaults to <request-origin>/oauth/graph/callback.
GRAPH_OAUTH_REDIRECT_URI=http://localhost:3005/oauth/graph/callback
```

Then restart the container/app.

| Variable | Required | Where to find it |
|---|---|---|
| `GRAPH_OAUTH_CLIENT_ID` | Yes | App registration **Overview → Application (client) ID** |
| `GRAPH_OAUTH_CLIENT_SECRET` | Yes | **Certificates & secrets → Client secret Value** |
| `GRAPH_OAUTH_TENANT_ID` | No | **Overview → Directory (tenant) ID**. Defaults to `common`. |
| `GRAPH_OAUTH_REDIRECT_URI` | No | Must exactly match the registered Web redirect URI. |

### 3) Connect Outlook in JobOps

1. Open **Tracking Inbox**.
2. Select provider `Microsoft Graph` (value `graph`).
3. Click **Connect**.
4. Sign in with the Microsoft account that owns the mailbox and accept consent.

JobOps starts OAuth with:

- Authorization code flow with PKCE (`S256`)
- Scopes: `openid`, `offline_access`, `User.Read`, `Mail.Read`, and `Mail.Send` when it has been added to the app registration
- `prompt=consent`

Access tokens last about one hour. JobOps stores the refresh token server-side and silently exchanges it for a new access token on each sync; Microsoft may rotate the refresh token, and JobOps persists the replacement. If the refresh token is revoked or expires, reconnect from the UI.

### Re-consent after adding Mail.Send

Adding a permission to an existing app registration does not upgrade tokens that were issued before the change. If you connected Outlook before adding `Mail.Send`, confirm sends fail with an actionable "Reconnect Microsoft Graph to grant Mail.Send permission" message. To fix it:

1. In **API permissions**, confirm delegated `Mail.Send` is listed for **JobOps Tracking Inbox**.
2. Open **Tracking Inbox** in JobOps and click **Disconnect** (if available), then **Connect** again.
3. On the Microsoft consent screen, approve the `Mail.Send` permission. `prompt=consent` forces the screen to reappear.
4. Retry the **Email recruiter** preview and send.

If your organization restricts user consent, ask an administrator to grant admin consent for `Mail.Send`.

### 4) Sync mail

Set **Search Days** and **Max Messages**, then click **Sync**. JobOps reads recent messages, filters likely recruitment mail, classifies each with the Smart Router, and places matches in the pending review queue.

## Common problems

### `AADSTS50011: The redirect URI specified in the request does not match`

The `redirect_uri` sent by JobOps does not match the app registration. Check `GRAPH_OAUTH_REDIRECT_URI` and the **Web** redirect URI in Entra. For local Docker use, the default is `http://localhost:3005/oauth/graph/callback`.

### `AADSTS7000215: Invalid client secret`

The client secret was regenerated or copied without its full value. Create a new secret and update `GRAPH_OAUTH_CLIENT_SECRET`.

### `AADSTS65001: The user or administrator has not consented`

Required permissions were added after the first consent. Reconnect from the Tracking Inbox so the consent screen is shown again. If your organization restricts consent, ask an administrator for admin consent.

### Connect succeeds but no mail is ingested

- Confirm the signed-in account is the mailbox you expect.
- Increase **Search Days** and **Max Messages**.
- Messages are pre-filtered by recruitment keywords before classification, so unrelated mail is skipped.

### Sync fails with `GRAPH_SYNC_FAILED`

Open the sync run in the Tracking Inbox for the error. Common causes are a revoked refresh token, removed `Mail.Read` permission, or an expired client secret.

### Email recruiter says "Reconnect Microsoft Graph to grant Mail.Send permission"

The stored token was granted before `Mail.Send` was added to the app registration, so it cannot authorize a send. Follow [Re-consent after adding Mail.Send](#re-consent-after-adding-mailsend). JobOps does not silently re-request scopes during a send; you must explicitly reconnect.

### Email recruiter is disabled

The action requires a tailored PDF for the job. Tailor and generate the resume first; the email action attaches that exact PDF. Attachments larger than 4 MB are rejected before any preview or send.

## Related pages

- [Gmail OAuth Setup](/docs/next/getting-started/gmail-oauth-setup)
- [Self-Hosting (Docker Compose)](/docs/next/getting-started/self-hosting)
- [Post-Application Tracking](/docs/next/features/post-application-tracking)
- [Post-Application Workflow](/docs/next/workflows/post-application-workflow)
- [Common Problems](/docs/next/troubleshooting/common-problems)
