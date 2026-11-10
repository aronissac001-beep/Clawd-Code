// Art for the Phase 4 military content: seven units and three training buildings, two
// projectile looks, and the small world overlays (Shieldwall guard rings, Healer beams).
// Same signatures and tabletop-miniature style as UNIT_ART / BUILDING_ART in sprites.js.
// Cosmetic only: Math.random is allowed here, nothing in this file touches game state.
import { ART, unitSprite, flashOf, glowSprite } from './sprites.js';

const { INK, shadow, poly, rect, rrect, circle, line, shade, roof, windowLit, banner } = ART;
const T = 32;
// Unit sprite box (matches sprites.js): 26 x 32, feet at (13, 28).
const UAX = 13, UAY = 28;

const STEEL = '#b8bec8', STEEL_D = '#7c828c', STEEL_L = '#dfe4ea';
const WOOD = '#8a6440', WOOD_D = '#5e4228', WOOD_L = '#b08458';
const LEATHER = '#7a5232', CLOTH_RED = '#8e3a32', ROBE = '#e6dcc4', SASH = '#5f9a4a';
const EMBER = '#ff8a3a', EMBER_L = '#ffd27a', EMBER_D = '#b8402a';
const HAY = '#d8b860', STRAW = '#e2c878';

/** The sprite key a soldier type is drawn with (the Knight unit's id is 'cavalier'). */
export function artKey(type) { return type; }

function legs(g, frame, color, y = 22, h = 6) {
  const a = frame === 1 ? 2 : frame === 2 ? -2 : 0;
  rect(g, 10 + a * 0.5, y, 2.6, h - Math.max(0, a), color, 'rgba(25,18,12,0.7)', 0.6);
  rect(g, 13.4 - a * 0.5, y, 2.6, h - Math.max(0, -a), color, 'rgba(25,18,12,0.7)', 0.6);
}
function body(g, color, trim, y = 13, w = 11, h = 10) {
  rrect(g, 13 - w / 2, y, w, h, 3, color);
  if (trim) rect(g, 13 - 1.5, y + 1, 3, h - 2, trim, null);
  rect(g, 13 - w / 2 + 0.5, y + h - 3, w - 1, 1.6, 'rgba(60,40,20,0.8)', null);
}
function head(g, skin = '#e0b88e', y = 9, r = 3.8) { circle(g, 13, y, r, skin); }

