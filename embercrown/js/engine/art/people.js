// Colonist art (owner D; doc 14.6 "Human art with 4 hair styles x 6 palettes", 12.4 integer sprite
// keys). One rig for every ancestry: body, skin (6 tones), clothes (6 palettes), hair (4 styles x
// 6 colours), beard (5), profession looks (miner, cleric, runesmith), the tool in hand while working,
// and the walk / work frames. The look fields come from the colonist (schema.js `look`:
// { skin, hair, hairC, beard, cloth }, F's colonist factory rolls them from the ancestry's table).
//
//   colonistSprite(c, frame, flip, scale, tool?, look?)  cached sprite (sprites.js): frame 0 idle,
//                         1-2 walk, 3-4 work; tool: '' | pick | axe | hammer | saw | mallet; look: profession key
//   colonistKey(...)      the integer cache key (anc | skin | hair | hairC | beard | cloth | look | tool | frame | flip)
//   toolOfJob(type, def)  the tool a job shows (mine: pick, chop: axe, build: hammer, craft at a bench: saw / mallet)
//   PEOPLE_PARTS          kit parts for keys.js (body.*, hair.*, beard.*, clothes, outfit.*, held.* tools)
//   SKIN, HAIR_COLOURS, CLOTH                 the palettes
// Sprite box: 48 x 44 world units, anchor (24, 40) at the feet; the rig itself is the roguelite villager's 26 x 34.

import { ART as Hlp, shade, sprite } from '../sprites.js';
import { HAIR_STYLES, BEARDS, CLOTH_PALETTES } from './keys.js';

const { INK, shadow, poly, rect, rrect, circle, line } = Hlp;
export const CW = 48, CH = 44, CAX = 24, CAY = 40;
const OX = 11, OY = 10; // the rig is drawn in a 26 x 34 frame (feet at 13, 30) offset inside the larger box (room for swung tools)
const FX = 13, FY = 30;

export const SKIN = Object.freeze(['#f1cfae', '#e0b48c', '#c99a6e', '#a8754e', '#86583a', '#5e3f2a']);
const SKIN_SYLVARI = ['#c8d8a8', '#a8c890', '#d8c8a0', '#98b088'];
const SKIN_EMBER = ['#c8704a', '#a85a3a', '#d88858', '#8a4a32'];
export const HAIR_COLOURS = Object.freeze(['#231c1a', '#4a3020', '#7a4626', '#b0582a', '#c8b078', '#a8a49e']);
/** Clothes palettes: [tunic, trim, trousers]. */
export const CLOTH = Object.freeze({
  russet: ['#9a4a32', '#d8a86a', '#4a3a2e'], moss: ['#5e7a3a', '#c8b870', '#3e3a2a'], slate: ['#4a5a6e', '#b8c0c8', '#2e2e36'],
  ochre: ['#b8903a', '#6a4a2a', '#4a3e30'], plum: ['#6e3a5e', '#d8a8c0', '#3a2e36'], teal: ['#2e6a6a', '#e0c890', '#2a3a3a'],
});
const ANC = { human: 0, sylvari: 1, deepforge: 2, emberkin: 3 };
const ANC_IDS = ['human', 'sylvari', 'deepforge', 'emberkin'];
const LOOKS = { '': 0, 'look.miner': 1, 'look.cleric': 2, 'look.runesmith': 3 };
const LOOK_IDS = ['', 'miner', 'cleric', 'runesmith'];
const TOOLS = { '': 0, pick: 1, axe: 2, hammer: 3, saw: 4, mallet: 5, hoe: 6 };
const TOOL_IDS = ['', 'pick', 'axe', 'hammer', 'saw', 'mallet', 'hoe'];

/** The tool a job shows in hand. def: the bench def for craft jobs (carpenter: saw, mason: mallet). */
export function toolOfJob(type, def) {
  switch (type) {
    case 'mine': return 'pick';
    case 'chop': return 'axe';
    case 'build': case 'deconstruct': return 'hammer';
    case 'craft': case 'bill': return def === 'mason' ? 'mallet' : 'saw';
    case 'grow': case 'sow': return 'hoe';
    default: return '';
  }
}

