-- Durable terminal-charge intent for reservations. Set true when the metering
-- coordinator decided a run must be charged the fallback hold (started/successful
-- run with no billable usage, or a failed usage write) BEFORE attempting the
-- charge. If that charge write then fails transiently, the stale-expiry sweep still
-- charges the hold for a marked reservation even when it has zero billed usage rows
-- — so a started run can't go free on a brief finalization-time DB outage.
ALTER TABLE "boring_usage_reservations" ADD COLUMN "charge_on_expire" boolean DEFAULT false NOT NULL;
