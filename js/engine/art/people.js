// Colonist art (owner D; doc 14.6 "Human art with 4 hair styles x 6 palettes", 12.4 integer sprite
// keys, docs/ART-STYLE.md). One pixel rig for every ancestry, about 15 px tall in a 24 x 24 px cell:
// head (6 skin tones per ancestry), hair (4 styles x 6 colours), beard (5), a tunic in the colour of
// the colonist's ROLE (miner ember, builder ochre, crafter blue, hauler green, generalist slate; other
// roles plum), trousers and trim from the look's clothes palette, profession looks (miner, cleric,
// runesmith), the tool in hand while working and the frames:
//   0 idle (also the passing pose of the walk), 1-2 walk strides (the 4-frame cycle is 1, 0, 2, 0),
//   3-4 work swing (3 wind-up, 4 strike), 5 carry idle, 6-7 carry strides.
// The look fields come from the colonist (schema.js `look`: { skin, hair, hairC, beard, cloth }).
//
//   colonistSprite(c, frame, flip, scale, tool?, prof?)  cached sprite; c: a colonist or { anc, look, role };
//                         tool: '' | pick | axe | hammer | saw | mallet | hoe; prof: a look key; c.job.carry -> carry bundle
//   colonistKey(anc, look, frame, flip, tool, prof, role?, carry?)  the integer cache key
//   toolOfJob(type, def)  the tool a job shows (mine: pick, chop: axe, build: hammer, craft at a bench: saw / mallet)
//   selectRing(on)        the pixel selection ring (a sprite drawn under a selected colonist)
//   PEOPLE_PARTS          kit parts for keys.js (body.*, hair.*, beard.*, clothes, outfit.*, held.* tools)
//   SKIN, HAIR_COLOURS, CLOTH, ROLE_TUNIC   the palettes (palette.js colours)
// Sprite box: 24 x 24 px (48 x 48 world units), anchor (12, 20) px at the feet.

import { PAL, RAMP } from './palette.js';
import { bake, Px, peek } from './pixel.js';
import { HAIR_STYLES, BEARDS, CLOTH_PALETTES } from './keys.js';

const P = PAL;
export const CW = 48, CH = 48, CAX = 24, CAY = 40; // world units (px x 2)
const BW = 24, BH = 24, AX = 12, AY = 20;

/** Skin ramps [shadow, base, light] per ancestry. */
export const SKIN = Object.freeze([[P.tan, P.peach, P.bone], [P.umber3, P.sand, P.peach], [P.umber3, P.tan, P.sand], [P.umber2, P.umber3, P.tan], [P.umber1, P.umber2, P.umber3], [P.umber0, P.umber1, P.umber2]]);
const SKIN_SYLVARI = [[P.moss2, P.moss3, P.sand], [P.moss1, P.moss2, P.moss3], [P.umber3, P.sand, P.peach], [P.moss1, P.moss3, P.sand]];
const SKIN_EMBER = [[P.ember0, P.ember1, P.orange], [P.umber1, P.ember1, P.tan], [P.ember1, P.orange, P.sand], [P.ember0, P.umber2, P.ember1]];
/** Hair colours [dark, light]. */
export const HAIR_COLOURS = Object.freeze([[P.ink, P.night], [P.umber0, P.umber1], [P.umber1, P.umber2], [P.ember0, P.ember1], [P.tan, P.sand], [P.slate2, P.slate3]]);
/** Clothes palettes: [trousers dark, trousers, trim]. */
export const CLOTH = Object.freeze({
  russet: [P.ember0, P.umber1, P.tan], moss: [P.moss0, P.moss1, P.sand], slate: [P.slate0, P.slate1, P.mist],
  ochre: [P.umber0, P.umber2, P.gold], plum: [P.plum0, P.plum1, P.peach], teal: [P.deep, P.water, P.teal],
});
/** Tunic ramps [dark, mid, light] by role (js/data/roles.js ids); any other role wears plum. */
export const ROLE_TUNIC = Object.freeze({
  miner: [P.ember0, P.ember1, P.orange], builder: [P.umber2, P.tan, P.sand], crafter: [P.deep, P.water, P.shallow],
  hauler: [P.moss1, P.moss2, P.moss3], generalist: [P.slate1, P.slate2, P.slate3], other: [P.plum0, P.plum1, P.violet],
});
const ROLE_IX = { generalist: 0, miner: 1, builder: 2, crafter: 3, hauler: 4 };
const ROLE_IDS = ['generalist', 'miner', 'builder', 'crafter', 'hauler', 'other'];
const ANC = { human: 0, sylvari: 1, deepforge: 2, emberkin: 3 };
const ANC_IDS = ['human', 'sylvari', 'deepforge', 'emberkin'];
const LOOKS = { '': 0, 'look.miner': 1, 'look.cleric': 2, 'look.runesmith': 3, miner: 1, cleric: 2, runesmith: 3 };
const LOOK_IDS = ['', 'miner', 'cleric', 'runesmith'];
const TOOLS = { '': 0, pick: 1, axe: 2, hammer: 3, saw: 4, mallet: 5, hoe: 6 };
const TOOL_IDS = ['', 'pick', 'axe', 'hammer', 'saw', 'mallet', 'hoe'];
/** Carry bundles: 0 none, 1 logs, 2 stone, 3 a sack (anything else). */
const CARRY_OF = { wood: 1, stone: 2, block: 2, ore: 2, coal: 2, pillar: 2 };

