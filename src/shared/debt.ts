// Just for fun. Every reload is a "marker" from the house. Markers add up to a debt, and the dealer
// suggests something to pawn that would cover it. Virtual chips only — nothing here is real money.

export interface PawnItem { value: number; item: string } // value in cents

/** Ascending by value. The suggestion is the cheapest item that covers the whole debt. */
export const PAWN_ITEMS: PawnItem[] = [
  { value: 50_000, item: 'your AirPods (one is missing)' },
  { value: 100_000, item: 'your PlayStation 5 and both controllers' },
  { value: 200_000, item: 'the big TV you mounted yourself' },
  { value: 350_000, item: 'your gaming PC, RGB lights included' },
  { value: 500_000, item: 'the Rolex (it says “Rolax”)' },
  { value: 800_000, item: 'your road bike nobody’s ridden since 2023' },
  { value: 1_200_000, item: 'the jet ski' },
  { value: 2_000_000, item: 'a lightly used golf cart with a cup holder' },
  { value: 3_500_000, item: 'your truck (lift kit and all)' },
  { value: 6_000_000, item: 'a vintage Corvette' },
  { value: 10_000_000, item: 'the timeshare in Cabo' },
  { value: 25_000_000, item: 'a food truck with a loyal following' },
  { value: 50_000_000, item: 'the house — and the dog’s house' },
  { value: 100_000_000, item: 'a small vineyard in Napa' },
  { value: 500_000_000, item: 'a minor-league baseball team' },
  { value: 2_000_000_000, item: 'a private island (it’s mostly rocks)' },
];

export const DEBT_JOKES: string[] = [
  'The pit boss just learned your name.',
  'Your credit score folded pre-flop.',
  'Accounting would like a word.',
  'Security has started waving at you.',
  'Your marker now has its own marker.',
  'The cocktail waitress stopped asking if you want anything.',
  'The ATM in the lobby filed for a restraining order.',
  'Somewhere, a loan officer felt a disturbance.',
  'The house thanks you for your continued support.',
  'Your bank sent a sympathy card.',
  'The dealer is quietly shuffling for you now.',
  'They’re naming a slot machine after you.',
];

const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function pawnFor(debt: number): PawnItem {
  return PAWN_ITEMS.find((p) => p.value >= debt) ?? PAWN_ITEMS[PAWN_ITEMS.length - 1];
}

/** The joke for the n-th marker (1-based) cycles through the list so it doesn't repeat back to back. */
export function debtJoke(markers: number): string {
  return DEBT_JOKES[(Math.max(1, markers) - 1) % DEBT_JOKES.length];
}

/** One line for chat when a player takes another marker. */
export function debtLine(name: string, borrowed: number, debt: number, markers: number): string {
  return `${name} takes a ${money(borrowed)} marker. Total debt: ${money(debt)}. ${debtJoke(markers)} `
    + `To cover it, pawn ${pawnFor(debt).item} (about ${money(pawnFor(debt).value)}).`;
}