// A horse seen side-on, facing right. coat/mane colours, a = gait offset, small = pony.
function horse(g, frame, coat, mane, small) {
  const a = frame === 1 ? 2 : frame === 2 ? -2 : 0;
  const k = small ? 0.88 : 1;
  const by = small ? 19.6 : 19;
  // legs: far pair darker
  const far = shade(coat, -0.25);
  for (const [x, s, c] of [[7, -1, far], [18 * k + 1, 1, far], [5, 1, coat], [16 * k + 1, -1, coat]]) {
    line(g, x, by + 2, x + a * s * 0.9, 27.2, c, small ? 1.8 : 2.1);
    rect(g, x + a * s * 0.9 - 1, 26.6, 2.2, 1.4, '#3a2c20', null);
  }
  // tail
  g.strokeStyle = mane; g.lineWidth = 2.2; g.beginPath(); g.moveTo(3.4, by - 2); g.quadraticCurveTo(0.8, by, 1.4 + a * 0.3, by + 5); g.stroke();
  // barrel
  g.fillStyle = coat; g.beginPath(); g.ellipse(12, by, 9 * k, 4.6 * k, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.8; g.stroke();
  // neck and head
  const hx = small ? -1.2 : 0;
  poly(g, [17 + hx, by - 1.5, 20.5 + hx, by - 8.5, 23.5 + hx, by - 9.2, 25.6 + hx, by - 6, 24.6 + hx, by - 4.8, 22 + hx, by - 5.6, 21 + hx, by], coat, INK, 0.8);
  line(g, 18.2 + hx, by - 3.5, 21 + hx, by - 8.8, mane, 1.7);
  poly(g, [21 + hx, by - 8.5, 21.6 + hx, by - 11.2, 22.6 + hx, by - 9], shade(coat, 0.1), INK, 0.5);
  circle(g, 23.2 + hx, by - 7.4, 0.6, '#1a1414', null);
  return by;
}

// ---- Units -----------------------------------------------------------------------------------------
export const MILITARY_UNIT_ART = {
  // Crossbowman: red gambeson, steel kettle helm, a heavy crossbow held level.
  crossbow(frame, opt) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 6.5, 2.5);
      legs(g, frame, '#4a3a30');
      body(g, CLOTH_RED, opt.field, 13, 11, 10);
      // quilting lines
      g.strokeStyle = 'rgba(40,15,10,0.35)'; g.lineWidth = 0.6;
      for (let yy = 15.5; yy < 21; yy += 2.4) { g.beginPath(); g.moveTo(8.2, yy); g.lineTo(17.8, yy); g.stroke(); }
      // bolt case at the hip
      rect(g, 7, 14, 2.6, 7, LEATHER, INK, 0.5);
      line(g, 7.6, 14, 7.6, 12.6, '#d8d0c0', 0.7); line(g, 8.8, 14, 8.8, 12.8, '#d8d0c0', 0.7);
      head(g, '#e0b88e', 9.2, 3.6);
      // kettle helm: dome plus a wide brim
      g.fillStyle = STEEL; g.beginPath(); g.arc(13, 8.4, 3.8, Math.PI, 0); g.fill(); g.strokeStyle = INK; g.lineWidth = 0.6; g.stroke();
      g.fillStyle = STEEL_D; g.beginPath(); g.ellipse(13, 8.6, 6, 1.4, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      // crossbow: stock, prod and string
      const atk = frame === 3;
      const sx = atk ? 15.5 : 16.5;
      line(g, 11, 17, sx + 8, 16, WOOD, 2);
      rect(g, 10, 16.6, 3, 3, WOOD_D, null);
      const px = sx + 6.5;
      g.strokeStyle = STEEL_D; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(px - 1.6, 10.6); g.quadraticCurveTo(px + 1.6, 16, px - 1.6, 21.4); g.stroke();
      g.strokeStyle = '#eee8d8'; g.lineWidth = 0.5;
      g.beginPath(); g.moveTo(px - 1.6, 10.6); g.lineTo(atk ? px - 0.6 : px - 4.6, 16.2); g.lineTo(px - 1.6, 21.4); g.stroke();
      if (!atk) { line(g, px - 4.4, 16.1, px + 2.6, 15.9, '#3a2c20', 1.1); poly(g, [px + 2.4, 14.9, px + 4.4, 15.9, px + 2.4, 16.9], STEEL_L, null); }
      circle(g, 12, 17.4, 1.3, '#e0b88e', INK, 0.5); // hand on the stock
    };
  },
  // Knight (cavalry): plated rider on a barded bay warhorse, heraldic caparison, sword.
  cavalier(frame, opt) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 11.5, 2.9, 0.34);
      const by = horse(g, frame, '#6a4630', '#2e2018', false);
      // steel chanfron and crinet on the horse's head and neck
      poly(g, [21.6, by - 9.4, 23.8, by - 9.8, 25.7, by - 6.3, 24.4, by - 5.2], STEEL, INK, 0.5);
      line(g, 18.6, by - 3, 21.2, by - 8.4, STEEL_D, 1.3);
      // caparison in the realm's field, edged in the charge colour
      const field = opt.field || '#2c4f8c', ch = opt.charge || '#e8b63c';
      poly(g, [4.6, by - 4, 18.8, by - 4, 20, by + 3.4, 16.4, by + 2.2, 12.6, by + 4, 8.8, by + 2.2, 5.2, by + 3.6, 3.4, by - 1], field, INK, 0.7);
      line(g, 5.4, by + 3, 19.2, by + 2.8, ch, 0.9);
      rect(g, 9.4, by - 2.4, 3.4, 3.4, ch, 'rgba(30,20,10,0.5)', 0.5);
      // rider: full plate
      rrect(g, 9.4, 7.6, 7.2, 8.6, 2.4, STEEL);
      line(g, 13, 8.2, 13, 15.6, STEEL_D, 0.8);
      line(g, 11.4, 16, 10.4, 19.6, STEEL_D, 1.8); // leg over the flank
      // great helm with a plume in the charge colour
      rrect(g, 10.2, 1.6, 5.8, 6.6, 1.6, STEEL_L, INK, 0.6);
      line(g, 12.6, 4.4, 16, 4.4, '#20202a', 0.9);
      line(g, 13.1, 1.8, 13.1, 8, STEEL_D, 0.5);
      g.strokeStyle = ch; g.lineWidth = 1.8; g.beginPath(); g.moveTo(12, 1.8); g.quadraticCurveTo(9.4, -0.4, 6.8, 1.8); g.stroke();
      // heater shield on the near arm
      poly(g, [7.8, 9.6, 11.6, 9.6, 11.2, 14, 9.7, 15.6, 8.2, 14], field, INK, 0.6);
      line(g, 9.7, 10.2, 9.7, 14.8, ch, 0.9);
      // sword: raised, then swept forward on the blow
      const atk = frame === 3;
      if (atk) { line(g, 16, 11, 25.6, 13.6, STEEL_L, 1.9); line(g, 15.4, 9.6, 16.8, 12.6, '#c8902e', 1.4); }
      else { line(g, 16.2, 11.6, 20.4, 1.2, STEEL_L, 1.9); line(g, 14.6, 11, 17.8, 12.4, '#c8902e', 1.4); }
      circle(g, 16, 11.6, 1.3, STEEL_D, INK, 0.5);
    };
  },
  // Shieldwall: a tall tower shield in the realm's colours covers the whole body.
  shieldwall(frame, opt) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 7, 2.7, 0.32);
      legs(g, frame, '#4a4440');
      body(g, '#6c6a72', null, 13, 12, 10);
      head(g, '#d8b08a', 9, 3.7);
      // nasal helm
      g.fillStyle = STEEL; g.beginPath(); g.arc(13, 8.6, 4.1, Math.PI, 0); g.lineTo(17.1, 9.4); g.lineTo(8.9, 9.4); g.closePath(); g.fill();
      g.strokeStyle = INK; g.lineWidth = 0.6; g.stroke();
      line(g, 14.6, 8.6, 14.6, 11.6, STEEL_D, 1.1);
      // mace over the shield rim (raised on the blow)
      const atk = frame === 3;
      if (atk) { line(g, 15, 13, 21, 4.6, WOOD_D, 1.6); circle(g, 21.4, 4, 2.2, STEEL_D, INK, 0.6); }
      else { line(g, 16, 15, 19.6, 9.4, WOOD_D, 1.6); circle(g, 20, 8.8, 2, STEEL_D, INK, 0.6); }
      // tower shield
      const field = opt.field || '#2c4f8c', ch = opt.charge || '#e8b63c';
      const sx = atk ? 8.6 : 9.4;
      rrect(g, sx, 11.4, 10.6, 15.4, 2.4, field, INK, 0.9);
      rrect(g, sx + 0.9, 12.3, 8.8, 13.6, 1.8, null, ch, 0.8);
      circle(g, sx + 5.3, 19, 2.1, ch, INK, 0.6);
      circle(g, sx + 5.3, 19, 0.8, STEEL_L, null);
      line(g, sx + 5.3, 12.6, sx + 5.3, 16.6, ch, 0.7);
      line(g, sx + 5.3, 21.4, sx + 5.3, 25.6, ch, 0.7);
    };
  },
  // Field Healer: cream robe, green sash, hood, a staff with a lit lantern.
  healer(frame, opt) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 6.2, 2.4);
      // robe to the ground (no legs, a hem that sways)
      const a = frame === 1 ? 1 : frame === 2 ? -1 : 0;
      poly(g, [8.4, 13, 17.6, 13, 19 + a * 0.5, 27, 7 + a * 0.5, 27], ROBE, INK, 0.8);
      line(g, 13, 14, 13 + a * 0.3, 26.4, 'rgba(120,100,70,0.45)', 0.8);
      line(g, 8.6, 17.6, 17.4, 15.2, SASH, 1.8);
      // satchel with a leaf mark
      rrect(g, 15.4, 18.4, 4.4, 3.6, 1, LEATHER, INK, 0.5);
      g.fillStyle = '#9fe07a'; g.beginPath(); g.ellipse(17.6, 20.2, 1.2, 0.6, -0.6, 0, Math.PI * 2); g.fill();
      head(g, '#e8c49a', 9.4, 3.5);
      // hood
      g.fillStyle = '#cfc2a2'; g.beginPath(); g.arc(13, 9, 4.5, Math.PI * 0.92, Math.PI * 0.08); g.lineTo(16.6, 13); g.lineTo(9.4, 13); g.closePath(); g.fill();
      g.strokeStyle = INK; g.lineWidth = 0.6; g.stroke();
      circle(g, 14.3, 9.6, 0.45, '#3a2c20', null);
      // lantern-staff: raised while mending
      const up = frame === 3;
      const tx = up ? 21.6 : 20.4, ty = up ? 2.4 : 5;
      line(g, 18.2, up ? 22 : 26, tx, ty + 3, WOOD, 1.5);
      circle(g, 16.8, up ? 15 : 17.4, 1.3, '#e8c49a', INK, 0.5); // hand
      line(g, tx - 1.8, ty + 1.6, tx + 1.8, ty + 1.6, WOOD_D, 1.1);
      rrect(g, tx - 1.9, ty + 2, 3.8, 4.4, 1, up ? '#fff0b0' : '#f5d070', INK, 0.6);
      line(g, tx, ty + 2, tx, ty + 6.4, 'rgba(120,80,20,0.6)', 0.5);
      if (up) {
        g.globalAlpha = 0.45; circle(g, tx, ty + 4.2, 4.2, '#d8ffb0', null); g.globalAlpha = 1;
      }
    };
  },
  // Battlemage: deep crimson robe with gold trim, high cowl, an ember-orb staff.
  battlemage(frame, opt) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 6.4, 2.4);
      const a = frame === 1 ? 1 : frame === 2 ? -1 : 0;
      poly(g, [8.2, 12.6, 17.8, 12.6, 19.4 + a * 0.5, 27, 6.6 + a * 0.5, 27], '#6a2430', INK, 0.8);
      line(g, 7, 26.4, 19.2, 26.4, '#d8a040', 1);
      line(g, 13, 13, 13 + a * 0.3, 26.4, '#d8a040', 0.9);
      if (opt.field) rect(g, 11.6, 14.2, 2.8, 3.6, opt.field, 'rgba(30,20,10,0.5)', 0.4);
      head(g, '#e0b88e', 9.4, 3.4);
      // tall pointed cowl
      poly(g, [8.4, 12.4, 9, 7.6, 12.4, 1.4, 15, 4.6, 17.6, 8.6, 17.6, 12.4, 15.8, 11.6, 15.6, 8.6, 10.6, 8.6, 10.2, 11.6], '#4e1a24', INK, 0.7);
      circle(g, 14.4, 9.8, 0.5, EMBER_L, null);
      // staff with an ember orb; on the cast the free hand flares
      const atk = frame === 3;
      line(g, 6.4, 26, 7.6, 6, WOOD_D, 1.5);
      g.strokeStyle = '#d8a040'; g.lineWidth = 0.9; g.beginPath(); g.arc(7.6, 4.6, 2.2, 0.2, Math.PI * 1.8); g.stroke();
      circle(g, 7.6, 4.6, 1.6, atk ? EMBER_L : EMBER, null);
      circle(g, 8.4, 16, 1.3, '#e0b88e', INK, 0.5);
      if (atk) {
        circle(g, 19.6, 14.4, 1.4, '#e0b88e', INK, 0.5);
        g.globalAlpha = 0.6; circle(g, 22, 13.8, 3.4, EMBER, null); g.globalAlpha = 1;
        circle(g, 22, 13.8, 1.8, EMBER_L, null);
      } else circle(g, 17.4, 17.2, 1.3, '#e0b88e', INK, 0.5);
    };
  },
  // Scout: a grey-dun pony and a green-hooded rider with a short bow.
  scout(frame, opt) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 10, 2.6, 0.3);
      const by = horse(g, frame, '#a89a7c', '#5a4a36', true);
      // saddle cloth
      poly(g, [7.4, by - 3.6, 15.4, by - 3.6, 15.8, by + 1.6, 7, by + 1.6], opt.field || '#4f6b3a', INK, 0.6);
      // rider: leather jerkin, green hooded cloak blowing back
      poly(g, [9.6, 9.6, 6, 13.6 + (frame === 1 ? 1 : 0), 6.4, 16.4, 10.4, 15], '#3e5a2c', INK, 0.6);
      rrect(g, 9.8, 9.2, 6, 7, 2, LEATHER);
      line(g, 11.6, 16, 10.8, 19.4, '#4a3a2a', 1.6);
      circle(g, 13, 7.2, 2.9, '#e0b88e', INK, 0.7);
      g.fillStyle = '#3e5a2c'; g.beginPath(); g.arc(13, 6.8, 3.4, Math.PI * 0.95, Math.PI * 0.1); g.lineTo(15.6, 8.6); g.lineTo(10.2, 8.6); g.closePath(); g.fill();
      g.strokeStyle = INK; g.lineWidth = 0.6; g.stroke();
      circle(g, 14.4, 7.6, 0.45, '#2a2018', null);
      // short bow
      const atk = frame === 3;
      g.strokeStyle = WOOD; g.lineWidth = 1.3; g.beginPath(); g.arc(atk ? 17.4 : 16.4, 11.6, 4.6, -1.2, 1.2); g.stroke();
      const bx = atk ? 17.4 : 16.4;
      line(g, bx + Math.cos(-1.2) * 4.6, 11.6 + Math.sin(-1.2) * 4.6, bx + Math.cos(1.2) * 4.6, 11.6 + Math.sin(1.2) * 4.6, '#e8e0d0', 0.5);
      // spyglass case on the saddle
      rect(g, 4.6, by - 3, 3.4, 1.6, '#c8902e', INK, 0.4);
    };
  },
  // Ballista Cart: a great crossbow on a two-wheeled carriage, with a crewman at the winch.
  ballistacart(frame, opt) {
    return (g) => {
      shadow(g, UAX, UAY - 1, 12, 2.8, 0.34);
      const spin = frame === 1 ? 0.5 : frame === 2 ? 1.1 : 0;
      // crewman behind, cranking
      legs(g, frame, '#4a3a2a', 22, 5.5);
      rrect(g, 3.2, 12, 6.2, 8, 2, '#7a6a48');
      circle(g, 6.2, 9.2, 2.8, '#d8b08a', INK, 0.6);
      g.fillStyle = '#5a4a36'; g.beginPath(); g.arc(6.2, 8.6, 3, Math.PI, 0); g.fill();
      const cr = frame === 3 ? -0.8 : frame === 1 ? 0.8 : 0;
      line(g, 8.4, 15, 10.6, 14 + cr, '#d8b08a', 1.3);
      // carriage bed
      poly(g, [5.4, 17.6, 23.4, 15.4, 24.2, 19.2, 6, 21.2], WOOD, INK, 0.8);
      line(g, 6, 19.4, 23.6, 17.4, WOOD_D, 0.7);
      // trail resting on the ground
      line(g, 6, 20.6, 1.6, 26.4, WOOD_D, 1.8);
      // stock along the bed with the winch wheel
      line(g, 9.4, 14.6, 24.4, 12.6, WOOD_L, 2.2);
      circle(g, 11, 14.6, 1.8, WOOD_D, INK, 0.5);
      line(g, 11, 14.6, 11 + Math.cos(cr) * 1.8, 14.6 + Math.sin(cr) * 1.8, STEEL_L, 0.6);
      // the bow arms, steel, drawn back unless just loosed
      const atk = frame === 3;
      const px = 21.8;
      g.strokeStyle = STEEL_D; g.lineWidth = 2;
      g.beginPath(); g.moveTo(px - (atk ? 0.4 : 2.4), 5.2); g.quadraticCurveTo(px + 2.6, 13, px - (atk ? 0.4 : 2.4), 20.4); g.stroke();
      g.strokeStyle = STEEL_L; g.lineWidth = 0.7; g.stroke();
      g.strokeStyle = '#efe6d0'; g.lineWidth = 0.6;
      g.beginPath(); g.moveTo(px - (atk ? 0.4 : 2.4), 5.2); g.lineTo(atk ? px + 0.6 : px - 8.4, 13); g.lineTo(px - (atk ? 0.4 : 2.4), 20.4); g.stroke();
      if (!atk) { line(g, px - 8, 13, px + 3.4, 12.7, '#3a2c20', 1.3); poly(g, [px + 3.2, 11.4, px + 5.6, 12.7, px + 3.2, 14], STEEL_L, INK, 0.4); }
      // spoked wheels
      for (const wx of [8.6, 19.4]) {
        circle(g, wx, 23.2, 4.3, WOOD_D, INK, 0.9);
        circle(g, wx, 23.2, 3.2, null, WOOD_L, 0.6);
        for (let k = 0; k < 4; k++) {
          const an = spin + (k * Math.PI) / 4;
          line(g, wx - Math.cos(an) * 3.2, 23.2 - Math.sin(an) * 3.2, wx + Math.cos(an) * 3.2, 23.2 + Math.sin(an) * 3.2, WOOD_L, 0.7);
        }
        circle(g, wx, 23.2, 1, STEEL_D, null);
      }
      // pennant in the realm's field
      line(g, 16, 15.6, 16, 7, WOOD_D, 0.9);
      poly(g, [16, 7, 20.2, 8, 16, 9.4], opt.field || CLOTH_RED, 'rgba(30,20,10,0.5)', 0.4);
    };
  },
};

