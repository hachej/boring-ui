CREATE TABLE IF NOT EXISTS "boring_credit_purchases" (
  "order_id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "amount_micros" bigint NOT NULL,
  "source" text DEFAULT 'lemonsqueezy' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "boring_credit_purchases_user_idx" ON "boring_credit_purchases" USING btree ("user_id");
