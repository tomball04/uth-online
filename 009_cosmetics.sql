-- §24 Avatars, Style Credits and the Casino Boutique. Entirely separate from casino chips: nothing here
-- references stacks, the chip ledger, wagers or payouts, and no column or function converts between them.

-- Saved look: free appearance + equipped items + outfit presets. Values are validated against the bundled
-- catalog by the server before they are written; no markup is ever stored.
CREATE TABLE avatar_profiles (
  player_id    TEXT PRIMARY KEY REFERENCES players(id),
  appearance   JSONB NOT NULL,
  equipped     JSONB NOT NULL,
  preset       TEXT NOT NULL DEFAULT 'casual',
  outfits      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Style Credit wallet. Never negative.
CREATE TABLE style_wallets (
  player_id    TEXT PRIMARY KEY REFERENCES players(id),
  balance      BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every credit movement, with a unique idempotency key (a retried purchase or reward can never apply twice).
CREATE TABLE style_tx (
  id             BIGSERIAL PRIMARY KEY,
  tx_key         TEXT NOT NULL UNIQUE,
  player_id      TEXT NOT NULL REFERENCES players(id),
  kind           TEXT NOT NULL CHECK (kind IN ('earn', 'purchase')),
  amount         BIGINT NOT NULL,             -- signed: + earned, − spent
  balance_after  BIGINT NOT NULL CHECK (balance_after >= 0),
  item_id        TEXT,
  reward_id      TEXT,
  note           TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX style_tx_player ON style_tx(player_id, id DESC);

-- Owned items. Free catalog items are usable without a row.
CREATE TABLE player_items (
  player_id    TEXT NOT NULL REFERENCES players(id),
  item_id      TEXT NOT NULL,
  method       TEXT NOT NULL CHECK (method IN ('purchase', 'reward', 'collection')),
  tx_key       TEXT,
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, item_id)
);