// ---- Buildings ---------------------------------------------------------------------------------------
function target(g, x, y, r, gold) {
  circle(g, x, y, r, '#f0e6d0', INK, 0.8);
  circle(g, x, y, r * 0.68, gold ? '#c8902e' : '#b8402a', null);
  circle(g, x, y, r * 0.42, '#f0e6d0', null);
  circle(g, x, y, r * 0.18, gold ? '#c8902e' : '#b8402a', null);
}
function bale(g, x, y, w, h) {
  rrect(g, x, y, w, h, 2, STRAW, 'rgba(90,70,30,0.8)', 0.7);
  line(g, x + 1, y + h * 0.35, x + w - 1, y + h * 0.35, 'rgba(120,90,40,0.6)', 0.6);
  line(g, x + 1, y + h * 0.7, x + w - 1, y + h * 0.7, 'rgba(120,90,40,0.6)', 0.6);
}
function fence(g, x0, x1, y, color = WOOD) {
  line(g, x0, y - 4, x1, y - 4, color, 1.2);
  line(g, x0, y - 1.5, x1, y - 1.5, color, 1.2);
  for (let x = x0; x <= x1 + 0.1; x += 6) line(g, x, y, x, y - 6, shade(color, -0.2), 1.4);
}
function stoneBase(g, x, y, w, h, c = '#9a948a') {
  rect(g, x, y, w, h, c);
  g.strokeStyle = 'rgba(50,45,40,0.45)'; g.lineWidth = 0.7;
  for (let yy = y + 3.5, r = 0; yy < y + h; yy += 3.5, r++) {
    g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke();
    for (let xx = x + (r % 2 ? 3 : 6); xx < x + w; xx += 7) { g.beginPath(); g.moveTo(xx, yy - 3.5); g.lineTo(xx, yy); g.stroke(); }
  }
}
function horseHead(g, x, y, coat, face = 1) {
  g.save(); g.translate(x, y); g.scale(face, 1);
  poly(g, [0, 4, 0, -1, 2.4, -3, 5.4, -2.2, 6.4, 0.4, 4.6, 1.4, 3, 4], coat, INK, 0.6);
  poly(g, [1.2, -2.2, 1.6, -4.4, 2.6, -2.8], shade(coat, 0.1), INK, 0.4);
  circle(g, 3.4, -1.2, 0.45, '#1a1414', null);
  line(g, 0.4, -1, 1.8, -2.8, shade(coat, -0.45), 1.1);
  g.restore();
}

