-- Ultimate Pairs and Bad Beat side bets (scope addendum §22).
-- Every hand records the pay tables in force; every player row records stake, combination,
-- multiplier and net for each side bet so history and analytics never depend on current config.

ALTER TABLE hands
  ADD COLUMN pairs_variant    TEXT,
  ADD COLUMN bad_beat_variant TEXT;

ALTER TABLE hand_players
  ADD COLUMN pairs               BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN bad_beat            BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN pairs_net           BIGINT,
  ADD COLUMN bad_beat_net        BIGINT,
  ADD COLUMN pairs_combo         TEXT,
  ADD COLUMN bad_beat_combo      TEXT,
  ADD COLUMN pairs_multiplier    INTEGER,
  ADD COLUMN bad_beat_multiplier INTEGER,
  ADD COLUMN pairs_variant       TEXT,
  ADD COLUMN bad_beat_variant    TEXT,
  ADD COLUMN base_net            BIGINT;