/** Integer sprite key (doc 12.4: integer keys, no strings per frame). */
export function colonistKey(anc, look, frame, flip, tool, prof) {
  const L = look || {};
  return 1073741824 + ((ANC[anc] | 0) | ((L.skin & 7) << 2) | ((L.hair & 3) << 5) | ((L.hairC & 7) << 8) | ((L.beard & 7) << 11) | ((L.cloth & 7) << 14)
    | ((LOOKS[prof || ''] | 0) << 17) | ((TOOLS[tool || ''] | 0) << 19) | ((frame & 7) << 22) | ((flip ? 1 : 0) << 25));
}

/** Cached colonist sprite. c: a colonist (anc, look) or { anc, look }. */
export function colonistSprite(c, frame = 0, flip = false, scale = 2, tool = '', prof = '') {
  const anc = c.anc || 'human', look = c.look || {};
  const key = colonistKey(anc, look, frame, flip, tool, prof);
  return sprite(key, scale, CW, CH, CAX, CAY, (g) => {
    if (flip) { g.translate(CW, 0); g.scale(-1, 1); }
    g.translate(OX, OY);
    drawColonist(g, anc, look, frame, tool, prof);
  });
}

/** Draw a colonist in its 26 x 34 box (feet at y 30). */
export function drawColonist(g, anc, look, frame, tool = '', prof = '') {
  const a = ANC_IDS.includes(anc) ? anc : 'human';
  const L = look || {};
  const skins = a === 'sylvari' ? SKIN_SYLVARI : a === 'emberkin' ? SKIN_EMBER : SKIN;
  const skin = skins[(L.skin | 0) % skins.length];
  const hairC = HAIR_COLOURS[(L.hairC | 0) % 6];
  const cloth = CLOTH[CLOTH_PALETTES[(L.cloth | 0) % 6]];
  const hairStyle = HAIR_STYLES[(L.hair | 0) % 4];
  const beard = a === 'sylvari' ? 'none' : BEARDS[(L.beard | 0) % 5];
  const p = typeof prof === 'string' ? prof.replace('look.', '') : '';
  const short = a === 'deepforge', dy = short ? 2 : 0, wide = short ? 1.5 : a === 'sylvari' ? -0.8 : 0;
  const work = frame === 3 || frame === 4, up = frame === 3;
  shadow(g, FX, FY - 1, 6.5 + wide, 2.4);
  // legs and boots
  const st = frame === 1 ? 2 : frame === 2 ? -2 : 0;
  rect(g, 9.5 + st * 0.5 - wide * 0.4, 22 + dy, 3, 6.5 - Math.max(0, st) - dy * 0.5, cloth[2], 'rgba(25,18,12,0.7)', 0.6);
  rect(g, 13.5 - st * 0.5 + wide * 0.4, 22 + dy, 3, 6.5 - Math.max(0, -st) - dy * 0.5, cloth[2], 'rgba(25,18,12,0.7)', 0.6);
  rect(g, 9 + st * 0.5 - wide * 0.4, 27.5, 3.8, 2, '#3a2a1e', null); rect(g, 13.2 - st * 0.5 + wide * 0.4, 27.5, 3.8, 2, '#3a2a1e', null);
  // the cleric's robe falls over the legs
  if (p === 'cleric') poly(g, [7.5 - wide, 14 + dy, 18.5 + wide, 14 + dy, 20 + wide, 28.5, 6 - wide, 28.5], '#d8d0b8', INK, 0.8);
  // back arm
  const armSwing = work ? 0 : st;
  rrect(g, 6.5 - wide, 15 + dy - armSwing * 0.3, 3, 8, 1.4, shade(cloth[0], -0.2), 'rgba(25,18,12,0.6)', 0.5);
  // torso: tunic with a belt and the palette's trim
  rrect(g, 8 - wide, 13.5 + dy, 10 + wide * 2, 10 - dy * 0.5, 3, p === 'cleric' ? '#e4dcc4' : cloth[0], INK, 0.9);
  if (p !== 'cleric') { rect(g, 12, 14 + dy, 2, 8, cloth[1], null); rect(g, 8.3 - wide, 20 + dy, 9.4 + wide * 2, 1.6, '#4a3020', null); circle(g, 13, 20.8 + dy, 0.9, '#c8a040', null); }
  else { rect(g, 12, 14 + dy, 2, 13, '#b89850', null); }
  if (p === 'runesmith') { rrect(g, 9 - wide, 16 + dy, 8 + wide * 2, 9, 1.5, '#6a4a2a', 'rgba(25,18,12,0.7)', 0.6); line(g, 10 - wide, 16 + dy, 9 - wide, 13.8 + dy, '#5a3a20', 0.7); line(g, 16 + wide, 16 + dy, 17 + wide, 13.8 + dy, '#5a3a20', 0.7); }
  if (p === 'miner') rect(g, 8.3 - wide, 17 + dy, 9.4 + wide * 2, 1.2, '#7a6a4a', null);
  // head
  const hy = 9.5 + dy, hr = 3.9;
  if (a === 'sylvari') { poly(g, [9.4, hy - 0.5, 6.4, hy - 3.2, 9.6, hy + 1.2], skin, INK, 0.5); poly(g, [16.6, hy - 0.5, 19.6, hy - 3.2, 16.4, hy + 1.2], skin, INK, 0.5); }
  circle(g, 13, hy, hr, skin, INK, 0.8);
  // eyes (facing right by default; flip mirrors the whole sprite)
  g.fillStyle = '#2a1e18'; g.fillRect(13.8, hy - 0.6, 1, 1.2); g.fillRect(16, hy - 0.6, 1, 1.2);
  if (a === 'emberkin') { g.fillStyle = '#ffb04a'; g.fillRect(10, hy + 0.5, 1.6, 0.8); g.fillRect(14, hy + 2, 1.2, 0.7); poly(g, [10.5, hy - 3, 9.5, hy - 6.5, 12, hy - 3.6], '#3a2a24', INK, 0.4); poly(g, [15.5, hy - 3, 16.5, hy - 6.5, 14, hy - 3.6], '#3a2a24', INK, 0.4); }
  // beard
  drawBeard(g, beard, hy, hairC, short);
  // hair (under hats and hoods it shows only at the sides)
  const covered = p === 'miner' || p === 'cleric';
  drawHair(g, hairStyle, hy, hr, hairC, covered);
  // profession headgear
  if (p === 'miner') { // leather cap with a candle
    g.fillStyle = '#6a4a2a'; g.beginPath(); g.arc(13, hy - 0.5, 4.4, Math.PI, 0); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.6; g.stroke();
    rect(g, 8.4, hy - 1, 9.2, 1.4, '#5a3a20', null);
    rect(g, 12.2, hy - 7.5, 1.8, 3.4, '#efe4c0', 'rgba(25,18,12,0.6)', 0.4); circle(g, 13.1, hy - 8.6, 1.1, '#ffc860', null);
  } else if (p === 'cleric') { // hood
    g.fillStyle = '#cfc6aa'; g.beginPath(); g.arc(13, hy, 5, Math.PI * 1.02, Math.PI * 1.98); g.lineTo(18, hy + 3); g.lineTo(17, hy + 1); g.lineTo(9, hy + 1); g.lineTo(8, hy + 3); g.closePath(); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.6; g.stroke();
  } else if (p === 'runesmith') { // goggles pushed up
    rect(g, 9.3, hy - 3.2, 7.4, 1.2, '#3a2a24', null); circle(g, 11.4, hy - 2.8, 1.3, '#8ad0e0', INK, 0.4); circle(g, 14.6, hy - 2.8, 1.3, '#8ad0e0', INK, 0.4);
  }
  // front arm and the tool
  const ax = 16.5 + wide, ay = 15 + dy;
  if (work && tool) { // the arm follows the swing: raised up and forward (wind-up), then down and forward (strike)
    const th = up ? -2.5 : -0.95, len = 7;
    const hx = ax + 1.5 - Math.sin(th) * len, hy2 = ay + 1 + Math.cos(th) * len;
    drawTool(g, tool, hx - 1.5, hy2 - 1, up ? 0.25 : 2.35);
    g.save(); g.translate(ax + 1.5, ay + 1); g.rotate(th); rrect(g, -1.5, 0, 3, len + 1, 1.4, shade(cloth[0], -0.05), 'rgba(25,18,12,0.6)', 0.5); g.restore();
    circle(g, hx, hy2, 1.5, skin, null);
  } else circle(g, ax + 1.5, ay + 8.5 + armSwing * 0.3, 1.4, skin, null);
}

