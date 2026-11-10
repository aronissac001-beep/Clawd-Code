// Random events for Mystery nodes. Pure data: every outcome is written in the
// shared effect language (see applyEffects / describeEffects in the run layer),
// so the UI can describe a choice before it is taken.
//
// Choice shape: { label, chance?, win, lose?, note? }. With `chance` the choice
// is a gamble: `win` applies on success, `lose` on failure. Without it, `win`
// always applies. Every event keeps at least one safe choice.
//
// Flags: whenever an effect sets flag { name: value }, the interpreter also
// records flags[name + 'At'] = run.regionsCleared. Chain events compare that
// stamp with run.regionsCleared to wait a region or more between steps.

import { DEFAULT_MODS } from './balance.js';
import { BUILDINGS } from './buildings.js';
import { RELICS } from './relics.js';

const F = (run) => run.flags || {};
const gold = (run) => run.gold || 0;
const cleared = (run) => run.regionsCleared || 0;

export const EVENTS = {
  bard: {
    id: 'bard', title: 'The Wandering Bard', icon: 'sound', weight: 10,
    text: 'A bard with a cracked lute and a perfect smile offers a song of your deeds. He charges 20 gold, and insists the price is a kindness.',
    requires: (run) => gold(run) >= 20,
    choices: [
      { label: 'Pay for the song (20 gold)', win: { gold: -20, sovHp: 40, next: { mods: { soldierDmg: 0.1 } }, text: 'The ballad is shameless and wonderful. Your soldiers hum it all the way to the next region.' } },
      { label: 'Ask for the sad version', chance: 0.5,
        win: { embers: 14, text: 'Even the crows go quiet. Something in the Hearthflame answers.' },
        lose: { gold: -10, text: 'The sad version is mostly about his ex-wife. He still asks for a tip.' } },
      { label: 'Send him on his way', win: { text: 'He bows deeply and plays you out of earshot anyway.' } },
    ],
  },

  star_fall: {
    id: 'star_fall', title: 'A Star Falls', icon: 'nova', weight: 8, minStep: 1,
    text: 'Something bright tears across the dusk and lands in a smoking crater nearby. The rock inside still hums.',
    choices: [
      { label: 'Pry out the star-metal', chance: 0.6,
        win: { relic: 'rare', text: 'It cools in your hands into something worth keeping.' },
        lose: { sovHp: -50, text: 'The star-metal flares white. You keep your eyebrows, mostly.' } },
      { label: 'Sell the site to prospectors', win: { gold: 35, text: 'They pay in coin and promises. You keep the coin.' } },
      { label: 'Let it cool and gather the sparks', win: { embers: 8 } },
    ],
  },

  plague_rats: {
    id: 'plague_rats', title: 'Rats in the Grain', icon: 'skull', weight: 8,
    text: 'Grey rats with too-bright eyes pour out of a wagon of grain bound for your stores. One of them looks smug.',
    choices: [
      { label: 'Quarantine and burn it (15 gold)', win: { gold: -15, embers: 5, text: 'It smells terrible. Nobody gets sick.' } },
      { label: 'Sort the grain and keep it', chance: 0.55,
        win: { next: { food: 45 }, text: 'Most of it is fine. The smug rat is not.' },
        lose: { next: { mods: { farmYield: -0.2, upkeep: 0.15 } }, text: 'The sickness spreads to the fields of your next region.' } },
      { label: 'Turn the wagon off the road', win: { text: 'The rats go elsewhere. Somebody else’s problem, for once.' } },
    ],
  },

  tribute: {
    id: 'tribute', title: 'A Rival Lord', icon: 'crown', weight: 8, minStep: 1,
    text: 'Lord Varrick of the Ninth Mile blocks the road with forty spears and a very large hat. He demands tribute for passage.',
    choices: [
      { label: 'Pay 40 gold', win: { gold: -40, text: 'He tips the hat. The spears part.' } },
      { label: 'Refuse him', win: { embers: 10, next: { raiders: true }, text: 'He swears you will regret it. His riders will follow you into the next region.' } },
      { label: 'Challenge his champion', chance: 0.5,
        win: { gold: 40, text: 'His champion yields. Varrick pays you to keep it quiet.' },
        lose: { sovHp: -60, next: { raiders: true }, text: 'You lose the duel and your temper. His riders follow you.' } },
    ],
  },

  deserters: {
    id: 'deserters', title: 'Deserters at the Fire', icon: 'pop', weight: 9,
    text: 'Three ragged soldiers from a fallen keep ask to share your fire. They swear they only ran from the Hollow, never from a fight.',
    choices: [
      { label: 'Welcome them', chance: 0.7,
        win: { next: { villagers: 3 }, text: 'They keep their word and their posts.' },
        lose: { gold: -35, next: { villagers: 1 }, text: 'Two vanish before dawn with part of the treasury. One stays, ashamed.' } },
      { label: 'Feed them and send them on', win: { embers: 6, text: 'They leave lighter of heart. So do you.' } },
    ],
  },

  flood: {
    id: 'flood', title: 'The River Rises', icon: 'moon', weight: 8,
    text: 'Rain in the hills has swollen the river to a brown roar. The only ford is under a man’s height of water.',
    choices: [
      { label: 'Wait for the water to fall', win: { next: { mods: { farmYield: 0.25, buildSpeed: -0.1 } }, text: 'The flood leaves rich silt behind, and a great deal of mud.' } },
      { label: 'Cross now', win: { sovHp: -35, next: { wood: 40 }, text: 'You are battered across, dragging a raft of driftwood behind you.' } },
    ],
  },

  fey_market: {
    id: 'fey_market', title: 'The Midnight Market', icon: 'eye', weight: 6, minStep: 1,
    text: 'Lanterns bloom in a ring of mushrooms and tall, smiling merchants unroll their wares. Nothing has a price tag. Everything has a price.',
    choices: [
      { label: 'Buy a moonlit blessing (40 gold)', win: { gold: -40, next: { mods: { lightRadius: 1, lootMult: 0.15 } }, text: 'Your lanterns burn a little brighter, and coins seem to find you.' } },
      { label: 'Trade a memory', chance: 0.5,
        win: { relic: 'rare', text: 'You forget a rainy afternoon. You gain a treasure.' },
        lose: { sovHp: -40, gold: -20, text: 'You forget which of them you paid. They do not.' } },
      { label: 'Decline politely, and do not eat anything', win: { text: 'Wise. The fruit was looking at you.' } },
    ],
  },

  eclipse: {
    id: 'eclipse', title: 'The Sun Goes Out', icon: 'sun', weight: 6, minStep: 1,
    text: 'At noon the sun turns black at the rim. In the strange dark, an old mason’s tablet glints in the rubble.',
    choices: [
      { label: 'Study the tablet through the dark', win: { blueprint: 'random', next: { extraNights: 1 }, text: 'You learn a new design. The Hollow learn your scent and will press you for longer.' } },
      { label: 'Light every torch and wait (15 gold)', win: { gold: -15, text: 'The sun returns. So does your nerve.' } },
    ],
  },

  old_soldier: {
    id: 'old_soldier', title: 'The Old Soldier', icon: 'shield', weight: 9,
    text: 'A one-eyed veteran sits on a milestone, sharpening a sword older than your crown. He has opinions about your footwork.',
    choices: [
      { label: 'Spar with him at dawn', win: { sovMaxHp: 25, text: 'You are bruised everywhere and somehow stronger.' } },
      { label: 'Let him drill your soldiers (15 gold)', win: { gold: -15, next: { mods: { soldierDmg: 0.15 } }, text: 'He charges for the lessons, and is worth it.' } },
      { label: 'Share a meal and a story', win: { sovHeal: true, text: 'He laughs at your jokes. Nobody has done that in weeks.' } },
    ],
  },

  collapsed_mine: {
    id: 'collapsed_mine', title: 'The Collapsed Mine', icon: 'pick', weight: 8,
    text: 'A dwarf-cut mine slumps into the hillside. Behind the fallen timbers, something glitters.',
    choices: [
      { label: 'Clear the entrance carefully', win: { next: { stone: 25 }, text: 'Good cut stone, stacked and waiting.' } },
      { label: 'Dig for the deep vein', chance: 0.5,
        win: { gold: 55, next: { stone: 35 }, text: 'Gold and stone in the same seam. The old dwarves would be jealous.' },
        lose: { sovHp: -45, next: { stone: 10 }, text: 'The ceiling comes down. You come out, eventually.' } },
      { label: 'Leave it to the dark', win: { text: 'Some holes are best left alone.' } },
    ],
  },

  lost_caravan: {
    id: 'lost_caravan', title: 'The Lost Caravan', icon: 'map', weight: 9,
    text: 'Six wagons sit axle-deep in a bog, their drivers arguing about whose map was wrong. It was everyone’s.',
    choices: [
      { label: 'Haul them out', win: { gold: 25, next: { food: 20 }, text: 'They pay in coin and cheese.' } },
      { label: 'Escort them past the Hollow', chance: 0.65,
        win: { gold: 30, relic: 'common', text: 'Safe on the road, the caravan master gives you a trinket from her own neck.' },
        lose: { sovHp: -40, gold: 15, text: 'The Hollow find you halfway. The drivers pay what they can.' } },
      { label: 'Point them the right way', win: { embers: 5 } },
    ],
  },

  hollow_child: {
    id: 'hollow_child', title: 'The Grey-Eyed Child', icon: 'heart', weight: 6, minStep: 1,
    text: 'A small girl sits alone in a burned village. Her eyes are Hollow-grey, but she is warm, and she is asking for her mother.',
    choices: [
      { label: 'Hold her close to the Hearthflame', win: { sovHp: -30, embers: 15, next: { villagers: 1 }, text: 'The grey burns out of her eyes and into you. She follows you home.' } },
      { label: 'Ask the Hearthflame to cleanse her', chance: 0.6,
        win: { removeCurse: true, embers: 10, text: 'The light that heals her heals something in you too.' },
        lose: { next: { mods: { enemyDmg: 0.1 } }, text: 'The grey flees her and runs ahead of you. The next Hollow hit harder.' } },
      { label: 'Leave her with the shrine-keepers (10 gold)', win: { gold: -10, text: 'You pay for her keep. They promise to try.' } },
    ],
  },

  smith: {
    id: 'smith', title: 'The Travelling Smith', icon: 'hammer', weight: 9,
    requires: (run) => gold(run) >= 30, // both safe choices cost gold
    text: 'A smith with a forge on wheels and arms like hams offers to improve anything you own. She refuses to improve your hat.',
    choices: [
      { label: 'Reforge your blade (30 gold)', win: { gold: -30, next: { mods: { sovDmg: 0.25 } }, text: 'The edge sings when you draw it.' } },
      { label: 'Buy barbed arrowheads (35 gold)', win: { gold: -35, next: { mods: { rangedDmg: 0.15 } }, text: 'A crate of wicked little points.' } },
      { label: 'Ask her to test her new design', chance: 0.6,
        win: { blueprint: 'random', text: 'It works. She lets you keep the plans.' },
        lose: { sovHp: -25, text: 'It explodes. She takes notes.' } },
    ],
  },

  ember_wisp: {
    id: 'ember_wisp', title: 'An Ember Wisp', icon: 'flame', weight: 9,
    text: 'A spark the size of a sparrow circles your head, chirping. It seems to like you.',
    choices: [
      { label: 'Cup it in your hands', win: { embers: 15, text: 'It settles into the Hearthflame with a contented hiss.' } },
      { label: 'Let it warm you', win: { sovHeal: true, text: 'Every old wound remembers how to close.' } },
      { label: 'Follow it into the woods', chance: 0.5,
        win: { relic: 'common', text: 'It leads you to a forgotten cairn and something shiny.' },
        lose: { sovHp: -25, text: 'It leads you into a thorn bush and laughs.' } },
    ],
  },

  cursed_altar: {
    id: 'cursed_altar', title: 'The Weeping Altar', icon: 'relic', weight: 6, minStep: 2,
    text: 'A black stone altar weeps something dark and slow. Upon it, half-sunk in the stone, rests a gilded box.',
    choices: [
      { label: 'Take the box', chance: 0.5,
        win: { relic: 'rare', text: 'The lid opens on a treasure, and the weeping stops.' },
        lose: { relic: 'cursed', text: 'The box opens on something that was waiting for you.' } },
      { label: 'Offer your blood instead', win: { sovHp: -40, embers: 18, text: 'The altar drinks, and goes quiet, and gives back warmth.' } },
      { label: 'Walk away', win: { text: 'The weeping follows you for a mile. Then it stops.' } },
    ],
  },

  granary: {
    id: 'granary', title: 'The Abandoned Granary', icon: 'farm', weight: 8,
    text: 'A granary stands sealed and untouched in an empty village. The door is barred from the inside.',
    choices: [
      { label: 'Break the bar', chance: 0.7,
        win: { next: { food: 60 }, text: 'Sacks of good grain, and one very surprised goat.' },
        lose: { sovHp: -30, next: { food: 20 }, text: 'Something Hollow was guarding it. Most of the grain survives.' } },
      { label: 'Knock first', win: { next: { food: 25 }, text: 'Nobody answers. You take a little and leave a coin, out of manners.' } },
    ],
  },

  dice_stranger: {
    id: 'dice_stranger', title: 'Bones at the Crossroads', icon: 'dice', weight: 7,
    requires: (run) => gold(run) >= 25,
    text: 'A hooded stranger rattles a cup of carved bones. "One throw," she says. "Unless you are afraid."',
    choices: [
      { label: 'Wager 25 gold', chance: 0.45,
        win: { gold: 30, text: 'Double sixes. She pays out and claps, slowly.' },
        lose: { gold: -25, text: 'Snake eyes. She does not gloat, which is worse.' } },
      { label: 'Throw for a secret', chance: 0.5,
        win: { blueprint: 'random', text: 'She sketches a building on the back of your hand.' },
        lose: { next: { extraNights: 1 }, text: 'She whispers to the dark instead. Something out there starts counting nights.' } },
      { label: 'Decline the game', win: { text: 'She shrugs. The crossroads are patient.' } },
    ],
  },

  woodcutters: {
    id: 'woodcutters', title: 'The Woodcutters’ Feud', icon: 'axe', weight: 8,
    text: 'Two families of woodcutters are fighting over one very large oak. Both ask you to judge.',
    choices: [
      { label: 'Split the oak between them', win: { next: { wood: 30 }, text: 'Both families grumble equally, which is justice.' } },
      { label: 'Hire both families (20 gold)', win: { gold: -20, next: { wood: 50, villagers: 1 }, text: 'One of them follows you to the next region.' } },
      { label: 'Claim the oak for the crown', chance: 0.6,
        win: { next: { wood: 70 }, text: 'Nobody argues with a crown. Out loud.' },
        lose: { next: { wood: 30, mods: { chopSpeed: -0.15 } }, text: 'Word gets around. Woodcutters work slowly for a tyrant.' } },
    ],
  },

  pilgrims: {
    id: 'pilgrims', title: 'Lantern Pilgrims', icon: 'brazier', weight: 8,
    text: 'A procession of pilgrims passes in silence, each carrying a lantern for someone lost to the Hollow.',
    choices: [
      { label: 'Walk with them a while', win: { sovHp: 50, next: { mods: { lightRadius: 1 } }, text: 'They gift you lantern-oil and a little peace.' } },
      { label: 'Give alms (20 gold)', win: { gold: -20, embers: 12, next: { villagers: 1 }, text: 'One pilgrim decides her journey ends with you.' } },
    ],
  },

  architect: {
    id: 'architect', title: 'The Exiled Architect', icon: 'book', weight: 6, minStep: 1,
    text: 'A thin man with ink-black fingers and a satchel of plans says he was exiled for building too well. He seems proud of it.',
    choices: [
      { label: 'Buy his best plans (50 gold)', win: { gold: -50, blueprint: 'random', text: 'He rolls them up with real tenderness.' } },
      { label: 'Ask him to oversee your builders (20 gold)', win: { gold: -20, next: { mods: { buildSpeed: 0.2 } }, text: 'He shouts a lot. Things go up fast.' } },
      { label: 'Wish him luck', win: { text: 'He corrects your posture and leaves.' } },
    ],
  },

  hollow_scouts: {
    id: 'hollow_scouts', title: 'Hollow Scouts', icon: 'sword', weight: 7, minStep: 2,
    text: 'Grey shapes watch from the treeline, counting your banners. They will tell the dark what they saw.',
    choices: [
      { label: 'Hunt them down', chance: 0.6,
        win: { embers: 15, gold: 20, text: 'None of them get home.' },
        lose: { sovHp: -45, next: { mods: { waveMult: 0.15 } }, text: 'One escapes. The next region’s nights will be crowded.' } },
      { label: 'Break camp and move quietly (10 gold)', win: { gold: -10, text: 'You abandon a wagon of supplies, but not your trail.' } },
      { label: 'Let them look', win: { next: { mods: { waveMult: 0.1 } }, embers: 6, text: 'Let them come. The Hearth is hungry.' } },
    ],
  },

  // ---------------- Dragon egg chain (3 steps, once per run) ----------------
  // dragon_egg sets dragonEgg = 1 (stamping dragonEggAt). After at least one
  // more region, egg_stirs fires and sets dragonEgg to 'fed' or 'warm' (new
  // stamp) or 'sold' (ends the chain). One region after that, egg_hatches.
  // maxStep 2 leaves three steps before the boss for the two regions it needs.
  dragon_egg: {
    id: 'dragon_egg', title: 'An Egg in the Ashes', icon: 'flame', weight: 6, minStep: 1, maxStep: 2,
    requires: (run) => F(run).dragonEgg === undefined,
    text: 'In a nest of fused stone sits an egg the size of a shield, warm as a hearth and scaled in copper. Something inside taps back when you knock.',
    choices: [
      { label: 'Carry it home', win: { sovHp: -25, flag: { dragonEgg: 1 }, text: 'It is heavy and very hot. You are sure it is worth it.' } },
      { label: 'Sell the shell-shards nearby', win: { gold: 30, flag: { dragonEgg: 'left' }, text: 'You leave the egg where it lies and pocket the pretty fragments.' } },
    ],
  },

  egg_stirs: {
    id: 'egg_stirs', title: 'The Egg Stirs', icon: 'flame', weight: 100, trigger: 'chain',
    requires: (run) => F(run).dragonEgg === 1 && cleared(run) >= (F(run).dragonEggAt || 0) + 1,
    text: 'The dragon egg rocks in its blankets and the shell glows from within. It is hungry, or cold, or both.',
    choices: [
      { label: 'Feed it 40 gold', win: { gold: -40, flag: { dragonEgg: 'fed' }, text: 'It drinks the coins like soup. The glow steadies.' } },
      { label: 'Keep it warm against you', win: { sovHp: -40, flag: { dragonEgg: 'warm' }, text: 'You sleep with it in your arms. It is like hugging a forge.' } },
      { label: 'Sell it to a collector', win: { gold: 90, flag: { dragonEgg: 'sold' }, text: 'The collector weeps with joy. You try not to think about it.' } },
    ],
  },

  egg_hatches: {
    id: 'egg_hatches', title: 'The Egg Hatches', icon: 'wyrm', weight: 100, trigger: 'chain',
    requires: (run) => {
      const f = F(run);
      return (f.dragonEgg === 'fed' || f.dragonEgg === 'warm') && cleared(run) >= (f.dragonEggAt || 0) + 1;
    },
    text: 'With a crack like a breaking bell, a copper wyrmling tumbles out and sneezes a smoke ring. It looks at you as if you are its mother.',
    choices: [
      { label: 'Raise it as your own', win: { relic: 'legendary', flag: { dragonEgg: 'hatched' }, text: 'It curls around your crown and refuses to move.' } },
      { label: 'Set it free to fight the dark', win: { sovMaxHp: 40, sovHeal: true, embers: 30, flag: { dragonEgg: 'freed' }, text: 'It circles once, roars, and burns a road through the Hollow ahead of you.' } },
    ],
  },
};

