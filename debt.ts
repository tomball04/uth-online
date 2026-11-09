// Just for fun. Every reload is a "marker" from the house. Markers add up to a debt, and the dealer
// suggests something to pawn that would cover it. Virtual chips only — nothing here is real money.
//
// TO ADD OR CHANGE PAWN ITEMS: edit PAWN_TIERS below.
//  • `value` is in cents (100_000 = $1,000). Keep tiers sorted from cheapest to most expensive.
//  • A debt uses the cheapest tier that covers it, and one item from that tier is picked at random.
//  • Start personal items with "your" — payoff messages turn it into "their".
//  • Use a curly apostrophe (’) inside items, e.g. 'grandma’s china'.

export interface PawnItem { value: number; item: string } // value in cents
export interface PawnTier { value: number; items: string[] }

export const PAWN_TIERS: PawnTier[] = [
  { value: 100_000, items: [ // $1,000
    'your AirPods (one is missing)',
    'your PlayStation 5 and both controllers',
    'the stand mixer you used once',
    'your Nintendo Switch and every Mario game',
    'the espresso machine you call “Giuseppe”',
    'your grandpa’s fishing rods',
    'the air fryer (it’s practically new)',
    'your vinyl collection, minus the embarrassing ones',
    'your Costco membership and rotisserie chicken rights',
    'the drone you crashed into a tree twice',
    'your signed baseball (signature: “Gary”)',
    'the robot vacuum that keeps getting stuck',
    'your snowboard and the boots that hurt',
    'the Instant Pot and all its rings',
    'your fantasy football trophy',
  ] },
  { value: 200_000, items: [ // $2,000
    'the big TV you mounted yourself',
    'your phone (screen protector included)',
    'the leather recliner with the cup holders',
    'your electric guitar and the amp the neighbors hate',
    'the gas grill you named “The Beast”',
    'your mountain bike',
    'the camera you bought for an Italy trip you never took',
    'your mom’s good silverware (don’t tell her)',
    'the treadmill that’s now a clothes rack',
    'your laptop, stickers and all',
    'the hot tub cover (the hot tub is pending)',
    'your record player and the speakers you swear by',
    'the golf clubs you blame for everything',
    'a lifetime supply of your grandma’s salsa',
    'the kayak in the garage rafters',
  ] },
  { value: 300_000, items: [ // $3,000
    'your gaming PC, RGB lights included',
    'the Peloton you use as a coat rack',
    'your season tickets (nosebleeds, but still)',
    'the smoker you tend every Sunday',
    'your drum kit',
    'the riding mower you take on “joyrides”',
    'your comic book collection, still in the plastic',
    'the designer handbag that was “an investment”',
    'the pinball machine in the garage',
    'your telescope — you never did find Saturn',
    'the sectional couch the dog chewed',
    'your sneaker wall',
    'a slightly haunted grandfather clock',
    'your dirt bike',
    'the backyard pizza oven',
  ] },
  { value: 400_000, items: [ // $4,000
    'the Rolex (it says “Rolax”)',
    'your home gym, mirror selfies not included',
    'the vintage arcade cabinet',
    'your watch collection (all three)',
    'the above-ground pool and its floaties',
    'your entire Lego collection, Death Star included',
    'the boat trailer (the boat is a separate conversation)',
    'your ATV',
    'the backyard shed you call your “office”',
    'your laptop and every dongle it needs',
    'the baby grand piano nobody plays',
    'your stand-up paddleboards (both of them)',
    'the karaoke system the whole street knows',
    'your tool chest, every wrench labeled',
    'the cast-iron skillets passed down four generations',
  ] },
  { value: 500_000, items: [ // $5,000
    'your road bike nobody’s ridden since 2023',
    'the hot tub (finally)',
    'your Super Bowl party projector and screen',
    'the diamond earrings from your anniversary',
    'your camping trailer that sleeps “four”',
    'the vintage jukebox',
    'your rare trading card (it has a smudge)',
    'the custom smoker trailer',
    'the antique dining set that seats twelve',
    'your motorcycle helmet collection',
    'the backyard putting green',
    'your fishing boat’s motor',
    'a framed jersey from a game you didn’t attend',
    'the home theater recliners (row two)',
    'your wine fridge, contents included',
  ] },
  { value: 600_000, items: [ // $6,000
    'the jet ski',
    'your golf cart with the custom rims',
    'the solar panels (one side of the roof)',
    'your saltwater aquarium and Gary the clownfish',
    'your vintage Vespa',
    'the riding lawn tractor with the cup holder',
    'your bass boat (needs “a little work”)',
    'the sauna you built from a kit',
    'your coin collection, finally worth something',
    'the gold chain you never take off',
    'your beach cruiser fleet (six bikes, one rider)',
    'the backyard playset you overbuilt',
    'the piano lessons you prepaid through 2031',
    'a commercial-grade popcorn machine',
    'the first car you ever bought, still on blocks',
  ] },
  { value: 700_000, items: [ // $7,000
    'your snowmobile',
    'the side-by-side with the light bar',
    'your bowling ball collection and the shoes',
    'the in-ground trampoline',
    'your vintage guitar (a real one this time)',
    'the outdoor kitchen you finished last summer',
    'your autographed movie poster wall',
    'a racing simulator with three screens',
    'the lake cabin rental deposit for the next five summers',
    'your mid-century modern furniture, all of it',
    'the fountain in the front yard',
    'your home brewing setup',
    'a pallet of collectible sneakers, never worn',
    'the home recording studio',
    'the hand-carved bar in the basement',
  ] },
  { value: 800_000, items: [ // $8,000
    'a lightly used golf cart with a cup holder',
    'your horse’s saddle (the horse says no)',
    'the ice-cream truck you bought “for the kids”',
    'your dad’s classic pickup (he still asks about it)',
    'your share of the pontoon boat',
    'a rooftop tent and all the overlanding gear',
    'the restaurant-grade espresso bar',
    'your season of private golf lessons',
    'the koi pond and all twelve koi',
    'your sports memorabilia room',
    'the electric bike fleet',
    'a full suit of armor (decorative)',
    'the pool table that took six guys to carry in',
    'your custom Halloween animatronics',
    'the backyard ice rink',
  ] },
  { value: 900_000, items: [ // $9,000
    'your truck’s lift kit (the truck stays… for now)',
    'the travel trailer with the awning',
    'your Pac-Man and Galaga cabinets',
    'a slightly used tiny house',
    'the go-kart track out back',
    'the camper van conversion kit',
    'the hot-air balloon ride credits you won',
    'your signed first-edition books',
    'the professional camera rig',
    'your tractor (the green one)',
    'a mechanical bull',
    'the backyard movie theater, popcorn included',
    'your fly-fishing gear and lodge membership',
    'a gently used hot dog cart',
    'the pinball collection (all four machines)',
  ] },
  { value: 1_000_000, items: [ // $10,000
    'your truck (lift kit and all)',
    'the used sedan that “just needs a timing belt”',
    'your bass boat and its trailer',
    'the home solar battery',
    'your vintage motorcycle',
    'a slightly used carnival ride',
    'the backyard pool renovation fund',
    'your watch (the real one this time)',
    'a vintage photo booth',
    'your restored jukebox and every 45 in it',
    'a small herd of alpacas',
    'your boat slip at the marina',
    'a lifetime supply of Thanksgiving turkeys',
    'a neon sign collection worth more than your car',
    'the chandelier in the dining room',
  ] },
  // Bigger debts: fewer steps, still plenty of choices.
  { value: 2_000_000, items: [ // $20,000
    'a used electric car with 200,000 miles',
    'your pontoon boat',
    'a vintage Airstream',
    'a food truck that only sells corn dogs',
    'the RV you call “The Mothership”',
    'a used stretch limousine',
    'half of a racehorse (the back half)',
    'your fishing boat with the pun name',
  ] },
  { value: 6_000_000, items: [ // $60,000
    'a vintage Corvette (it doesn’t start)',
    'a food truck with a loyal following',
    'a sailboat named “Reel Estate”',
    'a classic Mustang convertible',
    'the cabin up at the lake',
    'half a frozen-yogurt franchise',
    'a vintage Rolls-Royce that smells like cigars',
    'a race car (the slow kind)',
  ] },
  { value: 25_000_000, items: [ // $250,000
    'the timeshare in Cabo',
    'a laundromat',
    'a car wash with the inflatable tube guy',
    'a bowling alley’s last two lanes',
    'a mini golf course',
    'a racehorse that “just needs one more year”',
    'a yacht share (one week a year)',
    'a small-town diner',
  ] },
  { value: 100_000_000, items: [ // $1,000,000
    'the house — and the dog’s house',
    'a drive-in movie theater',
    'a lake house',
    'a fleet of ice-cream trucks',
    'a ski chalet',
    'a beachfront bar in Key West',
    'a radio station',
    'a castle in Ireland (needs a roof)',
  ] },
  { value: 2_000_000_000, items: [ // $20,000,000
    'a small vineyard in Napa',
    'a minor-league baseball team',
    'a private island (it’s mostly rocks)',
    'a casino — a small one, in a strip mall',
    'a superyacht with a helipad',
    'a ski resort',
    'a horse farm in Kentucky',
    'a skyscraper’s top three floors',
  ] },
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
  'The casino just added a wing. Guess who paid for it.',
  'Your accountant changed their number.',
  'The buffet is still free. Mostly.',
  'The valet is keeping your car “for safekeeping.”',
  'Even the slot machines feel bad for you.',
  'Your lucky socks have been placed on probation.',
  'The house would like to name you Employee of the Month.',
  'Your piggy bank has entered witness protection.',
  'The dealer slid you a mint. It’s on your tab.',
  'Your financial advisor is now just “an advisor.”',
  'The chandelier in the lobby has your name on a plaque.',
  'Rumor has it the high-limit room is lowering its limits for you.',
  'Your marker is framed in the manager’s office.',
];

