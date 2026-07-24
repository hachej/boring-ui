CREATE TABLE "workspace_credential_keys" (
	"workspace_id" uuid NOT NULL,
	"dek_generation" integer NOT NULL,
	"kek_provider_id" text NOT NULL,
	"key_ref" text NOT NULL,
	"key_version" integer NOT NULL,
	"wrapper_format" text NOT NULL,
	"wrapped_payload" bytea NOT NULL,
	"wrapper_nonce" bytea,
	"wrapper_auth_tag" bytea,
	"wrapper_aad_context" bytea,
	"state" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_credential_keys_workspace_id_dek_generation_pk" PRIMARY KEY("workspace_id","dek_generation"),
	CONSTRAINT "workspace_credential_keys_generation_check" CHECK ("workspace_credential_keys"."dek_generation" > 0),
	CONSTRAINT "workspace_credential_keys_key_version_check" CHECK ("workspace_credential_keys"."key_version" > 0),
	CONSTRAINT "workspace_credential_keys_state_check" CHECK ("workspace_credential_keys"."state" IN ('active', 'retired', 'destroyed')),
	CONSTRAINT "workspace_credential_keys_wrapper_format_check" CHECK ("workspace_credential_keys"."wrapper_format" IN ('vault-transit-ciphertext.v1', 'local-aes-256-gcm.v1', 'external-kms-opaque.v1')),
	CONSTRAINT "workspace_credential_keys_payload_size_check" CHECK (octet_length("workspace_credential_keys"."wrapped_payload") BETWEEN 1 AND 65536),
	CONSTRAINT "workspace_credential_keys_local_wrapper_shape_check" CHECK (("workspace_credential_keys"."wrapper_format" = 'local-aes-256-gcm.v1' AND "workspace_credential_keys"."wrapper_nonce" IS NOT NULL AND "workspace_credential_keys"."wrapper_auth_tag" IS NOT NULL AND "workspace_credential_keys"."wrapper_aad_context" IS NOT NULL AND octet_length("workspace_credential_keys"."wrapped_payload") = 32 AND octet_length("workspace_credential_keys"."wrapper_nonce") = 12 AND "workspace_credential_keys"."wrapper_nonce" <> decode(repeat('00', 12), 'hex') AND octet_length("workspace_credential_keys"."wrapper_auth_tag") = 16 AND octet_length("workspace_credential_keys"."wrapper_aad_context") BETWEEN 1 AND 4096) OR ("workspace_credential_keys"."wrapper_format" <> 'local-aes-256-gcm.v1' AND "workspace_credential_keys"."wrapper_nonce" IS NULL AND "workspace_credential_keys"."wrapper_auth_tag" IS NULL AND "workspace_credential_keys"."wrapper_aad_context" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "workspace_provider_credentials" (
	"workspace_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"display_label" text NOT NULL,
	"credential_type" text NOT NULL,
	"credential_schema_version" integer NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"active_credential_version" integer NOT NULL,
	"dek_generation" integer NOT NULL,
	"masked_last_four_suffix" text,
	"created_by_actor_id" uuid,
	"updated_by_actor_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_provider_credentials_workspace_id_provider_id_pk" PRIMARY KEY("workspace_id","provider_id"),
	CONSTRAINT "workspace_provider_credentials_state_check" CHECK ("workspace_provider_credentials"."state" IN ('active', 'disabled', 'revoked', 'needs_reauth', 'intentionally_absent', 'instance_fallback_enabled')),
	CONSTRAINT "workspace_provider_credentials_version_check" CHECK ("workspace_provider_credentials"."active_credential_version" > 0 AND "workspace_provider_credentials"."credential_schema_version" > 0 AND "workspace_provider_credentials"."dek_generation" > 0),
	CONSTRAINT "workspace_provider_credentials_text_bounds_check" CHECK (length("workspace_provider_credentials"."provider_id") BETWEEN 1 AND 64 AND length("workspace_provider_credentials"."display_label") BETWEEN 1 AND 256 AND length("workspace_provider_credentials"."credential_type") BETWEEN 1 AND 64),
	CONSTRAINT "workspace_provider_credentials_mask_check" CHECK ("workspace_provider_credentials"."masked_last_four_suffix" IS NULL OR "workspace_provider_credentials"."masked_last_four_suffix" = 'configured' OR ("workspace_provider_credentials"."masked_last_four_suffix" ~ '^[!-~]{4}$'))
);
--> statement-breakpoint
CREATE TABLE "workspace_provider_credential_fields" (
	"workspace_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"credential_version" integer NOT NULL,
	"field_id" text NOT NULL,
	"envelope_version" text NOT NULL,
	"ciphertext" bytea NOT NULL,
	"nonce" bytea NOT NULL,
	"auth_tag" bytea NOT NULL,
	"aad_context" bytea NOT NULL,
	"dek_generation" integer NOT NULL,
	CONSTRAINT "workspace_provider_credential_fields_pk" PRIMARY KEY("workspace_id","provider_id","credential_version","field_id"),
	CONSTRAINT "workspace_provider_credential_fields_version_check" CHECK ("workspace_provider_credential_fields"."credential_version" > 0 AND "workspace_provider_credential_fields"."dek_generation" > 0),
	CONSTRAINT "workspace_provider_credential_fields_identity_check" CHECK (length("workspace_provider_credential_fields"."provider_id") BETWEEN 1 AND 64 AND length("workspace_provider_credential_fields"."field_id") BETWEEN 1 AND 64),
	CONSTRAINT "workspace_provider_credential_fields_envelope_check" CHECK ("workspace_provider_credential_fields"."envelope_version" = 'boring.credential-envelope.v1'),
	CONSTRAINT "workspace_provider_credential_fields_crypto_shape_check" CHECK (octet_length("workspace_provider_credential_fields"."ciphertext") BETWEEN 0 AND 65536 AND octet_length("workspace_provider_credential_fields"."nonce") = 12 AND "workspace_provider_credential_fields"."nonce" <> decode(repeat('00', 12), 'hex') AND octet_length("workspace_provider_credential_fields"."auth_tag") = 16 AND octet_length("workspace_provider_credential_fields"."aad_context") BETWEEN 1 AND 4096)
);
--> statement-breakpoint
ALTER TABLE "workspace_credential_keys" ADD CONSTRAINT "workspace_credential_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_provider_credentials" ADD CONSTRAINT "workspace_provider_credentials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_provider_credentials" ADD CONSTRAINT "workspace_provider_credentials_created_by_actor_id_users_id_fk" FOREIGN KEY ("created_by_actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_provider_credentials" ADD CONSTRAINT "workspace_provider_credentials_updated_by_actor_id_users_id_fk" FOREIGN KEY ("updated_by_actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_provider_credentials" ADD CONSTRAINT "workspace_provider_credentials_dek_fk" FOREIGN KEY ("workspace_id","dek_generation") REFERENCES "public"."workspace_credential_keys"("workspace_id","dek_generation") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_provider_credential_fields" ADD CONSTRAINT "workspace_provider_credential_fields_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_provider_credential_fields" ADD CONSTRAINT "workspace_provider_credential_fields_credential_fk" FOREIGN KEY ("workspace_id","provider_id") REFERENCES "public"."workspace_provider_credentials"("workspace_id","provider_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_provider_credential_fields" ADD CONSTRAINT "workspace_provider_credential_fields_dek_fk" FOREIGN KEY ("workspace_id","dek_generation") REFERENCES "public"."workspace_credential_keys"("workspace_id","dek_generation") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_credential_keys_one_active_idx" ON "workspace_credential_keys" USING btree ("workspace_id") WHERE "workspace_credential_keys"."state" = 'active';
--> statement-breakpoint
CREATE INDEX "workspace_provider_credential_fields_lookup_idx" ON "workspace_provider_credential_fields" USING btree ("workspace_id","provider_id","credential_version");
