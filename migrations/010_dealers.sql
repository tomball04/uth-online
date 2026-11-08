-- §25 Rotating dealers: which dealer is working each table and how many completed rounds into the shift.
-- Presentation only; nothing here is read by dealing or settlement.
ALTER TABLE game_tables ADD COLUMN dealer_id TEXT;
ALTER TABLE game_tables ADD COLUMN dealer_rounds INT NOT NULL DEFAULT 0;
