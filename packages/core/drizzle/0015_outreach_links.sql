ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isAnonymous" boolean DEFAULT false;

CREATE TABLE "outreach_experiences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" text NOT NULL,
  "name" text NOT NULL,
  "provisioning_mode" text NOT NULL,
  "template_workspace_id" uuid,
  "default_target_path" text DEFAULT '/' NOT NULL,
  "anonymous_capability_profile" text DEFAULT 'trial' NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "outreach_experiences_mode_check" CHECK ("outreach_experiences"."provisioning_mode" IN ('clone_per_lead', 'shared_readonly', 'existing_workspace_viewer'))
);

CREATE TABLE "outreach_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" text NOT NULL,
  "experience_id" uuid NOT NULL,
  "campaign_id" text,
  "token_hash" text NOT NULL,
  "recipient_hint" text,
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "max_leads" integer,
  "lead_count" integer DEFAULT 0 NOT NULL,
  "first_opened_at" timestamp,
  "last_opened_at" timestamp,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "outreach_links_token_hash_unique" UNIQUE("token_hash"),
  CONSTRAINT "outreach_links_max_leads_check" CHECK ("outreach_links"."max_leads" IS NULL OR "outreach_links"."max_leads" > 0),
  CONSTRAINT "outreach_links_lead_count_check" CHECK ("outreach_links"."lead_count" >= 0)
);

CREATE TABLE "outreach_leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" text NOT NULL,
  "outreach_link_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "provisioned_workspace_id" uuid,
  "provisioned_target_path" text,
  "provision_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "provisioning_status" text DEFAULT 'pending' NOT NULL,
  "provisioning_error_code" text,
  "provisioning_attempted_at" timestamp,
  "provisioning_completed_at" timestamp,
  "resume_nonce_hash" text,
  "status" text DEFAULT 'anonymous' NOT NULL,
  "claimed_at" timestamp,
  "claimed_email" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "outreach_leads_user_id_unique" UNIQUE("user_id"),
  CONSTRAINT "outreach_leads_status_check" CHECK ("outreach_leads"."status" IN ('anonymous', 'claimed', 'blocked')),
  CONSTRAINT "outreach_leads_provisioning_status_check" CHECK ("outreach_leads"."provisioning_status" IN ('pending', 'provisioning', 'provisioned', 'failed')),
  CONSTRAINT "outreach_leads_provision_result_check" CHECK (("outreach_leads"."provisioned_workspace_id" IS NULL AND "outreach_leads"."provisioned_target_path" IS NULL) OR ("outreach_leads"."provisioned_workspace_id" IS NOT NULL AND "outreach_leads"."provisioned_target_path" IS NOT NULL))
);

ALTER TABLE "outreach_experiences" ADD CONSTRAINT "outreach_experiences_template_workspace_id_workspaces_id_fk" FOREIGN KEY ("template_workspace_id") REFERENCES "workspaces"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "outreach_experiences" ADD CONSTRAINT "outreach_experiences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "outreach_links" ADD CONSTRAINT "outreach_links_experience_id_outreach_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "outreach_experiences"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "outreach_links" ADD CONSTRAINT "outreach_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "outreach_leads" ADD CONSTRAINT "outreach_leads_outreach_link_id_outreach_links_id_fk" FOREIGN KEY ("outreach_link_id") REFERENCES "outreach_links"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "outreach_leads" ADD CONSTRAINT "outreach_leads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "outreach_leads" ADD CONSTRAINT "outreach_leads_provisioned_workspace_id_workspaces_id_fk" FOREIGN KEY ("provisioned_workspace_id") REFERENCES "workspaces"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX "outreach_experiences_app_id_idx" ON "outreach_experiences" USING btree ("app_id");
CREATE UNIQUE INDEX "outreach_links_token_hash_idx" ON "outreach_links" USING btree ("token_hash");
CREATE INDEX "outreach_links_app_id_idx" ON "outreach_links" USING btree ("app_id");
CREATE INDEX "outreach_links_experience_id_idx" ON "outreach_links" USING btree ("experience_id");
CREATE UNIQUE INDEX "outreach_leads_user_id_idx" ON "outreach_leads" USING btree ("user_id");
CREATE INDEX "outreach_leads_link_status_idx" ON "outreach_leads" USING btree ("outreach_link_id", "status");
