CREATE TABLE "d1_binding_admissions" (
	"sequence" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	"host_id" text NOT NULL,
	"binding_id" text NOT NULL,
	"active_revision" text NOT NULL,
	"admitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "d1_binding_admissions_pk" PRIMARY KEY("host_id","binding_id"),
	CONSTRAINT "d1_binding_admissions_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "d1_binding_admissions_revision_check" CHECK ("active_revision" ~ '^r[0-9]{10}$')
);
