-- §27 Blackjack and §31 decision grading.
ALTER TABLE hands DROP CONSTRAINT IF EXISTS hands_game_check;
ALTER TABLE hands ADD CONSTRAINT hands_game_check CHECK (game IN ('uth', 'tcp', 'bj'));
ALTER TABLE hand_players DROP CONSTRAINT IF EXISTS hand_players_game_check;
ALTER TABLE hand_players ADD CONSTRAINT hand_players_game_check CHECK (game IN ('uth', 'tcp', 'bj'));
-- Blackjack: wagers added during the round (doubles, splits, insurance), and the per-hand detail.
ALTER TABLE hand_players ADD COLUMN bj_extra BIGINT NOT NULL DEFAULT 0;
ALTER TABLE hand_players ADD COLUMN bj_insurance BIGINT NOT NULL DEFAULT 0;
-- §31: a decision that couldn't be graded (no verified strategy, or the best play was unaffordable) is stored
-- as ungraded — never counted as right or wrong.
ALTER TABLE decisions ADD COLUMN graded BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE decisions ADD COLUMN ev_cost_cents BIGINT;
