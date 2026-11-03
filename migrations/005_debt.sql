-- Just for fun: every reload is a marker from the house; markers add up to a per-table debt (cents).
ALTER TABLE stacks ADD COLUMN debt BIGINT NOT NULL DEFAULT 0;
-- Backfill from existing reload ledger rows.
UPDATE stacks s SET debt = COALESCE((SELECT SUM(l.amount) FROM ledger l
  WHERE l.player_id = s.player_id AND l.table_code = s.table_code AND l.kind = 'reload' AND l.amount > 0), 0);