export const MILITARY_BUILDING_ART = {
  // Archery Range: an open firing shed, straw butts with targets, a bow rack.
  archery(level, her) {
    const S = 2 * T, top = 26 + level * 8;
    return {
      w: S + 10, h: S + top + 4, ax: 5, ay: top,
      draw(g) {
        const ox = 5, oy = top;
        shadow(g, ox + S / 2, oy + S - 3, S / 2, 7, 0.26);
        // packed-earth yard with a chalked shooting lane
        rrect(g, ox + 1, oy + 22, S - 2, S - 24, 4, '#b89c70', 'rgba(70,50,30,0.5)', 0.8);
        for (let x = ox + 6; x < ox + S - 4; x += 8) line(g, x, oy + 47, x + 4, oy + 47, 'rgba(250,240,220,0.7)', 1);
        // firing shed (left): posts and a lean-to roof
        const sx0 = ox + 2, sx1 = ox + 30, sy = oy + 4 - level * 3;
        if (level >= 1) stoneBase(g, sx0, sy + 14, sx1 - sx0, 10);
        else rect(g, sx0, sy + 18, sx1 - sx0, 6, WOOD_D);
        for (const px of [sx0 + 1, sx0 + 13, sx1 - 3]) rect(g, px, sy + 4, 2.4, 20, WOOD);
        if (level >= 1) { rect(g, sx0 + 3.4, sy + 5, 9, 9, '#c9b48e'); windowLit(g, sx0 + 5.6, sy + 7, 4.5, 5); }
        roof(g, sx0, sx1, sy + 5, sy - 8, sy - 13, level >= 2 ? '#3f5f8a' : '#8e4a34', 3);
        // bow rack under the roof
        for (let i = 0; i < 3; i++) {
          g.strokeStyle = WOOD_D; g.lineWidth = 1.1; g.beginPath(); g.arc(sx0 + 18 + i * 3.6, sy + 13, 4, -1.3, 1.3); g.stroke();
        }
        // target butts on the right
        const n = level >= 1 ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const bx = ox + S - 14 - i * 11, byy = oy + 26 + (i % 2) * 7;
          line(g, bx - 3, byy + 12, bx - 1, byy + 3, WOOD_D, 1.4); line(g, bx + 5, byy + 12, bx + 3, byy + 3, WOOD_D, 1.4);
          bale(g, bx - 5, byy + 1, 12, 9);
          target(g, bx + 1, byy + 2, 5, level >= 2);
          // a bolt stuck in the outer ring
          line(g, bx - 2, byy + 1, bx - 6, byy - 1, '#3a2c20', 0.9);
        }
        // tall watch platform at level 3
        if (level >= 2) {
          const tx = ox + S - 12, ty = oy - 22;
          for (const px of [tx - 7, tx + 5]) line(g, px, oy + 18, px + (px < tx ? 2 : -2), ty + 10, WOOD_D, 2);
          line(g, tx - 6, oy + 6, tx + 4, ty + 14, WOOD, 0.9); line(g, tx + 4, oy + 6, tx - 6, ty + 14, WOOD, 0.9);
          rect(g, tx - 9, ty + 6, 18, 5, WOOD_L);
          for (let i = 0; i < 4; i++) rect(g, tx - 8.5 + i * 4.6, ty + 1, 2.6, 5.2, WOOD, INK, 0.5);
          poly(g, [tx - 11, ty + 1, tx + 11, ty + 1, tx, ty - 9], '#3f5f8a');
          banner(g, tx + 6, ty - 12, 7, 13, her);
        } else banner(g, ox + S - 8, oy + 2 - level * 3, 7, 15, her);
        // fence along the front
        fence(g, ox + 4, ox + S - 4, oy + S - 2, level >= 1 ? WOOD_L : WOOD);
      },
    };
  },
  // Stable: a long barn with horse heads at the stall doors, hay and a paddock fence.
  stable(level, her) {
    const S = 2 * T, top = 30 + level * 8;
    return {
      w: S + 10, h: S + top + 4, ax: 5, ay: top,
      draw(g) {
        const ox = 5, oy = top;
        shadow(g, ox + S / 2, oy + S - 3, S / 2, 7, 0.26);
        // paddock ground
        rrect(g, ox + 1, oy + 30, S - 2, S - 32, 4, '#9a8a5a', 'rgba(60,50,30,0.5)', 0.8);
        g.fillStyle = 'rgba(80,60,30,0.25)';
        for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(ox + 10 + i * 9, oy + 46 + (i % 2) * 6, 3, 1.4, 0, 0, Math.PI * 2); g.fill(); }
        // barn
        const wy = oy + 2 - level * 5, wh = 28 + level * 5;
        if (level >= 1) { stoneBase(g, ox + 3, wy + wh - 12, S - 6, 12); rect(g, ox + 3, wy, S - 6, wh - 12, '#a8744a'); }
        else rect(g, ox + 3, wy, S - 6, wh, '#a8744a');
        g.strokeStyle = 'rgba(70,40,20,0.5)'; g.lineWidth = 0.8;
        for (let x = ox + 8; x < ox + S - 4; x += 5) { g.beginPath(); g.moveTo(x, wy); g.lineTo(x, wy + (level >= 1 ? wh - 12 : wh)); g.stroke(); }
        // stall doors with horses looking out
        const stalls = level >= 1 ? 3 : 2;
        const coats = ['#6a4630', '#d8d0be', '#3a2a22'];
        for (let i = 0; i < stalls; i++) {
          const dx = ox + 9 + i * (stalls === 3 ? 17 : 24), dy = wy + wh - 16;
          rect(g, dx, dy, 11, 16, '#4a2e1c');
          rect(g, dx, dy + 8, 11, 8, '#7a4e30', INK, 0.6);
          line(g, dx, dy + 8, dx + 11, dy + 16, '#5a3a22', 0.9); line(g, dx + 11, dy + 8, dx, dy + 16, '#5a3a22', 0.9);
          horseHead(g, dx + 2.5, dy + 7, coats[i % 3], 1);
        }
        // hayloft door and hay at level 2
        if (level >= 1) {
          rect(g, ox + S / 2 - 5, wy - 2, 10, 8, '#5a3a22', INK, 0.7);
          for (let i = 0; i < 5; i++) line(g, ox + S / 2 - 4 + i * 2, wy + 6, ox + S / 2 - 5 + i * 2.2, wy + 3, HAY, 1);
        }
        roof(g, ox + 3, ox + S - 3, wy + 1, wy - 15, wy - 21, level >= 1 ? '#5f4a3a' : '#8e4a34', 3);
        // weathervane horse at level 2, banner otherwise
        if (level >= 1) {
          line(g, ox + S / 2, wy - 15, ox + S / 2, wy - 25, '#4a3a2a', 1);
          horseHead(g, ox + S / 2 - 3, wy - 26, '#2a2a30', 1);
          banner(g, ox + S - 12, wy - 6, 7, 14, her);
        } else banner(g, ox + S - 11, wy - 4, 7, 14, her);
        // hay bales, water trough
        bale(g, ox + 4, oy + 40, 12, 8);
        if (level >= 1) bale(g, ox + 7, oy + 34, 10, 7);
        rrect(g, ox + S - 24, oy + 44, 16, 6, 1.5, WOOD_D, INK, 0.7);
        rect(g, ox + S - 22.5, oy + 45, 13, 2.4, '#6a9ab8', null);
        fence(g, ox + 4, ox + S - 4, oy + S - 2);
      },
    };
  },
  // Siege Workshop: heavy timber shop, crane, a ballista on the stocks; later a forge and an ember lamp.
  siegeworks(level, her) {
    const S = 2 * T, top = 34 + level * 8;
    return {
      w: S + 10, h: S + top + 4, ax: 5, ay: top,
      draw(g) {
        const ox = 5, oy = top;
        shadow(g, ox + S / 2, oy + S - 3, S / 2, 7, 0.28);
        rrect(g, ox + 1, oy + 26, S - 2, S - 28, 4, '#8a7a62', 'rgba(60,45,30,0.5)', 0.8);
        // workshop (left two thirds)
        const wx0 = ox + 3, wx1 = ox + 42, wy = oy + 2 - level * 4, wh = 26 + level * 4;
        if (level >= 1) stoneBase(g, wx0, wy, wx1 - wx0, wh, '#8e8880');
        else { rect(g, wx0, wy, wx1 - wx0, wh, '#9a7a52'); g.strokeStyle = 'rgba(60,40,20,0.5)'; g.lineWidth = 0.8; for (let yy = wy + 5; yy < wy + wh; yy += 5) { g.beginPath(); g.moveTo(wx0, yy); g.lineTo(wx1, yy); g.stroke(); } }
        // great double doors, iron-banded
        rect(g, wx0 + 9, wy + wh - 18, 18, 18, '#4a3020', INK, 0.8);
        line(g, wx0 + 18, wy + wh - 18, wx0 + 18, wy + wh, '#2a1a10', 0.9);
        for (const yy of [wy + wh - 14, wy + wh - 5]) line(g, wx0 + 9, yy, wx0 + 27, yy, STEEL_D, 1.1);
        windowLit(g, wx0 + 3, wy + 6, 4.5, 5); windowLit(g, wx1 - 8, wy + 6, 4.5, 5);
        roof(g, wx0, wx1, wy + 1, wy - 14, wy - 20, level >= 2 ? '#4a4a58' : '#6f4a34', 3);
        if (level >= 2) for (let x = wx0 + 4; x < wx1; x += 9) line(g, x, wy - 13, x - 1, wy + 1, STEEL_D, 1);
        // forge chimney with an ember glow (level 2+)
        if (level >= 1) {
          stoneBase(g, wx0 + 2, wy - 22, 7, 16, '#7e7870');
          g.globalAlpha = 0.6; circle(g, wx0 + 5.5, wy - 24, 3.2, EMBER, null); g.globalAlpha = 1;
          circle(g, wx0 + 5.5, wy - 23.5, 1.6, EMBER_L, null);
        }
        // crane: A-frame with a jib and a hanging hook
        const cx = ox + S - 10, cbase = oy + 40;
        const ch = 40 + level * 8;
        line(g, cx - 6, cbase, cx, cbase - ch, WOOD_D, 2);
        line(g, cx + 6, cbase, cx, cbase - ch, WOOD_D, 2);
        line(g, cx - 4, cbase - 12, cx + 4, cbase - 12, WOOD, 1.2);
        line(g, cx, cbase - ch, cx - 22, cbase - ch + 6, WOOD, 1.8);
        line(g, cx - 20, cbase - ch + 6, cx - 20, cbase - 18, '#3a3030', 0.6);
        g.strokeStyle = STEEL_D; g.lineWidth = 1; g.beginPath(); g.arc(cx - 20, cbase - 16, 2, 0, Math.PI); g.stroke();
        // ballista on the stocks in the yard (finished, with wheels, from level 2)
        const bx = ox + 34, byy = oy + 46;
        line(g, bx - 8, byy + 4, bx + 14, byy + 1, WOOD_L, 2.2);
        g.strokeStyle = STEEL_D; g.lineWidth = 1.6; g.beginPath(); g.moveTo(bx + 10, byy - 6); g.quadraticCurveTo(bx + 14, byy + 2, bx + 10, byy + 9); g.stroke();
        if (level >= 1) {
          for (const wxx of [bx - 4, bx + 8]) { circle(g, wxx, byy + 8, 3.4, WOOD_D, INK, 0.7); line(g, wxx - 2.4, byy + 8, wxx + 2.4, byy + 8, WOOD_L, 0.6); line(g, wxx, byy + 5.6, wxx, byy + 10.4, WOOD_L, 0.6); }
        } else {
          rect(g, bx - 7, byy + 4, 3, 7, WOOD_D); rect(g, bx + 9, byy + 2, 3, 8, WOOD_D);
        }
        // timber pile and gears
        for (let i = 0; i < 3; i++) { circle(g, ox + 8 + i * 5, oy + S - 9 - (i === 1 ? 4 : 0), 2.4, '#b08458', INK, 0.6); circle(g, ox + 8 + i * 5, oy + S - 9 - (i === 1 ? 4 : 0), 0.9, '#7a5a3a', null); }
        g.strokeStyle = STEEL_D; g.lineWidth = 1.6; g.beginPath(); g.arc(ox + S - 18, oy + S - 10, 4, 0, Math.PI * 2); g.stroke();
        for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; line(g, ox + S - 18 + Math.cos(a) * 4, oy + S - 10 + Math.sin(a) * 4, ox + S - 18 + Math.cos(a) * 5.6, oy + S - 10 + Math.sin(a) * 5.6, STEEL_D, 1.4); }
        // ember lamp on a post for the Battlemages (level 3)
        if (level >= 2) {
          line(g, ox + 4, oy + S - 4, ox + 4, oy + 20, '#3a3030', 1.6);
          g.globalAlpha = 0.5; circle(g, ox + 4, oy + 17, 5, EMBER, null); g.globalAlpha = 1;
          circle(g, ox + 4, oy + 17, 2.6, '#ffe8a0', INK, 0.6);
          banner(g, wx1 - 11, wy - 8, 7, 14, her);
        } else banner(g, wx1 - 10, wy - 4, 7, 13, her);
      },
    };
  },
};

