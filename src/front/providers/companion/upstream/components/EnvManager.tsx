import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { api, type CompanionEnv } from "../api.js";

interface Props {
  onClose: () => void;
  mode?: "full" | "auth";
  authError?: string | null;
  presentation?: "modal" | "inline";
}

interface VarRow {
  key: string;
  value: string;
}

function getWorkspaceBasePath(pathname: string = ""): string {
  const match = String(pathname || "").match(/^\/w\/[^/]+/);
  return match ? match[0] : "";
}

function getWorkspaceId(pathname: string = ""): string | null {
  const match = String(pathname || "").match(/^\/w\/([^/]+)/);
  return match?.[1] ? String(match[1]) : null;
}

function getManagedAuthBase(): string {
  if (typeof window === "undefined") return "/api/v1/chat/auth";
  const workspaceBase = getWorkspaceBasePath(window.location?.pathname || "");
  return `${workspaceBase}/api/v1/chat/auth`;
}

export function EnvManager({
  onClose,
  mode = "full",
  authError = null,
  presentation = "modal",
}: Props) {
  const authOnly = mode === "auth";
  const isInline = presentation === "inline";
  const workspaceId =
    typeof window === "undefined"
      ? null
      : getWorkspaceId(window.location?.pathname || "");
  const [envs, setEnvs] = useState<CompanionEnv[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editVars, setEditVars] = useState<VarRow[]>([]);
  const [error, setError] = useState("");

  // New env form
  const [newName, setNewName] = useState("");
  const [newVars, setNewVars] = useState<VarRow[]>([{ key: "", value: "" }]);
  const [creating, setCreating] = useState(false);
  const [managedEmail, setManagedEmail] = useState("");
  const [managedLoginUrl, setManagedLoginUrl] = useState("");
  const [managedStatus, setManagedStatus] = useState("");
  const [managedStatusError, setManagedStatusError] = useState(false);
  const [managedBusy, setManagedBusy] = useState(false);
  const [managedProviderLabel, setManagedProviderLabel] = useState("Chat provider");
  const [managedSupported, setManagedSupported] = useState(true);
  const [managedSessionId, setManagedSessionId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState("");
  const [apiKeyStatusError, setApiKeyStatusError] = useState(false);
  const [managedCode, setManagedCode] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [copyStatusError, setCopyStatusError] = useState(false);
  const authAutoLaunchStartedRef = useRef(false);

  const refresh = () => {
    api.listEnvs().then(setEnvs).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!authOnly) {
      refresh();
      return;
    }
    setLoading(false);
  }, [authOnly]);

  async function loadManagedAuthMeta() {
    let supported = true;
    try {
      const resp = await fetch(`${getManagedAuthBase()}/meta`);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) return { supported };
      const label = String(data.provider_label || "").trim();
      if (label) setManagedProviderLabel(label);
      if (data.managed_login_supported === false) {
        supported = false;
        setManagedSupported(false);
      }
    } catch {
      // No-op: keep defaults for backward compatibility.
    }
    return { supported };
  }

  async function checkManagedAuthStatus(silent = false) {
    if (!managedSupported) return { loggedIn: false, activeSession: false };
    if (!silent) {
      setManagedBusy(true);
      setManagedStatus("");
      setManagedStatusError(false);
    }
    try {
      const resp = await fetch(`${getManagedAuthBase()}/status`);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setManagedStatus("Unable to check Claude login status.");
        setManagedStatusError(true);
        return null;
      }
      const active = data?.active_login_session && typeof data.active_login_session === "object"
        ? data.active_login_session
        : null;
      const activeSession = Boolean(active);
      if (active) {
        const sessionId = String(active?.session_id || "").trim();
        if (sessionId) setManagedSessionId(sessionId);
        const loginUrl = String(active?.url || "").trim();
        if (loginUrl) setManagedLoginUrl(loginUrl);
        const loginCode = String(active?.code || "").trim();
        if (loginCode) setManagedCode(loginCode);
      }
      if (data.logged_in) {
        setManagedStatus(`${managedProviderLabel} login is active in this runtime.`);
        setManagedStatusError(false);
        setManagedSessionId("");
        if (authOnly) {
          window.setTimeout(() => onClose(), 400);
        }
      } else {
        setManagedStatus(`${managedProviderLabel} is not logged in yet.`);
        setManagedStatusError(false);
      }
      return { loggedIn: Boolean(data.logged_in), activeSession };
    } catch {
      setManagedStatus("Unable to check chat login status.");
      setManagedStatusError(true);
      return null;
    } finally {
      setManagedBusy(false);
    }
  }

  async function startManagedClaudeLogin() {
    if (!managedSupported) return;
    setManagedBusy(true);
    setManagedStatus(`Starting ${managedProviderLabel} login...`);
    setManagedStatusError(false);
    setManagedLoginUrl("");
    setManagedSessionId("");
    setManagedCode("");
    try {
      const resp = await fetch(`${getManagedAuthBase()}/login-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: managedEmail.trim() || undefined }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setManagedStatus(data?.message || "Unable to start managed login.");
        setManagedStatusError(true);
        return;
      }
      if (data?.already_logged_in || data?.logged_in) {
        setManagedStatus(`${managedProviderLabel} login is already active in this runtime.`);
        setManagedStatusError(false);
        setManagedSessionId("");
        return;
      }
      if (!data?.url) {
        setManagedStatus(data?.message || "Unable to start managed login.");
        setManagedStatusError(true);
        return;
      }
      setManagedLoginUrl(String(data.url));
      const maybeSessionId = String(data?.session_id || "").trim();
      if (maybeSessionId) {
        setManagedSessionId(maybeSessionId);
      }
      const maybeCode = String(data?.code || "").trim();
      if (maybeCode) {
        setManagedCode(maybeCode);
      }
      if (data?.running === false) {
        if (data?.logged_in) {
          setManagedStatus(`${managedProviderLabel} login is active in this runtime.`);
          setManagedStatusError(false);
          if (authOnly) {
            window.setTimeout(() => onClose(), 400);
          }
          return;
        }
        setManagedStatus(String(data?.message || "Claude login process exited before authentication completed."));
        setManagedStatusError(true);
        return;
      }
      setManagedStatus("Open the login link, complete sign-in, paste code if prompted, then click Finish Login.");
      setManagedStatusError(false);
    } catch {
      setManagedStatus("Unable to start managed login.");
      setManagedStatusError(true);
    } finally {
      setManagedBusy(false);
    }
  }

  async function finishManagedClaudeLogin() {
    if (!managedSupported) return;
    setManagedBusy(true);
    setManagedStatus(`Completing ${managedProviderLabel} login...`);
    setManagedStatusError(false);
    try {
      const resp = await fetch(`${getManagedAuthBase()}/submit-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: managedCode.trim() || undefined,
          session_id: managedSessionId || undefined,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const message = String(data?.message || "Unable to complete managed login.");
        if (/timed out/i.test(message)) {
          await checkManagedAuthStatus(true).catch(() => {});
          setManagedStatus(
            "Login is still in progress. Complete browser sign-in, then click Finish Login again.",
          );
          setManagedStatusError(false);
          return;
        }
        setManagedStatus(message);
        setManagedStatusError(true);
        return;
      }

      const maybeSessionId = String(data?.session_id || "").trim();
      if (maybeSessionId) {
        setManagedSessionId(maybeSessionId);
      }
      const maybeUrl = String(data?.url || "").trim();
      if (maybeUrl) {
        setManagedLoginUrl(maybeUrl);
      }
      const maybeCode = String(data?.code || "").trim();
      if (maybeCode) {
        setManagedCode(maybeCode);
      }

      if (data?.finished) {
        if (data?.logged_in) {
          setManagedStatus(`${managedProviderLabel} login is active in this runtime.`);
          setManagedStatusError(false);
          setManagedSessionId("");
          if (authOnly) {
            window.setTimeout(() => onClose(), 400);
          }
          return;
        }
        setManagedStatus(String(data?.message || `${managedProviderLabel} authentication did not complete.`));
        setManagedStatusError(true);
        return;
      }

      setManagedStatus(String(data?.message || "Waiting for login process to complete."));
      setManagedStatusError(false);
    } catch {
      setManagedStatus("Unable to complete managed login.");
      setManagedStatusError(true);
    } finally {
      setManagedBusy(false);
    }
  }

  async function saveWorkspaceApiKey() {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setApiKeyStatus("Please enter an API key.");
      setApiKeyStatusError(true);
      return;
    }
    if (!workspaceId) {
      setApiKeyStatus("Workspace context is missing from URL; unable to save key.");
      setApiKeyStatusError(true);
      return;
    }
    setApiKeyBusy(true);
    setApiKeyStatus("Saving API key...");
    setApiKeyStatusError(false);
    try {
      const resp = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "boring-ui",
        },
        body: JSON.stringify({ claude_api_key: trimmed }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const message = String(data?.message || "Failed to save API key.");
        setApiKeyStatus(message);
        setApiKeyStatusError(true);
        return;
      }
      setApiKey("");
      setApiKeyStatus("API key saved. Relaunch the chat session to pick up the credential.");
      setApiKeyStatusError(false);
    } catch {
      setApiKeyStatus("Failed to save API key.");
      setApiKeyStatusError(true);
    } finally {
      setApiKeyBusy(false);
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus("Copied to clipboard.");
      setCopyStatusError(false);
    } catch {
      setCopyStatus("Could not copy automatically. Copy it manually.");
      setCopyStatusError(true);
    }
  }

  useEffect(() => {
    (async () => {
      const meta = await loadManagedAuthMeta().catch(() => ({ supported: true }));
      const status = await checkManagedAuthStatus(true).catch(() => null);

      if (!authOnly) return;
      if (authAutoLaunchStartedRef.current) return;
      if (meta?.supported === false) return;

      const loggedIn = Boolean(status?.loggedIn);
      const hasActiveSession = Boolean(status?.activeSession);
      if (!loggedIn && !hasActiveSession) {
        authAutoLaunchStartedRef.current = true;
        await startManagedClaudeLogin().catch(() => {});
      }
    })();
  }, [authOnly]);

  function startEdit(env: CompanionEnv) {
    setEditingSlug(env.slug);
    setEditName(env.name);
    const rows = Object.entries(env.variables).map(([key, value]) => ({ key, value }));
    if (rows.length === 0) rows.push({ key: "", value: "" });
    setEditVars(rows);
    setError("");
  }

  function cancelEdit() {
    setEditingSlug(null);
    setError("");
  }

  async function saveEdit() {
    if (!editingSlug) return;
    const variables: Record<string, string> = {};
    for (const row of editVars) {
      const k = row.key.trim();
      if (k) variables[k] = row.value;
    }
    try {
      await api.updateEnv(editingSlug, { name: editName.trim() || undefined, variables });
      setEditingSlug(null);
      setError("");
      refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(slug: string) {
    try {
      await api.deleteEnv(slug);
      if (editingSlug === slug) setEditingSlug(null);
      refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    const variables: Record<string, string> = {};
    for (const row of newVars) {
      const k = row.key.trim();
      if (k) variables[k] = row.value;
    }
    try {
      await api.createEnv(name, variables);
      setNewName("");
      setNewVars([{ key: "", value: "" }]);
      setError("");
      refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const title = authOnly ? `Authenticate with ${managedProviderLabel}` : "Manage Environments";
  const authErrorMessage = String(authError || "").trim();

  const panel = (
    <div
      className={`w-full max-w-lg ${isInline ? "max-h-none" : "max-h-[80vh]"} flex flex-col bg-cc-bg border border-cc-border rounded-[14px] shadow-2xl overflow-hidden`}
      onClick={(e) => {
        if (!isInline) e.stopPropagation();
      }}
    >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-cc-border">
          <h2 className="text-sm font-semibold text-cc-fg">{title}</h2>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {authOnly && (
            <div className="px-3 py-2.5 rounded-lg bg-cc-card border border-cc-border text-xs text-cc-muted space-y-1.5">
              <p className="text-cc-fg font-medium">Authenticate Claude Code before sending chat messages.</p>
              {authErrorMessage && (
                <p className="text-cc-error">Latest error: {authErrorMessage}</p>
              )}
              <p>Workflow: Launch Login, open the login link, paste code only if prompted, finish login, then check status.</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
              {error}
            </div>
          )}

          {/* Managed login */}
          <div className="border border-cc-border rounded-[10px] overflow-hidden">
            <div className="px-3 py-2.5 bg-cc-card">
              <span className="text-xs font-medium text-cc-fg">
                {authOnly ? `${managedProviderLabel} Login (Recommended)` : `Managed ${managedProviderLabel} Login (Recommended)`}
              </span>
            </div>
            <div className="px-3 py-3 space-y-2 border-t border-cc-border">
              {!managedSupported && (
                <div className="text-[11px] text-cc-muted">
                  Managed login is not available for the current chat provider yet.
                </div>
              )}
              <input
                type="email"
                value={managedEmail}
                onChange={(e) => setManagedEmail(e.target.value)}
                placeholder="Email (optional, for account selection)"
                disabled={!managedSupported}
                className="w-full px-2 py-1.5 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/50"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={startManagedClaudeLogin}
                  disabled={managedBusy || !managedSupported}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    managedBusy || !managedSupported
                      ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                      : "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
                  }`}
                >
                  Launch Login
                </button>
                <button
                  onClick={finishManagedClaudeLogin}
                  disabled={managedBusy || !managedSupported || (!managedSessionId && !managedLoginUrl)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    managedBusy || !managedSupported || (!managedSessionId && !managedLoginUrl)
                      ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                      : "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
                  }`}
                >
                  Finish Login
                </button>
                <button
                  onClick={() => checkManagedAuthStatus(false)}
                  disabled={managedBusy || !managedSupported}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    managedBusy || !managedSupported
                      ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                      : "bg-cc-input-bg border border-cc-border text-cc-fg hover:bg-cc-hover cursor-pointer"
                  }`}
                >
                  Check Status
                </button>
              </div>
              <div className="space-y-1">
                <div className="text-[11px] text-cc-muted">Auth code (paste only if Claude asks for one):</div>
                <input
                  type="text"
                  value={managedCode}
                  onChange={(e) => setManagedCode(e.target.value)}
                  placeholder="Paste auth code (if prompted)"
                  className="w-full px-2 py-1.5 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/50"
                />
              </div>
              {managedLoginUrl && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <a
                      href={managedLoginUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex px-2.5 py-1 text-[11px] bg-cc-input-bg border border-cc-border text-cc-fg rounded-md hover:bg-cc-hover cursor-pointer"
                    >
                      Open Login Link
                    </a>
                    <button
                      onClick={() => copyText(managedLoginUrl)}
                      className="inline-flex px-2.5 py-1 text-[11px] bg-cc-input-bg border border-cc-border text-cc-fg rounded-md hover:bg-cc-hover cursor-pointer"
                    >
                      Copy Link
                    </button>
                  </div>
                  <div className="text-[11px] text-cc-muted break-all">{managedLoginUrl}</div>
                </div>
              )}
              {managedSessionId && (
                <div className="text-[11px] text-cc-muted break-all">
                  Active login session: <code>{managedSessionId}</code>
                </div>
              )}
              {managedCode && (
                <div className="space-y-1.5">
                  <div className="text-[11px] text-cc-muted">Detected auth code:</div>
                  <div className="flex items-center gap-2">
                    <code className="px-2 py-1 rounded-md bg-cc-input-bg border border-cc-border text-[11px] text-cc-fg break-all">
                      {managedCode}
                    </code>
                    <button
                      onClick={() => copyText(managedCode)}
                      className="inline-flex px-2.5 py-1 text-[11px] bg-cc-input-bg border border-cc-border text-cc-fg rounded-md hover:bg-cc-hover cursor-pointer"
                    >
                      Copy Code
                    </button>
                  </div>
                </div>
              )}
              {managedStatus && (
                <div className={`text-[11px] ${managedStatusError ? "text-cc-error" : "text-cc-muted"}`}>
                  {managedStatus}
                </div>
              )}
              {copyStatus && (
                <div className={`text-[11px] ${copyStatusError ? "text-cc-error" : "text-cc-muted"}`}>
                  {copyStatus}
                </div>
              )}
            </div>
          </div>

          {/* API key fallback */}
          <div className="border border-cc-border rounded-[10px] overflow-hidden">
            <div className="px-3 py-2.5 bg-cc-card">
              <span className="text-xs font-medium text-cc-fg">
                {authOnly ? "Use API Key Instead" : "Workspace Claude API Key"}
              </span>
            </div>
            <div className="px-3 py-3 space-y-2 border-t border-cc-border">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-api03-..."
                className="w-full px-2 py-1.5 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/50"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={saveWorkspaceApiKey}
                  disabled={apiKeyBusy || !workspaceId}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    apiKeyBusy || !workspaceId
                      ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                      : "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
                  }`}
                >
                  Save API Key
                </button>
              </div>
              <div className="text-[11px] text-cc-muted">
                Saved to this workspace only. Relaunch chat session after saving.
              </div>
              {!workspaceId && (
                <div className="text-[11px] text-cc-error">
                  Workspace ID not detected in URL. Open this modal from a workspace route.
                </div>
              )}
              {apiKeyStatus && (
                <div className={`text-[11px] ${apiKeyStatusError ? "text-cc-error" : "text-cc-muted"}`}>
                  {apiKeyStatus}
                </div>
              )}
            </div>
          </div>

          {!authOnly && (
            <>
              {/* Existing environments */}
              {loading ? (
                <div className="text-xs text-cc-muted text-center py-4">Loading...</div>
              ) : envs.length === 0 ? (
                <div className="text-xs text-cc-muted text-center py-4">No environments yet. Create one below.</div>
              ) : (
                envs.map((env) => (
                  <div key={env.slug} className="border border-cc-border rounded-[10px] overflow-hidden">
                    {/* Env header row */}
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-cc-card">
                      <span className="text-xs font-medium text-cc-fg flex-1">{env.name}</span>
                      <span className="text-[10px] text-cc-muted">
                        {Object.keys(env.variables).length} var{Object.keys(env.variables).length !== 1 ? "s" : ""}
                      </span>
                      {editingSlug === env.slug ? (
                        <button
                          onClick={cancelEdit}
                          className="text-[10px] text-cc-muted hover:text-cc-fg cursor-pointer"
                        >
                          Cancel
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(env)}
                            className="text-[10px] text-cc-muted hover:text-cc-fg cursor-pointer"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(env.slug)}
                            className="text-[10px] text-cc-muted hover:text-cc-error cursor-pointer"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>

                    {/* Edit form */}
                    {editingSlug === env.slug && (
                      <div className="px-3 py-3 space-y-2 border-t border-cc-border">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Environment name"
                          className="w-full px-2 py-1.5 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/50"
                        />
                        <VarEditor rows={editVars} onChange={setEditVars} />
                        <button
                          onClick={saveEdit}
                          className="px-3 py-1.5 text-xs font-medium bg-cc-primary hover:bg-cc-primary-hover text-white rounded-lg transition-colors cursor-pointer"
                        >
                          Save
                        </button>
                      </div>
                    )}

                    {/* Variable preview (collapsed) */}
                    {editingSlug !== env.slug && Object.keys(env.variables).length > 0 && (
                      <div className="px-3 py-2 border-t border-cc-border space-y-0.5">
                        {Object.entries(env.variables).map(([k, v]) => (
                          <div key={k} className="flex items-center gap-1 text-[11px]">
                            <span className="font-mono-code text-cc-fg">{k}</span>
                            <span className="text-cc-muted">=</span>
                            <span className="font-mono-code text-cc-muted truncate">{v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}

              {/* Create new environment */}
              <div className="border border-cc-border rounded-[10px] overflow-hidden">
                <div className="px-3 py-2.5 bg-cc-card">
                  <span className="text-xs font-medium text-cc-muted">New Environment</span>
                </div>
                <div className="px-3 py-3 space-y-2 border-t border-cc-border">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Environment name (e.g. production)"
                    className="w-full px-2 py-1.5 text-xs bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/50"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newName.trim()) handleCreate();
                    }}
                  />
                  <VarEditor rows={newVars} onChange={setNewVars} />
                  <button
                    onClick={handleCreate}
                    disabled={!newName.trim() || creating}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      newName.trim() && !creating
                        ? "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
                        : "bg-cc-hover text-cc-muted cursor-not-allowed"
                    }`}
                  >
                    {creating ? "Creating..." : "Create"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
    </div>
  );

  if (isInline) {
    return (
      <div className="h-full min-h-0 overflow-y-auto px-4 py-5 bg-cc-bg">
        <div className="mx-auto w-full max-w-lg">{panel}</div>
      </div>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      {panel}
    </div>,
    document.body,
  );
}

// ─── Key-Value Editor ───────────────────────────────────────────────────

function VarEditor({ rows, onChange }: { rows: VarRow[]; onChange: (rows: VarRow[]) => void }) {
  function updateRow(i: number, field: "key" | "value", val: string) {
    const next = [...rows];
    next[i] = { ...next[i], [field]: val };
    onChange(next);
  }

  function removeRow(i: number) {
    const next = rows.filter((_, idx) => idx !== i);
    if (next.length === 0) next.push({ key: "", value: "" });
    onChange(next);
  }

  function addRow() {
    onChange([...rows, { key: "", value: "" }]);
  }

  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="text"
            value={row.key}
            onChange={(e) => updateRow(i, "key", e.target.value)}
            placeholder="KEY"
            className="flex-1 min-w-0 px-2 py-1 text-[11px] font-mono-code bg-cc-input-bg border border-cc-border rounded-md text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/50"
          />
          <span className="text-[10px] text-cc-muted">=</span>
          <input
            type="text"
            value={row.value}
            onChange={(e) => updateRow(i, "value", e.target.value)}
            placeholder="value"
            className="flex-1 min-w-0 px-2 py-1 text-[11px] font-mono-code bg-cc-input-bg border border-cc-border rounded-md text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/50"
          />
          <button
            onClick={() => removeRow(i)}
            className="w-5 h-5 flex items-center justify-center rounded text-cc-muted hover:text-cc-error transition-colors cursor-pointer shrink-0"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-2.5 h-2.5">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
      <button
        onClick={addRow}
        className="text-[10px] text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
      >
        + Add variable
      </button>
    </div>
  );
}
