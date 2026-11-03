-- $5 Five Card Progressive: one linked meter for every table on this server.
CREATE TABLE progressive_meter (
  id          TEXT PRIMARY KEY,
  amount      BIGINT NOT NULL CHECK (amount >= 0),    -- cents
  hits        INTEGER NOT NULL DEFAULT 0,
  last_hit_at TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO progressive_meter(id, amount) VALUES ('five-card-5', 1000000) ON CONFLICT DO NOTHING;

-- Every meter-paid award (Royal / Straight Flush), with the meter value it was paid from.
CREATE TABLE progressive_hits (
  id           BIGSERIAL PRIMARY KEY,
  hand_id      TEXT NOT NULL REFERENCES hands(id),
  player_id    TEXT NOT NULL REFERENCES players(id),
  table_code   TEXT NOT NULL,
  hand_name    TEXT NOT NULL,
  amount       BIGINT NOT NULL,
  meter_before BIGINT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hand_id, player_id)
);

ALTER TABLE hand_players
  ADD COLUMN progressive      BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN progressive_net  BIGINT,
  ADD COLUMN progressive_hand TEXT;
