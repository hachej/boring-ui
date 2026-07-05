// Provenance: copied from /home/ubuntu/projects/ext-pi-for-excel-test/boring-connector/boring-connector.mjs on 2026-07-05 for issue #526 plan-pack reference.
const CONFIG_GLOBAL_KEY = "__BORING_CONNECTOR_CONFIG__";
const DEFAULT_CONFIG = Object.freeze({
  baseUrl: "http://localhost:3000",
  workspaceId: "",
  connectionId: "boring",
  connectionTitle: "Boring UI workspace API",
  connectionCapability: "read and write files in a Boring workspace",
  secretFieldId: "token",
  secretFieldLabel: "API token or bearer token",
  authHeaderName: "Authorization",
  authValueTemplate: "Bearer {token}",
  allowedHosts: [],
});

const EXCEL_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const FORBIDDEN_KEY_PATTERN = /(^|_)(access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|cookie|authorization|preview[_-]?url|get[_-]?url|post[_-]?url|wopi[_-]?token)($|_)/i;
const FORBIDDEN_STRING_PATTERN = /([?&#](access_token|refresh_token|id_token|wopiToken|authorization|cookie|sig|signature)=)|Bearer\s+[A-Za-z0-9._~+/-]+=*/i;
const ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textResult(text, details) {
  return { content: [{ type: "text", text }], details };
}

function asOptionalString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function requireString(params, key) {
  const value = asOptionalString(params?.[key]);
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function normalizeBaseUrl(value) {
  const raw = asOptionalString(value) ?? DEFAULT_CONFIG.baseUrl;
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Boring base URL must use http or https.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

function hostFromUrl(value) {
  return new URL(value).hostname.toLowerCase();
}

function normalizeAllowedHost(value) {
  const raw = asOptionalString(value);
  if (!raw) return undefined;
  if (raw.includes("://")) return hostFromUrl(raw);
  const withoutPort = raw.includes(":") ? raw.slice(0, raw.indexOf(":")) : raw;
  return withoutPort.trim().toLowerCase() || undefined;
}

function normalizeWorkspaceId(config, params) {
  const workspaceId = asOptionalString(params?.workspaceId) ?? asOptionalString(config.workspaceId);
  if (!workspaceId) throw new Error("Boring workspace id is required in connector config or tool params.");
  if (workspaceId.includes("\0") || workspaceId.includes("/") || workspaceId.includes("\\") || workspaceId.includes("..")) {
    throw new Error("Boring workspace id is invalid.");
  }
  return workspaceId;
}

function readGlobalConfig() {
  const value = globalThis?.[CONFIG_GLOBAL_KEY];
  return isRecord(value) ? value : {};
}

export function resolveBoringConnectorConfig(overrides = {}) {
  const merged = { ...DEFAULT_CONFIG, ...readGlobalConfig(), ...overrides };
  const baseUrl = normalizeBaseUrl(merged.baseUrl);
  const allowedHosts = new Set([hostFromUrl(baseUrl)]);
  if (Array.isArray(merged.allowedHosts)) {
    for (const host of merged.allowedHosts) {
      const normalized = normalizeAllowedHost(host);
      if (normalized) allowedHosts.add(normalized);
    }
  }
  return {
    ...merged,
    baseUrl,
    allowedHosts: Array.from(allowedHosts).sort((left, right) => left.localeCompare(right)),
  };
}

function buildApiUrl(config, pathname, query = {}) {
  const url = new URL(`${config.baseUrl}${pathname}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function redactString(value) {
  let redacted = value.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]");
  redacted = redacted.replace(/([?&#](?:access_token|refresh_token|id_token|wopiToken|authorization|cookie|sig|signature)=)[^&#\s]+/gi, "$1[REDACTED]");
  return redacted;
}

function redactForToolResult(value) {
  if (Array.isArray(value)) return value.map((entry) => redactForToolResult(entry));
  if (!isRecord(value)) return typeof value === "string" ? redactString(value) : value;
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      out[key] = "[REDACTED]";
    } else {
      out[key] = redactForToolResult(nested);
    }
  }
  return out;
}

function assertNoForbiddenRefData(value, path = "ref") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenRefData(entry, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) {
    if (typeof value === "string" && FORBIDDEN_STRING_PATTERN.test(value)) {
      throw new Error(`${path} contains token-bearing data.`);
    }
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      throw new Error(`${nestedPath} is not allowed in a stored SharePoint ref.`);
    }
    assertNoForbiddenRefData(nested, nestedPath);
  }
}

function assertWorkspaceRelativePath(path, label) {
  if (!path || path.includes("\0")) throw new Error(`${label} must be a non-empty workspace-relative path.`);
  if (ABSOLUTE_PATH_PATTERN.test(path)) throw new Error(`${label} must be workspace-relative, not absolute.`);
  if (path.includes("\\")) throw new Error(`${label} must use forward slashes.`);
  if (path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${label} must not contain empty, dot, or traversal segments.`);
  }
}

function basenameFromWebUrl(webUrl) {
  try {
    const url = new URL(webUrl);
    const segment = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
    return segment || "workbook.xlsx";
  } catch {
    return "workbook.xlsx";
  }
}

function getOfficeDocumentUrl() {
  const office = globalThis?.Office;
  const url = office?.context?.document?.url;
  return typeof url === "string" && url.trim().length > 0 ? url.trim() : undefined;
}

export function buildExcelCloudRef(params = {}) {
  const webUrl = asOptionalString(params.webUrl) ?? getOfficeDocumentUrl();
  if (!webUrl) {
    throw new Error("webUrl is required. Pi extensions do not expose durable SharePoint identity for the current workbook.");
  }
  const parsedWebUrl = new URL(webUrl);
  if (parsedWebUrl.protocol !== "https:") throw new Error("webUrl must be an https URL.");
  if (FORBIDDEN_STRING_PATTERN.test(webUrl)) throw new Error("webUrl contains token-bearing query data.");

  const name = asOptionalString(params.name) ?? basenameFromWebUrl(webUrl);
  if (!name.endsWith(".xlsx")) throw new Error("Excel cloud refs must use a .xlsx workbook name.");

  const ref = {
    kind: "office-cloud-document",
    provider: "sharepoint",
    version: 1,
    name,
    officeKind: "excel",
    mimeType: EXCEL_MIME_TYPE,
    webUrl,
    siteId: requireString(params, "siteId"),
    driveId: requireString(params, "driveId"),
    driveItemId: requireString(params, "driveItemId"),
  };

  const sourcePath = asOptionalString(params.sourcePath);
  if (sourcePath) {
    assertWorkspaceRelativePath(sourcePath, "sourcePath");
    ref.createdFrom = { type: "sharepoint", originalPath: sourcePath };
  }

  assertNoForbiddenRefData(ref);
  return ref;
}

export function cloudRefPathForExcel(params = {}) {
  const explicitPath = asOptionalString(params.path);
  if (explicitPath) {
    assertWorkspaceRelativePath(explicitPath, "path");
    if (!explicitPath.endsWith(".xlsx.cloud.json")) {
      throw new Error("path must end with .xlsx.cloud.json.");
    }
    return explicitPath;
  }
  const sourcePath = asOptionalString(params.sourcePath);
  if (sourcePath) {
    assertWorkspaceRelativePath(sourcePath, "sourcePath");
    if (!sourcePath.endsWith(".xlsx")) throw new Error("sourcePath must end with .xlsx.");
    return `${sourcePath}.cloud.json`;
  }
  const name = asOptionalString(params.name) ?? basenameFromWebUrl(asOptionalString(params.webUrl) ?? getOfficeDocumentUrl() ?? "workbook.xlsx");
  if (!name.endsWith(".xlsx")) throw new Error("name must end with .xlsx.");
  return `${name}.cloud.json`;
}

async function parseJsonResponse(response) {
  try {
    return JSON.parse(response.body);
  } catch {
    throw new Error(`Boring API returned non-JSON response: HTTP ${response.status} ${response.statusText}`);
  }
}

async function boringFetch(api, config, pathname, params = {}, options = {}) {
  const workspaceId = normalizeWorkspaceId(config, params);
  const headers = {
    Accept: "application/json",
    "x-boring-workspace-id": workspaceId,
    ...(options.headers ?? {}),
  };
  const response = await api.http.fetch(
    buildApiUrl(config, pathname, options.query),
    {
      method: options.method ?? "GET",
      headers,
      body: options.body,
      connection: config.connectionId,
      timeoutMs: options.timeoutMs ?? 30000,
    },
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Boring API failed: HTTP ${response.status} ${response.statusText} ${redactString(response.body)}`.trim());
  }
  return response;
}

async function listFiles(api, config, params) {
  const path = asOptionalString(params?.path) ?? ".";
  assertWorkspaceRelativePath(path === "." ? "root" : path, "path");
  const recursive = params?.recursive === true;
  const response = await boringFetch(api, config, "/api/v1/tree", params, {
    query: { path, recursive: recursive ? "true" : "false" },
  });
  const body = await parseJsonResponse(response);
  const entries = Array.isArray(body.entries) ? body.entries : [];
  const safeEntries = redactForToolResult(entries);
  return textResult(
    `Listed ${entries.length} workspace entries under ${path}.`,
    { ok: true, path, recursive, entries: safeEntries },
  );
}

async function readFile(api, config, params) {
  const path = requireString(params, "path");
  assertWorkspaceRelativePath(path, "path");
  const response = await boringFetch(api, config, "/api/v1/files", params, {
    query: { path },
  });
  const body = await parseJsonResponse(response);
  const content = typeof body.content === "string" ? body.content : "";
  return textResult(
    redactString(content),
    {
      ok: true,
      path,
      mtimeMs: typeof body.mtimeMs === "number" ? body.mtimeMs : undefined,
      access: typeof body.access === "string" ? body.access : undefined,
    },
  );
}

async function writeTextFile(api, config, params, path, content) {
  assertWorkspaceRelativePath(path, "path");
  const response = await boringFetch(api, config, "/api/v1/files", params, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content, createDirs: true }),
  });
  return parseJsonResponse(response);
}

async function saveCloudRef(api, config, params) {
  const ref = buildExcelCloudRef(params);
  const path = cloudRefPathForExcel({ ...params, name: ref.name, webUrl: ref.webUrl });
  const body = `${JSON.stringify(ref, null, 2)}\n`;
  const result = await writeTextFile(api, config, params, path, body);
  return textResult(
    `Saved SharePoint Excel cloud ref at ${path}.`,
    { ok: true, path, name: ref.name, mtimeMs: result.mtimeMs },
  );
}

async function postNote(api, config, params) {
  const path = requireString(params, "path");
  const markdown = requireString(params, "markdown");
  const result = await writeTextFile(api, config, params, path, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
  return textResult(
    `Saved note at ${path}.`,
    { ok: true, path, mtimeMs: result.mtimeMs },
  );
}

function registerTool(api, config, name, definition) {
  api.registerTool(name, {
    ...definition,
    requiresConnection: [config.connectionId],
  });
}

export function activate(api) {
  const config = resolveBoringConnectorConfig();
  api.connections.register({
    id: config.connectionId,
    title: config.connectionTitle,
    capability: config.connectionCapability,
    authKind: "api_key",
    secretFields: [{
      id: config.secretFieldId,
      label: config.secretFieldLabel,
      required: true,
      maskInUi: true,
    }],
    httpAuth: {
      placement: "header",
      headerName: config.authHeaderName,
      valueTemplate: config.authValueTemplate,
      allowedHosts: config.allowedHosts,
    },
    setupHint: "Open /tools -> Connections -> Extension connections -> Boring UI workspace API",
  });

  registerTool(api, config, "boring_list_files", {
    description: "List files in the configured boring-ui workspace using GET /api/v1/tree.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative directory path. Defaults to root." },
        recursive: { type: "boolean", description: "List recursively, capped by boring-ui." },
        workspaceId: { type: "string", description: "Optional workspace id override for tests or multi-workspace use." },
      },
      additionalProperties: false,
    },
    execute: (params) => listFiles(api, config, params),
  });

  registerTool(api, config, "boring_read_file", {
    description: "Read a text file from the configured boring-ui workspace using GET /api/v1/files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        workspaceId: { type: "string", description: "Optional workspace id override for tests or multi-workspace use." },
      },
      required: ["path"],
      additionalProperties: false,
    },
    execute: (params) => readFile(api, config, params),
  });

  registerTool(api, config, "boring_save_cloud_ref", {
    description: "Persist a SharePoint-backed Excel *.xlsx.cloud.json reference into the boring-ui workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional destination path ending in .xlsx.cloud.json." },
        sourcePath: { type: "string", description: "Optional workspace-relative .xlsx source path used to derive the cloud ref path." },
        name: { type: "string", description: "Workbook file name ending in .xlsx." },
        webUrl: { type: "string", description: "HTTPS SharePoint open URL. Falls back to Office.context.document.url only when available." },
        siteId: { type: "string", description: "Microsoft Graph SharePoint site id." },
        driveId: { type: "string", description: "Microsoft Graph drive id." },
        driveItemId: { type: "string", description: "Microsoft Graph drive item id." },
        workspaceId: { type: "string", description: "Optional workspace id override for tests or multi-workspace use." },
      },
      required: ["siteId", "driveId", "driveItemId"],
      additionalProperties: false,
    },
    execute: (params) => saveCloudRef(api, config, params),
  });

  registerTool(api, config, "boring_post_note", {
    description: "Write a Markdown note into the configured boring-ui workspace using POST /api/v1/files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative destination path." },
        markdown: { type: "string", description: "Markdown content to write." },
        workspaceId: { type: "string", description: "Optional workspace id override for tests or multi-workspace use." },
      },
      required: ["path", "markdown"],
      additionalProperties: false,
    },
    execute: (params) => postNote(api, config, params),
  });
}
