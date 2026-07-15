ALTER TABLE "d1_destructive_publication_events"
	ADD COLUMN "source_revision" text,
	ADD COLUMN "source_digest" text,
	ADD CONSTRAINT "d1_destructive_publication_source_pair_check" CHECK (("source_revision" IS NULL) = ("source_digest" IS NULL)),
	ADD CONSTRAINT "d1_destructive_publication_source_revision_check" CHECK ("source_revision" IS NULL OR "source_revision" ~ '^r[0-9]{10}$'),
	ADD CONSTRAINT "d1_destructive_publication_source_digest_check" CHECK ("source_digest" IS NULL OR "source_digest" ~ '^sha256:[a-f0-9]{64}$');
