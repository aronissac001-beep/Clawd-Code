// Season and weather HUD (Phase 3): a compact widget in the cycle bar with
//  - the season wheel: a 34 px ring in four coloured quarters and a pointer at
//    today's place in the year (tap: this season and the next two), and
//  - the forecast: today's weather icon and tomorrow's omen (tap: forecast text).
// Shows a banner when a new season begins. Never mutates the simulation.
// register() also registers the seasons/weather systems and their visuals.
import { BUS } from '../game/hooks.js';
import { BAL } from '../data/balance.js';
import { el, tapButton } from './dom.js';
import { SEASONS, seasonIndex, seasonDay, daysToNextSeason, isEndlessWinter, calendarDay, register as registerSeasons } from '../game/systems/seasons.js';
import { WEATHER, weatherToday, forecast, register as registerWeather } from '../game/systems/weather.js';
import { drawWeatherIcon, register as registerFx } from '../engine/weatherfx.js';

const DIM = '0.34';

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('seasonui-css')) return;
  const st = document.createElement('style');
  st.id = 'seasonui-css';
  st.textContent = `
.ssn { display: flex; align-items: center; gap: 4px; flex: none; }
.ssn button { position: relative; background: none; border: 0; padding: 0; margin: 0; height: 34px; display: grid; place-items: center; color: inherit; cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent; border-radius: 10px; }
.ssn button::before { content: ''; position: absolute; top: -6px; right: -6px; bottom: -6px; left: -6px; }
.ssn button.pressed { background: rgba(255,255,255,0.08); }
.ssn .ssn-wheel { width: 34px; }
.ssn .ssn-wheel::before { left: -8px; right: -3px; }
.ssn .ssn-wheel canvas { width: 34px; height: 34px; display: block; }
.ssn .ssn-wx { width: 40px; }
.ssn .ssn-wx::before { left: -1px; right: -6px; }
.ssn .ssn-wx canvas { width: 40px; height: 34px; display: block; }
`;
  document.head.appendChild(st);
}

// ---- Drawing ---------------------------------------------------------------------------------
function dayFrac(s) {
  const c = s.cycle, C = BAL.cycle;
  const f = (t, len) => Math.max(0, Math.min(1, t / len));
  switch (c.phase) {
    case 'dawn': return 0.02 * f(c.t, C.dawnLen);
    case 'day': return 0.02 + 0.6 * f(c.t, C.dayLen);
    case 'dusk': return 0.62 + 0.08 * f(c.t, C.duskLen);
    default: return 0.7 + 0.29 * f(c.t, C.nightMax);
  }
}

function seasonGlyph(g, i, cx, cy, s) {
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (i === 0) { // sprout
    g.strokeStyle = '#3d7a2e'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(cx, cy + s * 0.45); g.lineTo(cx, cy - s * 0.05); g.stroke();
    g.fillStyle = '#8fdc6a';
    g.beginPath(); g.ellipse(cx - s * 0.22, cy - s * 0.12, s * 0.26, s * 0.13, -0.6, 0, 6.283); g.fill();
    g.beginPath(); g.ellipse(cx + s * 0.22, cy - s * 0.24, s * 0.26, s * 0.13, 0.6, 0, 6.283); g.fill();
  } else if (i === 1) { // sun
    drawWeatherIcon(g, 'clear', cx, cy, s * 1.2);
  } else if (i === 2) { // falling leaf
    g.fillStyle = '#e8803a'; g.strokeStyle = '#7a3a12'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx - s * 0.4, cy + s * 0.4);
    g.quadraticCurveTo(cx - s * 0.45, cy - s * 0.35, cx + s * 0.4, cy - s * 0.4);
    g.quadraticCurveTo(cx + s * 0.35, cy + s * 0.35, cx - s * 0.4, cy + s * 0.4);
    g.fill(); g.stroke();
    g.beginPath(); g.moveTo(cx - s * 0.4, cy + s * 0.4); g.lineTo(cx + s * 0.15, cy - s * 0.15); g.stroke();
  } else drawWeatherIcon(g, 'snow', cx, cy, s * 1.15);
  g.restore();
}