// ---------------- selection ----------------

function currentStep(run) {
  if (run.pos === null || run.pos === undefined || !run.map || !run.map.nodes) return null;
  const node = run.map.nodes[run.pos];
  return node && typeof node.step === 'number' ? node.step : null;
}

// Events that can fire right now for this trigger.
export function eligibleEvents(run, trigger = 'mystery') {
  const seen = F(run).seenEvents || [];
  const step = currentStep(run);
  const out = [];
  for (const id in EVENTS) {
    const e = EVENTS[id];
    if ((e.trigger || 'mystery') !== trigger) continue;
    if (seen.includes(id)) continue;
    if (step !== null) {
      if (e.minStep !== undefined && step < e.minStep) continue;
      if (e.maxStep !== undefined && step > e.maxStep) continue;
    }
    if (e.requires && !e.requires(run)) continue;
    out.push(e);
  }
  return out;
}

// Weighted pick from the eligible pool, or null if nothing can fire.
export function pickEvent(run, rng, trigger = 'mystery') {
  const pool = eligibleEvents(run, trigger);
  if (!pool.length) return null;
  return rng.weighted(pool, (e) => e.weight);
}

// Gold a choice always costs up front (negative gold in every outcome).
// The UI should disable a choice the player cannot pay for.
export function choiceCost(choice) {
  const w = (choice.win && choice.win.gold) || 0;
  const l = choice.chance !== undefined ? ((choice.lose && choice.lose.gold) || 0) : w;
  return Math.max(0, -Math.max(w, l));
}
export function canChoose(run, choice) {
  return gold(run) >= choiceCost(choice);
}

