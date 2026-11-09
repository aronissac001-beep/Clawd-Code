// ===== sprites.js : vector unit icons, drawn once per size and cached =====
// Each icon is a list of parts in a -1..1 box: l = thick line, p = polygon, c = circle, a = arc, d = dark detail.
const ICONS = (() => {
  const arcPts = (cx, cy, r, a0, a1, n) => { const o = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return o; };
  const star = (n, r0, r1) => { const o = []; for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? r1 : r0; o.push([Math.cos(a) * r, Math.sin(a) * r]); } return o; };
  const horse = [[-0.45, 0.85], [-0.5, 0.2], [-0.35, -0.35], [-0.12, -0.68], [-0.02, -0.92], [0.12, -0.68], [0.6, -0.25], [0.72, 0.0], [0.56, 0.14], [0.2, 0.02], [0.16, 0.36], [0.32, 0.85]];
  const sailHull = [[-0.85, 0.25], [0.85, 0.25], [0.6, 0.65], [-0.6, 0.65]];
  return {
    club: [['p', [[-0.18, 0.85], [0.04, 0.85], [0.3, -0.5], [0.12, -0.86], [-0.22, -0.72]]], ['d', 'l', [[-0.05, 0.2], [0.08, 0.15]], 0.04]],
    spear: [['c', -0.28, 0.28, 0.34], ['d', 'c', -0.28, 0.28, 0.1], ['l', [[-0.55, 0.82], [0.45, -0.55]], 0.1], ['p', [[0.65, -0.86], [0.34, -0.63], [0.56, -0.47]]]],
    pike: [['c', -0.3, 0.32, 0.3], ['l', [[-0.65, 0.9], [0.55, -0.7]], 0.08], ['p', [[0.78, -1.0], [0.44, -0.78], [0.66, -0.6]]], ['l', [[0.1, -0.3], [0.32, -0.12]], 0.06]],
    sword: [['p', [[-0.09, 0.22], [-0.09, -0.7], [0, -0.9], [0.09, -0.7], [0.09, 0.22]]], ['l', [[-0.4, 0.28], [0.4, 0.28]], 0.13], ['l', [[0, 0.34], [0, 0.66]], 0.13], ['c', 0, 0.8, 0.11]],
    greatsword: [['p', [[-0.11, 0.18], [-0.11, -0.78], [0, -0.96], [0.11, -0.78], [0.11, 0.18]]], ['l', [[-0.48, 0.22], [0.48, 0.22]], 0.13], ['l', [[0, 0.3], [0, 0.72]], 0.12], ['c', 0, 0.84, 0.1]],
    bow: [['a', -0.45, 0, 0.78, -1.08, 1.08, 0.11], ['l', [[-0.08, -0.69], [-0.08, 0.69]], 0.035], ['l', [[-0.6, 0], [0.62, 0]], 0.06], ['p', [[0.85, 0], [0.6, -0.14], [0.6, 0.14]]], ['p', [[-0.62, 0], [-0.78, -0.14], [-0.7, 0], [-0.78, 0.14]]]],
    crossbow: [['l', [[0, -0.1], [0, 0.82]], 0.17], ['a', 0, 0.28, 0.76, -2.4, -0.74, 0.1], ['l', [[-0.56, -0.23], [0.56, -0.23]], 0.035], ['l', [[0, -0.8], [0, 0.05]], 0.06], ['p', [[0, -0.95], [-0.1, -0.74], [0.1, -0.74]]]],
    horse: [['p', horse], ['d', 'c', 0.1, -0.33, 0.07], ['d', 'l', [[-0.3, -0.35], [-0.42, 0.3]], 0.04]],
    lancer: [['p', horse], ['d', 'c', 0.1, -0.33, 0.07], ['l', [[-0.9, 0.7], [0.88, -0.8]], 0.07], ['p', [[0.98, -0.9], [0.74, -0.8], [0.88, -0.66]]]],
    musket: [['l', [[-0.72, 0.55], [0.72, -0.52]], 0.1], ['p', [[-0.9, 0.45], [-0.45, 0.22], [-0.28, 0.48], [-0.72, 0.85]]], ['d', 'l', [[-0.2, 0.2], [-0.1, 0.32]], 0.05]],
    rifle: [['l', [[-0.72, 0.55], [0.72, -0.52]], 0.09], ['l', [[0.72, -0.52], [0.94, -0.7]], 0.035], ['p', [[-0.9, 0.45], [-0.45, 0.22], [-0.28, 0.48], [-0.72, 0.85]]], ['d', 'l', [[-0.2, 0.2], [-0.1, 0.32]], 0.05]],
    catapult: [['p', [[-0.78, 0.32], [0.78, 0.32], [0.78, 0.52], [-0.78, 0.52]]], ['c', -0.46, 0.62, 0.2], ['c', 0.46, 0.62, 0.2], ['l', [[0.12, 0.32], [0.12, -0.05]], 0.1], ['l', [[-0.25, 0.32], [0.55, -0.66]], 0.1], ['c', 0.6, -0.72, 0.16]],
    cannon: [['p', [[-0.62, 0.12], [0.78, -0.36], [0.86, -0.12], [-0.5, 0.4]]], ['c', -0.15, 0.45, 0.33], ['d', 'c', -0.15, 0.45, 0.09]],
    galley: [['p', [[-0.88, 0.12], [0.88, 0.12], [0.62, 0.52], [-0.62, 0.52]]], ['l', [[0, 0.12], [0, -0.78]], 0.07], ['p', [[0.02, -0.74], [0.52, -0.36], [0.02, -0.04]]], ['l', [[-0.42, 0.45], [-0.62, 0.84]], 0.05], ['l', [[0, 0.5], [-0.16, 0.88]], 0.05], ['l', [[0.42, 0.45], [0.26, 0.84]], 0.05]],
    sail: [['p', sailHull], ['l', [[-0.25, 0.25], [-0.25, -0.86]], 0.06], ['l', [[0.32, 0.25], [0.32, -0.7]], 0.06], ['p', [[-0.58, -0.76], [0.06, -0.76], [0.02, 0.1], [-0.52, 0.1]]], ['p', [[0.1, -0.58], [0.58, -0.58], [0.55, 0.1], [0.14, 0.1]]]],
    frigate: [['p', sailHull], ['l', [[-0.25, 0.25], [-0.25, -0.86]], 0.06], ['l', [[0.32, 0.25], [0.32, -0.7]], 0.06], ['p', [[-0.58, -0.76], [0.06, -0.76], [0.02, 0.1], [-0.52, 0.1]]], ['p', [[0.1, -0.58], [0.58, -0.58], [0.55, 0.1], [0.14, 0.1]]], ['d', 'c', -0.4, 0.43, 0.06], ['d', 'c', 0, 0.43, 0.06], ['d', 'c', 0.4, 0.43, 0.06]],
    ironclad: [['p', [[-0.92, 0.18], [0.92, 0.18], [0.72, 0.56], [-0.78, 0.56]]], ['p', [[-0.48, 0.18], [-0.32, -0.16], [0.36, -0.16], [0.52, 0.18]]], ['p', [[0.0, -0.16], [0.16, -0.16], [0.16, -0.62], [0.0, -0.62]]], ['d', 'c', -0.2, 0.02, 0.05], ['d', 'c', 0.2, 0.02, 0.05]],
    spyglass: [['l', [[-0.66, 0.52], [0.5, -0.36]], 0.2], ['l', [[0.3, -0.22], [0.7, -0.52]], 0.3], ['c', -0.74, 0.58, 0.1]],
    wagon: [['p', [[-0.78, -0.02], [0.78, -0.02], [0.66, 0.38], [-0.66, 0.38]]], ['p', arcPts(0, -0.02, 0.66, Math.PI, Math.PI * 2, 10)], ['d', 'l', [[-0.22, -0.6], [-0.22, -0.04]], 0.04], ['d', 'l', [[0.22, -0.6], [0.22, -0.04]], 0.04], ['c', -0.44, 0.5, 0.21], ['c', 0.44, 0.5, 0.21]],
    hammer: [['l', [[-0.58, 0.78], [0.28, -0.2]], 0.13], ['p', [[0.04, -0.62], [0.62, -0.04], [0.42, 0.16], [-0.16, -0.42]]]],
    crate: [['p', [[-0.62, -0.5], [0.62, -0.5], [0.62, 0.32], [-0.62, 0.32]]], ['d', 'l', [[-0.62, -0.09], [0.62, -0.09]], 0.05], ['d', 'l', [[-0.2, -0.5], [-0.2, 0.32]], 0.05], ['d', 'l', [[0.2, -0.5], [0.2, 0.32]], 0.05], ['c', -0.36, 0.5, 0.19], ['c', 0.36, 0.5, 0.19]],
    book: [['p', [[-0.75, -0.48], [0, -0.32], [0.75, -0.48], [0.75, 0.5], [0, 0.66], [-0.75, 0.5]]], ['d', 'l', [[0, -0.3], [0, 0.64]], 0.05], ['d', 'l', [[-0.55, -0.16], [-0.16, -0.06]], 0.035], ['d', 'l', [[0.16, -0.06], [0.55, -0.16]], 0.035]],
    lantern: [['p', [[-0.32, -0.36], [0.32, -0.36], [0.42, 0.58], [-0.42, 0.58]]], ['a', 0, -0.48, 0.22, Math.PI, Math.PI * 2, 0.08], ['d', 'p', [[-0.16, -0.16], [0.16, -0.16], [0.2, 0.38], [-0.2, 0.38]]]],
    radiant: [['p', star(8, 0.92, 0.42)], ['d', 'c', 0, 0, 0.18]],
  };
})();
const UNIT_ICON = {
  militia: 'club', spearman: 'spear', cohort_spear: 'spear', pikeman: 'pike', swordsman: 'sword', longsword: 'greatsword',
  archer: 'bow', thornbow: 'bow', crossbowman: 'crossbow', wallwarden: 'crossbow', rider: 'horse', knight: 'lancer', dune_lancer: 'lancer',
  musketeer: 'musket', rifleman: 'rifle', catapult: 'catapult', firedrake: 'catapult', cannon: 'cannon', artillery: 'cannon',
  galley: 'galley', reef_runner: 'galley', iceguard: 'pike', caravel: 'sail', warship: 'sail', frigate: 'frigate', corsair: 'frigate', ironclad: 'ironclad',
  scout: 'spyglass', settler: 'wagon', builder: 'hammer', caravan: 'crate', missionary: 'book', inquisitor: 'lantern', prophet: 'radiant',
};
// Paint an icon into ctx centred at 0,0 with half-size r. Outline pass first, then the fill.
function paintIcon(ctx, name, r, fill, ink) {
  const parts = ICONS[name]; if (!parts) return;
  const pass = (outline) => {
    for (let part of parts) {
      let dark = false;
      if (part[0] === 'd') { dark = true; part = part.slice(1); if (outline) continue; }
      const col = dark ? ink : fill;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (part[0] === 'l') {
        ctx.beginPath(); part[1].forEach(([x, y], i) => i ? ctx.lineTo(x * r, y * r) : ctx.moveTo(x * r, y * r));
        ctx.lineWidth = (part[2] + (outline ? 0.16 : 0)) * r; ctx.strokeStyle = outline ? ink : col; ctx.stroke();
      } else if (part[0] === 'p') {
        ctx.beginPath(); part[1].forEach(([x, y], i) => i ? ctx.lineTo(x * r, y * r) : ctx.moveTo(x * r, y * r)); ctx.closePath();
        if (outline) { ctx.lineWidth = 0.16 * r; ctx.strokeStyle = ink; ctx.stroke(); } else { ctx.fillStyle = col; ctx.fill(); }
      } else if (part[0] === 'c') {
        ctx.beginPath(); ctx.arc(part[1] * r, part[2] * r, (part[3] + (outline ? 0.08 : 0)) * r, 0, 6.283); ctx.fillStyle = outline ? ink : col; ctx.fill();
      } else if (part[0] === 'a') {
        ctx.beginPath(); ctx.arc(part[1] * r, part[2] * r, part[3] * r, part[4], part[5]);
        ctx.lineWidth = (part[6] + (outline ? 0.16 : 0)) * r; ctx.strokeStyle = outline ? ink : col; ctx.stroke();
      }
    }
  };
  pass(true); pass(false);
}
// Small top-lit gradient so the icons read as embossed metal on the shield.
function iconCanvas(name, px, dpr) {
  const s = Math.ceil(px * 2.4 * dpr), c = document.createElement('canvas'); c.width = s; c.height = s;
  const x = c.getContext('2d'); x.translate(s / 2, s / 2);
  const r = px * dpr;
  const g = x.createLinearGradient(0, -r, 0, r); g.addColorStop(0, '#fffaf0'); g.addColorStop(1, '#d9ccb0');
  paintIcon(x, name, r, g, 'rgba(18,14,8,.92)');
  return c;
}
