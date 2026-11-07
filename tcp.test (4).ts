import { describe, expect, it } from 'vitest';
import { cardToInt } from '../../src/shared/cards';
import { evaluate3, settleTcp, tcpBasicPlay, tcpExactEV, tcpHandName, tcpQualifies, ANTE_BONUS, PAIR_PLUS, SIX_CARD } from '../../src/shared/tcp';

const c = (s: string) => s.split(' ').map(cardToInt);
const E = (s: string) => evaluate3(c(s));
const name = (s: string) => tcpHandName(E(s));

describe('three-card evaluator', () => {
  it('names every category', () => {
    expect(name('9h Th Jh')).toBe('Straight Flush');
    expect(name('7c 7d 7s')).toBe('Three of a Kind');
    expect(name('9h Tc Jd')).toBe('Straight');
    expect(name('2h 9h Kh')).toBe('Flush');
    expect(name('Kc Kd 4s')).toBe('Pair');
    expect(name('Ac 9d 4s')).toBe('High Card');
  });
  it('ranks Straight above Flush (unlike five-card poker)', () => {
    expect(E('4c 5d 6s')).toBeGreaterThan(E('Ah Kh 9h'));
    expect(E('Ah Kh 9h')).toBeGreaterThan(E('Ac Ad Ks'));        // flush beats pair
    expect(E('2c 2d 2h')).toBeGreaterThan(E('Ac Kd Qs'));        // trips beat a straight
  });
  it('A-K-Q is the highest straight, A-2-3 the lowest', () => {
    expect(name('Ac Kd Qs')).toBe('Straight');
    expect(name('Ac 2d 3s')).toBe('Straight');
    expect(E('Ac Kd Qs')).toBeGreaterThan(E('Kc Qd Js'));
    expect(E('Ac 2d 3s')).toBeLessThan(E('2c 3d 4s'));
    expect(name('Ac Kd 2s')).toBe('High Card');                   // no wrap-around
    expect(E('Ah 2h 3h')).toBeLessThan(E('2s 3s 4s'));            // steel wheel is the lowest straight flush
  });
  it('compares trips by rank, pairs by pair then kicker, flush and high card by descending ranks, exact ties', () => {
    expect(E('8c 8d 8s')).toBeGreaterThan(E('7c 7d 7s'));
    expect(E('9c 9d 2s')).toBeGreaterThan(E('8c 8d As'));
    expect(E('9c 9d 5s')).toBeGreaterThan(E('9h 9s 4c'));
    expect(E('Kh 9h 3h')).toBeGreaterThan(E('Ks 9s 2s'));
    expect(E('Kh Jc 3d')).toBeGreaterThan(E('Ks Tc 9d'));
    expect(E('Kh Jc 3d')).toBe(E('Ks Jd 3c'));
  });
  it('dealer qualifies with Queen high or better; Jack high does not', () => {
    expect(tcpQualifies(E('Qc 4d 2s'))).toBe(true);
    expect(tcpQualifies(E('Jc Td 8s'))).toBe(false);
    expect(tcpQualifies(E('2c 2d 3s'))).toBe(true);
    expect(tcpQualifies(E('Ac 3d 2s'))).toBe(true);              // A-2-3 is a straight
  });
});

