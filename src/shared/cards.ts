// Card model shared by server and client.
// Wire/storage format is a 2-char string: rank + suit, e.g. "As", "Td", "2c".
// Internally the evaluator uses integers 0..51: rank = c >> 2 (0 = deuce .. 12 = ace), suit = c & 3.

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'shdc'; // spades, hearts, diamonds, clubs
export const SUIT_SYMBOL: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const RANK_LABEL: Record<string, string> = {
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A',
};

export type CardStr = string;

export function cardToInt(c: CardStr): number {
  const r = RANK_CHARS.indexOf(c[0]);
  const s = SUIT_CHARS.indexOf(c[1]);
  if (r < 0 || s < 0 || c.length !== 2) throw new Error(`Invalid card: ${c}`);
  return (r << 2) | s;
}

export function intToCard(n: number): CardStr {
  return RANK_CHARS[n >> 2] + SUIT_CHARS[n & 3];
}

export const rankOf = (n: number) => n >> 2;
export const suitOf = (n: number) => n & 3;

/** A fresh, ordered 52-card deck as integers. Shuffling happens on the server only. */
export function orderedDeck(): number[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

export function isRed(c: CardStr): boolean {
  return c[1] === 'h' || c[1] === 'd';
}