// ---- Movers drawn through BUS.draw.entity ------------------------------------------------------------
/** Draw a mover with a UNIT_ART key, as the core renderer does (frames, flip, flash, elite glow). */
export function drawMover(g, e, x, y, scale, type, her, k = 1) {
  const moving = Math.abs(e.x - e.px) + Math.abs(e.y - e.py) > 0.04;
  const frame = e.atkT > 0 ? 3 : moving ? ((e.anim / 2.4) | 0) % 2 ? 1 : 2 : 0;
  const opt = her ? { field: her.field, charge: her.charge, second: her.second } : {};
  const flip = e.face < 0;
  const sp = unitSprite(type, frame, flip, scale, opt);
  const w = sp.w * k, h = sp.h * k;
  const dx = x - sp.ax * k, dy = y - sp.ay * k;
  if (e.kind === 'enemy' && e.affix === 'warden') {
    g.globalCompositeOperation = 'lighter';
    const gl = glowSprite('rgba(170,140,255,0.5)');
    g.drawImage(gl.c, x - 30, y - 40, 60, 60);
    g.globalCompositeOperation = 'source-over';
  }
  g.drawImage(sp.c, dx, dy, w, h);
  if (e.hitT > 0) {
    const f = flashOf(sp, `u:${type}:${frame}:${flip ? 1 : 0}::0:${opt.field || ''}`, scale);
    g.globalAlpha = Math.min(1, e.hitT / 0.14); g.drawImage(f.c, dx, dy, w, h); g.globalAlpha = 1;
  }
}

