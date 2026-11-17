// Tiny DOM helpers. All UI feedback happens on pointerdown so taps feel instant.
import { icon } from './icons.js';
import { audio } from '../engine/audio.js';

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** Fast button: fires on pointerup inside, with instant press feedback + click sound. */
export function tapButton(btn, fn, { sound = 'click', longpress } = {}) {
  let down = false, lpT = 0, fired = false, sx = 0, sy = 0;
  btn.addEventListener('pointerdown', (e) => {
    down = true; fired = false; sx = e.clientX; sy = e.clientY;
    btn.classList.add('pressed');
    if (sound) audio.play(sound);
    if (longpress) lpT = setTimeout(() => { if (down) { fired = true; longpress(e); } }, 480);
  });
  const end = (e, ok) => {
    if (!down) return;
    down = false; clearTimeout(lpT);
    btn.classList.remove('pressed');
    if (ok && !audio.ready) audio.unlock();
    if (ok && !fired && !btn.disabled && Math.hypot(e.clientX - sx, e.clientY - sy) < 24) fn(e);
  };
  btn.addEventListener('pointerup', (e) => end(e, true));
  btn.addEventListener('pointercancel', (e) => end(e, false));
  btn.addEventListener('pointerleave', (e) => { if (down && e.pointerType === 'mouse') end(e, false); });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  return btn;
}

export function iconBtn(name, title, cls = '') {
  const b = el('button', 'hbtn ' + cls, icon(name));
  b.setAttribute('aria-label', title);
  b.title = title;
  return b;
}

export function fmt(n) {
  n = Math.floor(n);
  if (n >= 10000) return (n / 1000).toFixed(0) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

export function costHtml(cost, res) {
  return Object.entries(cost).map(([k, v]) => {
    const miss = res && (res[k] || 0) < v;
    return `<span class="costline"><span style="color:var(--c-${k})">${icon(k)}</span><span class="${miss ? 'miss' : ''}">${v}</span></span>`;
  }).join(' ');
}

export function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); }
