import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { orderedDeck } from '../shared/cards.js';

/** Fisher–Yates with a CSPRNG (crypto.randomInt is unbiased). */
export function secureShuffle(): number[] {
  const d = orderedDeck();
  for (let i = d.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export function roomCode(len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export const newId = () => randomUUID();
export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
