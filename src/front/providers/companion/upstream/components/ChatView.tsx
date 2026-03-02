import { useEffect, useMemo } from "react";
import { useStore } from "../store.js";
import { api } from "../api.js";
import { MessageFeed } from "./MessageFeed.js";
import { Composer } from "./Composer.js";
import { PermissionBanner } from "./PermissionBanner.js";
import { EnvManager } from "./EnvManager.js";

function getWorkspaceBasePath(pathname: string = ""): string {
  const match = String(pathname || "").match(/^\/w\/[^/]+/);
  return match ? match[0] : "";
}

function getWorkspaceId(pathname: string = ""): string | null {
  const match = String(pathname || "").match(/^\/w\/([^/]+)/);
  return match?.[1] ? String(match[1]) : null;
}

export function ChatView({ sessionId }: { sessionId: string }) {
  const sessionPerms = useStore((s) => s.pendingPermissions.get(sessionId));
  const connStatus = useStore(
    (s) => s.connectionStatus.get(sessionId) ?? "disconnected"
  );
  const cliConnected = useStore((s) => s.cliConnected.get(sessionId) ?? false);
  const authRequired = useStore((s) => s.authRequired.get(sessionId) ?? null);
  const setAuthRequired = useStore((s) => s.setAuthRequired);

  const perms = useMemo(
    () => (sessionPerms ? Array.from(sessionPerms.values()) : []),
    [sessionPerms]
  );

  useEffect(() => {
    let cancelled = false;
    async function checkInitialAuth() {
      if (authRequired) return;
      if (typeof window === "undefined") return;

      const pathname = window.location?.pathname || "";
      const workspaceBase = getWorkspaceBasePath(pathname);
      const workspaceId = getWorkspaceId(pathname);

      try {
        const statusResp = await fetch(`${workspaceBase}/api/v1/chat/auth/status`);
        const statusData = await statusResp.json().catch(() => ({}));
        if (statusResp.ok && statusData?.logged_in) {
          return;
        }
      } catch {
        // Ignore; fall through to settings-based check.
      }

      if (workspaceId) {
        try {
          const settingsResp = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/settings`);
          const settingsData = await settingsResp.json().catch(() => ({}));
          const method = String(settingsData?.auth_method || "").trim();
          // API key auth does not appear as logged-in in `claude auth status`,
          // so allow chat to proceed when API key is configured.
          if (settingsResp.ok && method === "api_key") {
            return;
          }
        } catch {
          // Ignore settings lookup errors; use chat status outcome.
        }
      }

      if (!cancelled) {
        setAuthRequired(sessionId, "Authentication required");
      }
    }
    checkInitialAuth().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authRequired, sessionId, setAuthRequired]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* CLI disconnected banner */}
      {connStatus === "connected" && !cliConnected && (
        <div className="px-4 py-2 bg-cc-warning/10 border-b border-cc-warning/20 text-center flex items-center justify-center gap-3">
          <span className="text-xs text-cc-warning font-medium">
            CLI disconnected
          </span>
          <button
            onClick={() => api.relaunchSession(sessionId).catch(console.error)}
            className="text-xs font-medium px-3 py-1 rounded-md bg-cc-warning/20 hover:bg-cc-warning/30 text-cc-warning transition-colors cursor-pointer"
          >
            Reconnect
          </button>
        </div>
      )}

      {/* WebSocket disconnected banner */}
      {connStatus === "disconnected" && (
        <div className="px-4 py-2 bg-cc-warning/10 border-b border-cc-warning/20 text-center">
          <span className="text-xs text-cc-warning font-medium">
            Reconnecting to session...
          </span>
        </div>
      )}

      {authRequired ? (
        <EnvManager
          mode="auth"
          authError={authRequired}
          presentation="inline"
          onClose={() => {
            setAuthRequired(sessionId, null);
          }}
        />
      ) : (
        <>
          {/* Message feed */}
          <MessageFeed sessionId={sessionId} />

          {/* Permission banners */}
          {perms.length > 0 && (
            <div className="shrink-0 max-h-[60vh] overflow-y-auto border-t border-cc-border bg-cc-card">
              {perms.map((p) => (
                <PermissionBanner key={p.request_id} permission={p} sessionId={sessionId} />
              ))}
            </div>
          )}

          {/* Composer */}
          <Composer sessionId={sessionId} />
        </>
      )}
    </div>
  );
}
