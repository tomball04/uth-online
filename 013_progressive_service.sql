-- §33–§39: one progressive service for all three games, Blackjack side bets, the rules profile of every
-- hand, and the Three Card Poker stored-rank correction.

-- Every meter is its own row: (variant, profile) never share a balance. The original Five Card meter keeps
-- its id and balance.
ALTER TABLE progressive_meter
  ADD COLUMN seed    BIGINT,
  ADD COLUMN game    TEXT,
  ADD COLUMN variant TEXT,
  ADD COLUMN profile TEXT;
UPDATE progressive_meter SET seed = 1000000, game = 'uth', variant = 'five-card-5', profile = 'casino' WHERE id = 'five-card-5';

ALTER TABLE progressive_hits ADD COLUMN meter_id TEXT NOT NULL DEFAULT 'five-card-5', ADD COLUMN meter_after BIGINT;
ALTER TABLE progressive_hits DROP CONSTRAINT IF EXISTS progressive_hits_hand_id_player_id_key;
ALTER TABLE progressive_hits ADD CONSTRAINT progressive_hits_once UNIQUE (hand_id, player_id, meter_id);

-- §37.8 transaction history: one row for EVERY settled progressive wager (wins, Envy-only and losses).
CREATE TABLE progressive_tx (
  id             BIGSERIAL PRIMARY KEY,
  hand_id        TEXT NOT NULL REFERENCES hands(id),
  player_id      TEXT NOT NULL REFERENCES players(id),
  table_code     TEXT NOT NULL,
  game           TEXT NOT NULL,
  meter_id       TEXT NOT NULL,
  variant        TEXT NOT NULL,
  profile        TEXT NOT NULL,
  wager          BIGINT NOT NULL,
  combo          TEXT,                 -- qualifying hand, null when nothing qualified
  category       TEXT NOT NULL,        -- 'meter' | 'fixed' | 'envy' | 'loss'
  pct            INTEGER,              -- share of the meter for 'meter' awards
  fixed_award    BIGINT NOT NULL DEFAULT 0,
  meter_award    BIGINT NOT NULL DEFAULT 0,
  envy           BIGINT NOT NULL DEFAULT 0,
  meter_before   BIGINT NOT NULL,
  meter_after    BIGINT NOT NULL,
  stake_returned BOOLEAN NOT NULL DEFAULT false,   -- always false: progressive awards are "for 1"
  amount         BIGINT NOT NULL,      -- total credited for this wager
  net            BIGINT NOT NULL,      -- amount - wager
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hand_id, player_id, meter_id)
);
CREATE INDEX progressive_tx_player ON progressive_tx(player_id, created_at);

-- Which meter a player's progressive wager fed, and by how much (so a voided hand can take it back exactly).
ALTER TABLE hand_players
  ADD COLUMN prog_meter   TEXT,
  ADD COLUMN prog_contrib BIGINT NOT NULL DEFAULT 0,
  -- §34 Blackjack side bets: stakes as placed ({id: cents}) and, after settlement, one result per wager.
  ADD COLUMN side_bets    JSONB,
  ADD COLUMN side_stake   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN side_results JSONB;

-- §34.5 the exact pay tables / profiles a hand was played under.
ALTER TABLE hands ADD COLUMN rules_profile JSONB;

-- §35: Three Card Poker hands were stored with a five-card-style rank (Flush 5 > Straight 4 > Three of a Kind 3).
-- Re-rank them in Three Card order so history, best-hand stats and recaps compare them correctly.
UPDATE hand_players SET hand_rank = CASE hand_name
    WHEN 'High Card' THEN 0 WHEN 'Pair' THEN 1 WHEN 'Flush' THEN 2 WHEN 'Straight' THEN 3
    WHEN 'Three of a Kind' THEN 4 WHEN 'Straight Flush' THEN 8 ELSE hand_rank END
  WHERE game = 'tcp' AND settled;
