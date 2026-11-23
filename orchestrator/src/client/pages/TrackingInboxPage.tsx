import type {
  JobListItem,
  PostApplicationInboxItem,
  PostApplicationLastMessagePreview,
  PostApplicationProvider,
  PostApplicationSyncRun,
} from "@shared/types";
import {
  DEFAULT_POST_APPLICATION_PROVIDER,
  POST_APPLICATION_PROVIDERS,
} from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle,
  Inbox,
  Link2,
  Loader2,
  Mail,
  RefreshCcw,
  Unplug,
  Upload,
  XCircle,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useQueryErrorToast } from "@/client/hooks/useQueryErrorToast";
import { showErrorToast } from "@/client/lib/error-toast";
import { queryKeys } from "@/client/lib/queryKeys";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trackProductEvent } from "@/lib/analytics";
import { formatDateTime } from "@/lib/utils";
import * as api from "../api";
import { EmptyState, PageHeader, PageMain } from "../components";
import { EmailViewerList } from "./tracking-inbox/EmailViewerList";

const PROVIDER_OPTIONS: PostApplicationProvider[] = [
  DEFAULT_POST_APPLICATION_PROVIDER,
  ...POST_APPLICATION_PROVIDERS.filter(
    (provider) => provider !== DEFAULT_POST_APPLICATION_PROVIDER,
  ),
];
const OAUTH_RESULT_TYPE = (provider: PostApplicationProvider): string =>
  `${provider}-oauth-result`;
const OAUTH_TIMEOUT_MS = 3 * 60 * 1000;
const EMPTY_INBOX_ITEMS: PostApplicationInboxItem[] = [];
const EMPTY_SYNC_RUNS: PostApplicationSyncRun[] = [];

const OAUTH_PROVIDER_LABELS: Partial<Record<PostApplicationProvider, string>> =
  {
    gmail: "Gmail",
    graph: "Microsoft Graph",
  };

type OauthResultMessage = {
  type: string;
  state?: string;
  code?: string;
  error?: string;
};

function formatEpochMs(value?: number | null): string {
  if (!value) return "n/a";
  return formatDateTime(new Date(value).toISOString()) ?? "n/a";
}

