// Storyteller director UI (Phase 3):
//  - the region event card (BUS.pendingUI.regionEvent) on the shared event dialog,
//    with exact effects for every choice, then the outcome card;
//  - an omen button (44x44, prepended to the HUD corner) shown while tonight's wave
//    carries modifiers or a temporary buff is active; it opens a text card with
//    tonight's omens, active buffs and this region's modifiers;
//  - world drawings: the Dragon's Shadow telegraph and the Ancient Battlefield.
// Never mutates the simulation: choices go through ctl.cmd({ t: 'choose', i }).
// register() also registers the director simulation.
import { BUS } from '../game/hooks.js';
import { T } from '../game/grid.js';
import { el, tapButton } from './dom.js';
import { icon } from './icons.js';
import { showEventDialog, showEventResult } from './runscreens.js';
import { register as registerDirector, regionEventView, tonightOmens, activeBuffs, regionModifierViews } from '../game/systems/director.js';
import { storytellerDef } from '../data/storytellers.js';

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('directorui-css')) return;
  const st = document.createElement('style');
  st.id = 'directorui-css';
  st.textContent = `
.hbtn.omen { color: #e8c8ff; border-color: rgba(190, 150, 240, 0.85); background: linear-gradient(#3c2c4e, #221a30); }
.hbtn.omen.bad { animation: omen-pulse 1.6s ease-in-out infinite; }
.hbtn.omen .badge { background: #c9a0f0; }
@keyframes omen-pulse { 50% { box-shadow: 0 0 12px rgba(200, 140, 255, 0.7), 0 3px 0 rgba(0,0,0,0.35); } }
body.reduce-motion .hbtn.omen.bad { animation: none; }
`;
  document.head.appendChild(st);
}

// ---- Region event card ------------------------------------------------------------------------
function regionEventUI(ctl, s) {
  const view = regionEventView(s);
  if (!view) { ctl.cmd({ t: 'choose', i: 0 }); return; }
  showEventDialog(ctl.app.modal, view, (i) => {
    const r = ctl.cmd({ t: 'choose', i });
    if (!r || !r.ok) return; // the controller shows the card again while the choice is pending
    const lines = [];
    if (r.text) lines.push(r.text);
    for (const ln of r.lines || []) lines.push(ln);
    if (!r.lines || !r.lines.length) lines.push('Nothing else changes.');
    const title = r.won === true ? 'Fortune Smiles' : r.won === false ? 'Ill Fortune' : view.title;
    showEventResult(ctl.app.modal, { title, lines, good: !!r.good }, () => { if (ctl.autosave) ctl.autosave(); });
  });
}

// ---- Omen button and card ------------------------------------------------------------------------
/** Text lines for the omen card (also used by tests). */
export function omenLines(s) {
  const out = [];
  const omens = tonightOmens(s);
  const n = s.wave ? s.wave.n : s.cycle.night + 1;
  if (omens.length) for (const m of omens) out.push(`Tonight: ${m.name}. ${m.text}`);
  else out.push(`Tonight (night ${n}): no omens.`);
  for (const b of activeBuffs(s)) out.push(`Blessing: ${b.text}.`);
  for (const m of regionModifierViews(s)) out.push(`This land: ${m.name}. ${m.text}`);
  const st = storytellerDef(s.storyteller);
  out.push(`Storyteller: ${st.name}. ${st.desc}`);
  return out;
}

export function openOmens(ctl) {
  const s = ctl.s;
  const n = s.wave ? s.wave.n : s.cycle.night + 1;
  ctl.openText('Omens', `Night ${n}${s.wave && s.wave.blood ? ' · Blood Moon' : ''}`, omenLines(s), 'moon');
}

function omenButton(hud, ctl) {
  injectCss();
  const btn = el('button', 'hbtn omen hidden', icon('moon') + '<span class="badge hidden"></span>');
  btn.setAttribute('aria-label', 'Omens: tonight\'s wave modifiers');
  btn.title = 'Omens';
  const badge = btn.querySelector('.badge');
  tapButton(btn, () => openOmens(ctl), { longpress: () => openOmens(ctl) });
  const corner = hud.slots.corner;
  corner.insertBefore(btn, corner.firstChild);
  // Change detection without per-frame allocation: omens are only ever appended to
  // tonight's plan, so (night, omen count, buff count) identifies what is shown.
  let lastN = -1, lastK = -1, lastB = -1;
  return {
    update(s) {
      const omens = tonightOmens(s);
      const d = s.ext && s.ext.director;
      const nb = d ? d.buffs.length : 0;
      const wn = s.wave ? s.wave.n : -1;
      if (wn === lastN && omens.length === lastK && nb === lastB) return;
      lastN = wn; lastK = omens.length; lastB = nb;
      const show = omens.length > 0 || nb > 0;
      btn.classList.toggle('hidden', !show);
      badge.textContent = String(omens.length + nb);
      badge.classList.toggle('hidden', !show);
      btn.classList.toggle('bad', omens.some((m) => m.id !== 'lull'));
    },
  };
}

