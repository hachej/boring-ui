-- #1463: idx_workspaces_default_per_user_app only excluded non-default rows,
-- not soft-deleted ones. Deleting a user's default workspace (deleted_at set,
-- is_default stays true) left a tombstoned row that still satisfied the old
-- partial index, so the auto-recreate insert for a fresh default collided
-- with it (duplicate key) and left the user with zero active workspaces.
-- Rebuild the index scoped to live rows only.
DROP INDEX "idx_workspaces_default_per_user_app";
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_workspaces_default_per_user_app"
  ON "workspaces" USING btree ("created_by","app_id")
  WHERE "workspaces"."is_default" = true AND "workspaces"."deleted_at" IS NULL;
