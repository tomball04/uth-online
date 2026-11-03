-- Ultimate Texas Hold'em Online — initial schema.
-- All money columns are BIGINT cents. Every balance change goes through the ledger with a unique
-- tx_key, which makes wagers, payouts, refunds and reloads idempotent.

CREATE TABLE players (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  avatar        TEXT NOT NULL DEFAULT '',
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE game_tables (
  code          TEXT PRIMARY KEY,
  host_id       TEXT NOT NULL REFERENCES players(id),
  config        JSONB NOT NULL,
  hand_counter  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at     TIMESTAMPTZ
);

-- A player's chip stack at one table. Created at the table's starting bankroll on first sit.
CREATE TABLE stacks (
  player_id     TEXT NOT NULL REFERENCES players(id),
  table_code    TEXT NOT NULL REFERENCES game_tables(code),
  balance       BIGINT NOT NULL CHECK (balance >= 0),
  reloads       INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, table_code)
);

CREATE TABLE hands (
  id                 TEXT PRIMARY KEY,
  table_code         TEXT NOT NULL REFERENCES game_tables(code),
  hand_number        INTEGER NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('active', 'settled', 'voided')),
  deck_commitment    TEXT NOT NULL,             -- sha256 of the shuffled deck (audit)
  dealer_cards       JSONB NOT NULL,            -- server-only until showdown
  community          JSONB NOT NULL,            -- server-only until revealed
  participant_count  INTEGER NOT NULL,
  dealer_hand        TEXT,
  dealer_qualifies   BOOLEAN,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at         TIMESTAMPTZ,
  UNIQUE (table_code, hand_number)
);
CREATE INDEX hands_active ON hands(status) WHERE status = 'active';

CREATE TABLE hand_players (
  hand_id       TEXT NOT NULL REFERENCES hands(id),
  player_id     TEXT NOT NULL REFERENCES players(id),
  seat          INTEGER NOT NULL,
  name          TEXT NOT NULL,
  hole          JSONB NOT NULL,
  ante          BIGINT NOT NULL,
  blind         BIGINT NOT NULL,
  trips         BIGINT NOT NULL DEFAULT 0,
  play          BIGINT NOT NULL DEFAULT 0,
  folded        BOOLEAN NOT NULL DEFAULT false,
  outcome       TEXT,
  hand_name     TEXT,
  hand_rank     INTEGER,
  net           BIGINT,
  trips_net     BIGINT,
  settlement    JSONB,
  settled       BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (hand_id, player_id)
);
CREATE INDEX hand_players_player ON hand_players(player_id);

CREATE TABLE decisions (
  hand_id       TEXT NOT NULL REFERENCES hands(id),
  player_id     TEXT NOT NULL REFERENCES players(id),
  phase         TEXT NOT NULL,
  action        TEXT NOT NULL,
  recommended   TEXT NOT NULL,
  correct       BOOLEAN NOT NULL,
  timed_out     BOOLEAN NOT NULL DEFAULT false,
  reason        TEXT NOT NULL DEFAULT '',
  ev_cost       DOUBLE PRECISION,             -- ante units (analysis only, never money)
  ev_exact      BOOLEAN,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hand_id, player_id, phase)
);

CREATE TABLE ledger (
  id             BIGSERIAL PRIMARY KEY,
  tx_key         TEXT NOT NULL UNIQUE,
  player_id      TEXT NOT NULL REFERENCES players(id),
  table_code     TEXT NOT NULL REFERENCES game_tables(code),
  hand_id        TEXT REFERENCES hands(id),
  kind           TEXT NOT NULL CHECK (kind IN ('buyin', 'wager', 'payout', 'refund', 'reload')),
  amount         BIGINT NOT NULL,            -- signed: + credited to stack, − debited
  balance_after  BIGINT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_player_table ON ledger(player_id, table_code);