// ---- Projectiles ------------------------------------------------------------------------------------------
/** ART_HOOKS.drawProjectileExt part: crossbow bolts and Battlemage orbs. True when drawn. */
export function drawProjectile(g, p, x, y) {
  if (p.kind === 'qbolt') {
    const u = Math.min(1, p.t / p.dur);
    const ang = Math.atan2(p.ty - p.sy - p.arc * p.dist * 0.7 * Math.cos(Math.PI * u), p.tx - p.sx);
    const c = Math.cos(ang), s = Math.sin(ang);
    g.strokeStyle = 'rgba(240,228,200,0.5)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x - c * 8, y - s * 8); g.lineTo(x, y); g.stroke();
    g.strokeStyle = '#3a2c20'; g.lineWidth = 1.8; g.stroke();
    g.fillStyle = '#d8dde4';
    g.beginPath(); g.moveTo(x + c * 3, y + s * 3); g.lineTo(x - s * 1.8, y + c * 1.8); g.lineTo(x + s * 1.8, y - c * 1.8); g.closePath(); g.fill();
    return true;
  }
  if (p.kind === 'mageorb') {
    const dx = p.tx - p.sx, dy = p.ty - p.sy, l = Math.hypot(dx, dy) || 1;
    const ux = dx / l, uy = dy / l;
    g.globalCompositeOperation = 'lighter';
    for (let k = 4; k >= 1; k--) {
      g.fillStyle = `rgba(255,130,50,${0.13 * (5 - k)})`;
      g.beginPath(); g.arc(x - ux * k * 4.4, y - uy * k * 4.4, 4 - k * 0.6, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(255,170,80,0.35)'; g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = EMBER; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff0c0'; g.beginPath(); g.arc(x - 1, y - 1, 1.8, 0, Math.PI * 2); g.fill();
    return true;
  }
  return false;
}

// ---- World overlays ------------------------------------------------------------------------------------------
/** Faint guard rings under Shieldwalls so players can see who is protected. */
export function drawShieldRings(g, s, view, time, R) {
  g.lineWidth = 1.2;
  for (let i = 0; i < s.soldiers.length; i++) {
    const u = s.soldiers[i];
    if (!u.alive || u.type !== 'shieldwall' || u.x < view.x0 - R || u.x > view.x1 + R || u.y < view.y0 - R || u.y > view.y1 + R) continue;
    const a = 0.16 + 0.05 * Math.sin(time * 2 + u.id);
    g.fillStyle = `rgba(150,190,255,${a * 0.45})`;
    g.strokeStyle = `rgba(170,205,255,${a + 0.1})`;
    g.beginPath(); g.ellipse(u.x, u.y - 1, R, R * 0.5, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  }
}

/** A soft green thread from each Healer to the ally it is mending right now. */
export function drawHealBeams(g, s, view, time) {
  for (let i = 0; i < s.soldiers.length; i++) {
    const u = s.soldiers[i];
    if (!u.alive || u.type !== 'healer' || !u.milHid || s.time - (u.milHt || -9) > 0.3) continue;
    if (u.x < view.x0 - 160 || u.x > view.x1 + 160 || u.y < view.y0 - 160 || u.y > view.y1 + 160) continue;
    const o = s.rt.eById.get(u.milHid);
    if (!o || !o.alive) continue;
    const fx = u.x + (u.face < 0 ? -7 : 7), fy = u.y - 22, tx = o.x, ty = o.y - 12;
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = `rgba(170,255,140,${0.35 + 0.15 * Math.sin(time * 10 + u.id)})`;
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(fx, fy); g.quadraticCurveTo((fx + tx) / 2, Math.min(fy, ty) - 14, tx, ty); g.stroke();
    g.fillStyle = 'rgba(210,255,180,0.5)'; g.beginPath(); g.arc(tx, ty, 4, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over';
  }
}
