CREATE TABLE users (
    id TEXT PRIMARY KEY
);

CREATE TABLE workspaces (
    id TEXT PRIMARY KEY
);

CREATE TABLE members (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL
);

CREATE TABLE invites (
    id TEXT PRIMARY KEY
);

CREATE TABLE settings (
    workspace_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value BYTEA,
    PRIMARY KEY (workspace_id, key)
);

CREATE TABLE workspace_settings (
    workspace_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value BYTEA,
    PRIMARY KEY (workspace_id, key)
);

CREATE TABLE workspace_runtimes (
    workspace_id TEXT PRIMARY KEY,
    runtime TEXT NOT NULL
);
