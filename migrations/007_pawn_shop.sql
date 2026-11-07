-- Just for fun: the pawn shop. One row per marker taken or paid back; never changes chips by itself
-- (the chips move in the ledger, kind 'reload': positive for a marker, negative for a payoff).
CREATE TABLE debt_events (
  id          BIGSERIAL PRIMARY KEY,
  player_id   TEXT NOT NULL REFERENCES players(id),
  table_code  TEXT NOT NULL REFERENCES game_tables(code),
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('marker', 'payoff')),
  amount      BIGINT NOT NULL,
  debt_after  BIGINT NOT NULL,
  item        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX debt_events_table ON debt_events(table_code, id DESC);
