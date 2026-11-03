-- Outs recorded with each graded decision: river = dealer's single-card outs + exact beating hands,
-- flop = the player's outs to improve. Kept with the decision so replays show what the player saw.
ALTER TABLE decisions ADD COLUMN outs JSONB;
