-- Table nights (running tab + recap) and the rules version each hand was played under.
CREATE TABLE table_nights (
  id          TEXT PRIMARY KEY,
  table_code  TEXT NOT NULL REFERENCES game_tables(code),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ
);
CREATE INDEX table_nights_code ON table_nights(table_code, started_at DESC);
-- At most one open night per table.
CREATE UNIQUE INDEX table_nights_open ON table_nights(table_code) WHERE ended_at IS NULL;

ALTER TABLE hands
  ADD COLUMN night_id      TEXT REFERENCES table_nights(id),
  ADD COLUMN rules_version TEXT;
CREATE INDEX hands_night ON hands(night_id);
