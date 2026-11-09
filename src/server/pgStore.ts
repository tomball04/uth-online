import type { RivalryEvent, RivalryRow } from './roast.js';
import type { QHand } from '../shared/quality.js';
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DecisionRecord, TableConfig } from '../shared/protocol.js';
import { PROGRESSIVE } from '../shared/progressive.js';
import type { NightHand } from '../shared/recap.js';
import type { GameId } from '../shared/rules.js';
import type { AvatarData, PublicLook } from '../shared/cosmetics.js';
import {
  InsufficientFunds, JACKPOT_ID, type HandStart, type MeterSpec, type MeterRow, type SettlementBuilder, type PlayerRow, type PlayerSettlementRow, type PlayerStats,
  type DebtEvent, type NightRow, type CosmeticState, type PurchaseResult, type RewardFacts, type StyleTx, type RecentHandRow, type ReplayData, type StackRow, type Store, type TableRow,
  toQHand,
} from './store.js';

// BIGINT -> number (all our values are well inside Number.MAX_SAFE_INTEGER)
pg.types.setTypeParser(20, (v) => Number(v));

type Q = pg.PoolClient | pg.Pool;

export class PgStore implements Store {
  pool: pg.Pool;
  constructor(url: string, private migrationsDir: string) {
    this.pool = new pg.Pool({
      connectionString: url,
      max: 10,
      ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
    });
  }

  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const files = readdirSync(this.migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const { rowCount } = await this.pool.query('SELECT 1 FROM schema_migrations WHERE name=$1', [f]);
      if (rowCount) continue;
      await this.tx(async (c) => {
        await c.query(readFileSync(join(this.migrationsDir, f), 'utf8'));
        await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      });
    }
  }

  close() { return this.pool.end(); }

  private async tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async createPlayer(id: string, name: string, avatar: string, tokenHash: string): Promise<PlayerRow> {
    await this.pool.query('INSERT INTO players(id,name,avatar,token_hash) VALUES ($1,$2,$3,$4)', [id, name, avatar, tokenHash]);
    return { id, name, avatar };
  }
  async playerByTokenHash(hash: string) {
    const r = await this.pool.query('UPDATE players SET last_seen_at=now() WHERE token_hash=$1 RETURNING id,name,avatar', [hash]);
    return r.rows[0] ?? null;
  }
  async updatePlayer(id: string, p: { name?: string; avatar?: string }) {
    await this.pool.query('UPDATE players SET name=COALESCE($2,name), avatar=COALESCE($3,avatar) WHERE id=$1', [id, p.name ?? null, p.avatar ?? null]);
  }

  async createTable(code: string, hostId: string, config: TableConfig) {
    await this.pool.query('INSERT INTO game_tables(code,host_id,config) VALUES ($1,$2,$3)', [code, hostId, config]);
  }
  async loadTable(code: string): Promise<TableRow | null> {
    const r = await this.pool.query('SELECT code,host_id,config,hand_counter,closed_at,dealer_id,dealer_rounds FROM game_tables WHERE code=$1', [code]);
    const t = r.rows[0];
    return t ? { code: t.code, hostId: t.host_id, config: t.config, handCounter: t.hand_counter, closed: !!t.closed_at, dealer: { dealerId: t.dealer_id, rounds: t.dealer_rounds } } : null;
  }
  async updateDealer(code: string, dealerId: string, rounds: number) {
    await this.pool.query('UPDATE game_tables SET dealer_id=$2, dealer_rounds=$3 WHERE code=$1', [code, dealerId, rounds]);
  }
  async updateTable(code: string, p: { config?: TableConfig; hostId?: string; closed?: boolean; handCounter?: number }) {
    await this.pool.query(
      `UPDATE game_tables SET config=COALESCE($2,config), host_id=COALESCE($3,host_id),
         closed_at=CASE WHEN $4::boolean THEN now() ELSE closed_at END, hand_counter=COALESCE($5,hand_counter) WHERE code=$1`,
      [code, p.config ?? null, p.hostId ?? null, !!p.closed, p.handCounter ?? null]);
  }

  async getStack(playerId: string, code: string): Promise<StackRow | null> {
    const r = await this.pool.query('SELECT balance,reloads,debt FROM stacks WHERE player_id=$1 AND table_code=$2', [playerId, code]);
    return r.rows[0] ? stackRow(r.rows[0]) : null;
  }
  async createStack(playerId: string, code: string, amount: number): Promise<StackRow> {
    return this.tx(async (c) => {
      const ins = await c.query(
        `INSERT INTO stacks(player_id,table_code,balance) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING balance,reloads,debt`,
        [playerId, code, amount]);
      if (ins.rowCount) {
        await c.query(`INSERT INTO ledger(tx_key,player_id,table_code,kind,amount,balance_after) VALUES ($1,$2,$3,'buyin',$4,$4)`,
          [`${code}:${playerId}:buyin`, playerId, code, amount]);
        return stackRow(ins.rows[0]);
      }
      return stackRow((await c.query('SELECT balance,reloads,debt FROM stacks WHERE player_id=$1 AND table_code=$2', [playerId, code])).rows[0]);
    });
  }
  async reloadStack(playerId: string, code: string, amount: number, pawn?: { name: string; item: string }): Promise<StackRow> {
    return this.tx(async (c) => {
      const cur = (await c.query('SELECT balance,reloads,debt FROM stacks WHERE player_id=$1 AND table_code=$2 FOR UPDATE', [playerId, code])).rows[0];
      if (!cur) throw new Error('No stack');
      const n = cur.reloads + 1;
      const debt = Number(cur.debt) + Math.max(0, amount - Number(cur.balance));
      await c.query('UPDATE stacks SET balance=$3, reloads=$4, debt=$5, updated_at=now() WHERE player_id=$1 AND table_code=$2', [playerId, code, amount, n, debt]);
      await c.query(`INSERT INTO ledger(tx_key,player_id,table_code,kind,amount,balance_after) VALUES ($1,$2,$3,'reload',$4,$5)`,
        [`${code}:${playerId}:reload:${n}`, playerId, code, amount - cur.balance, amount]);
      if (pawn && debt > Number(cur.debt))
        await c.query(`INSERT INTO debt_events(player_id,table_code,name,kind,amount,debt_after,item) VALUES ($1,$2,$3,'marker',$4,$5,$6)`,
          [playerId, code, pawn.name, debt - Number(cur.debt), debt, pawn.item]);
      return { balance: amount, reloads: n, debt };
    });
  }

  async payDebt(playerId: string, code: string, amount: number, pawn: { name: string; item: (debtAfter: number) => string }) {
    return this.tx(async (c) => {
      const cur = (await c.query('SELECT balance,reloads,debt FROM stacks WHERE player_id=$1 AND table_code=$2 FOR UPDATE', [playerId, code])).rows[0];
      if (!cur) throw new Error('No stack');
      const paid = Math.max(0, Math.min(amount, Number(cur.debt), Number(cur.balance)));
      if (!paid) return { ...stackRow(cur), paid: 0 };
      const balance = Number(cur.balance) - paid, debt = Number(cur.debt) - paid;
      await c.query('UPDATE stacks SET balance=$3, debt=$4, updated_at=now() WHERE player_id=$1 AND table_code=$2', [playerId, code, balance, debt]);
      const n = (await c.query(`SELECT COUNT(*)::int n FROM debt_events WHERE player_id=$1 AND table_code=$2`, [playerId, code])).rows[0].n;
      await c.query(`INSERT INTO ledger(tx_key,player_id,table_code,kind,amount,balance_after) VALUES ($1,$2,$3,'reload',$4,$5)`,
        [`${code}:${playerId}:payoff:${n + 1}`, playerId, code, -paid, balance]);
      await c.query(`INSERT INTO debt_events(player_id,table_code,name,kind,amount,debt_after,item) VALUES ($1,$2,$3,'payoff',$4,$5,$6)`,
        [playerId, code, pawn.name, paid, debt, pawn.item(debt)]);
      return { balance, reloads: Number(cur.reloads), debt, paid };
    });
  }

  async debtEvents(code: string, limit: number) {
    return (await this.pool.query('SELECT * FROM debt_events WHERE table_code=$1 ORDER BY id DESC LIMIT $2', [code, limit])).rows.map((r: any) => ({
      id: Number(r.id), playerId: r.player_id, name: r.name, kind: r.kind, amount: Number(r.amount), debtAfter: Number(r.debt_after), item: r.item,
      at: new Date(r.created_at).getTime() }));
  }

  private async debit(c: Q, playerId: string, code: string, handId: string, amount: number, key: string): Promise<number | null> {
    if (amount <= 0) return null;
    const exists = await c.query('SELECT 1 FROM ledger WHERE tx_key=$1', [key]);
    if (exists.rowCount) return null;
    const u = await c.query(
      'UPDATE stacks SET balance=balance-$3, updated_at=now() WHERE player_id=$1 AND table_code=$2 AND balance >= $3 RETURNING balance',
      [playerId, code, amount]);
    if (!u.rowCount) throw new InsufficientFunds(`Insufficient balance for ${playerId}`);
    const bal = u.rows[0].balance;
    await c.query(`INSERT INTO ledger(tx_key,player_id,table_code,hand_id,kind,amount,balance_after) VALUES ($1,$2,$3,$4,'wager',$5,$6)`,
      [key, playerId, code, handId, -amount, bal]);
    return bal;
  }

  /** Creates any meter this hand may touch, at its seed, without changing an existing one. */
  private async ensureMeters(c: pg.PoolClient, specs: MeterSpec[] | undefined) {
    for (const m of specs ?? [])
      await c.query(`INSERT INTO progressive_meter(id, amount, seed, game, variant, profile) VALUES ($1,$2,$2,$3,$4,$5)
        ON CONFLICT (id) DO UPDATE SET seed = COALESCE(progressive_meter.seed, EXCLUDED.seed), game = COALESCE(progressive_meter.game, EXCLUDED.game),
          variant = COALESCE(progressive_meter.variant, EXCLUDED.variant), profile = COALESCE(progressive_meter.profile, EXCLUDED.profile)`,
        [m.id, m.seed, m.game, m.variant, m.profile]);
  }

  async startHand(h: HandStart) {
    return this.tx(async (c) => {
      await this.ensureMeters(c, h.meters);
      await c.query(
        `INSERT INTO hands(id,table_code,hand_number,status,deck_commitment,dealer_cards,community,participant_count,pairs_variant,bad_beat_variant,night_id,rules_version,game,rules_profile)
         VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [h.id, h.tableCode, h.handNumber, h.deckCommitment, JSON.stringify(h.dealerCards), JSON.stringify(h.community), h.players.length,
         h.pairsVariant, h.badBeatVariant, h.nightId || null, h.rulesVersion, h.game ?? 'uth', h.rulesProfile ? JSON.stringify(h.rulesProfile) : null]);
      await c.query('UPDATE game_tables SET hand_counter=$2 WHERE code=$1', [h.tableCode, h.handNumber]);
      const balances = new Map<string, number>();
      const add = new Map<string, number>();
      for (const p of h.players) {
        const sideStake = Object.values(p.sides ?? {}).reduce((t, x) => t + x, 0);
        await c.query(
          `INSERT INTO hand_players(hand_id,player_id,seat,name,hole,ante,blind,trips,pairs,bad_beat,progressive,pair_plus,six_card,game,prog_meter,prog_contrib,side_bets,side_stake)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [h.id, p.playerId, p.seat, p.name, JSON.stringify(p.hole), p.ante, p.blind, p.trips, p.pairs, p.badBeat, p.progressive, p.pairPlus ?? 0, p.sixCard ?? 0, h.game ?? 'uth',
           p.progressive ? (p.progMeter ?? JACKPOT_ID) : null, p.progressive ? (p.progContribution ?? PROGRESSIVE.contribution) : 0,
           p.sides && sideStake ? JSON.stringify(p.sides) : null, sideStake]);
        const total = p.ante + p.blind + p.trips + p.pairs + p.badBeat + p.progressive + (p.pairPlus ?? 0) + (p.sixCard ?? 0) + sideStake;
        const bal = await this.debit(c, p.playerId, h.tableCode, h.id, total, `${h.id}:${p.playerId}:initial`);
        balances.set(p.playerId, bal!);
        if (p.progressive > 0) { const id = p.progMeter ?? JACKPOT_ID; add.set(id, (add.get(id) ?? 0) + (p.progContribution ?? PROGRESSIVE.contribution)); }
      }
      // Each progressive wager feeds its own meter in the same transaction as the debit.
      const meters = new Map<string, number>();
      for (const [id, amt] of [...add].sort(([a], [b]) => a.localeCompare(b)))
        meters.set(id, (await c.query('UPDATE progressive_meter SET amount=amount+$2, updated_at=now() WHERE id=$1 RETURNING amount', [id, amt])).rows[0].amount);
      const jackpot = meters.get(JACKPOT_ID) ?? (await c.query('SELECT amount FROM progressive_meter WHERE id=$1', [JACKPOT_ID])).rows[0].amount;
      return { balances, jackpot, meters };
    });
  }

  async getMeters(): Promise<MeterRow[]> {
    const r = await this.pool.query('SELECT id, amount, seed, game, variant, profile, hits FROM progressive_meter ORDER BY id');
    return r.rows.map((x) => ({ id: x.id, amount: Number(x.amount), seed: Number(x.seed ?? 0), game: x.game ?? 'uth', variant: x.variant ?? x.id, profile: x.profile ?? 'casino', hits: x.hits }));
  }

  async bonusRows(playerId: string) {
    const r = await this.pool.query(
      `SELECT hp.hand_id, h.hand_number, h.settled_at, h.table_code, hp.side_results, hp.progressive, hp.prog_contrib, hp.prog_meter, hp.settlement, hp.base_net
         FROM hand_players hp JOIN hands h ON h.id = hp.hand_id
        WHERE hp.player_id=$1 AND hp.settled AND hp.game='bj' AND (hp.side_results IS NOT NULL OR hp.progressive > 0)
        ORDER BY h.settled_at, h.id`, [playerId]);
    return r.rows.map((x) => {
      const p = x.settlement?.progressive;
      return { handId: x.hand_id, handNumber: x.hand_number, at: x.settled_at.getTime(), tableCode: x.table_code, mainNet: Number(x.base_net ?? 0),
        results: x.side_results ?? [],
        prog: Number(x.progressive) > 0 ? { stake: Number(x.progressive), amount: Number(p?.amount ?? 0), combo: p?.combo ?? null, contrib: Number(x.prog_contrib),
          meterId: x.prog_meter, fromMeter: !!p?.fromMeter } : null };
    });
  }

  async progressiveTx(f: { playerId?: string; meterId?: string }, limit: number) {
    const r = await this.pool.query(
      `SELECT * FROM progressive_tx WHERE ($1::text IS NULL OR player_id=$1) AND ($2::text IS NULL OR meter_id=$2) ORDER BY id DESC LIMIT $3`,
      [f.playerId ?? null, f.meterId ?? null, limit]);
    return r.rows.map((x) => ({ handId: x.hand_id, at: x.created_at.getTime(), playerId: x.player_id, game: x.game, meterId: x.meter_id, variant: x.variant, profile: x.profile,
      wager: Number(x.wager), combo: x.combo, category: x.category, pct: x.pct, fixedAward: Number(x.fixed_award), meterAward: Number(x.meter_award), envy: Number(x.envy),
      meterBefore: Number(x.meter_before), meterAfter: Number(x.meter_after), amount: Number(x.amount), net: Number(x.net) }));
  }

  async getJackpot() {
    return (await this.pool.query('SELECT amount FROM progressive_meter WHERE id=$1', [JACKPOT_ID])).rows[0].amount as number;
  }

  async wager(handId: string, playerId: string, code: string, amount: number, key: string) {
    return this.tx(async (c) => {
      const h = await c.query(`SELECT status FROM hands WHERE id=$1 FOR UPDATE`, [handId]);
      if (h.rows[0]?.status !== 'active') throw new Error('Hand is not active');
      const bal = await this.debit(c, playerId, code, handId, amount, key);
      if (bal !== null) await c.query('UPDATE hand_players SET play=$3 WHERE hand_id=$1 AND player_id=$2', [handId, playerId, amount]);
      return bal;
    });
  }

  async extraWager(handId: string, playerId: string, code: string, amount: number, key: string, totals: { extra: number; insurance: number }) {
    return this.tx(async (c) => {
      const h = await c.query(`SELECT status FROM hands WHERE id=$1 FOR UPDATE`, [handId]);
      if (h.rows[0]?.status !== 'active') throw new Error('Hand is not active');
      const bal = await this.debit(c, playerId, code, handId, amount, key);
      if (bal !== null) await c.query('UPDATE hand_players SET bj_extra=$3, bj_insurance=$4 WHERE hand_id=$1 AND player_id=$2', [handId, playerId, totals.extra, totals.insurance]);
      return bal;
    });
  }

  async recordDecision(handId: string, playerId: string, d: DecisionRecord, state: { play: number; folded: boolean }) {
    await this.pool.query(
      `INSERT INTO decisions(hand_id,player_id,phase,action,recommended,correct,timed_out,reason,outs,graded,ev_cost_cents,ev_cost,ev_exact)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
      [handId, playerId, d.phase, d.action, d.recommended, d.correct, d.timedOut, d.reason, d.outs ? JSON.stringify(d.outs) : null, d.graded !== false, d.evCostCents ?? null, d.evCost ?? null, d.evExact ?? null]);
    if (state.folded) await this.pool.query('UPDATE hand_players SET folded=true WHERE hand_id=$1 AND player_id=$2', [handId, playerId]);
  }
  async updateDecisionEV(handId: string, playerId: string, phase: string, evCost: number, exact: boolean, cents?: number) {
    await this.pool.query('UPDATE decisions SET ev_cost=$4, ev_exact=$5, ev_cost_cents=COALESCE($6, ev_cost_cents) WHERE hand_id=$1 AND player_id=$2 AND phase=$3',
      [handId, playerId, phase, evCost, exact, cents ?? null]);
  }

  async settleHand(handId: string, code: string, dealer: { hand: string; qualifies: boolean }, build: SettlementBuilder, meterIds: string[] = []) {
    return this.tx(async (c) => {
      const balances = new Map<string, number>();
      const h = await c.query('SELECT status FROM hands WHERE id=$1 FOR UPDATE', [handId]);
      // Lock every meter this hand can touch, always in id order, so concurrent tables queue instead of deadlocking.
      const ids = [...new Set([JACKPOT_ID, ...meterIds])].sort();
      const locked = new Map<string, number>();
      for (const id of ids) {
        const row = (await c.query('SELECT amount FROM progressive_meter WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (row) locked.set(id, Number(row.amount));
      }
      if (h.rows[0]?.status !== 'active') return { applied: false, balances, jackpot: locked.get(JACKPOT_ID)!, meters: locked };
      const { rows, meters: after = new Map(), hits = [], progTx = [] } = build(new Map(locked));
      for (const [id, amount] of after) {
        if (!locked.has(id)) throw new Error(`Meter ${id} was not locked for this settlement`);
        if (amount < 0) throw new Error(`Meter ${id} would go negative`);
        const n = hits.filter((x) => x.meterId === id).length;
        if (amount !== locked.get(id) || n)
          await c.query(`UPDATE progressive_meter SET amount=$2, hits=hits+$3, last_hit_at=CASE WHEN $3>0 THEN now() ELSE last_hit_at END, updated_at=now() WHERE id=$1`, [id, amount, n]);
        locked.set(id, amount);
      }
      for (const x of hits)
        await c.query(`INSERT INTO progressive_hits(hand_id,player_id,table_code,hand_name,amount,meter_before,meter_id,meter_after) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [handId, x.playerId, code, x.hand, x.amount, x.meterBefore, x.meterId, x.meterAfter]);
      for (const t of progTx)
        await c.query(`INSERT INTO progressive_tx(hand_id,player_id,table_code,game,meter_id,variant,profile,wager,combo,category,pct,fixed_award,meter_award,envy,meter_before,meter_after,stake_returned,amount,net)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,false,$17,$18)`,
          [handId, t.playerId, code, t.game, t.meterId, t.variant, t.profile, t.wager, t.combo, t.category, t.pct, t.fixedAward, t.meterAward, t.envy, t.meterBefore, t.meterAfter, t.amount, t.net]);
      for (const r of rows) {
        await c.query(
          `UPDATE hand_players SET outcome=$3, hand_name=$4, hand_rank=$5, net=$6, trips_net=$7, settlement=$8, play=$9, folded=$10, settled=true,
             pairs_net=$11, bad_beat_net=$12, pairs_combo=$13, bad_beat_combo=$14, pairs_multiplier=$15, bad_beat_multiplier=$16,
             pairs_variant=$17, bad_beat_variant=$18, base_net=$19, progressive_net=$20, progressive_hand=$21,
             pair_plus_net=$22, six_card_net=$23, ante_bonus_net=$24, pair_plus_hand=$25, six_card_hand=$26, side_results=$27
           WHERE hand_id=$1 AND player_id=$2`,
          [handId, r.playerId, r.outcome, r.handName, r.handRank, r.net, r.tripsNet, JSON.stringify(r.settlement), r.play, r.folded,
           r.pairsNet, r.badBeatNet, r.pairsCombo, r.badBeatCombo, r.pairsMultiplier, r.badBeatMultiplier,
           r.pairsVariant, r.badBeatVariant, r.baseNet, r.progressiveNet, r.progressiveHand,
           r.pairPlusNet ?? null, r.sixCardNet ?? null, r.anteBonusNet ?? null, r.pairPlusHand ?? null, r.sixCardHand ?? null,
           r.sideResults?.length ? JSON.stringify(r.sideResults) : null]);
        let bal: number;
        if (r.credit > 0) {
          bal = (await c.query('UPDATE stacks SET balance=balance+$3, updated_at=now() WHERE player_id=$1 AND table_code=$2 RETURNING balance',
            [r.playerId, code, r.credit])).rows[0].balance;
          await c.query(`INSERT INTO ledger(tx_key,player_id,table_code,hand_id,kind,amount,balance_after) VALUES ($1,$2,$3,$4,'payout',$5,$6)`,
            [`${handId}:${r.playerId}:payout`, r.playerId, code, handId, r.credit, bal]);
        } else {
          bal = (await c.query('SELECT balance FROM stacks WHERE player_id=$1 AND table_code=$2', [r.playerId, code])).rows[0].balance;
        }
        balances.set(r.playerId, bal);
      }
      await c.query(`UPDATE hands SET status='settled', settled_at=now(), dealer_hand=$2, dealer_qualifies=$3 WHERE id=$1`,
        [handId, dealer.hand, dealer.qualifies]);
      return { applied: true, balances, jackpot: locked.get(JACKPOT_ID)!, meters: locked };
    });
  }

  async voidActiveHands() {
    const active = await this.pool.query(`SELECT id, table_code FROM hands WHERE status='active'`);
    let refunds = 0;
    for (const h of active.rows) {
      await this.tx(async (c) => {
        const lock = await c.query('SELECT status FROM hands WHERE id=$1 FOR UPDATE', [h.id]);
        if (lock.rows[0].status !== 'active') return;
        const debits = await c.query(
          `SELECT player_id, -SUM(amount) AS staked FROM ledger WHERE hand_id=$1 AND kind='wager' GROUP BY player_id`, [h.id]);
        for (const d of debits.rows) {
          const amt = Number(d.staked);
          const bal = (await c.query('UPDATE stacks SET balance=balance+$3 WHERE player_id=$1 AND table_code=$2 RETURNING balance',
            [d.player_id, h.table_code, amt])).rows[0].balance;
          await c.query(`INSERT INTO ledger(tx_key,player_id,table_code,hand_id,kind,amount,balance_after) VALUES ($1,$2,$3,$4,'refund',$5,$6)`,
            [`${h.id}:${d.player_id}:refund`, d.player_id, h.table_code, h.id, amt, bal]);
          refunds++;
        }
        // The voided hand's progressive contributions come back out of each meter they fed, along with the refunds.
        const contrib = await c.query(`SELECT COALESCE(prog_meter, $2) meter, SUM(CASE WHEN prog_contrib > 0 THEN prog_contrib ELSE $3 END)::bigint amt
          FROM hand_players WHERE hand_id=$1 AND progressive>0 GROUP BY 1 ORDER BY 1`, [h.id, JACKPOT_ID, PROGRESSIVE.contribution]);
        for (const x of contrib.rows)
          await c.query('UPDATE progressive_meter SET amount=GREATEST(COALESCE(seed, $3), amount-$2) WHERE id=$1', [x.meter, Number(x.amt), PROGRESSIVE.seed]);
        await c.query(`UPDATE hands SET status='voided', settled_at=now() WHERE id=$1`, [h.id]);
      });
    }
    return { hands: active.rowCount ?? 0, refunds };
  }

  async playerStats(pid: string, game?: GameId): Promise<PlayerStats> {
    const q = (sql: string) => this.pool.query(sql, [pid]);
    // Game filter (a fixed enum, never user text): hand_players carry their game; decisions go through hands.
    const G = game === 'uth' || game === 'tcp' || game === 'bj' ? ` AND game='${game}'` : '';
    const GD = G ? ` AND hand_id IN (SELECT id FROM hands WHERE game='${game}')` : '';
    const side = (stake: string, net: string, combo: string) => Promise.all([
      q(`SELECT COUNT(*)::int bets, COUNT(*) FILTER (WHERE ${net}>0)::int wins, COALESCE(SUM(${stake}),0) wagered,
            COALESCE(SUM(${stake}+${net}),0) returned, COALESCE(SUM(${net}),0) net, COALESCE(MAX(${net}) FILTER (WHERE ${net}>0),0) biggest
         FROM hand_players WHERE player_id=$1 AND settled AND ${stake}>0${G}`),
      q(`SELECT ${combo} combo, COUNT(*)::int count FROM hand_players WHERE player_id=$1 AND settled AND ${stake}>0 AND ${net}>0${G}
         GROUP BY ${combo} ORDER BY count DESC`),
    ]).then(([a, c]) => ({
      bets: a.rows[0].bets, wins: a.rows[0].wins, wagered: Number(a.rows[0].wagered), returned: Number(a.rows[0].returned),
      net: Number(a.rows[0].net), biggestPayout: Number(a.rows[0].biggest), combos: c.rows.map((r) => ({ combo: r.combo ?? '—', count: r.count })),
    }));
    const [sTrips, sPairs, sBad, sProg, sPP, sSix, base] = await Promise.all([
      side('trips', 'trips_net', 'hand_name'), side('pairs', 'pairs_net', 'pairs_combo'), side('bad_beat', 'bad_beat_net', 'bad_beat_combo'),
      side('progressive', 'progressive_net', 'progressive_hand'),
      side('pair_plus', 'pair_plus_net', 'pair_plus_hand'), side('six_card', 'six_card_net', 'six_card_hand'),
      q(`SELECT COALESCE(SUM(COALESCE(base_net, net - COALESCE(trips_net,0))),0) net, COALESCE(SUM(ante+blind+play),0) wagered
         FROM hand_players WHERE player_id=$1 AND settled${G}`),
    ]);
    const [agg, best, dec, byPhase, mistakes, trips, friends, stacks, series] = await Promise.all([
      q(`SELECT COUNT(*)::int hands, COALESCE(SUM(net),0) net,
            COUNT(*) FILTER (WHERE outcome='win')::int wins, COUNT(*) FILTER (WHERE outcome='lose')::int losses,
            COUNT(*) FILTER (WHERE outcome='push')::int pushes, COUNT(*) FILTER (WHERE outcome='fold')::int folds,
            COALESCE(MAX(net),0) biggest_win, COALESCE(MIN(net),0) biggest_loss,
            COALESCE(SUM(ante+blind+trips+play+pairs+bad_beat+progressive+pair_plus+six_card+bj_insurance),0) wagered
         FROM hand_players WHERE player_id=$1 AND settled${G}`),
      q(`SELECT hand_name FROM hand_players WHERE player_id=$1 AND settled${G} ORDER BY hand_rank DESC NULLS LAST LIMIT 1`),
      q(`SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE correct)::int ok, COALESCE(SUM(ev_cost),0) ev FROM decisions WHERE player_id=$1 AND graded${GD}`),
      q(`SELECT CASE WHEN phase LIKE 'bj-%' THEN 'bj' ELSE phase END phase, action, COUNT(*)::int count, COUNT(*) FILTER (WHERE correct)::int correct FROM decisions WHERE player_id=$1 AND graded${GD} GROUP BY 1, action ORDER BY 1, action`),
      q(`SELECT CASE WHEN phase LIKE 'bj-%' THEN 'bj' ELSE phase END phase, action, recommended, COUNT(*)::int count, COALESCE(SUM(ev_cost),0) ev FROM decisions WHERE player_id=$1 AND graded AND NOT correct${GD}
         GROUP BY 1, action, recommended ORDER BY count DESC LIMIT 5`),
      q(`SELECT COUNT(*)::int bets, COUNT(*) FILTER (WHERE trips_net>0)::int wins, COALESCE(SUM(trips_net),0) net FROM hand_players WHERE player_id=$1 AND settled AND trips>0${G}`),
      q(`SELECT COUNT(*)::int n FROM hand_players hp JOIN hands h ON h.id=hp.hand_id WHERE hp.player_id=$1 AND hp.settled AND h.participant_count>1${G ? ` AND h.game='${game}'` : ''}`),
      q(`SELECT COALESCE(SUM(reloads),0)::int reloads, COALESCE(SUM(debt),0) debt, COUNT(*)::int tables FROM stacks WHERE player_id=$1`),
      q(`SELECT h.settled_at at, SUM(hp.net) OVER (ORDER BY h.settled_at, h.id) cum
         FROM hand_players hp JOIN hands h ON h.id=hp.hand_id WHERE hp.player_id=$1 AND hp.settled ORDER BY h.settled_at DESC, h.id DESC LIMIT 500`),
    ]);
    const a = agg.rows[0];
    return {
      hands: a.hands, net: Number(a.net), wins: a.wins, losses: a.losses, pushes: a.pushes, folds: a.folds,
      biggestWin: Number(a.biggest_win), biggestLoss: Number(a.biggest_loss), totalWagered: Number(a.wagered),
      bestHand: best.rows[0]?.hand_name ?? null,
      decisions: dec.rows[0].n, correctDecisions: dec.rows[0].ok, evLost: Number(dec.rows[0].ev),
      byPhase: byPhase.rows,
      commonMistakes: mistakes.rows.map((m) => ({ ...m, evCost: Number(m.ev) })),
      trips: { bets: trips.rows[0].bets, wins: trips.rows[0].wins, net: Number(trips.rows[0].net) },
      side: { trips: sTrips, pairs: sPairs, badBeat: sBad, progressive: sProg, pairPlus: sPP, sixCard: sSix },
      game: game ?? null,
      baseNet: Number(base.rows[0].net), baseWagered: Number(base.rows[0].wagered),
      handsWithFriends: friends.rows[0].n, reloads: stacks.rows[0].reloads, tables: stacks.rows[0].tables, debt: Number(stacks.rows[0].debt),
      series: series.rows.reverse().map((r) => ({ at: new Date(r.at).toISOString(), cumulative: Number(r.cum) })),
    };
  }

  async rivalries(dealerId: string, playerIds: string[]): Promise<Map<string, RivalryRow>> {
    const out = new Map<string, RivalryRow>();
    if (!playerIds.length) return out;
    const r = await this.pool.query('SELECT * FROM dealer_rivalries WHERE dealer_id=$1 AND player_id = ANY($2)', [dealerId, playerIds]);
    for (const x of r.rows) out.set(x.player_id, { witnessed: x.witnessed, wins: x.wins, jackpots: x.jackpots, mockedThenWon: x.mocked_then_won, events: x.events ?? [] });
    return out;
  }
  async bumpRivalry(dealerId: string, playerId: string, d: Partial<Record<'witnessed' | 'wins' | 'jackpots' | 'mockedThenWon', number>>, ev?: RivalryEvent) {
    // Keep the 8 most recent memorable events. Comedic only — nothing in dealing or settlement reads this table.
    await this.pool.query(
      `INSERT INTO dealer_rivalries (dealer_id, player_id, witnessed, wins, jackpots, mocked_then_won, events)
       VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $7::jsonb IS NULL THEN '[]'::jsonb ELSE jsonb_build_array($7::jsonb) END)
       ON CONFLICT (dealer_id, player_id) DO UPDATE SET
         witnessed = dealer_rivalries.witnessed + EXCLUDED.witnessed, wins = dealer_rivalries.wins + EXCLUDED.wins,
         jackpots = dealer_rivalries.jackpots + EXCLUDED.jackpots, mocked_then_won = dealer_rivalries.mocked_then_won + EXCLUDED.mocked_then_won,
         events = CASE WHEN $7::jsonb IS NULL THEN dealer_rivalries.events
                  ELSE (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM (SELECT e FROM jsonb_array_elements(dealer_rivalries.events || jsonb_build_array($7::jsonb)) e OFFSET GREATEST(jsonb_array_length(dealer_rivalries.events) + 1 - 8, 0)) t) END,
         updated_at = now()`,
      [dealerId, playerId, d.witnessed ?? 0, d.wins ?? 0, d.jackpots ?? 0, d.mockedThenWon ?? 0, ev ? JSON.stringify(ev) : null]);
  }

  async qualityHands(playerId: string, game?: GameId): Promise<QHand[]> {
    const G = game === 'uth' || game === 'tcp' || game === 'bj' ? game : null;
    const r = await this.pool.query(
      `SELECT h.id, h.hand_number, h.table_code, h.game, h.settled_at, h.night_id, h.community, h.dealer_cards,
              hp.hole, hp.folded, hp.net, hp.ante, COALESCE(hp.base_net, hp.net - COALESCE(hp.trips_net,0)) base,
              CASE WHEN h.game='bj' THEN hp.settlement END settlement,
              COALESCE((SELECT json_agg(json_build_object('phase',d.phase,'action',d.action,'recommended',d.recommended,'correct',d.correct,
                'graded',d.graded,'timedOut',d.timed_out,'reason',d.reason,'evCost',d.ev_cost,'evCents',d.ev_cost_cents) ORDER BY d.created_at)
                FROM decisions d WHERE d.hand_id=h.id AND d.player_id=hp.player_id), '[]'::json) ds
       FROM hand_players hp JOIN hands h ON h.id=hp.hand_id
       WHERE hp.player_id=$1 AND hp.settled AND h.status='settled' AND ($2::text IS NULL OR h.game=$2)
       ORDER BY h.settled_at, h.id`, [playerId, G]);
    return r.rows.map((x) => toQHand({
      handId: x.id, handNumber: x.hand_number, tableCode: x.table_code, game: x.game, at: new Date(x.settled_at).getTime(), nightId: x.night_id,
      mainNet: Number(x.base), totalNet: Number(x.net), folded: x.folded, hole: x.hole ?? [], community: x.community ?? [], dealer: x.dealer_cards ?? [],
      ante: Number(x.ante), settlement: x.settlement, decisions: x.ds,
    }));
  }

  async recentHands(code: string, limit: number): Promise<RecentHandRow[]> {
    const r = await this.pool.query(
      `SELECT h.id, h.hand_number, h.settled_at, h.dealer_hand, h.dealer_qualifies,
              json_agg(json_build_object('name',hp.name,'net',hp.net,'outcome',hp.outcome,'handName',hp.hand_name,'folded',hp.folded,
                'tripsNet',hp.trips_net,'pairsNet',hp.pairs_net,'pairsMult',hp.pairs_multiplier,'badBeatNet',hp.bad_beat_net,'badBeatMult',hp.bad_beat_multiplier)
                ORDER BY hp.seat) players
       FROM hands h JOIN hand_players hp ON hp.hand_id=h.id
       WHERE h.table_code=$1 AND h.status='settled'
       GROUP BY h.id ORDER BY h.hand_number DESC LIMIT $2`, [code, limit]);
    return r.rows.map((x) => ({
      handId: x.id, handNumber: x.hand_number, at: new Date(x.settled_at).getTime(),
      dealerHand: x.dealer_hand, dealerQualifies: x.dealer_qualifies,
      players: x.players.map((p: any) => {
        const hits: string[] = [];
        if (Number(p.tripsNet) > 0) hits.push('Trips+');
        if (Number(p.pairsNet) > 0) hits.push(`Ultimate Pairs ${p.pairsMult}:1`);
        if (Number(p.badBeatNet) > 0) hits.push(`Bad Beat ${p.badBeatMult}:1`);
        return { name: p.name, net: Number(p.net), outcome: p.outcome, handName: p.handName, sideHits: hits };
      }),
    }));
  }

  async handReplay(handId: string): Promise<ReplayData | null> {
    const h = (await this.pool.query('SELECT * FROM hands WHERE id=$1', [handId])).rows[0];
    if (!h) return null;
    const ps = (await this.pool.query('SELECT * FROM hand_players WHERE hand_id=$1 ORDER BY seat', [handId])).rows;
    const ds = (await this.pool.query('SELECT * FROM decisions WHERE hand_id=$1 ORDER BY created_at', [handId])).rows;
    return {
      handId: h.id, tableCode: h.table_code, handNumber: h.hand_number, status: h.status,
      startedAt: new Date(h.started_at).toISOString(), settledAt: h.settled_at ? new Date(h.settled_at).toISOString() : null,
      dealer: h.dealer_cards, community: h.community, dealerHand: h.dealer_hand, dealerQualifies: h.dealer_qualifies,
      deckCommitment: h.deck_commitment,
      pairsVariant: h.pairs_variant, badBeatVariant: h.bad_beat_variant, rulesVersion: h.rules_version ?? null, game: h.game ?? 'uth',
      players: ps.map((p) => ({
        playerId: p.player_id, name: p.name, seat: p.seat, hole: p.hole, folded: p.folded,
        ante: p.ante, blind: p.blind, trips: p.trips, pairs: p.pairs, badBeat: p.bad_beat, progressive: p.progressive, pairPlus: Number(p.pair_plus ?? 0), sixCard: Number(p.six_card ?? 0), play: p.play, net: p.net, outcome: p.outcome,
        handName: p.hand_name, settlement: p.settlement,
      })),
      decisions: ds.map((d) => ({
        playerId: d.player_id, phase: d.phase, action: d.action, recommended: d.recommended, correct: d.correct,
        reason: d.reason, timedOut: d.timed_out, evCost: d.ev_cost ?? undefined, evExact: d.ev_exact ?? undefined, outs: d.outs ?? undefined,
        at: new Date(d.created_at).toISOString(),
      })),
    };
  }

  private nightRow = (r: any): NightRow => ({ id: r.id, tableCode: r.table_code, startedAt: new Date(r.started_at).getTime(),
    endedAt: r.ended_at ? new Date(r.ended_at).getTime() : null, hands: Number(r.hands ?? 0) });
  private nightSelect = `SELECT n.*, (SELECT COUNT(*) FROM hands h WHERE h.night_id=n.id AND h.status='settled') hands FROM table_nights n`;

  async openNight(code: string, idleMs: number, fresh: boolean): Promise<NightRow> {
    return this.tx(async (c) => {
      await c.query('SELECT code FROM game_tables WHERE code=$1 FOR UPDATE', [code]);   // one opener per table at a time
      const cur = (await c.query(`${this.nightSelect} WHERE n.table_code=$1 AND n.ended_at IS NULL`, [code])).rows[0];
      if (cur && !fresh) {
        const last = (await c.query(`SELECT MAX(COALESCE(settled_at, started_at)) t FROM hands WHERE night_id=$1`, [cur.id])).rows[0].t;
        const lastAt = last ? new Date(last).getTime() : new Date(cur.started_at).getTime();
        if (Date.now() - lastAt < idleMs) return this.nightRow(cur);
      }
      if (cur) await c.query('UPDATE table_nights SET ended_at=now() WHERE id=$1', [cur.id]);
      const id = `night-${code}-${Date.now().toString(36)}`;
      const r = (await c.query('INSERT INTO table_nights(id,table_code) VALUES ($1,$2) RETURNING *', [id, code])).rows[0];
      return this.nightRow({ ...r, hands: 0 });
    });
  }

  async endNight(code: string) {
    const r = (await this.pool.query('UPDATE table_nights SET ended_at=now() WHERE table_code=$1 AND ended_at IS NULL RETURNING id', [code])).rows[0];
    return r ? this.getNight(r.id) : null;
  }

  async getNight(id: string) {
    const r = (await this.pool.query(`${this.nightSelect} WHERE n.id=$1`, [id])).rows[0];
    return r ? this.nightRow(r) : null;
  }

  async listNights(code: string, limit: number) {
    return (await this.pool.query(`${this.nightSelect} WHERE n.table_code=$1 ORDER BY n.started_at DESC LIMIT $2`, [code, limit])).rows.map(this.nightRow);
  }

  async nightHands(nightId: string): Promise<NightHand[]> {
    const hands = (await this.pool.query(
      `SELECT id, hand_number, started_at, settled_at, community, dealer_hand, game FROM hands WHERE night_id=$1 AND status='settled' ORDER BY hand_number`, [nightId])).rows;
    if (!hands.length) return [];
    const ids = hands.map((h: any) => h.id);
    const players = (await this.pool.query(`SELECT * FROM hand_players WHERE hand_id = ANY($1) ORDER BY seat`, [ids])).rows;
    const decisions = (await this.pool.query(`SELECT hand_id, player_id, phase, correct FROM decisions WHERE hand_id = ANY($1)`, [ids])).rows;
    return hands.map((h: any) => ({
      handId: h.id, handNumber: h.hand_number, startedAt: new Date(h.started_at).getTime(), settledAt: new Date(h.settled_at).getTime(),
      community: h.community, dealerHand: h.dealer_hand ?? '', game: h.game,
      players: players.filter((p: any) => p.hand_id === h.id).map((p: any) => ({
        playerId: p.player_id, name: p.name, seat: p.seat, hole: p.hole, folded: p.folded, net: Number(p.net ?? 0), outcome: p.outcome ?? '',
        handName: p.hand_name ?? '', handRank: p.hand_rank ?? 0, tripsNet: Number(p.trips_net ?? 0), pairsNet: Number(p.pairs_net ?? 0),
        badBeatNet: Number(p.bad_beat_net ?? 0), progressiveNet: Number(p.progressive_net ?? 0), pairsCombo: p.pairs_combo, badBeatCombo: p.bad_beat_combo,
        progressiveHand: p.progressive_hand, pairsMultiplier: p.pairs_multiplier, badBeatMultiplier: p.bad_beat_multiplier,
        pairPlusNet: Number(p.pair_plus_net ?? 0), sixCardNet: Number(p.six_card_net ?? 0), anteBonusNet: Number(p.ante_bonus_net ?? 0), sixCardHand: p.six_card_hand,
      })),
      decisions: decisions.filter((d: any) => d.hand_id === h.id).map((d: any) => ({ playerId: d.player_id, phase: d.phase, correct: d.correct })),
    }));
  }

  async ledgerSummary(playerId: string, code: string) {
    const rows = (await this.pool.query('SELECT kind, SUM(amount)::bigint s FROM ledger WHERE player_id=$1 AND table_code=$2 GROUP BY kind', [playerId, code])).rows;
    return Object.fromEntries(rows.map((r: any) => [r.kind, Number(r.s)]));
  }

  async ledgerSum(playerId: string, code: string) {
    const r = await this.pool.query('SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE player_id=$1 AND table_code=$2', [playerId, code]);
    return Number(r.rows[0].s);
  }

  // ---- §24 cosmetics (separate tables; never touches stacks or the chip ledger)
  async getCosmetics(pid: string): Promise<CosmeticState> {
    const [w, it, av, rw] = await Promise.all([
      this.pool.query('SELECT balance FROM style_wallets WHERE player_id=$1', [pid]),
      this.pool.query('SELECT item_id, method, acquired_at FROM player_items WHERE player_id=$1 ORDER BY acquired_at', [pid]),
      this.pool.query('SELECT appearance, equipped, preset, outfits FROM avatar_profiles WHERE player_id=$1', [pid]),
      this.pool.query('SELECT reward_id, created_at FROM style_tx WHERE player_id=$1 AND reward_id IS NOT NULL ORDER BY id', [pid]),
    ]);
    const a = av.rows[0];
    return {
      balance: w.rows[0]?.balance ?? 0,
      owned: it.rows.map((r) => ({ itemId: r.item_id, method: r.method, at: new Date(r.acquired_at).getTime() })),
      avatar: a ? { appearance: a.appearance, equipped: a.equipped, preset: a.preset, outfits: a.outfits } : null,
      rewards: rw.rows.map((r) => ({ rewardId: r.reward_id, at: new Date(r.created_at).getTime() })),
    };
  }
  async saveAvatar(pid: string, d: AvatarData) {
    await this.pool.query(
      `INSERT INTO avatar_profiles(player_id, appearance, equipped, preset, outfits) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (player_id) DO UPDATE SET appearance=$2, equipped=$3, preset=$4, outfits=$5, updated_at=now()`,
      [pid, JSON.stringify(d.appearance), JSON.stringify(d.equipped), d.preset, JSON.stringify(d.outfits)]);
  }
  async publicLooks(ids: string[]) {
    const m = new Map<string, PublicLook>();
    if (!ids.length) return m;
    const r = await this.pool.query('SELECT player_id, appearance, equipped FROM avatar_profiles WHERE player_id = ANY($1)', [ids]);
    for (const x of r.rows) m.set(x.player_id, { appearance: x.appearance, equipped: x.equipped });
    return m;
  }
  private async wallet(c: pg.PoolClient, pid: string): Promise<number> {
    await c.query('INSERT INTO style_wallets(player_id) VALUES ($1) ON CONFLICT DO NOTHING', [pid]);
    return (await c.query('SELECT balance FROM style_wallets WHERE player_id=$1 FOR UPDATE', [pid])).rows[0].balance;
  }
  async grant(pid: string, g: { key: string; rewardId: string | null; amount: number; items: string[]; method: 'reward' | 'collection'; note: string }) {
    if (g.amount < 0) throw new Error('grant amount must be >= 0');
    return this.tx(async (c) => {
      const bal = await this.wallet(c, pid);
      const dup = await c.query('SELECT 1 FROM style_tx WHERE tx_key=$1', [g.key]);
      if (dup.rowCount) return { applied: false, balance: bal };
      const after = bal + g.amount;
      await c.query('UPDATE style_wallets SET balance=$2, updated_at=now() WHERE player_id=$1', [pid, after]);
      await c.query(`INSERT INTO style_tx(tx_key, player_id, kind, amount, balance_after, item_id, reward_id, note) VALUES ($1,$2,'earn',$3,$4,$5,$6,$7)`,
        [g.key, pid, g.amount, after, g.items[0] ?? null, g.rewardId, g.note]);
      for (const it of g.items) {
        await c.query('INSERT INTO player_items(player_id, item_id, method, tx_key) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [pid, it, g.method, g.key]);
      }
      return { applied: true, balance: after };
    });
  }
  async purchase(pid: string, itemId: string, price: number, key: string, note: string): Promise<PurchaseResult> {
    if (!Number.isInteger(price) || price < 0) throw new Error('bad price');
    return this.tx(async (c) => {
      const bal = await this.wallet(c, pid);   // row lock serializes concurrent purchases by one player
      if ((await c.query('SELECT 1 FROM style_tx WHERE tx_key=$1', [key])).rowCount) return { status: 'duplicate' as const, balance: bal };
      if ((await c.query('SELECT 1 FROM player_items WHERE player_id=$1 AND item_id=$2', [pid, itemId])).rowCount) return { status: 'owned' as const, balance: bal };
      if (bal < price) return { status: 'insufficient' as const, balance: bal };
      const after = bal - price;
      await c.query('UPDATE style_wallets SET balance=$2, updated_at=now() WHERE player_id=$1', [pid, after]);
      await c.query(`INSERT INTO style_tx(tx_key, player_id, kind, amount, balance_after, item_id, note) VALUES ($1,$2,'purchase',$3,$4,$5,$6)`,
        [key, pid, -price, after, itemId, note]);
      await c.query(`INSERT INTO player_items(player_id, item_id, method, tx_key) VALUES ($1,$2,'purchase',$3)`, [pid, itemId, key]);
      return { status: 'ok' as const, balance: after };
    });
  }
  async styleHistory(pid: string, limit: number): Promise<StyleTx[]> {
    const r = await this.pool.query('SELECT id, kind, amount, balance_after, item_id, reward_id, note, created_at FROM style_tx WHERE player_id=$1 ORDER BY id DESC LIMIT $2', [pid, limit]);
    return r.rows.map((x) => ({ id: x.id, kind: x.kind, amount: x.amount, balanceAfter: x.balance_after, itemId: x.item_id, rewardId: x.reward_id, note: x.note, at: new Date(x.created_at).getTime() }));
  }
  async rewardFacts(pid: string, nightId: string | null): Promise<RewardFacts> {
    const h = await this.pool.query(
      `SELECT count(*)::int AS hands, coalesce(array_agg(DISTINCT coalesce(h.game,'uth')), '{}') AS games,
              count(*) FILTER (WHERE h.participant_count > 1)::int AS friend_hands,
              count(DISTINCT h.night_id)::int AS nights,
              count(*) FILTER (WHERE h.night_id = $2)::int AS night_hands
         FROM hand_players hp JOIN hands h ON h.id = hp.hand_id
        WHERE hp.player_id = $1 AND hp.settled AND h.status = 'settled'`, [pid, nightId]);
    const d = await this.pool.query('SELECT count(*)::int AS n, count(*) FILTER (WHERE correct)::int AS c FROM decisions WHERE player_id=$1', [pid]);
    const x = h.rows[0];
    return { hands: x.hands, games: x.hands ? x.games : [], friendHands: x.friend_hands, nights: x.nights, nightHands: x.night_hands, decisions: d.rows[0].n, correct: d.rows[0].c };
  }
}

const stackRow = (r: { balance: unknown; reloads: unknown; debt: unknown }): StackRow =>
  ({ balance: Number(r.balance), reloads: Number(r.reloads), debt: Number(r.debt ?? 0) });
