-- §32 Dealer Roast Engine: comedic dealer-vs-player records. Never read by dealing, shuffling or settlement.
CREATE TABLE IF NOT EXISTS dealer_rivalries (
  dealer_id   TEXT NOT NULL,
  player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  witnessed   INTEGER NOT NULL DEFAULT 0,  -- verified strategy mistakes this dealer saw
  wins        INTEGER NOT NULL DEFAULT 0,  -- hands the player won on this dealer's shifts
  jackpots    INTEGER NOT NULL DEFAULT 0,
  mocked_then_won INTEGER NOT NULL DEFAULT 0,
  events      JSONB NOT NULL DEFAULT '[]', -- last few memorable, real events (hit20, split10, bigLoss, …)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dealer_id, player_id)
);
