import type React from "react";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

const PROVIDER_LABELS: Record<string, string> = {
  gmail: "Gmail",
  graph: "Microsoft Graph",
};

export const ProviderOauthCallbackPage: React.FC<{ provider: string }> = ({
  provider,
}) => {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        {
          type: `${provider}-oauth-result`,
          code,
          state,
          error,
        },
        window.location.origin,
      );
    }

    window.close();
  }, [provider, searchParams]);

  const label = PROVIDER_LABELS[provider] ?? provider;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-lg font-semibold">
          Completing {label} connection…
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You can close this window if it does not close automatically.
        </p>
      </div>
    </main>
  );
};
