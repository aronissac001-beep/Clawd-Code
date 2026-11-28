// The hold's chrome textures (owner I; UI pass 2): a dressed-stone course for the top and bottom bars and
// the title's button panel, and a riveted brass trim for their inner edge, painted once at start-up as
// tiny pixel canvases in the art palette (docs/ART-STYLE.md) and handed to the CSS as data-URL custom
// properties (--px-stone, --px-trim, --px-trim-v). No image files; without a canvas the bars stay flat.
// W1.5 (EMBERCROWN-WORLD.md 7.2 item 2, 8.9): it also installs D's 9-slice panel frames and the rune rule
// (js/engine/art/ui.js frameVars) as --px-frame-<stone|wood|plate|plate-hot>[-slice|-w], --px-rule[-w|-h],
// --px-rune[-w] and --px-m, baked for the screen's device pixel ratio so that every art pixel is a whole
// number of device pixels, and bakes them again when the ratio changes (a zoom, another screen). Use:
//   border: var(--px-frame-stone-w) solid transparent;
//   border-image: var(--px-frame-stone) var(--px-frame-stone-slice) / var(--px-frame-stone-w) repeat;
//   image-rendering: pixelated; background-clip: padding-box;
import { PAL } from '../engine/art/palette.js';
import { frameVars } from '../engine/art/ui.js';

let dprWatch = null;
/** Install (or re-install for a new device pixel ratio) the panel frames and the rule (idempotent per ratio). */
export function installPanels(k = 2) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  const dpr = window.devicePixelRatio || 1, root = document.documentElement;
  if (root.dataset.panels === String(dpr)) return root.dataset.panels;
  try {
    const v = frameVars({ k, dpr });
    for (const n in v) root.style.setProperty(n, v[n]);
    root.dataset.panels = String(dpr);
  } catch (_) { return null; /* no canvas: the CSS borders stay */ }
  if (window.matchMedia) {
    if (dprWatch) dprWatch.mq.removeEventListener?.('change', dprWatch.fn);
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`), fn = () => installPanels(k);
    mq.addEventListener?.('change', fn, { once: true });
    dprWatch = { mq, fn };
  }
  return root.dataset.panels;
}

function paint(w, hh, fn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = hh;
  const g = c.getContext('2d');
  if (!g) return null;
  const px = (x, y, col, ww = 1, h2 = 1) => { g.fillStyle = col; g.fillRect(x, y, ww, h2); };
  fn(px);
  return `url(${c.toDataURL('image/png')})`;
}

/** Install the textures on :root (idempotent). */
export function installFrame() {
  if (typeof document === 'undefined') return;
  installPanels();
  if (document.documentElement.dataset.frame) return;
  try {
    // 16 x 8: two courses of dark ashlar, offset joints, a lit top edge per block and a few chips
    const stone = paint(16, 8, (px) => {
      px(0, 0, '#2a2329', 16, 8);
      px(0, 0, '#352c31', 16, 1); px(0, 4, '#352c31', 16, 1);          // lit top of each course
      px(0, 3, PAL.ink, 16, 1); px(0, 7, PAL.ink, 16, 1);              // mortar beds
      px(7, 0, PAL.ink, 1, 3); px(15, 4, PAL.ink, 1, 3); px(3, 4, PAL.ink, 1, 3); px(11, 0, '#1f1a1f', 1, 3);
      px(2, 1, '#30282d'); px(12, 5, '#30282d'); px(9, 2, '#241e23'); px(5, 6, '#241e23');
    });
    // 8 x 6 trim: ink, brass highlight, brass, shadow, ink, with a rivet every 8 px
    const trimRows = (px, o) => {
      px(0, o(0), PAL.ink, 8, 1); px(0, o(1), PAL.flame, 8, 1); px(0, o(2), PAL.gold, 8, 1);
      px(0, o(3), '#b07a2e', 8, 1); px(0, o(4), PAL.umber1, 8, 1); px(0, o(5), PAL.ink, 8, 1);
      px(3, o(1), PAL.umber2, 2, 1); px(3, o(2), PAL.bone, 1, 1); px(4, o(2), PAL.flame, 1, 1); px(3, o(3), PAL.umber1, 2, 1);
    };
    const trim = paint(8, 6, (px) => trimRows(px, (r) => r));
    // the same trim turned on its side for the landscape side rail (the lit edge faces the world, left)
    const trimV = paint(6, 8, (px) => {
      const rows = [PAL.ink, PAL.flame, PAL.gold, '#b07a2e', PAL.umber1, PAL.ink];
      rows.forEach((col, i) => px(i, 0, col, 1, 8));
      px(1, 3, PAL.umber2, 1, 2); px(2, 3, PAL.bone); px(2, 4, PAL.flame); px(3, 3, PAL.umber1, 1, 2);
    });
    const root = document.documentElement.style;
    if (stone) root.setProperty('--px-stone', stone);
    if (trim) root.setProperty('--px-trim', trim);
    if (trimV) root.setProperty('--px-trim-v', trimV);
    document.documentElement.dataset.frame = '1';
  } catch (_) { /* no canvas: flat bars */ }
}
