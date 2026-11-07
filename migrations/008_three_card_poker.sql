-- Three Card Poker (scope addendum §23). Every hand records its game; TCP wagers and results get their own columns.
ALTER TABLE hands ADD COLUMN game TEXT NOT NULL DEFAULT 'uth' CHECK (game IN ('uth', 'tcp'));
ALTER TABLE hand_players
  ADD COLUMN game           TEXT NOT NULL DEFAULT 'uth' CHECK (game IN ('uth', 'tcp')),
  ADD COLUMN pair_plus      BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN six_card       BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN pair_plus_net  BIGINT,
  ADD COLUMN six_card_net   BIGINT,
  ADD COLUMN ante_bonus_net BIGINT,
  ADD COLUMN pair_plus_hand TEXT,
  ADD COLUMN six_card_hand  TEXT;
CREATE INDEX hand_players_player_game ON hand_players(player_id, game);