function drawHair(g, style, hy, hr, c, covered) {
  const hi = shade(c, 0.25);
  g.strokeStyle = INK; g.lineWidth = 0.6;
  if (covered) { rect(g, 8.8, hy - 0.5, 1.6, 3, c, null); return; }
  switch (style) {
    case 'cropped':
      g.fillStyle = c; g.beginPath(); g.arc(13, hy - 0.4, hr + 0.4, Math.PI * 1.05, Math.PI * 1.95); g.lineTo(17, hy - 1.2); g.lineTo(9.4, hy - 0.2); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = hi; g.fillRect(11, hy - 3.8, 3, 0.8);
      break;
    case 'braid':
      g.fillStyle = c; g.beginPath(); g.arc(13, hy - 0.4, hr + 0.5, Math.PI * 1.0, Math.PI * 2.0); g.lineTo(16.8, hy - 1.5); g.lineTo(9.2, hy + 1); g.closePath(); g.fill(); g.stroke();
      for (let k = 0; k < 4; k++) circle(g, 8.6 - k * 0.2, hy + 1.5 + k * 2.4, 1.3, k & 1 ? hi : c, INK, 0.4); // braid down the back
      break;
    case 'mane':
      g.fillStyle = c; g.beginPath(); g.moveTo(8.4, hy + 6); g.lineTo(8.2, hy - 1); g.arc(13, hy - 0.4, hr + 0.8, Math.PI, Math.PI * 2); g.lineTo(17.6, hy + 1.5); g.lineTo(16.4, hy - 1.4); g.lineTo(10.4, hy + 0.2); g.lineTo(10.6, hy + 6); g.closePath(); g.fill(); g.stroke();
      line(g, 9.4, hy, 9.4, hy + 5, hi, 0.6);
      break;
    case 'topknot':
      g.fillStyle = shade(c, -0.1); g.beginPath(); g.arc(13, hy - 0.2, hr + 0.1, Math.PI * 1.1, Math.PI * 1.9); g.closePath(); g.fill();
      circle(g, 12.6, hy - hr - 1.6, 2, c, INK, 0.5); rect(g, 11.8, hy - hr - 0.2, 1.6, 1, '#c8a040', null);
      break;
    default: break;
  }
}
function drawBeard(g, beard, hy, c, big) {
  const k = big ? 1.25 : 1;
  switch (beard) {
    case 'stubble': g.fillStyle = shade(c, 0.1); g.globalAlpha = 0.55; for (let i = 0; i < 6; i++) g.fillRect(12.4 + (i % 3) * 1.6, hy + 2 + ((i / 3) | 0) * 1.1, 0.7, 0.7); g.globalAlpha = 1; break;
    case 'short': poly(g, [11.4, hy + 1.6, 17.2, hy + 1.2, 16, hy + 4 * k, 13, hy + 4.6 * k], c, INK, 0.5); break;
    case 'full': poly(g, [10, hy + 0.6, 17.4, hy + 0.4, 16.6, hy + 5 * k, 13.6, hy + 7 * k, 11, hy + 5 * k], c, INK, 0.6); line(g, 13.6, hy + 3, 13.6, hy + 6 * k, shade(c, 0.25), 0.5); break;
    case 'forked': poly(g, [10.6, hy + 0.8, 17.2, hy + 0.6, 16.4, hy + 5 * k, 15, hy + 7.4 * k, 14, hy + 5.2 * k, 12.6, hy + 7.4 * k, 11.6, hy + 5 * k], c, INK, 0.6); break;
    default: break;
  }
}
function drawTool(g, tool, x, y, rot) {
  g.save(); g.translate(x + 1.5, y + 1); g.rotate(rot === true ? 0.25 : rot === false ? 1.85 : rot);
  const wood = '#6b4a2d', iron = '#c8ccd2';
  switch (tool) {
    case 'pick': line(g, 0, 0, 0, -12, wood, 1.5); poly(g, [-5, -12.5, 5, -13.5, 6.5, -11.6, 0, -11.2, -6, -10.8], iron, INK, 0.6); break;
    case 'axe': line(g, 0, 0, 0, -12, wood, 1.5); poly(g, [0, -12, 4.5, -14, 5, -8.5, 0, -9.5], iron, INK, 0.6); break;
    case 'hammer': line(g, 0, 0, 0, -10, wood, 1.5); rect(g, -2.5, -12.5, 5, 3.2, '#9aa0a8', INK, 0.5); break;
    case 'saw': poly(g, [-1, -1, 1.5, -1, 2.2, -13, -0.4, -12], iron, INK, 0.5); rrect(g, -2, -1, 4, 4, 1, wood, INK, 0.5); break;
    case 'mallet': line(g, 0, 0, 0, -9, wood, 1.5); rrect(g, -3, -13, 6, 5, 1.5, '#8a6a44', INK, 0.6); break;
    case 'hoe': line(g, 0, 0, 0, -13, wood, 1.4); rect(g, 0, -14, 3.5, 2, '#9aa0a8', null); break;
    default: break;
  }
  g.restore();
}