const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Every item, for lists and tests. */
export const PAWN_ITEMS: PawnItem[] = PAWN_TIERS.flatMap((t) => t.items.map((item) => ({ value: t.value, item })));

/** The cheapest tier that covers the whole debt (the biggest tier beyond that). */
export function pawnTier(debt: number): PawnTier {
  return PAWN_TIERS.find((t) => t.value >= debt) ?? PAWN_TIERS[PAWN_TIERS.length - 1];
}

/**
 * An item that covers `debt`. `pick` chooses within the tier: a number in [0, 1) (e.g. Math.random()),
 * or a string that always maps to the same item. Without it, the tier's first item.
 */
export function pawnFor(debt: number, pick: number | string = 0): PawnItem {
  const t = pawnTier(debt);
  let i = 0;
  if (typeof pick === 'number') i = Math.floor(Math.min(Math.max(pick, 0), 0.999999) * t.items.length);
  else { let h = 2166136261; for (const ch of pick) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); i = (h >>> 0) % t.items.length; }
  return { value: t.value, item: t.items[i] };
}

/** A random item for a new marker. */
export const randomPawn = (debt: number) => pawnFor(debt, Math.random());

/** The joke for the n-th marker (1-based) cycles through the list so it doesn't repeat back to back. */
export function debtJoke(markers: number): string {
  return DEBT_JOKES[(Math.max(1, markers) - 1) % DEBT_JOKES.length];
}

/** One line for chat when a player takes another marker. */
export function debtLine(name: string, borrowed: number, debt: number, markers: number, pawn: PawnItem = pawnFor(debt)): string {
  return `${name} takes a ${money(borrowed)} marker. Total debt: ${money(debt)}. ${debtJoke(markers)} `
    + `To cover it, pawn ${pawn.item} (about ${money(pawn.value)}).`;
}