/** The tool a job shows in hand. def: the bench def for craft jobs (carpenter: saw, mason: mallet). */
export function toolOfJob(type, def) {
  switch (type) {
    case 'mine': return 'pick';
    case 'chop': return 'axe';
    case 'build': case 'construct': case 'deconstruct': return 'hammer';
    case 'craft': case 'bill': return def === 'mason' ? 'mallet' : 'saw';
    case 'grow': case 'sow': return 'hoe';
    default: return '';
  }
}
/** Carry bundle index of a colonist (its job's carried stack), 0 when empty-handed. */
export function carryOf(c) {
  const j = c && c.job, k = j && j.carry && j.carry.k;
  return k ? CARRY_OF[k] || 3 : 0;
}
const roleOf = (c) => { const r = c && c.role ? (Array.isArray(c.role) ? c.role[0] : c.role) : 'generalist'; return r in ROLE_IX ? ROLE_IX[r] : r ? 5 : 0; };

/** Integer sprite key (doc 12.4: integer keys, no strings per frame). */
export function colonistKey(anc, look, frame, flip, tool, prof, role = 0, carry = 0) {
  const L = look || {};
  const lo = ((ANC[anc] | 0) | ((L.skin & 7) << 2) | ((L.hair & 3) << 5) | ((L.hairC & 7) << 8) | ((L.beard & 7) << 11) | ((L.cloth & 7) << 14)
    | ((LOOKS[prof || ''] | 0) << 17) | ((TOOLS[tool || ''] | 0) << 19) | ((frame & 7) << 22) | ((flip ? 1 : 0) << 25)) >>> 0;
  return 4294967296 + lo + (role & 7) * 67108864 + (carry & 3) * 536870912;
}

/** Cached colonist sprite. c: a colonist (anc, look, role, job) or { anc, look, role }. */
export function colonistSprite(c, frame = 0, flip = false, scale = 2, tool = '', prof = '') {
  const anc = c.anc || 'human', look = c.look || {}, role = roleOf(c);
  const carry = frame >= 5 ? carryOf(c) || 3 : 0;
  const key = colonistKey(anc, look, frame, flip, tool, prof, role, carry), hit = peek(key);
  if (hit) return hit;
  return bake(key, BW, BH, AX, AY, (p) => {
    if (flip) { p.g.translate(BW, 0); p.g.scale(-1, 1); }
    drawColonist(p, anc, look, frame, tool, prof, role, carry);
    if (flip) p.g.setTransform(1, 0, 0, 1, 0, 0);
  }, { after: (p) => p.shadow(12, 21, 4.5, 1.2, 7) });
}