export const TrackingInboxPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const jobIdFilter = searchParams.get("jobId")?.trim() ?? "";
  const [provider, setProvider] = useState<PostApplicationProvider>(
    DEFAULT_POST_APPLICATION_PROVIDER,
  );
  const [accountKey, setAccountKey] = useState("default");
  const [maxMessages, setMaxMessages] = useState("100");
  const [searchDays, setSearchDays] = useState("90");
  const isDefaultAccountKey = accountKey.trim() === "default";

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<
    "connect" | "sync" | "disconnect" | null
  >(null);

  const [isRunModalOpen, setIsRunModalOpen] = useState(false);
  const [selectedRun, setSelectedRun] = useState<PostApplicationSyncRun | null>(
    null,
  );

  const [isLastMessageOpen, setIsLastMessageOpen] = useState(false);
  const [isLastMessageLoading, setIsLastMessageLoading] = useState(false);
  const [lastMessage, setLastMessage] =
    useState<PostApplicationLastMessagePreview | null>(null);
  const [lastMessageError, setLastMessageError] = useState<string | null>(null);

  const [appliedJobByMessageId, setAppliedJobByMessageId] = useState<
    Record<string, string>
  >({});
  const statusQuery = useQuery({
    queryKey: queryKeys.postApplication.providerStatus(provider, accountKey),
    queryFn: () => api.postApplicationProviderStatus({ provider, accountKey }),
    enabled: Boolean(provider && accountKey),
  });
  const inboxQuery = useQuery({
    queryKey: queryKeys.postApplication.inbox(provider, accountKey, 100),
    queryFn: () =>
      api.getPostApplicationInbox({ provider, accountKey, limit: 100 }),
    enabled: Boolean(provider && accountKey),
  });
  const runsQuery = useQuery({
    queryKey: queryKeys.postApplication.runs(provider, accountKey, 20),
    queryFn: () =>
      api.getPostApplicationRuns({ provider, accountKey, limit: 20 }),
    enabled: Boolean(provider && accountKey),
  });

  const status = statusQuery.data?.status ?? null;
  const inbox = inboxQuery.data?.items ?? EMPTY_INBOX_ITEMS;
  const runs = runsQuery.data?.runs ?? EMPTY_SYNC_RUNS;

  const runMessagesQuery = useQuery({
    queryKey: queryKeys.postApplication.runMessages(
      selectedRun?.id ?? "",
      provider,
      accountKey,
    ),
    queryFn: () =>
      api.getPostApplicationRunMessages({
        runId: selectedRun?.id ?? "",
        provider,
        accountKey,
      }),
    enabled: Boolean(
      isRunModalOpen && selectedRun?.id && provider && accountKey,
    ),
  });
  const selectedRunItems = runMessagesQuery.data?.items ?? EMPTY_INBOX_ITEMS;
  const isRunMessagesLoading =
    runMessagesQuery.isPending || runMessagesQuery.isFetching;

  const visibleInbox = useMemo(
    () =>
      jobIdFilter
        ? inbox.filter((item) => item.message.matchedJobId === jobIdFilter)
        : inbox,
    [inbox, jobIdFilter],
  );
  const visibleRunItems = useMemo(
    () =>
      jobIdFilter
        ? selectedRunItems.filter(
            (item) => item.message.matchedJobId === jobIdFilter,
          )
        : selectedRunItems,
    [jobIdFilter, selectedRunItems],
  );

  const hasReviewItems = useMemo(
    () => visibleInbox.length > 0 || visibleRunItems.length > 0,
    [visibleInbox.length, visibleRunItems.length],
  );

  const appliedJobsQuery = useQuery({
    queryKey: queryKeys.jobs.list({
      statuses: ["applied", "in_progress"],
      view: "list",
    }),
    queryFn: () =>
      api.getJobs({
        statuses: ["applied", "in_progress"],
        view: "list",
      }),
    enabled: hasReviewItems,
  });
  const appliedJobs = useMemo<JobListItem[]>(
    () =>
      (appliedJobsQuery.data?.jobs ?? []).filter(
        (job) => job.status === "applied" || job.status === "in_progress",
      ),
    [appliedJobsQuery.data?.jobs],
  );
  const isAppliedJobsLoading =
    appliedJobsQuery.isPending || appliedJobsQuery.isFetching;

  const [inboxActionDialog, setInboxActionDialog] = useState<{
    isOpen: boolean;
    action: "approve" | "deny" | null;
    itemCount: number;
  }>({ isOpen: false, action: null, itemCount: 0 });
  const isLoading =
    statusQuery.isPending || inboxQuery.isPending || runsQuery.isPending;

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        statusQuery.refetch(),
        inboxQuery.refetch(),
        runsQuery.refetch(),
        hasReviewItems ? appliedJobsQuery.refetch() : Promise.resolve(),
      ]);
    } catch (error) {
      showErrorToast(error, "Failed to refresh tracking inbox");
    } finally {
      setIsRefreshing(false);
    }
  }, [appliedJobsQuery, hasReviewItems, inboxQuery, runsQuery, statusQuery]);

  useEffect(() => {
    if (!provider || !accountKey) return;
    setAppliedJobByMessageId({});
  }, [provider, accountKey]);

  useEffect(() => {
    const defaultAppliedJobId = appliedJobs[0]?.id ?? "";
    setAppliedJobByMessageId((previous) => {
      const next = { ...previous };
      let didChange = false;
      for (const item of [...visibleInbox, ...visibleRunItems]) {
        const selectedJobId = next[item.message.id];
        const hasValidSelection = appliedJobs.some(
          (appliedJob) => appliedJob.id === selectedJobId,
        );
        if (!selectedJobId || !hasValidSelection) {
          const matchedJobId = item.message.matchedJobId ?? "";
          const hasValidMatchedJob = appliedJobs.some(
            (appliedJob) => appliedJob.id === matchedJobId,
          );
          const nextJobId = hasValidMatchedJob
            ? matchedJobId
            : defaultAppliedJobId;
          if (next[item.message.id] !== nextJobId) {
            next[item.message.id] = nextJobId;
            didChange = true;
          }
        }
      }
      return didChange ? next : previous;
    });
  }, [appliedJobs, visibleInbox, visibleRunItems]);

  const waitForOauthResult = useCallback(
    (
      oauthProvider: PostApplicationProvider,
      expectedState: string,
      popup: Window,
    ): Promise<{ code?: string; error?: string }> => {
      const label = OAUTH_PROVIDER_LABELS[oauthProvider] ?? oauthProvider;
      return new Promise((resolve, reject) => {
        let settled = false;

        const close = () => {
          window.clearTimeout(timeoutId);
          window.clearInterval(closedCheckId);
          window.removeEventListener("message", onMessage);
        };

        const finishResolve = (value: { code?: string; error?: string }) => {
          if (settled) return;
          settled = true;
          close();
          try {
            popup.close();
          } catch {
            // Ignore cross-window close errors.
          }
          resolve(value);
        };

        const finishReject = (message: string) => {
          if (settled) return;
          settled = true;
          close();
          reject(new Error(message));
        };

        const onMessage = (event: MessageEvent<unknown>) => {
          if (event.origin !== window.location.origin) return;
          const data = event.data as OauthResultMessage | undefined;
          if (!data || data.type !== OAUTH_RESULT_TYPE(oauthProvider)) return;
          if (data.state !== expectedState) return;
          finishResolve({
            ...(data.code ? { code: data.code } : {}),
            ...(data.error ? { error: data.error } : {}),
          });
        };

        const timeoutId = window.setTimeout(() => {
          finishReject(`Timed out waiting for ${label} OAuth response.`);
        }, OAUTH_TIMEOUT_MS);

        const closedCheckId = window.setInterval(() => {
          if (!popup.closed) return;
          finishReject(`${label} OAuth window was closed before completion.`);
        }, 250);

        window.addEventListener("message", onMessage);
      });
    },
    [],
  );

  const runProviderAction = useCallback(
    async (action: "connect" | "sync" | "disconnect") => {
      setIsActionLoading(true);
      setActiveAction(action);
      let syncToastId: string | number | null = null;
      try {
        if (action === "connect") {
          trackProductEvent("tracking_inbox_connect_started", {
            provider,
            account_key_is_default: isDefaultAccountKey,
          });
          const oauthProvider = provider;
          const label = OAUTH_PROVIDER_LABELS[oauthProvider] ?? oauthProvider;
          if (oauthProvider !== "gmail" && oauthProvider !== "graph") {
            trackProductEvent("tracking_inbox_connect_completed", {
              provider,
              result: "error",
            });
            toast.error(
              `${label} connect is not implemented yet. Use Gmail or Microsoft Graph.`,
            );
            return;
          }

          const oauthStart =
            oauthProvider === "graph"
              ? await api.postApplicationGraphOauthStart({ accountKey })
              : await api.postApplicationGmailOauthStart({ accountKey });
          const popup = window.open(
            oauthStart.authorizationUrl,
            `${oauthProvider}-oauth-connect`,
            "popup,width=520,height=720",
          );
          if (!popup) {
            trackProductEvent("tracking_inbox_connect_completed", {
              provider,
              result: "error",
            });
            toast.error(
              `Browser blocked the ${label} OAuth popup. Allow popups and retry.`,
            );
            return;
          }

          const oauthResult = await waitForOauthResult(
            oauthProvider,
            oauthStart.state,
            popup,
          );
          if (oauthResult.error) {
            throw new Error(`${label} OAuth failed: ${oauthResult.error}`);
          }
          if (!oauthResult.code) {
            throw new Error(
              `${label} OAuth did not return an authorization code.`,
            );
          }

          if (oauthProvider === "graph") {
            await api.postApplicationGraphOauthExchange({
              accountKey,
              state: oauthStart.state,
              code: oauthResult.code,
            });
          } else {
            await api.postApplicationGmailOauthExchange({
              accountKey,
              state: oauthStart.state,
              code: oauthResult.code,
            });
          }
          trackProductEvent("tracking_inbox_connect_completed", {
            provider,
            result: "success",
          });
          toast.success("Provider connected");
        } else if (action === "sync") {
          const parsedMaxMessages = Number.parseInt(maxMessages, 10);
          const parsedSearchDays = Number.parseInt(searchDays, 10);
          if (
            !Number.isFinite(parsedMaxMessages) ||
            parsedMaxMessages < 1 ||
            parsedMaxMessages > 500 ||
            !Number.isFinite(parsedSearchDays) ||
            parsedSearchDays < 1 ||
            parsedSearchDays > 365
          ) {
            toast.error(
              "Max messages must be 1-500 and search days must be 1-365 before syncing.",
            );
            return;
          }
          syncToastId = toast.loading(
            "Sync in progress. This may take up to a couple of minutes.",
          );
          trackProductEvent("tracking_inbox_sync_started", {
            provider,
            max_messages: parsedMaxMessages,
            search_days: parsedSearchDays,
          });

          await api.postApplicationProviderSync({
            provider,
            accountKey,
            maxMessages: parsedMaxMessages,
            searchDays: parsedSearchDays,
          });
          trackProductEvent("tracking_inbox_sync_completed", {
            provider,
            result: "success",
          });
          toast.success("Sync completed", {
            ...(syncToastId ? { id: syncToastId } : {}),
          });
        } else {
          await api.postApplicationProviderDisconnect({ provider, accountKey });
          trackProductEvent("tracking_inbox_disconnect_confirmed", {
            provider,
          });
          toast.success("Provider disconnected");
        }

        await refresh();
      } catch (error) {
        if (action === "connect") {
          const rawMessage = error instanceof Error ? error.message : "";
          trackProductEvent("tracking_inbox_connect_completed", {
            provider,
            result: rawMessage.includes("Timed out")
              ? "timeout"
              : rawMessage.includes("window was closed")
                ? "cancelled"
                : "error",
          });
        }
        if (action === "sync") {
          trackProductEvent("tracking_inbox_sync_completed", {
            provider,
            result: "error",
          });
        }
        if (syncToastId) {
          showErrorToast(error, `Failed to ${action} provider connection`, {
            id: syncToastId,
          });
        } else {
          showErrorToast(error, `Failed to ${action} provider connection`);
        }
      } finally {
        setActiveAction(null);
        setIsActionLoading(false);
      }
    },
    [
      accountKey,
      isDefaultAccountKey,
      maxMessages,
      provider,
      refresh,
      searchDays,
      waitForOauthResult,
    ],
  );

  const handleDecision = useCallback(
    async (
      item: PostApplicationInboxItem,
      decision: "approve" | "deny",
      context: "main_inbox" | "run_modal",
    ) => {
      const selectedJobId =
        appliedJobByMessageId[item.message.id] || item.message.matchedJobId;

      if (decision === "approve" && !selectedJobId) {
        toast.error("Select an applied job before making a decision.");
        return;
      }

      setIsActionLoading(true);
      try {
        if (decision === "approve") {
          await api.approvePostApplicationInboxItem({
            messageId: item.message.id,
            provider,
            accountKey,
            jobId: selectedJobId ?? undefined,
            stageTarget: item.message.stageTarget ?? undefined,
          });
          trackProductEvent("tracking_inbox_review_action_completed", {
            action: "approve",
            context,
            item_count: 1,
            provider,
            result: "success",
          });
          toast.success("Message linked");
        } else {
          await api.denyPostApplicationInboxItem({
            messageId: item.message.id,
            provider,
            accountKey,
          });
          trackProductEvent("tracking_inbox_review_action_completed", {
            action: "deny",
            context,
            item_count: 1,
            provider,
            result: "success",
          });
          toast.success("Message ignored");
        }

        await refresh();
      } catch (error) {
        trackProductEvent("tracking_inbox_review_action_completed", {
          action: decision,
          context,
          item_count: 1,
          provider,
          result: "error",
        });
        showErrorToast(error, `Failed to ${decision} message`);
      } finally {
        setIsActionLoading(false);
      }
    },
    [accountKey, appliedJobByMessageId, provider, refresh],
  );

  const handleInboxAction = useCallback(
    async (action: "approve" | "deny") => {
      if (visibleInbox.length === 0) return;

      setIsActionLoading(true);
      setInboxActionDialog({ isOpen: false, action: null, itemCount: 0 });

      try {
        const result = await api.runPostApplicationInboxAction({
          action,
          provider,
          accountKey,
        });

        const { succeeded, failed, skipped } = result;
        const actionLabel = action === "approve" ? "approved" : "ignored";
        trackProductEvent("tracking_inbox_review_action_completed", {
          action,
          context: "main_inbox",
          item_count: result.requested,
          provider,
          result:
            failed === result.requested && result.requested > 0
              ? "error"
              : "success",
        });

        if (failed === 0 && skipped === 0) {
          toast.success(`All ${succeeded} messages ${actionLabel}`);
        } else if (failed === 0) {
          toast.success(
            `${succeeded} messages ${actionLabel}, ${skipped} skipped (no suggested match)`,
          );
        } else {
          toast.error(
            `${succeeded} ${actionLabel}, ${failed} failed, ${skipped} skipped`,
          );
        }

        await refresh();
      } catch (error) {
        trackProductEvent("tracking_inbox_review_action_completed", {
          action,
          context: "main_inbox",
          item_count: visibleInbox.length,
          provider,
          result: "error",
        });
        showErrorToast(error, `Failed to ${action} messages`);
      } finally {
        setIsActionLoading(false);
      }
    },
    [accountKey, visibleInbox.length, provider, refresh],
  );

  const openInboxActionDialog = useCallback(
    (action: "approve" | "deny") => {
      const eligibleCount =
        action === "approve"
          ? visibleInbox.filter((item) => item.matchedJob).length
          : visibleInbox.length;

      if (eligibleCount === 0) {
        toast.error(
          action === "approve"
            ? "No messages with suggested job matches to approve"
            : "No messages to ignore",
        );
        return;
      }

      setInboxActionDialog({
        isOpen: true,
        action,
        itemCount: eligibleCount,
      });
    },
    [visibleInbox],
  );

  const handleOpenRunMessages = useCallback((run: PostApplicationSyncRun) => {
    setSelectedRun(run);
    setIsRunModalOpen(true);
  }, []);

  const handleViewLastMessage = useCallback(async () => {
    setIsLastMessageOpen(true);
    setLastMessage(null);
    setLastMessageError(null);
    setIsLastMessageLoading(true);
    try {
      const response = await api.postApplicationProviderLastMessage({
        provider,
        accountKey,
      });
      setLastMessage(response.message);
    } catch (error) {
      setLastMessageError(
        error instanceof Error
          ? error.message
          : "Failed to load the latest email.",
      );
    } finally {
      setIsLastMessageLoading(false);
    }
  }, [provider, accountKey]);

  useQueryErrorToast(
    statusQuery.error,
    "Failed to load provider connection status",
  );
  useQueryErrorToast(inboxQuery.error, "Failed to load inbox");
  useQueryErrorToast(runsQuery.error, "Failed to load sync runs");
  useQueryErrorToast(
    appliedJobsQuery.error,
    "Failed to load jobs for inbox matching",
  );
  useQueryErrorToast(
    runMessagesQuery.error,
    "Failed to load messages for selected sync run",
  );

  const pendingCount = visibleInbox.length;
  const jobFilterLabel = jobIdFilter ? (
    <Badge variant="outline" className="text-[10px]">
      Filtered to job {jobIdFilter}
    </Badge>
  ) : null;
  const isConnected = Boolean(status?.connected);
  const connectionLabel = useMemo(() => {
    if (!status) return "Unknown";
    if (!status.connected) return "Disconnected";
    if (status.integration?.status === "error") return "Error";
    return "Connected";
  }, [status]);

  const handleAppliedJobChange = useCallback(
    (messageId: string, value: string) => {
      setAppliedJobByMessageId((previous) => ({
        ...previous,
        [messageId]: value,
      }));
    },
    [],
  );

  return (
    <>
      <PageHeader
        icon={Inbox}
        title="Tracking Inbox"
        subtitle="Post-application message review"
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => void refresh()}
            disabled={isRefreshing || isLoading}
            className="gap-2"
          >
            {isRefreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4" />
            )}
            Refresh
          </Button>
        }
      />

      <PageMain className="space-y-4">
        <section className="space-y-1 px-1">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold tracking-tight">
              Application Inbox Matching
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Connect your inbox to ingest related emails, review the suggested
            job matches, and approve or deny to automatically update your
            tracking timeline.
          </p>
        </section>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Provider Controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="provider">Provider</Label>
                <Select
                  value={provider}
                  onValueChange={(value) =>
                    setProvider(value as PostApplicationProvider)
                  }
                >
                  <SelectTrigger id="provider">
                    <SelectValue placeholder="Provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {OAUTH_PROVIDER_LABELS[option] ?? option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="accountKey">Account Key</Label>
                <Input
                  id="accountKey"
                  value={accountKey}
                  onChange={(event) => setAccountKey(event.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Gmail and Microsoft Graph connect with an OAuth popup and store
              refresh tokens server-side. No manual token paste is needed.
            </p>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="maxMessages">Max Messages</Label>
                <Input
                  id="maxMessages"
                  inputMode="numeric"
                  value={maxMessages}
                  onChange={(event) => setMaxMessages(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="searchDays">Search Days</Label>
                <Input
                  id="searchDays"
                  inputMode="numeric"
                  value={searchDays}
                  onChange={(event) => setSearchDays(event.target.value)}
                />
              </div>
              <div className="md:col-span-2 flex flex-wrap items-end gap-2">
                {!isConnected ? (
                  <Button
                    onClick={() => void runProviderAction("connect")}
                    disabled={isActionLoading}
                    className="gap-2"
                  >
                    <Link2 className="h-4 w-4" />
                    Connect
                  </Button>
                ) : null}
                <Button
                  onClick={() => void runProviderAction("sync")}
                  disabled={isActionLoading || !isConnected}
                  variant="secondary"
                  className="gap-2"
                >
                  {activeAction === "sync" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {activeAction === "sync" ? "Syncing..." : "Sync"}
                </Button>
                <Button
                  onClick={() => void handleViewLastMessage()}
                  disabled={
                    isActionLoading || isLastMessageLoading || !isConnected
                  }
                  variant="outline"
                  className="gap-2"
                >
                  {isLastMessageLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="h-4 w-4" />
                  )}
                  View last email
                </Button>
                {isConnected ? (
                  <Button
                    onClick={() => void runProviderAction("disconnect")}
                    disabled={isActionLoading}
                    variant="outline"
                    className="gap-2"
                  >
                    <Unplug className="h-4 w-4" />
                    Disconnect
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge variant={status?.connected ? "default" : "outline"}>
                {connectionLabel}
              </Badge>
              <span className="text-muted-foreground">
                Pending review:{" "}
                <span className="font-semibold">{pendingCount}</span>
              </span>
              {jobFilterLabel}
              {status?.integration?.lastSyncedAt ? (
                <span className="text-muted-foreground">
                  Last synced: {formatEpochMs(status.integration.lastSyncedAt)}
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Pending Review Queue</CardTitle>
            {inbox.length > 0 && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={isActionLoading}
                  onClick={() => openInboxActionDialog("approve")}
                >
                  <CheckCircle className="h-4 w-4" />
                  Approve All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={isActionLoading}
                  onClick={() => openInboxActionDialog("deny")}
                >
                  <XCircle className="h-4 w-4" />
                  Ignore All
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading inbox...
              </div>
            ) : visibleInbox.length === 0 ? (
              <EmptyState
                title="No pending messages"
                description="Run sync to ingest new job-application emails."
              />
            ) : (
              <EmailViewerList
                items={visibleInbox}
                appliedJobs={appliedJobs}
                appliedJobByMessageId={appliedJobByMessageId}
                onAppliedJobChange={handleAppliedJobChange}
                onDecision={(item, decision) =>
                  void handleDecision(item, decision, "main_inbox")
                }
                isActionLoading={isActionLoading}
                isAppliedJobsLoading={isAppliedJobsLoading}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Sync Runs</CardTitle>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sync runs yet.</p>
            ) : (
              <div className="space-y-2">
                {runs.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    className="w-full rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/30"
                    onClick={() => void handleOpenRunMessages(run)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-muted-foreground">
                        <p>{run.id}</p>
                        <p>{formatEpochMs(run.startedAt)}</p>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="outline">{run.status}</Badge>
                        <span className="text-muted-foreground">
                          discovered {run.messagesDiscovered}
                        </span>
                        <span className="text-muted-foreground">
                          relevant {run.messagesRelevant}
                        </span>
                        <span className="text-muted-foreground">
                          matched {run.messagesMatched}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </PageMain>

      <Dialog
        open={isLastMessageOpen}
        onOpenChange={(open) => {
          setIsLastMessageOpen(open);
          if (!open) {
            setLastMessage(null);
            setLastMessageError(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>Last email from this connection</DialogTitle>
            <DialogDescription>
              Read directly from the connected mailbox. This confirms the saved
              connection can still access your email, independently of sync.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {isLastMessageLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading the latest email...
              </div>
            ) : lastMessageError ? (
              <p className="text-sm text-destructive">{lastMessageError}</p>
            ) : !lastMessage ? (
              <p className="text-sm text-muted-foreground">
                No messages were returned by this connection.
              </p>
            ) : (
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="font-medium">From</dt>
                  <dd className="text-muted-foreground">
                    {lastMessage.senderName
                      ? `${lastMessage.senderName} <${lastMessage.fromAddress}>`
                      : lastMessage.fromAddress || "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Subject</dt>
                  <dd className="text-muted-foreground">
                    {lastMessage.subject || "(no subject)"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Received</dt>
                  <dd className="text-muted-foreground">
                    {formatEpochMs(lastMessage.receivedAt)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Preview</dt>
                  <dd className="whitespace-pre-wrap text-muted-foreground">
                    {lastMessage.snippet || "(no preview)"}
                  </dd>
                </div>
              </dl>
            )}
          </div>

          {lastMessage?.webLink ? (
            <div className="flex justify-end">
              <a
                href={lastMessage.webLink}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-primary underline"
              >
                Open in mail
              </a>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={isRunModalOpen}
        onOpenChange={(open) => {
          setIsRunModalOpen(open);
          if (!open) {
            setSelectedRun(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-6xl overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>Run Messages</DialogTitle>
            <DialogDescription>
              {selectedRun
                ? `Run ${selectedRun.id} • discovered ${selectedRun.messagesDiscovered} • relevant ${selectedRun.messagesRelevant} • matched ${selectedRun.messagesMatched}`
                : "Review all messages captured in this sync run, including partial matches."}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[calc(85vh-92px)] overflow-auto px-6 pb-6">
            {isRunMessagesLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading run messages...
              </div>
            ) : visibleRunItems.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No messages found for this run.
              </p>
            ) : (
              <EmailViewerList
                items={visibleRunItems}
                appliedJobs={appliedJobs}
                appliedJobByMessageId={appliedJobByMessageId}
                onAppliedJobChange={handleAppliedJobChange}
                onDecision={(item, decision) =>
                  void handleDecision(item, decision, "run_modal")
                }
                isActionLoading={isActionLoading}
                isAppliedJobsLoading={isAppliedJobsLoading}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={inboxActionDialog.isOpen}
        onOpenChange={(open) =>
          setInboxActionDialog((previous) => ({ ...previous, isOpen: open }))
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {inboxActionDialog.action === "approve"
                ? "Approve All Messages?"
                : "Ignore All Messages?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {inboxActionDialog.action === "approve"
                ? `This will approve ${inboxActionDialog.itemCount} message${inboxActionDialog.itemCount === 1 ? "" : "s"} with suggested job matches. Messages without matches will be skipped.`
                : `This will ignore all ${inboxActionDialog.itemCount} pending message${inboxActionDialog.itemCount === 1 ? "" : "s"}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (inboxActionDialog.action) {
                  void handleInboxAction(inboxActionDialog.action);
                }
              }}
            >
              {inboxActionDialog.action === "approve"
                ? "Approve All"
                : "Ignore All"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
