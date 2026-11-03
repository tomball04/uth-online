import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DecisionRecord, TableConfig } from '../shared/protocol.js';
import {
  InsufficientFunds, type HandStart, type PlayerRow, type PlayerSettlementRow, type PlayerStats,
  type RecentHandRow, type ReplayData, type StackRow, type Store, type TableRow,
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
    const r = await this.pool.query('SELECT code,host_id,config,hand_counter,closed_at FROM game_tables WHERE code=$1', [code]);
    const t = r.rows[0];
    return t ? { code: t.code, hostId: t.host_id, config: t.config, handCounter: t.hand_counter, closed: !!t.closed_at } : null;
  }
  async updateTable(code: string, p: { config?: TableConfig; hostId?: string; closed?: boolean; handCounter?: number }) {
    await this.pool.query(
      `UPDATE game_tables SET config=COALESCE($2,config), host_id=COALESCE($3,host_id),
         closed_at=CASE WHEN $4::boolean THEN now() ELSE closed_at END, hand_counter=COALESCE($5,hand_counter) WHERE code=$1`,
      [code, p.config ?? null, p.hostId ?? null, !!p.closed, p.handCounter ?? null]);
  }

  async getStack(playerId: string, code: string): Promise<StackRow | null> {
    const r = await this.pool.query('SELECT balance,reloads FROM stacks WHERE player_id=$1 AND table_code=$2', [playerId, code]);
    return r.rows[0] ?? null;
  }
  async createStack(playerId: string, code: string, amount: number): Promise<StackRow> {
    return this.tx(async (c) => {
      const ins = await c.query(
        `INSERT INTO stacks(player_id,table_code,balance) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING balance,reloads`,
        [playerId, code, amount]);
      if (ins.rowCount) {
        await c.query(`INSERT INTO ledger(tx_key,player_id,table_code,kind,amount,balance_after) VALUES ($1,$2,$3,'buyin',$4,$4)`,
          [`${code}:${playerId}:buyin`, playerId, code, amount]);
        return ins.rows[0];
      }
      return (await c.query('SELECT balance,reloads FROM stacks WHERE player_id=$1 AND table_code=$2', [playerId, code])).rows[0];
    });
  }
  async reloadStack(playerId: string, code: string, amount: number): Promise<StackRow> {
    return this.tx(async (c) => {
      const cur = (await c.query('SELECT balance,reloads FROM stacks WHERE player_id=$1 AND table_code=$2 FOR UPDATE', [playerId, code])).rows[0];
      if (!cur) throw new Error('No stack');
      const n = cur.reloads + 1;
      await c.query('UPDATE stacks SET balance=$3, reloads=$4, updated_at=now() WHERE player_id=$1 AND table_code=$2', [playerId, code, amount, n]);
      await c.query(`INSERT INTO ledger(tx_key,player_id,table_code,kind,amount,balance_after) VALUES ($1,$2,$3,'reload',$4,$5)`,
        [`${code}:${playerId}:reload:${n}`, playerId, code, amount - cur.balance, amount]);
      return { balance: amount, reloads: n };
    });
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

  async startHand(h: HandStart) {
    return this.tx(async (c) => {
      await c.query(
        `INSERT INTO hands(id,table_code,hand_number,status,deck_commitment,dealer_cards,community,participant_count)
         VALUES ($1,$2,$3,'active',$4,$5,$6,$7)`,
        [h.id, h.tableCode, h.handNumber, h.deckCommitment, JSON.stringify(h.dealerCards), JSON.stringify(h.community), h.players.length]);
      await c.query('UPDATE game_tables SET hand_counter=$2 WHERE code=$1', [h.tableCode, h.handNumber]);
      const balances = new Map<string, number>();
      for (const p of h.players) {
        await c.query(
          `INSERT INTO hand_players(hand_id,player_id,seat,name,hole,ante,blind,trips) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [h.id, p.playerId, p.seat, p.name, JSON.stringify(p.hole), p.ante, p.blind, p.trips]);
        const total = p.ante + p.blind + p.trips;
        const bal = await this.debit(c, p.playerId, h.tableCode, h.id, total, `${h.id}:${p.playerId}:initial`);
        balances.set(p.playerId, bal!);
      }
      return balances;
    });
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

  async recordDecision(handId: string, playerId: string, d: DecisionRecord, state: { play: number; folded: boolean }) {
    await this.pool.query(
      `INSERT INTO decisions(hand_id,player_id,phase,action,recommended,correct,timed_out,reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [handId, playerId, d.phase, d.action, d.recommended, d.correct, d.timedOut, d.reason]);
    if (state.folded) await this.pool.query('UPDATE hand_players SET folded=true WHERE hand_id=$1 AND player_id=$2', [handId, playerId]);
  }
  async updateDecisionEV(handId: string, playerId: string, phase: string, evCost: number, exact: boolean) {
    await this.pool.query('UPDATE decisions SET ev_cost=$4, ev_exact=$5 WHERE hand_id=$1 AND player_id=$2 AND phase=$3',
      [handId, playerId, phase, evCost, exact]);
  }

  async settleHand(handId: string, code: string, dealer: { hand: string; qualifies: boolean }, rows: PlayerSettlementRow[]) {
    return this.tx(async (c) => {
      const balances = new Map<string, number>();
      const h = await c.query('SELECT status FROM hands WHERE id=$1 FOR UPDATE', [handId]);
      if (h.rows[0]?.status !== 'active') return { applied: false, balances };
      for (const r of rows) {
        await c.query(
          `UPDATE hand_players SET outcome=$3, hand_name=$4, hand_rank=$5, net=$6, trips_net=$7, settlement=$8, play=$9, folded=$10, settled=true
           WHERE hand_id=$1 AND player_id=$2`,
          [handId, r.playerId, r.outcome, r.handName, r.handRank, r.net, r.tripsNet, JSON.stringify(r.settlement), r.play, r.folded]);
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
      return { applied: true, balances };
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
        await c.query(`UPDATE hands SET status='voided', settled_at=now() WHERE id=$1`, [h.id]);
      });
    }
    return { hands: active.rowCount ?? 0, refunds };
  }

  async playerStats(pid: string): Promise<PlayerStats> {
    const q = (sql: string) => this.pool.query(sql, [pid]);
    const [agg, best, dec, byPhase, mistakes, trips, friends, stacks, series] = await Promise.all([
      q(`SELECT COUNT(*)::int hands, COALESCE(SUM(net),0) net,
            COUNT(*) FILTER (WHERE outcome='win')::int wins, COUNT(*) FILTER (WHERE outcome='lose')::int losses,
            COUNT(*) FILTER (WHERE outcome='push')::int pushes, COUNT(*) FILTER (WHERE outcome='fold')::int folds,
            COALESCE(MAX(net),0) biggest_win, COALESCE(MIN(net),0) biggest_loss,
            COALESCE(SUM(ante+blind+trips+play),0) wagered
         FROM hand_players WHERE player_id=$1 AND settled`),
      q(`SELECT hand_name FROM hand_players WHERE player_id=$1 AND settled ORDER BY hand_rank DESC NULLS LAST LIMIT 1`),
      q(`SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE correct)::int ok, COALESCE(SUM(ev_cost),0) ev FROM decisions WHERE player_id=$1`),
      q(`SELECT phase, action, COUNT(*)::int count, COUNT(*) FILTER (WHERE correct)::int correct FROM decisions WHERE player_id=$1 GROUP BY phase, action ORDER BY phase, action`),
      q(`SELECT phase, action, recommended, COUNT(*)::int count, COALESCE(SUM(ev_cost),0) ev FROM decisions WHERE player_id=$1 AND NOT correct
         GROUP BY phase, action, recommended ORDER BY count DESC LIMIT 5`),
      q(`SELECT COUNT(*)::int bets, COUNT(*) FILTER (WHERE trips_net>0)::int wins, COALESCE(SUM(trips_net),0) net FROM hand_players WHERE player_id=$1 AND settled AND trips>0`),
      q(`SELECT COUNT(*)::int n FROM hand_players hp JOIN hands h ON h.id=hp.hand_id WHERE hp.player_id=$1 AND hp.settled AND h.participant_count>1`),
      q(`SELECT COALESCE(SUM(reloads),0)::int reloads, COUNT(*)::int tables FROM stacks WHERE player_id=$1`),
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
      handsWithFriends: friends.rows[0].n, reloads: stacks.rows[0].reloads, tables: stacks.rows[0].tables,
      series: series.rows.reverse().map((r) => ({ at: new Date(r.at).toISOString(), cumulative: Number(r.cum) })),
    };
  }

  async recentHands(code: string, limit: number): Promise<RecentHandRow[]> {
    const r = await this.pool.query(
      `SELECT h.id, h.hand_number, h.settled_at, h.dealer_hand, h.dealer_qualifies,
              json_agg(json_build_object('name',hp.name,'net',hp.net,'outcome',hp.outcome,'handName',hp.hand_name) ORDER BY hp.seat) players
       FROM hands h JOIN hand_players hp ON hp.hand_id=h.id
       WHERE h.table_code=$1 AND h.status='settled'
       GROUP BY h.id ORDER BY h.hand_number DESC LIMIT $2`, [code, limit]);
    return r.rows.map((x) => ({
      handId: x.id, handNumber: x.hand_number, at: new Date(x.settled_at).getTime(),
      dealerHand: x.dealer_hand, dealerQualifies: x.dealer_qualifies,
      players: x.players.map((p: { name: string; net: number | string; outcome: string; handName: string }) => ({ ...p, net: Number(p.net) })),
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
      players: ps.map((p) => ({
        playerId: p.player_id, name: p.name, seat: p.seat, hole: p.hole, folded: p.folded,
        ante: p.ante, blind: p.blind, trips: p.trips, play: p.play, net: p.net, outcome: p.outcome,
        handName: p.hand_name, settlement: p.settlement,
      })),
      decisions: ds.map((d) => ({
        playerId: d.player_id, phase: d.phase, action: d.action, recommended: d.recommended, correct: d.correct,
        reason: d.reason, timedOut: d.timed_out, evCost: d.ev_cost ?? undefined, evExact: d.ev_exact ?? undefined,
        at: new Date(d.created_at).toISOString(),
      })),
    };
  }

  async ledgerSum(playerId: string, code: string) {
    const r = await this.pool.query('SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE player_id=$1 AND table_code=$2', [playerId, code]);
    return Number(r.rows[0].s);
  }
}