/**
 * Draw a colonist into a 24 x 24 px cell (feet on row 20), facing right. role: ROLE_IDS index;
 * carry: bundle index (frames 5-7).
 */
export function drawColonist(p, anc, look, frame, tool = '', prof = '', role = 0, carry = 0) {
  const a = ANC_IDS.includes(anc) ? anc : 'human';
  const L = look || {};
  const skins = a === 'sylvari' ? SKIN_SYLVARI : a === 'emberkin' ? SKIN_EMBER : SKIN;
  const sk = skins[(L.skin | 0) % skins.length];
  const hc = HAIR_COLOURS[(L.hairC | 0) % 6];
  const cl = CLOTH[CLOTH_PALETTES[(L.cloth | 0) % 6]];
  const style = HAIR_STYLES[(L.hair | 0) % 4];
  const beard = a === 'sylvari' ? 'none' : BEARDS[(L.beard | 0) % 5];
  const pf = typeof prof === 'string' ? prof.replace('look.', '') : '';
  const tun = pf === 'cleric' ? [P.slate3, P.mist, P.bone] : ROLE_TUNIC[ROLE_IDS[role] || 'generalist'];
  const short = a === 'deepforge' ? 1 : 0; // deepforge: a head shorter, a pixel wider
  const work = frame === 3 || frame === 4, carrying = frame >= 5;
  const stride = frame === 1 || frame === 6 ? 1 : frame === 2 || frame === 7 ? 2 : 0;
  const top = 7 + short; // head top row (hair one above)
  // legs and boots (rows 17-20)
  const leg = (x, c) => { p.rect(x, 17, 2, 3, c); p.rect(x, 20, 2, 1, P.umber0); };
  if (pf === 'cleric') { p.rect(9 - short, 16, 7 + short * 2, 4, tun[1]); p.vl(15 + short, 16, 4, tun[0]); p.rect(10, 20, 2, 1, P.umber0); p.rect(13, 20, 2, 1, P.umber0); }
  else if (stride === 1) { leg(9, cl[0]); leg(13, cl[1]); p.px(15, 20, P.umber0); }
  else if (stride === 2) { leg(9, cl[1]); leg(13, cl[0]); p.px(15, 20, P.umber0); }
  else { leg(10, cl[0]); leg(12, cl[1]); p.px(14, 20, P.umber0); }
  // back arm (behind the body)
  const swing = stride === 1 ? 1 : stride === 2 ? -1 : 0;
  if (!carrying) { p.rect(8 - short, 12 + short + (swing > 0 ? 1 : 0), 1, 4, tun[0]); p.px(8 - short, 16 + short + (swing > 0 ? 1 : 0), sk[0]); }
  // torso: tunic lit from the top-left, belt with a buckle, the palette's trim at the collar
  const tx = 9 - short, tw = 6 + short * 2, ty = 12 + short, th = 5 - short;
  p.rect(tx, ty, tw, th, tun[1]); p.vl(tx, ty, th, tun[2]); p.vl(tx + tw - 1, ty, th, tun[0]); p.hl(tx, ty + th - 1, tw, tun[0]);
  p.hl(tx + 1, ty, tw - 2, cl[2]);
  if (pf !== 'cleric') { p.hl(tx, ty + th - 2, tw, P.umber0); p.px(tx + (tw >> 1), ty + th - 2, P.gold); }
  else p.vl(tx + (tw >> 1), ty, th + 3, P.gold);
  if (pf === 'runesmith') { p.rect(tx + 1, ty + 1, tw - 2, th + 2, P.umber2); p.hl(tx + 1, ty + 1, tw - 2, P.umber3); }
  if (pf === 'miner') p.hl(tx, ty + 1, tw, P.umber2);
  // head: 6 x 5 with cut corners, two eyes (facing right), the ancestry's ears or horns
  const hx = 9, hy = top;
  p.rect(hx, hy, 6, 5, sk[1]);
  p.vl(hx, hy + 1, 3, sk[0]); p.hl(hx + 1, hy + 4, 5, sk[0]); p.px(hx + 4, hy + 1, sk[2]);
  clearPx(p, hx, hy); clearPx(p, hx + 5, hy); clearPx(p, hx, hy + 4); clearPx(p, hx + 5, hy + 4);
  p.px(hx + 2, hy + 2, P.ink); p.px(hx + 4, hy + 2, P.ink);
  if (a === 'sylvari') { p.px(hx - 1, hy + 1, sk[1]); p.px(hx - 2, hy, sk[1]); }
  if (a === 'emberkin') { p.px(hx + 1, hy - 1, P.umber0); p.px(hx + 1, hy - 2, P.umber0); p.px(hx + 4, hy - 1, P.umber0); p.px(hx + 4, hy - 2, P.umber0); p.px(hx + 1, hy + 3, P.gold); }
  drawBeard(p, beard, hx, hy, hc, short);
  const covered = pf === 'miner' || pf === 'cleric';
  drawHair(p, style, hx, hy, hc, covered);
  if (pf === 'miner') { p.rect(hx, hy - 1, 6, 2, P.umber2); p.hl(hx - 1, hy + 1, 8, P.umber1); p.rect(hx + 2, hy - 3, 1, 2, P.bone); p.px(hx + 2, hy - 4, P.gold); }
  else if (pf === 'cleric') { p.rect(hx - 1, hy - 1, 8, 2, P.mist); p.vl(hx - 1, hy + 1, 4, P.mist); p.vl(hx - 1, hy + 1, 4, P.slate3); p.hl(hx, hy - 1, 6, P.bone); }
  else if (pf === 'runesmith') { p.hl(hx, hy, 6, P.umber0); p.px(hx + 2, hy, P.teal); p.px(hx + 4, hy, P.teal); }
  // front arm, the tool or the carried bundle
  const ax = tx + tw, ay = ty;
  if (carrying) {
    drawBundle(p, carry, ax - 2, ay - 2);
    p.px(ax - 1, ay + 1, sk[1]); p.px(tx - 1, ay + 1, sk[0]);
  } else if (work && tool) {
    if (frame === 3) { p.vl(ax, ay - 2, 3, tun[1]); p.px(ax, ay - 3, sk[1]); drawTool(p, tool, ax, ay - 3, 'up'); }
    else { p.px(ax, ay, tun[1]); p.px(ax + 1, ay + 1, tun[1]); p.px(ax + 2, ay + 2, sk[1]); drawTool(p, tool, ax + 2, ay + 2, 'down'); }
  } else {
    p.rect(ax, ay, 1, 4, tun[0]); p.px(ax + (swing < 0 ? 1 : 0), ay + 4, sk[1]);
  }
}
function clearPx(p, x, y) { p.g.clearRect(x + p.ox, y + p.oy, 1, 1); }