// ---------------- validation ----------------

const ICONS = ['food', 'wood', 'stone', 'gold', 'pop', 'sword', 'sun', 'moon', 'pause', 'play', 'fast',
  'nightskip', 'menu', 'sound', 'mute', 'map', 'nova', 'banner', 'check', 'x', 'info', 'hammer', 'trash',
  'up', 'crown', 'flame', 'tower', 'farm', 'house', 'skull', 'shield', 'gear', 'plus', 'minus', 'beacon',
  'book', 'axe', 'pick', 'hoe', 'wall', 'gate', 'brazier', 'barracks', 'lumber', 'quarry', 'export',
  'import', 'dice', 'share', 'eye', 'region', 'mystery', 'merchant', 'shrine', 'ruin', 'wyrm', 'heart', 'relic',
  'wheel'];
const EFFECT_KEYS = ['gold', 'sovHp', 'sovMaxHp', 'sovHeal', 'relic', 'loseRelic', 'removeCurse', 'embers',
  'blueprint', 'next', 'flag', 'text'];
const NEXT_KEYS = ['food', 'wood', 'stone', 'gold', 'villagers', 'caches', 'extraNights', 'raiders', 'mods'];
const RELIC_TIERS = ['common', 'rare', 'legendary', 'cursed'];
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