describe('Three Card Poker settlement', () => {
  const base = { ante: 1000, play: 1000, pairPlus: 0, sixCard: 0, folded: false };
  it('dealer does not qualify: Ante 1:1, Play pushes', () => {
    const s = settleTcp({ ...base, player: c('5c 7d 9s'), dealer: c('Jc Td 8h') });
    expect([s.ante.net, s.play.net, s.net, s.outcome, s.dealerQualifies]).toEqual([1000, 0, 1000, 'win', false]);
  });
  it('qualified dealer: player wins both, loses both, or ties and pushes', () => {
    expect(settleTcp({ ...base, player: c('Kc Kd 4s'), dealer: c('Qc 9d 2s') }).net).toBe(2000);
    expect(settleTcp({ ...base, player: c('Kc Jd 4s'), dealer: c('Ac 9d 2s') }).net).toBe(-2000);
    const tie = settleTcp({ ...base, player: c('Kh Jc 3d'), dealer: c('Ks Jd 3c') });
    expect([tie.outcome, tie.net]).toEqual(['push', 0]);
  });
  it('Ante Bonus pays even when the dealer wins; never after a fold', () => {
    const s = settleTcp({ ...base, player: c('4c 5d 6s'), dealer: c('2h 2d 2s') });
    expect(s.outcome).toBe('lose');
    expect(s.anteBonus).toMatchObject({ result: 'win', net: 1000, multiplier: 1 });
    expect(s.net).toBe(-2000 + 1000);
    expect(settleTcp({ ...base, player: c('9h Th Jh'), dealer: c('Qc 9d 2s') }).anteBonus.net).toBe(5000);
    expect(settleTcp({ ...base, player: c('7c 7d 7s'), dealer: c('Qc 9d 2s') }).anteBonus.net).toBe(4000);
    const f = settleTcp({ ...base, play: 0, folded: true, player: c('7c 7d 7s'), dealer: c('Qc 9d 2s') });
    expect([f.anteBonus.result, f.net, f.outcome]).toEqual(['none', -1000, 'fold']);
  });
  it('Pair Plus: every category, and it still pays after a fold', () => {
    const pp = (hand: string) => settleTcp({ ...base, play: 0, folded: true, pairPlus: 500, player: c(hand), dealer: c('Ac Ad Kh') }).pairPlus;
    expect(pp('9h Th Jh').net).toBe(500 * 40);
    expect(pp('7c 7d 7s').net).toBe(500 * 30);
    expect(pp('9h Tc Jd').net).toBe(500 * 6);
    expect(pp('2h 9h Kh').net).toBe(500 * 3);
    expect(pp('Kc Ks 4s').net).toBe(500);
    expect(pp('Qc 9d 4s')).toMatchObject({ result: 'lose', net: -500 });
    expect(Object.values(PAIR_PLUS)).toEqual([40, 30, 6, 3, 1]);
    expect(Object.values(ANTE_BONUS)).toEqual([5, 4, 1]);
  });
  it('Six Card Bonus uses five-card ranks on the best five of six, and pays after a fold', () => {
    const six = (p: string, d: string) => settleTcp({ ...base, play: 0, folded: true, sixCard: 500, player: c(p), dealer: c(d) });
    const cases: [string, string, string, number][] = [
      ['As Ks Qs', 'Js Ts 2d', 'Royal Flush', 1000], ['9s 8s 7s', '6s 5s 2d', 'Straight Flush', 200], ['9s 9h 9d', '9c 2s 3d', 'Four of a Kind', 100],
      ['9s 9h 9d', '4c 4s 3d', 'Full House', 20], ['2h 7h 9h', 'Jh Kh 3c', 'Flush', 15], ['9s Th Jd', 'Qc Ks 2d', 'Straight', 10],
      ['9s 9h 9d', 'Ac 2s 5d', 'Three of a Kind', 7],
    ];
    for (const [p, d, hand, m] of cases) {
      const s = six(p, d);
      expect(s.sixCardHand, hand).toBe(hand);
      expect(s.sixCard.net, hand).toBe(500 * m);
    }
    expect(six('9s 9h 4d', '4c 2s 3d').sixCard).toMatchObject({ result: 'lose', net: -500 });     // two pair loses
    // Three-card ranks would call 4-5-6 + 7-8-x a straight over a flush; five-card ranks see the 5-card straight.
    expect(six('4h 5c 6d', '7s 8h Kd').sixCardHand).toBe('Straight');
    expect(Object.values(SIX_CARD)).toEqual([1000, 200, 100, 20, 15, 10, 7]);
  });
});

describe('Three Card Poker strategy', () => {
  it('basic strategy: Queen-6-4 or better plays', () => {
    expect(tcpBasicPlay(c('Qc 6d 4s'))).toBe(true);
    expect(tcpBasicPlay(c('Qc 6d 3s'))).toBe(false);
    expect(tcpBasicPlay(c('Qc 7d 2s'))).toBe(true);
    expect(tcpBasicPlay(c('Jc Td 8s'))).toBe(false);
    expect(tcpBasicPlay(c('Kc 3d 2s'))).toBe(true);
    expect(tcpBasicPlay(c('2c 2d 3s'))).toBe(true);
  });
  it('exact enumeration over all 18,424 dealer hands agrees with Q-6-4', () => {
    const q64 = tcpExactEV(c('Qc 6d 4s')), q63 = tcpExactEV(c('Qc 6d 3s'));
    expect(q64.combos).toBe(18424);
    expect(q64.wins + q64.losses + q64.ties + q64.noQualify).toBe(18424);
    expect(q64.play).toBeGreaterThan(-1);       // play beats folding (−1 Ante)
    expect(q63.play).toBeLessThan(-1);
  });
});

describe('display names', () => {
  it('say the rank that matters', async () => {
    const { tcpDescribe } = await import('../../src/shared/tcp');
    expect(tcpDescribe(E('Qd 8c 3h'))).toBe('Queen High');
    expect(tcpDescribe(E('Jd 8c 3h'))).toBe('Jack High');
    expect(tcpDescribe(E('Kc Kd 4s'))).toBe('Pair of Kings');
    expect(tcpDescribe(E('7c 7d 7s'))).toBe('Three Sevens');
    expect(tcpDescribe(E('9h Th Jh'))).toBe('Straight Flush');
  });
});