function drawHair(p, style, hx, hy, c, covered) {
  const [d, l] = c;
  if (covered) { p.vl(hx, hy + 1, 2, d); return; }
  switch (style) {
    case 'cropped':
      p.hl(hx + 1, hy - 1, 4, d); p.hl(hx, hy, 6, d); p.vl(hx, hy + 1, 2, d); p.px(hx + 2, hy - 1, l); p.px(hx + 3, hy, l);
      break;
    case 'braid':
      p.hl(hx + 1, hy - 1, 4, d); p.hl(hx, hy, 6, d); p.vl(hx, hy + 1, 2, d); p.px(hx + 3, hy - 1, l);
      for (let k = 0; k < 5; k++) p.px(hx - 1, hy + 2 + k, k & 1 ? l : d);
      p.px(hx - 1, hy + 7, P.gold);
      break;
    case 'mane':
      p.hl(hx, hy - 1, 6, d); p.hl(hx - 1, hy, 7, d); p.rect(hx - 1, hy + 1, 2, 5, d); p.px(hx + 5, hy + 1, d);
      p.px(hx + 2, hy - 1, l); p.px(hx + 4, hy, l); p.vl(hx - 1, hy + 2, 3, l);
      break;
    case 'topknot':
      p.hl(hx, hy, 6, d); p.px(hx, hy + 1, d); p.rect(hx + 2, hy - 3, 3, 2, d); p.px(hx + 3, hy - 3, l); p.px(hx + 3, hy - 1, P.gold);
      break;
    default: break;
  }
}
function drawBeard(p, beard, hx, hy, c, big) {
  const [d, l] = c;
  switch (beard) {
    case 'stubble': p.dither(hx + 2, hy + 3, 4, 2, d, 6); break;
    case 'short': p.hl(hx + 2, hy + 4, 4, d); p.px(hx + 5, hy + 3, d); p.px(hx + 3, hy + 4, l); break;
    case 'full': p.rect(hx + 1, hy + 3, 5, 2 + big, d); p.hl(hx + 2, hy + 5 + big, 3, d); p.px(hx + 3, hy + 4, l); p.px(hx + 4, hy + 2, d); break;
    case 'forked': p.rect(hx + 1, hy + 3, 5, 2, d); p.px(hx + 2, hy + 5, d); p.px(hx + 4, hy + 5, d); p.px(hx + 2, hy + 6, l); p.px(hx + 4, hy + 6, l); break;
    default: break;
  }
}
const WOODH = P.umber2;
/** A tool held at (x, y) (the hand): 'up' raised behind the head (wind-up), 'down' swung forward (strike), 'rest' shown alone. */
function drawTool(p, tool, x, y, pose) {
  const up = pose === 'up';
  // handle: up -> runs up-left from the hand; down -> runs down-right
  const hx = up ? x - 3 : x + 4, hy = up ? y - 5 : y + 3;
  if (tool !== 'saw') p.line(x, y, hx, hy, WOODH);
  switch (tool) {
    case 'pick': if (up) { p.line(hx - 3, hy + 1, hx + 2, hy - 2, P.slate3); p.px(hx - 3, hy + 2, P.slate2); p.px(hx + 2, hy - 2, P.mist); } else { p.line(hx - 2, hy + 3, hx + 1, hy - 2, P.slate3); p.px(hx - 2, hy + 3, P.mist); } break;
    case 'axe': if (up) { p.rect(hx - 2, hy - 1, 3, 3, P.slate3); p.px(hx - 2, hy - 1, P.mist); } else { p.rect(hx, hy - 2, 3, 3, P.slate3); p.px(hx + 2, hy, P.mist); } break;
    case 'hammer': if (up) { p.rect(hx - 2, hy - 1, 4, 2, P.slate2); p.hl(hx - 2, hy - 1, 4, P.slate3); } else { p.rect(hx - 1, hy, 2, 3, P.slate2); p.vl(hx - 1, hy, 3, P.slate3); } break;
    case 'mallet': if (up) { p.rect(hx - 2, hy - 2, 4, 3, P.umber3); p.hl(hx - 2, hy - 2, 4, P.tan); } else { p.rect(hx - 1, hy, 3, 3, P.umber3); p.vl(hx - 1, hy, 3, P.tan); } break;
    case 'saw': { const dx = up ? -1 : 1, dy = up ? -1 : 1; p.px(x, y, P.umber2); for (let k = 1; k <= 5; k++) p.px(x + dx * k, y + dy * k, k & 1 ? P.mist : P.slate3); break; }
    case 'hoe': if (up) { p.rect(hx - 2, hy, 2, 2, P.slate2); } else { p.rect(hx, hy, 3, 1, P.slate2); p.px(hx + 2, hy - 1, P.slate3); } break;
    default: break;
  }
}
function drawBundle(p, carry, x, y) {
  if (carry === 1) { // logs
    for (let k = 0; k < 2; k++) { p.rect(x - 2, y + k * 2, 6, 2, RAMP.wood[1]); p.hl(x - 2, y + k * 2, 6, RAMP.wood[2]); p.px(x + 4, y + k * 2, RAMP.wood[3]); }
  } else if (carry === 2) { // a stone
    p.rect(x - 1, y, 5, 4, P.slate2); p.hl(x - 1, y, 5, P.slate3); p.px(x + 3, y + 3, P.slate1);
  } else { // a sack
    p.rect(x - 1, y, 5, 4, P.tan); p.hl(x - 1, y, 5, P.sand); p.px(x + 1, y - 1, P.umber2); p.px(x + 3, y + 3, P.umber3);
  }
}