function checkText(where, t) {
  if (typeof t !== 'string' || !t.trim()) throw new Error(`${where}: missing text`);
  if (EMOJI.test(t)) throw new Error(`${where}: emoji are not allowed`);
}

function checkEffects(where, eff) {
  if (!eff || typeof eff !== 'object' || Array.isArray(eff)) throw new Error(`${where}: effects must be an object`);
  for (const k in eff) {
    const v = eff[k];
    const at = `${where}.${k}`;
    if (!EFFECT_KEYS.includes(k)) throw new Error(`${at}: unknown effect key`);
    switch (k) {
      case 'gold': case 'sovHp':
        if (!Number.isInteger(v) || v === 0) throw new Error(`${at}: must be a non-zero integer`); break;
      case 'sovMaxHp': case 'embers':
        if (!Number.isInteger(v) || v <= 0) throw new Error(`${at}: must be a positive integer`); break;
      case 'sovHeal': case 'loseRelic': case 'removeCurse':
        if (v !== true) throw new Error(`${at}: must be true`); break;
      case 'relic':
        if (typeof v !== 'string' || !v) throw new Error(`${at}: must be a tier or relic id`);
        if (!RELIC_TIERS.includes(v) && !RELICS[v]) throw new Error(`${at}: unknown relic '${v}'`); break;
      case 'blueprint':
        if (v !== 'random' && !BUILDINGS[v]) throw new Error(`${at}: unknown building '${v}'`); break;
      case 'text': checkText(at, v); break;
      case 'flag':
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${at}: must be an object`);
        for (const f in v) {
          if (f === 'seenEvents' || f.endsWith('At')) throw new Error(`${at}.${f}: reserved flag name`);
          if (!['string', 'number', 'boolean'].includes(typeof v[f])) throw new Error(`${at}.${f}: flag values must be plain scalars`);
        }
        break;
      case 'next':
        if (!v || typeof v !== 'object') throw new Error(`${at}: must be an object`);
        for (const n in v) {
          if (!NEXT_KEYS.includes(n)) throw new Error(`${at}.${n}: unknown next key`);
          if (n === 'raiders') { if (v[n] !== true) throw new Error(`${at}.raiders: must be true`); continue; }
          if (n === 'mods') {
            for (const m in v.mods) {
              if (!(m in DEFAULT_MODS)) throw new Error(`${at}.mods.${m}: not in DEFAULT_MODS`);
              if (typeof v.mods[m] !== 'number' || !isFinite(v.mods[m]) || v.mods[m] === 0) throw new Error(`${at}.mods.${m}: bad number`);
            }
            continue;
          }
          if (!Number.isInteger(v[n]) || v[n] <= 0) throw new Error(`${at}.${n}: must be a positive integer`);
        }
        break;
    }
  }
}

// A fresh run as requires() would see it, for validation probes.
function probeRun(goldAmt) {
  return { gold: goldAmt, regionsCleared: 0, flags: { seenEvents: [] }, relics: [], blueprints: [], sov: { hp: 320, maxHp: 320 }, embers: 0 };
}

export function validateEvents() {
  const ids = Object.keys(EVENTS);
  if (ids.length < 18) throw new Error(`events: need at least 18, have ${ids.length}`);
  for (const id of ids) {
    const e = EVENTS[id];
    const w = `event '${id}'`;
    if (e.id !== id) throw new Error(`${w}: id mismatch`);
    checkText(`${w}.title`, e.title);
    checkText(`${w}.text`, e.text);
    if (!ICONS.includes(e.icon)) throw new Error(`${w}: unknown icon '${e.icon}'`);
    if (typeof e.weight !== 'number' || !(e.weight > 0)) throw new Error(`${w}: weight must be > 0`);
    if (e.trigger !== undefined && e.trigger !== 'mystery' && e.trigger !== 'chain') throw new Error(`${w}: bad trigger`);
    if (e.requires !== undefined && typeof e.requires !== 'function') throw new Error(`${w}: requires must be a function`);
    if (e.trigger === 'chain' && !e.requires) throw new Error(`${w}: chain events need requires()`);
    for (const k of ['minStep', 'maxStep']) {
      if (e[k] !== undefined && (!Number.isInteger(e[k]) || e[k] < 0)) throw new Error(`${w}: bad ${k}`);
    }
    if (e.minStep !== undefined && e.maxStep !== undefined && e.minStep > e.maxStep) throw new Error(`${w}: minStep > maxStep`);
    if (!Array.isArray(e.choices) || e.choices.length < 2 || e.choices.length > 3) throw new Error(`${w}: needs 2-3 choices`);
    let safe = 0;
    e.choices.forEach((c, i) => {
      const cw = `${w} choice ${i}`;
      checkText(`${cw}.label`, c.label);
      if (c.note !== undefined) checkText(`${cw}.note`, c.note);
      for (const k in c) if (!['label', 'chance', 'win', 'lose', 'note'].includes(k)) throw new Error(`${cw}: unknown key '${k}'`);
      checkEffects(`${cw}.win`, c.win);
      if (c.chance === undefined) {
        safe++;
        if (c.lose !== undefined) throw new Error(`${cw}: lose without chance`);
      } else {
        if (typeof c.chance !== 'number' || !(c.chance > 0 && c.chance < 1)) throw new Error(`${cw}: chance must be in (0,1)`);
        checkEffects(`${cw}.lose`, c.lose);
      }
    });
    if (!safe) throw new Error(`${w}: needs at least one safe choice`);
    // A player who cannot afford any safe choice must never see the event.
    const safeCost = Math.min(...e.choices.filter((c) => c.chance === undefined).map(choiceCost));
    if (safeCost > 0 && (!e.requires || e.requires(probeRun(safeCost - 1)))) {
      throw new Error(`${w}: every safe choice costs gold, so requires() must demand at least ${safeCost}`);
    }
    if (e.trigger === 'chain' && e.requires(probeRun(999))) throw new Error(`${w}: chain event fires on a fresh run`);
    if (e.trigger === 'chain' && !e.choices.every((c) => c.win.flag && (c.chance === undefined || c.lose.flag))) {
      throw new Error(`${w}: every chain choice must set a flag so it fires once`);
    }
  }
  return true;
}
