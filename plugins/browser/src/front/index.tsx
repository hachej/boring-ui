"use client";
import { useEffect, useState } from "react";
import { Globe2, Hand, Play, RotateCcw, Square } from "lucide-react";
import {
  Button,
  EmptyState,
  Notice,
  Pane,
  PaneBody,
  PaneHeader,
  PaneTitle,
} from "@hachej/boring-ui-kit";
import {
  useWorkspacePluginClient,
  type PaneProps,
} from "@hachej/boring-workspace";
import {
  definePlugin,
  type BoringFrontFactoryWithId,
} from "@hachej/boring-workspace/plugin";
import { BROWSER_BASE_PATH, type BrowserSessionView } from "../shared";

type BrowserPanelParams = { agentId?: string; agentSessionId?: string };
export function BrowserPanel({
  params,
  className,
}: PaneProps<BrowserPanelParams>) {
  const client = useWorkspacePluginClient();
  const [session, setSession] = useState<BrowserSessionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [viewUrl, setViewUrl] = useState("");
  useEffect(() => {
    const view = session?.view;
    if (!view) { setViewUrl(""); return; }
    let cancelled = false;
    client.postJson<{ url?: unknown }>(view.url, { grant: view.grant })
      .then((result) => {
        if (!cancelled && typeof result.url === "string" && result.url.startsWith("/api/v1/runtime-projection/view/")) {
          setViewUrl(result.url);
        }
      })
      .catch(() => { if (!cancelled) setError("The browser view could not be authorized."); });
    return () => { cancelled = true; };
  }, [client, session?.view?.grant, session?.view?.url]);
  const call = async (operation: "start" | "stop" | "takeover" | "return") => {
    setBusy(true);
    setError("");
    try {
      const body =
        operation === "start"
          ? { agentId: params?.agentId, agentSessionId: params?.agentSessionId }
          : {
              sessionId: session?.sessionId,
              ...(operation === "return" ? { consent: true } : {}),
            };
      setSession(
        await client.postJson<BrowserSessionView>(
          `${BROWSER_BASE_PATH}/${operation}`,
          body,
        ),
      );
    } catch {
      setError("The browser operation could not be completed.");
    } finally {
      setBusy(false);
    }
  };
  const addressed =
    typeof params?.agentId === "string" &&
    typeof params.agentSessionId === "string";
  return (
    <Pane className={className ?? "h-full"}>
      <PaneHeader>
        <PaneTitle className="flex items-center gap-2">
          <Globe2 className="h-4 w-4" />
          Browser
        </PaneTitle>
        <div className="ml-auto flex gap-2">
          {!session || session.state === "stopped" ? (
            <Button
              size="sm"
              disabled={busy || !addressed}
              onClick={() => void call("start")}
            >
              <Play className="mr-1 h-4 w-4" />
              Start
            </Button>
          ) : null}
          {session?.state === "agent-controlled" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void call("takeover")}
            >
              <Hand className="mr-1 h-4 w-4" />
              Take over
            </Button>
          ) : null}
          {session?.state === "human-controlled" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void call("return")}
            >
              <RotateCcw className="mr-1 h-4 w-4" />
              Return to Agent
            </Button>
          ) : null}
          {session && !["stopped", "stopping"].includes(session.state) ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void call("stop")}
            >
              <Square className="mr-1 h-4 w-4" />
              Stop
            </Button>
          ) : null}
        </div>
      </PaneHeader>
      <PaneBody className="min-h-0 p-0">
        {error ? <Notice tone="destructive">{error}</Notice> : null}
        {!addressed ? (
          <EmptyState
            icon={<Globe2 className="h-5 w-5" />}
            title="Open from an Agent session"
            description="Browser sessions are bound to the authenticated addressed Agent and chat session."
          />
        ) : null}
        {addressed && !session?.view ? (
          <EmptyState
            icon={<Globe2 className="h-5 w-5" />}
            title={
              session?.state === "error"
                ? "Browser unavailable"
                : "Browser is stopped"
            }
            description={
              session?.error ??
              "Start an ephemeral browser for this Agent session."
            }
          />
        ) : null}
        {session?.view && viewUrl ? (
          <div className="h-full min-h-[320px]">
            <iframe
              key={session.controlEpoch}
              src={viewUrl}
              title="Browser session"
              className="h-full w-full border-0 bg-white"
              sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
            />
          </div>
        ) : null}
      </PaneBody>
    </Pane>
  );
}
const browserPlugin: BoringFrontFactoryWithId = definePlugin({
  id: "browser",
  label: "Browser",
  panels: [
    {
      id: "browser.panel",
      label: "Browser",
      icon: Globe2,
      component: BrowserPanel,
      placement: "center",
      source: "builtin",
      chromeless: true,
    },
  ],
});
export default browserPlugin;
export { browserPlugin };