function drawWheel(c, s, dpr) {
  const g = c.getContext('2d');
  const S = 34;
  if (c.width !== S * dpr) { c.width = S * dpr; c.height = S * dpr; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2, R = 15.5, w = 5.5;
  const cur = seasonIndex(s);
  const ew = isEndlessWinter(s);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath(); g.arc(cx, cy, R + 1, 0, 6.283); g.fill();
  g.lineWidth = w;
  for (let i = 0; i < 4; i++) {
    const def = SEASONS[SEASONS.order[ew ? 3 : i]];
    const a0 = -Math.PI / 2 + (i * Math.PI) / 2 + 0.07, a1 = a0 + Math.PI / 2 - 0.14;
    g.globalAlpha = ew || i === cur ? 1 : +DIM;
    g.strokeStyle = def.color;
    g.beginPath(); g.arc(cx, cy, R - w / 2, a0, a1); g.stroke();
  }
  g.globalAlpha = 1;
  // Pointer: today's place in the year.
  const year = SEASONS.daysPer * 4;
  const frac = ew ? 0.875 : (((calendarDay(s) % year) + dayFrac(s)) / year);
  const a = -Math.PI / 2 + frac * Math.PI * 2;
  const ca = Math.cos(a), sa = Math.sin(a), pa = a + Math.PI / 2;
  const tip = R - w - 1.5, base = R + 1.2, hw = 3.2;
  g.fillStyle = '#ffffff'; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = 1;
  g.beginPath();
  g.moveTo(cx + ca * tip, cy + sa * tip);
  g.lineTo(cx + ca * base + Math.cos(pa) * hw, cy + sa * base + Math.sin(pa) * hw);
  g.lineTo(cx + ca * base - Math.cos(pa) * hw, cy + sa * base - Math.sin(pa) * hw);
  g.closePath(); g.fill(); g.stroke();
  seasonGlyph(g, cur, cx, cy, 10);
}

function drawForecast(c, s, dpr) {
  const g = c.getContext('2d');
  const W = 40, H = 34;
  if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const today = weatherToday(s), tom = forecast(s)[0];
  const night = s.cycle.phase === 'night' || s.cycle.phase === 'dusk';
  drawWeatherIcon(g, today, 12, 17, 24, night);
  g.strokeStyle = 'rgba(240,225,190,0.7)'; g.lineWidth = 1.6; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(24.5, 14); g.lineTo(27, 17); g.lineTo(24.5, 20); g.stroke();
  g.globalAlpha = 0.85;
  drawWeatherIcon(g, tom, 33.5, 17, 14, false);
  g.globalAlpha = 1;
}

// ---- Text ------------------------------------------------------------------------------------
function plural(n, w) { return `${n} ${w}${n === 1 ? '' : 's'}`; }

export function seasonText(s) {
  const i = seasonIndex(s), def = SEASONS[SEASONS.order[i]];
  if (isEndlessWinter(s)) {
    return { title: 'Endless Winter', sub: 'This region never thaws', lines: [def.text, 'A curse holds this land in winter: the seasons do not turn here.'] };
  }
  const sd = seasonDay(s), dn = daysToNextSeason(s);
  const n1 = SEASONS[SEASONS.order[(i + 1) % 4]], n2 = SEASONS[SEASONS.order[(i + 2) % 4]];
  return {
    title: `${def.name}`, sub: `Day ${sd.day} of ${sd.of}`,
    lines: [
      def.text,
      `Next: ${n1.name}, in ${plural(dn, 'day')}. ${n1.short}.`,
      `Then: ${n2.name}, in ${plural(dn + SEASONS.daysPer, 'day')}. ${n2.short}.`,
      `Seasons last ${SEASONS.daysPer} days; the calendar carries on between regions.`,
    ],
  };
}

export function forecastText(s) {
  const t = weatherToday(s), [a, b] = forecast(s);
  return {
    title: `Weather: ${WEATHER[t].name}`, sub: 'Forecast',
    lines: [
      `Today: ${WEATHER[t].text}`,
      `Tomorrow: ${WEATHER[a].name}. ${WEATHER[a].text}`,
      `The day after: ${WEATHER[b].name}. ${WEATHER[b].text}`,
      'The weather changes at dawn. The forecast always comes true.',
    ],
  };
}

// ---- Widget ----------------------------------------------------------------------------------
function seasonWidget(hud, ctl) {
  if (typeof document === 'undefined' || !hud.slots || !hud.slots.cyclebar) return null;
  injectCss();
  const box = el('div', 'ssn');
  const wheel = el('button', 'ssn-wheel', '<canvas></canvas>');
  const wx = el('button', 'ssn-wx', '<canvas></canvas>');
  wheel.setAttribute('aria-label', 'Season'); wx.setAttribute('aria-label', 'Weather forecast');
  const wc = wheel.querySelector('canvas'), xc = wx.querySelector('canvas');
  box.append(wheel, wx);
  // Keep the cycle bar's own tap handler (wave info) from firing as well.
  box.addEventListener('pointerdown', (e) => e.stopPropagation());
  const open = (f) => { const s = ctl.s; if (!s) return; const t = f(s); ctl.openText(t.title, t.sub, t.lines, t.ic || 'info'); };
  tapButton(wheel, () => open((s) => ({ ...seasonText(s), ic: SEASONS[SEASONS.order[seasonIndex(s)]].icon })));
  tapButton(wx, () => open((s) => ({ ...forecastText(s), ic: weatherToday(s) === 'clear' || weatherToday(s) === 'heat' ? 'sun' : 'info' })));
  hud.slots.cyclebar.appendChild(box);
  let acc = 1, wKey = '', fKey = '', lastS = null, lastIdx = -1, due = -1;
  return {
    root: box,
    update(s, dt) {
      acc += dt || 0;
      if (acc < 0.25 || !s || !s.cycle) return;
      acc = 0;
      const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
      const idx = seasonIndex(s);
      const year = SEASONS.daysPer * 4;
      const k1 = `${idx}|${isEndlessWinter(s)}|${Math.round((((calendarDay(s) % year) + dayFrac(s)) / year) * 240)}|${dpr}`;
      if (k1 !== wKey) { wKey = k1; drawWheel(wc, s, dpr); }
      const night = s.cycle.phase === 'night' || s.cycle.phase === 'dusk';
      const k2 = `${weatherToday(s)}|${forecast(s)[0]}|${night}|${dpr}`;
      if (k2 !== fKey) { fKey = k2; drawForecast(xc, s, dpr); }
      // Season banner, once the dawn choice is out of the way.
      if (s !== lastS) { lastS = s; lastIdx = idx; due = -1; }
      else if (idx !== lastIdx) { lastIdx = idx; due = idx; }
      if (due >= 0 && !s.pending && hud.showBanner) {
        const def = SEASONS[SEASONS.order[due]];
        hud.showBanner(def.name.toUpperCase(), def.short || '', due === 3 ? 'danger' : 'dawn', 3200);
        due = -1;
      }
    },
  };
}

// ---- Registration --------------------------------------------------------------------------
let done = false;
export function register() {
  if (done) return;
  done = true;
  registerSeasons();
  registerWeather();
  registerFx();
  BUS.hud.push(seasonWidget);
}
