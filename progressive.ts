// Five Card Progressive — a fixed $5 jackpot side bet scored on the player's two hole cards plus the
// three flop cards. One meter is shared by every table on the server (a "linked" progressive).
//
// Sources
//  * Hollywood Casino at Penn National Race Course, "Ultimate Texas Hold'em" progressive table guide:
//    Five Card Progressive — Royal 100% of jackpot, Straight Flush 10%, Four of a Kind $1,500, Full House $250,
//    Flush $200, Straight $150, Three of a Kind $45; Envy $5,000 / $1,500; original wager not returned.
//    https://www.hollywoodpnrc.com/-/media/png/east/hollywood-pnrc/pdfs/pnrc-progressive-table-guides-2022/pnrc-texasholdem.pdf
//  * Washington State Gambling Commission, Ultimate Texas Hold'em rules, Multi-Game Link jackpot Paytable 01
//    (the same table per $1: 100% / 10% / 300 / 50 / 40 / 30 / 9 for 1, Envy $1,000 / $300; hole cards + flop;
//    seed at least the largest fixed award; folded-hand eligibility at the operator's discretion).
//    https://wsgc.wa.gov/sites/default/files/2025-04/Ultimate%20Texas%20Hold%20'Em_0.pdf
//  Operator choices made here (not specified by the sources): $10,000 seed, 70% of each wager feeds the meter,
//  folded hands remain eligible (the bet is decided by the flop, before any fold), meter percentages and the
//  Straight Flush share are paid in whole dollars, rounded down.

import { evaluate, handName, type HandName } from './evaluator.js';

export interface ProgressiveRow { hand: HandName; kind: 'meter' | 'fixed'; pct?: number; amount?: number }

export const PROGRESSIVE = {
  id: 'five-card-5',
  name: 'Five Card Progressive',
  wager: 500,            // cents — fixed $5
  contribution: 350,     // cents of each wager added to the meter (70%)
  seed: 1_000_000,       // cents — $10,000 reset
  rows: [
    { hand: 'Royal Flush', kind: 'meter', pct: 100 },
    { hand: 'Straight Flush', kind: 'meter', pct: 10 },
    { hand: 'Four of a Kind', kind: 'fixed', amount: 150_000 },
    { hand: 'Full House', kind: 'fixed', amount: 25_000 },
    { hand: 'Flush', kind: 'fixed', amount: 20_000 },
    { hand: 'Straight', kind: 'fixed', amount: 15_000 },
    { hand: 'Three of a Kind', kind: 'fixed', amount: 4_500 },
  ] as ProgressiveRow[],
  envy: { 'Royal Flush': 500_000, 'Straight Flush': 150_000 } as Partial<Record<HandName, number>>,
  cards: 'Your two hole cards plus the three flop cards',
  foldHandling: 'stays-live' as const,
  sources: [
    { title: 'Hollywood Casino PNRC — Ultimate Texas Hold’em progressive guide', url: 'https://www.hollywoodpnrc.com/-/media/png/east/hollywood-pnrc/pdfs/pnrc-progressive-table-guides-2022/pnrc-texasholdem.pdf' },
    { title: 'Washington State Gambling Commission — Ultimate Texas Hold’em, Multi-Game Link Paytable 01', url: "https://wsgc.wa.gov/sites/default/files/2025-04/Ultimate%20Texas%20Hold%20'Em_0.pdf" },
  ],
};

const dollarsDown = (cents: number) => Math.floor(cents / 100) * 100;

/** The progressive hand: best five-card hand from the two hole cards and the flop only. */
export function progressiveHand(hole: number[], flop: number[]): HandName {
  return handName(evaluate([...hole, ...flop.slice(0, 3)]));
}

export interface ProgressiveEntry { playerId: string; seat: number; hand: HandName }
export interface ProgressiveAward {
  playerId: string; hand: HandName; base: number; envy: number; amount: number; label: string; fromMeter: boolean;
}
export interface ProgressiveHit { playerId: string; hand: HandName; amount: number; meterBefore: number }
export interface ProgressiveResolution {
  awards: Map<string, ProgressiveAward>; meterBefore: number; meterAfter: number; hits: ProgressiveHit[];
}

/**
 * Pays every progressive bet at one table for one hand, in seat order. A Royal takes the whole meter
 * (which then resets to the seed); a Straight Flush takes 10% of the meter as it stands; fixed awards are
 * paid by the house. Each Royal / Straight Flush pays an Envy bonus to every OTHER progressive bettor.
 */
export function resolveProgressive(entries: ProgressiveEntry[], meter: number): ProgressiveResolution {
  const meterBefore = meter;
  const awards = new Map<string, ProgressiveAward>();
  const hits: ProgressiveHit[] = [];
  const sorted = [...entries].sort((a, b) => a.seat - b.seat);
  for (const e of sorted) {
    const row = PROGRESSIVE.rows.find((r) => r.hand === e.hand);
    let base = 0, label = '', fromMeter = false;
    if (row?.kind === 'meter') {
      fromMeter = true;
      const before = meter;
      base = dollarsDown((meter * row.pct!) / 100);
      // Royal: the meter resets to the seed, and the cents left over from rounding down carry into the new meter.
      meter = row.pct === 100 ? PROGRESSIVE.seed + (meter - base) : Math.max(PROGRESSIVE.seed, meter - base);
      label = `${e.hand} — ${row.pct}% of the jackpot`;
      hits.push({ playerId: e.playerId, hand: e.hand, amount: base, meterBefore: before });
    } else if (row?.kind === 'fixed') {
      base = row.amount!;
      label = `${e.hand} pays $${(row.amount! / 100).toLocaleString('en-US')}`;
    }
    awards.set(e.playerId, { playerId: e.playerId, hand: e.hand, base, envy: 0, amount: base, label, fromMeter });
  }
  for (const hit of hits) {
    const envy = PROGRESSIVE.envy[hit.hand] ?? 0;
    for (const a of awards.values()) {
      if (a.playerId === hit.playerId || !envy) continue;
      a.envy += envy;
      a.amount += envy;
      a.label = a.label ? `${a.label} + Envy bonus` : `Envy bonus (${hit.hand} at the table)`;
    }
  }
  return { awards, meterBefore, meterAfter: meter, hits };
}
