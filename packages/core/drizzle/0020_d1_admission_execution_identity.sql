ALTER TABLE "d1_binding_admissions"
	ADD COLUMN "execution_identity_digest" text,
	ADD COLUMN "first_desired_state_digest" text,
	ADD CONSTRAINT "d1_binding_admissions_execution_digest_check" CHECK ("execution_identity_digest" ~ '^sha256:[a-f0-9]{64}$'),
	ADD CONSTRAINT "d1_binding_admissions_desired_digest_check" CHECK ("first_desired_state_digest" ~ '^sha256:[a-f0-9]{64}$');