/** Kit parts for the contact sheet and the KIT_PARTS check (drawn in a 32 x 32 cell, origin top-left). */
export const PEOPLE_PARTS = {
  'body.human': (g, o) => cell(g, () => drawColonist(g, 'human', o.look || { skin: 1, hair: 0, hairC: 1, beard: 2, cloth: 0 }, 0)),
  'body.sylvari': (g, o) => cell(g, () => drawColonist(g, 'sylvari', o.look || { skin: 1, hair: 2, hairC: 4, beard: 0, cloth: 1 }, 0)),
  'body.deepforge': (g, o) => cell(g, () => drawColonist(g, 'deepforge', o.look || { skin: 2, hair: 3, hairC: 3, beard: 3, cloth: 3 }, 0)),
  'body.emberkin': (g, o) => cell(g, () => drawColonist(g, 'emberkin', o.look || { skin: 0, hair: 1, hairC: 0, beard: 1, cloth: 4 }, 0)),
  'outfit.miner': (g) => cell(g, () => drawColonist(g, 'human', { skin: 2, hair: 0, hairC: 2, beard: 3, cloth: 3 }, 3, 'pick', 'miner')),
  'outfit.cleric': (g) => cell(g, () => drawColonist(g, 'human', { skin: 0, hair: 1, hairC: 5, beard: 0, cloth: 2 }, 0, '', 'cleric')),
  'outfit.runesmith': (g) => cell(g, () => drawColonist(g, 'human', { skin: 4, hair: 3, hairC: 0, beard: 4, cloth: 0 }, 4, 'mallet', 'runesmith')),
  hair: (g, o) => cell(g, () => drawColonist(g, 'human', { skin: 1, hair: (o.v | 0) % 4, hairC: (o.v | 0) % 6, beard: 0, cloth: 2 }, 0)),
  beard: (g, o) => cell(g, () => drawColonist(g, 'human', { skin: 2, hair: 0, hairC: 1, beard: 3, cloth: 0 }, 0)),
  clothes: (g, o) => cell(g, () => drawColonist(g, 'human', { skin: 1, hair: 0, hairC: 1, beard: 0, cloth: Math.max(0, CLOTH_PALETTES.indexOf(o.tint)) }, 1)),
  'held.pick': (g) => toolCell(g, 'pick'), 'held.axe': (g) => toolCell(g, 'axe'), 'held.hammer': (g) => toolCell(g, 'hammer'),
  'held.saw': (g) => toolCell(g, 'saw'), 'held.mallet': (g) => toolCell(g, 'mallet'),
};
for (const [i, h] of HAIR_STYLES.entries()) PEOPLE_PARTS[`hair.${h}`] = (g, o) => cell(g, () => drawColonist(g, 'human', { skin: (i + 1) % 6, hair: i, hairC: (o.v ?? i * 2) % 6, beard: 0, cloth: i }, 0));
for (const [i, b] of BEARDS.entries()) if (i) PEOPLE_PARTS[`beard.${b}`] = (g) => cell(g, () => drawColonist(g, 'human', { skin: 2, hair: 0, hairC: i, beard: i, cloth: 5 }, 0));
// a 26 x 34 colonist centred in a 32 x 32 cell (feet on the cell's lower edge)
function cell(g, draw) { g.save(); g.translate(3, -1); draw(); g.restore(); }
function toolCell(g, t) { g.save(); g.translate(10, 26); g.scale(1.6, 1.6); g.rotate(0.6); drawTool(g, t, -1.5, -1, 0); g.restore(); }
export const PEOPLE_TOOLS = TOOL_IDS.slice(1);
export const PEOPLE_LOOKS = LOOK_IDS.slice(1);
