import { describe, expect, it } from 'vitest';
import { DEBT_JOKES, PAWN_ITEMS, debtJoke, debtLine, pawnFor } from '../../src/shared/debt';

describe('debt counter', () => {
  it('suggests the cheapest item that covers the whole debt', () => {
    expect(pawnFor(1).item).toBe(PAWN_ITEMS[0].item);
    expect(pawnFor(50_000).value).toBe(50_000);
    expect(pawnFor(50_001).value).toBe(100_000);
    expect(pawnFor(4_000_000).item).toMatch(/Corvette/);
    expect(pawnFor(1e12).item).toBe(PAWN_ITEMS[PAWN_ITEMS.length - 1].item);   // beyond the list: the biggest item
    for (let i = 1; i < PAWN_ITEMS.length; i++) expect(PAWN_ITEMS[i].value).toBeGreaterThan(PAWN_ITEMS[i - 1].value);
  });
  it('never repeats a joke back to back and words the line in dollars', () => {
    for (let n = 1; n < 30; n++) expect(debtJoke(n)).not.toBe(debtJoke(n + 1));
    expect(new Set(Array.from({ length: DEBT_JOKES.length }, (_, i) => debtJoke(i + 1))).size).toBe(DEBT_JOKES.length);
    expect(debtLine('Tom', 100_000, 300_000, 3)).toBe(
      `Tom takes a $1,000 marker. Total debt: $3,000. ${DEBT_JOKES[2]} To cover it, pawn ${PAWN_ITEMS[3].item} (about $3,500).`);
  });
});