// ---- World drawing ---------------------------------------------------------------------------------
function drawShadow(g, s, view, time) {
  const d = s.ext && s.ext.director;
  if (!d || !d.shadow || s.cycle.phase !== 'day') return;
  const b = s.rt.bById.get(d.shadow.bid);
  if (!b) return;
  const x = (b.tx + b.size / 2) * T, y = (b.ty + b.size / 2) * T;
  const left = Math.max(0, d.shadow.at - s.cycle.t);
  // Target ring tightens as noon nears.
  const k = Math.min(1, left / d.shadow.at);
  const r = b.size * T * (0.7 + 0.6 * k);
  g.save();
  g.strokeStyle = `rgba(255, 110, 60, ${0.55 + 0.35 * Math.sin(time * 5)})`;
  g.lineWidth = 2.5; g.setLineDash([7, 5]);
  g.beginPath(); g.ellipse(x, y, r, r * 0.6, 0, 0, 6.283); g.stroke();
  g.setLineDash([]);
  // The wyvern's shadow glides in from the west during the last 12 seconds.
  if (left < 12) {
    const sx = x - left * 40, sy = y - left * 12;
    g.translate(sx, sy); g.scale(1, 0.55);
    g.fillStyle = 'rgba(10, 6, 16, 0.38)';
    g.beginPath();
    g.moveTo(26, 0); g.quadraticCurveTo(4, -8, -6, -30); g.quadraticCurveTo(-8, -6, -22, -4);
    g.lineTo(-34, 0); g.lineTo(-22, 4); g.quadraticCurveTo(-8, 6, -6, 30); g.quadraticCurveTo(4, 8, 26, 0);
    g.fill();
  }
  g.restore();
}

function drawBattlefield(g, s) {
  const d = s.ext && s.ext.director;
  const bf = d && d.battlefield;
  if (!bf || !s.ext.modifiers || !s.ext.modifiers.includes('ancient_battlefield')) return;
  const x = (bf.tx + 0.5) * T, y = (bf.ty + 0.5) * T;
  g.save();
  g.fillStyle = 'rgba(60, 48, 40, 0.35)';
  g.beginPath(); g.ellipse(x, y + 4, T * 1.4, T * 0.8, 0, 0, 6.283); g.fill();
  g.strokeStyle = '#6a625a'; g.lineWidth = 2; g.lineCap = 'round';
  // Broken blades and a leaning standard.
  const marks = [[-18, -2, 0.3], [-6, 6, -0.4], [10, -4, 0.15], [20, 6, -0.25]];
  for (const [dx, dy, a] of marks) {
    g.beginPath(); g.moveTo(x + dx, y + dy + 6); g.lineTo(x + dx + Math.sin(a) * 12, y + dy - 8); g.stroke();
    g.beginPath(); g.moveTo(x + dx - 4, y + dy - 1); g.lineTo(x + dx + 4, y + dy - 1); g.stroke();
  }
  g.strokeStyle = '#4a3a30'; g.beginPath(); g.moveTo(x + 2, y + 8); g.lineTo(x - 4, y - 22); g.stroke();
  g.fillStyle = 'rgba(120, 40, 40, 0.8)'; g.beginPath(); g.moveTo(x - 4, y - 22); g.lineTo(x + 10, y - 18); g.lineTo(x - 2, y - 12); g.fill();
  g.restore();
}

// ---- Registration ---------------------------------------------------------------------------------------
let done = false;
export function register() {
  if (done) return;
  done = true;
  registerDirector();
  injectCss();
  BUS.pendingUI.regionEvent = regionEventUI;
  BUS.hud.push(omenButton);
  BUS.draw.overlay.push(drawShadow);
  BUS.draw.ground.push(drawBattlefield);
}
