-- Purchase lifecycle: allow a refund-before-grant tombstone and a money-safety
-- amount check. user_id/amount_micros become nullable so a refund that arrives
-- before order_created can write a 'refunded' tombstone that blocks a later grant.
ALTER TABLE "boring_credit_purchases" ALTER COLUMN "user_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "boring_credit_purchases" ALTER COLUMN "amount_micros" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "boring_credit_purchases" ADD COLUMN "status" text DEFAULT 'granted' NOT NULL;
--> statement-breakpoint
ALTER TABLE "boring_credit_purchases" ADD COLUMN "refunded_at" timestamp;
--> statement-breakpoint
ALTER TABLE "boring_credit_purchases" ADD COLUMN "refunded_micros" bigint;
--> statement-breakpoint
ALTER TABLE "boring_credit_purchases" ADD COLUMN "pending_refund_ppm" bigint;
--> statement-breakpoint
ALTER TABLE "boring_credit_purchases" ADD CONSTRAINT "boring_credit_purchases_amount_check" CHECK ("amount_micros" IS NULL OR "amount_micros" > 0);
--> statement-breakpoint
ALTER TABLE "boring_credit_purchases" ADD CONSTRAINT "boring_credit_purchases_status_check" CHECK ("status" IN ('granted', 'refunded', 'refund_pending'));
--> statement-breakpoint
ALTER TABLE "boring_credit_purchases" ADD CONSTRAINT "boring_credit_purchases_granted_check" CHECK ("status" IN ('refunded', 'refund_pending') OR ("user_id" IS NOT NULL AND "amount_micros" IS NOT NULL));