/** The pixel selection ring under a colonist (an elliptical dashed ring, 20 x 8 px; gold, or red for drafted). */
export function selectRing(drafted = false) {
  const hit = peek(drafted ? 'selring:d' : 'selring');
  if (hit) return hit;
  return bake(drafted ? 'selring:d' : 'selring', 22, 10, 11, 5, (p) => {
    const c = drafted ? P.danger : P.flame;
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2, x = Math.round(11 + Math.cos(a) * 9.5), y = Math.round(5 + Math.sin(a) * 3.5);
      p.px(x, y, (k >> 2) & 1 ? c : P.bone);
    }
  });
}

// ---- Kit parts for the contact sheet and the KIT_PARTS check (a 16 x 16 px cell, origin top-left) ----
function cell(p, anc, look, frame = 0, tool = '', prof = '', role = 0) {
  const q = new Px(p.g, p.ox - 4, p.oy - 6);
  drawColonist(q, anc, look, frame, tool, prof, role, frame >= 5 ? 3 : 0);
}
export const PEOPLE_PARTS = {
  'body.human': (p, o) => cell(p, 'human', o.look || { skin: 1, hair: 0, hairC: 1, beard: 2, cloth: 0 }),
  'body.sylvari': (p, o) => cell(p, 'sylvari', o.look || { skin: 1, hair: 2, hairC: 4, beard: 0, cloth: 1 }, 0, '', '', 3),
  'body.deepforge': (p, o) => cell(p, 'deepforge', o.look || { skin: 2, hair: 3, hairC: 3, beard: 3, cloth: 3 }, 0, '', '', 1),
  'body.emberkin': (p, o) => cell(p, 'emberkin', o.look || { skin: 0, hair: 1, hairC: 0, beard: 1, cloth: 4 }, 0, '', '', 2),
  'outfit.miner': (p) => cell(p, 'human', { skin: 2, hair: 0, hairC: 2, beard: 3, cloth: 3 }, 3, 'pick', 'miner', 1),
  'outfit.cleric': (p) => cell(p, 'human', { skin: 0, hair: 1, hairC: 5, beard: 0, cloth: 2 }, 0, '', 'cleric'),
  'outfit.runesmith': (p) => cell(p, 'human', { skin: 4, hair: 3, hairC: 0, beard: 4, cloth: 0 }, 4, 'mallet', 'runesmith', 3),
  hair: (p, o) => cell(p, 'human', { skin: 1, hair: (o.v | 0) % 4, hairC: (o.v | 0) % 6, beard: 0, cloth: 2 }),
  beard: (p) => cell(p, 'human', { skin: 2, hair: 0, hairC: 1, beard: 3, cloth: 0 }),
  clothes: (p, o) => cell(p, 'human', { skin: 1, hair: 0, hairC: 1, beard: 0, cloth: Math.max(0, CLOTH_PALETTES.indexOf(o.tint)) }, 1),
};
for (const t of TOOL_IDS.slice(1)) PEOPLE_PARTS[`held.${t}`] = (p) => { const q = new Px(p.g, p.ox, p.oy); drawTool(q, t, 6, 11, 'down'); };
for (const [i, h] of HAIR_STYLES.entries()) PEOPLE_PARTS[`hair.${h}`] = (p, o) => cell(p, 'human', { skin: (i + 1) % 6, hair: i, hairC: (o.v ?? i * 2) % 6, beard: 0, cloth: i }, 0, '', '', i);
for (const [i, b] of BEARDS.entries()) if (i) PEOPLE_PARTS[`beard.${b}`] = (p) => cell(p, 'human', { skin: 2, hair: 0, hairC: i, beard: i, cloth: 5 });
export const PEOPLE_TOOLS = TOOL_IDS.slice(1);
export const PEOPLE_LOOKS = LOOK_IDS.slice(1);
export const ROLE_LIST = ROLE_IDS;
