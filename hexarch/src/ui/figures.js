// ===== figures.js : drawn unit figures, vehicles and ships =====
// Every unit type is painted procedurally as a small standing figure (or a vehicle or ship) with
// civ-coloured trim, then cached per renderer zoom. The origin is the middle of the feet / waterline.
// u = figure height in pixels. Shapes get a dark outline first so they read at small sizes.
const FIG_INK = 'rgba(22,16,12,.92)';
const SKINS = ['#e9c39b', '#c99a6e', '#a8754c', '#7e5436', '#f0d2b0'];
const METAL = '#c4cad3', METAL_D = '#7f8792', WOOD = '#7a4f2a', WOOD_D = '#4e3218', LEATHER = '#8c5d34';
// k: foot | horse | siege | tank | ship | wagon | camel
// body: tunic | coat | robe | mail | plate | uniform | fur ; trim: where the civ colour goes ; head: headgear ; w: weapon ; sh: shield
const UNIT_FIG = {
  militia: { k: 'foot', body: 'tunic', cloth: '#8a6a44', legs: '#5a4630', trim: 'sash', head: 'bare', w: 'club' },
  scout: { k: 'foot', body: 'tunic', cloth: '#6f7a46', legs: '#4f4630', trim: 'cape', head: 'wide', w: 'spyglass', extra: 'pack' },
  archer: { k: 'foot', body: 'tunic', cloth: '#7a6a48', legs: '#4c3e2a', trim: 'sash', head: 'hood', w: 'bow', extra: 'quiver' },
  thornbow: { k: 'foot', body: 'tunic', cloth: '#4f6e34', legs: '#3c4a28', trim: 'cape', head: 'hood', hoodCol: '#3f6a2c', w: 'bow', extra: 'quiver', leaves: true },
  spearman: { k: 'foot', body: 'tunic', cloth: '#9a7a50', legs: '#5a4630', trim: 'tabard', head: 'conical', w: 'spear', sh: 'round' },
  cohort_spear: { k: 'foot', body: 'mail', cloth: '#b08850', legs: '#5a4630', trim: 'tabard', head: 'crest', w: 'spear', sh: 'scutum' },
  swordsman: { k: 'foot', body: 'mail', legs: '#5a4630', trim: 'tabard', head: 'nasal', w: 'sword', sh: 'round' },
  pikeman: { k: 'foot', body: 'tunic', cloth: '#c8b48a', legs: '#4a3d30', trim: 'tabard', head: 'kettle', w: 'pike' },
  iceguard: { k: 'foot', body: 'fur', cloth: '#e4e8ea', legs: '#5d6670', trim: 'tabard', head: 'fur', w: 'pike', sh: 'round' },
  longsword: { k: 'foot', body: 'plate', legs: METAL_D, trim: 'tabard', head: 'great', w: 'greatsword' },
  crossbowman: { k: 'foot', body: 'tunic', cloth: '#8a7656', legs: '#4c3e2a', trim: 'tabard', head: 'kettle', w: 'crossbow' },
  wallwarden: { k: 'foot', body: 'mail', legs: '#4c3e2a', trim: 'tabard', head: 'kettle', w: 'crossbow', sh: 'pavise' },
  musketeer: { k: 'foot', body: 'coat', cloth: 'civ', legs: '#e6dcc4', trim: 'belts', head: 'tricorn', w: 'musket' },
  rifleman: { k: 'foot', body: 'coat', cloth: 'civdark', legs: '#3a4250', trim: 'collar', head: 'shako', w: 'rifle' },
  infantry: { k: 'foot', body: 'uniform', cloth: '#6b7046', legs: '#585c3a', trim: 'armband', head: 'brodie', w: 'rifle', extra: 'pack' },
  settler: { k: 'wagon' },
  builder: { k: 'foot', body: 'tunic', cloth: '#a0784a', legs: '#4f5a6a', trim: 'apron', head: 'cap', w: 'hammer', extra: 'pack' },
  caravan: { k: 'camel' },
  missionary: { k: 'foot', body: 'robe', cloth: '#ddd2bc', trim: 'stole', head: 'bare', w: 'book' },
  inquisitor: { k: 'foot', body: 'robe', cloth: '#3a3340', trim: 'stole', head: 'cowl', w: 'lantern' },
  prophet: { k: 'foot', body: 'robe', cloth: '#f2ecdc', trim: 'stole', head: 'hood', hoodCol: '#f2ecdc', w: 'staff', extra: 'halo' },
  spy: { k: 'foot', body: 'coat', cloth: '#2c3038', legs: '#22252b', trim: 'collar', head: 'topper', w: 'dagger' },
  great_scientist: { k: 'foot', body: 'robe', cloth: '#f4f4f0', trim: 'collar', head: 'bare', hair: '#ddd', w: 'flask', extra: 'glow' },
  great_engineer: { k: 'foot', body: 'tunic', cloth: '#6a5a48', legs: '#3f444c', trim: 'apron', head: 'goggles', w: 'wrench', extra: 'glow' },
  great_merchant: { k: 'foot', body: 'robe', cloth: '#7a3f5e', trim: 'stole', head: 'turban', w: 'coins', extra: 'glow' },
  great_artist: { k: 'foot', body: 'coat', cloth: '#3e5a7a', legs: '#2f3540', trim: 'collar', head: 'beret', w: 'brush', extra: 'glow' },
  great_general: { k: 'horse', coat: '#e8e2d6', rider: { body: 'plate', legs: METAL_D, trim: 'cape', head: 'plume' }, w: 'banner', barding: true, extra: 'glow' },
  rider: { k: 'horse', coat: '#8a5a32', rider: { body: 'tunic', cloth: '#9a7a50', legs: '#5a4630', trim: 'sash', head: 'conical' }, w: 'javelin' },
  knight: { k: 'horse', coat: '#5a4a40', rider: { body: 'plate', legs: METAL_D, trim: 'tabard', head: 'great' }, w: 'lance', barding: true, sh: 'kite' },
  dune_lancer: { k: 'horse', coat: '#d8b77a', rider: { body: 'robe', cloth: '#efe2c4', trim: 'sash', head: 'turban' }, w: 'lance', barding: true },
  catapult: { k: 'siege', gun: 'catapult' },
  cannon: { k: 'siege', gun: 'cannon' },
  firedrake: { k: 'siege', gun: 'drake' },
  artillery: { k: 'siege', gun: 'artillery' },
  field_gun: { k: 'siege', gun: 'fieldgun' },
  landship: { k: 'tank' },
  galley: { k: 'ship', hull: 'galley' },
  reef_runner: { k: 'ship', hull: 'reef' },
  warship: { k: 'ship', hull: 'bireme' },
  caravel: { k: 'ship', hull: 'caravel' },
  frigate: { k: 'ship', hull: 'frigate' },
  corsair: { k: 'ship', hull: 'corsair' },
  ironclad: { k: 'ship', hull: 'ironclad' },
  destroyer: { k: 'ship', hull: 'destroyer' },
};

function figCanvas(type, civ, u, dpr) {
  const spec = UNIT_FIG[type]; if (!spec) return null;
  const wide = spec.k === 'foot' ? 1.5 : 2.3, U = u * dpr;
  const c = document.createElement('canvas');
  c.width = Math.ceil(U * wide); c.height = Math.ceil(U * 1.62);
  c.ox = c.width / 2 / dpr; c.oy = U * 1.46 / dpr;
  const x = c.getContext('2d'); x.translate(c.width / 2, U * 1.46);
  x.lineJoin = 'round'; x.lineCap = 'round';
  paintFigure(x, spec, civ, U, type);
  return c;
}

function paintFigure(x, spec, civ, u, type) {
  const lw = Math.max(1, u * 0.042);
  const P = { x, u, lw, civ, col: civ.color, dark: civ.dark || shade(civ.color, -0.5), skin: SKINS[(civ.key || '').length % SKINS.length] };
  // shape helpers: path builders receive coordinates in figure units (u = 1)
  P.poly = (pts, fill, ink) => { x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a * u, b * u) : x.moveTo(a * u, b * u)); x.closePath(); figFill(P, fill, ink); };
  P.ell = (cx, cy, rx, ry, fill, ink, rot) => { x.beginPath(); x.ellipse(cx * u, cy * u, rx * u, ry * u, rot || 0, 0, 6.283); figFill(P, fill, ink); };
  P.line = (pts, w, col, ink) => {
    x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a * u, b * u) : x.moveTo(a * u, b * u));
    if (ink !== false) { x.strokeStyle = FIG_INK; x.lineWidth = w * u + lw * 2; x.stroke(); }
    x.strokeStyle = col; x.lineWidth = w * u; x.stroke();
  };
  P.rect = (a, b, w, h, fill, ink) => P.poly([[a, b], [a + w, b], [a + w, b + h], [a, b + h]], fill, ink);
  if (spec.extra === 'glow' || spec.extra === 'halo') { // great people and prophets carry a soft golden aura
    const g = x.createRadialGradient(0, -0.55 * u, 0.05 * u, 0, -0.55 * u, 0.75 * u); g.addColorStop(0, 'rgba(255,226,140,.55)'); g.addColorStop(1, 'rgba(255,226,140,0)');
    x.fillStyle = g; x.beginPath(); x.arc(0, -0.55 * u, 0.75 * u, 0, 6.283); x.fill();
  }
  if (spec.k === 'foot') paintFoot(P, spec, 0, 0, 1);
  else if (spec.k === 'horse') paintHorse(P, spec);
  else if (spec.k === 'siege') paintSiege(P, spec.gun);
  else if (spec.k === 'tank') paintTank(P);
  else if (spec.k === 'ship') paintShip(P, spec.hull);
  else if (spec.k === 'wagon') paintWagon(P);
  else if (spec.k === 'camel') paintCamel(P);
}
function figFill(P, fill, ink) {
  const x = P.x;
  if (ink !== false) { x.strokeStyle = FIG_INK; x.lineWidth = P.lw * 2; x.stroke(); }
  if (fill) { x.fillStyle = fill; x.fill(); }
}
// vertical gradient helper for rounded-looking shapes
function figGrad(P, top, bot, col, amt) { const g = P.x.createLinearGradient(-0.3 * P.u, top * P.u, 0.3 * P.u, bot * P.u); g.addColorStop(0, shade(col, amt || 0.18)); g.addColorStop(1, shade(col, -(amt || 0.18))); return g; }
function clothCol(P, c) { return c === 'civ' ? P.col : c === 'civdark' ? shade(P.dark, 0.15) : c; }

// A standing person. ox,oy = feet; s = scale; seated = mounted rider (no legs, wider stance)
function paintFoot(P, sp, ox, oy, s, seated) {
  const { x, u } = P, X = v => ox + v * s, Y = v => oy + v * s;
  const cloth = clothCol(P, sp.cloth || (sp.body === 'mail' ? '#9aa1aa' : sp.body === 'plate' ? METAL : '#8a6a44'));
  const metal = sp.body === 'mail' || sp.body === 'plate';
  const sx = 0.17, hy = -0.36, shy = -0.7; // shoulder half-width, hip and shoulder height
  // back layer: cape, quiver, pack, pavise
  if (sp.trim === 'cape') P.poly([[X(-sx), Y(shy + 0.02)], [X(sx), Y(shy + 0.02)], [X(sx + 0.1), Y(seated ? -0.42 : -0.12)], [X(-sx - 0.12), Y(seated ? -0.4 : -0.1)]], shade(P.col, -0.12));
  if (sp.extra === 'quiver') { P.poly([[X(-0.2), Y(-0.86)], [X(-0.1), Y(-0.9)], [X(-0.02), Y(-0.46)], [X(-0.12), Y(-0.42)]], LEATHER); P.line([[X(-0.17), Y(-0.9)], [X(-0.2), Y(-1.0)]], 0.025, '#e9e0c8'); P.line([[X(-0.11), Y(-0.92)], [X(-0.12), Y(-1.02)]], 0.025, '#e9e0c8'); }
  if (sp.extra === 'pack') P.rect(X(-0.24), Y(-0.72), 0.16 * s, 0.26 * s, '#7d6646');
  if (sp.sh === 'pavise') { P.poly([[X(-0.3), Y(-0.98)], [X(-0.02), Y(-1.0)], [X(0.0), Y(-0.34)], [X(-0.28), Y(-0.32)]], P.col); P.line([[X(-0.15), Y(-0.92)], [X(-0.15), Y(-0.42)]], 0.05, P.dark, false); }
  // legs
  if (!seated) {
    const lc = sp.legs || '#4c3e2a', robe = sp.body === 'robe';
    if (!robe) {
      P.poly([[X(-0.12), Y(hy)], [X(-0.01), Y(hy)], [X(-0.03), Y(-0.04)], [X(-0.13), Y(-0.04)]], lc);
      P.poly([[X(0.01), Y(hy)], [X(0.12), Y(hy)], [X(0.13), Y(-0.04)], [X(0.03), Y(-0.04)]], shade(lc, -0.12));
    }
    P.ell(X(-0.09), Y(-0.03), 0.075 * s, 0.04 * s, '#3a2a1c'); P.ell(X(0.09), Y(-0.03), 0.075 * s, 0.04 * s, '#3a2a1c');
  }
  // torso and skirt by body type
  const bodyFill = figGrad(P, shy, hy, cloth, metal ? 0.3 : 0.16);
  if (sp.body === 'robe') P.poly([[X(-sx), Y(shy)], [X(sx), Y(shy)], [X(0.22), Y(seated ? -0.4 : -0.04)], [X(-0.22), Y(seated ? -0.4 : -0.04)]], bodyFill);
  else if (sp.body === 'coat' || sp.body === 'fur') P.poly([[X(-sx), Y(shy)], [X(sx), Y(shy)], [X(0.19), Y(seated ? -0.4 : -0.22)], [X(-0.19), Y(seated ? -0.4 : -0.22)]], bodyFill);
  else P.poly([[X(-sx), Y(shy)], [X(sx), Y(shy)], [X(0.15), Y(hy - 0.02)], [X(0.18), Y(hy + 0.1)], [X(-0.18), Y(hy + 0.1)], [X(-0.15), Y(hy - 0.02)]], bodyFill);
  if (sp.body === 'fur') { x.fillStyle = 'rgba(255,255,255,.55)'; for (let k = 0; k < 5; k++) { x.beginPath(); x.arc(X(-0.15 + k * 0.075) * u, Y(shy + 0.03) * u, 0.045 * s * u, 0, 6.283); x.fill(); } }
  if (sp.body === 'mail') { x.strokeStyle = 'rgba(40,44,52,.35)'; x.lineWidth = Math.max(0.6, 0.012 * s * u); x.beginPath(); for (let r = 0; r < 4; r++) { const yy = Y(shy + 0.08 + r * 0.075) * u; x.moveTo(X(-0.14) * u, yy); x.lineTo(X(0.14) * u, yy); } x.stroke(); }
  if (sp.body === 'plate') { x.fillStyle = 'rgba(255,255,255,.45)'; x.beginPath(); x.ellipse(X(-0.06) * u, Y(-0.6) * u, 0.035 * s * u, 0.08 * s * u, 0, 0, 6.283); x.fill(); }
  // civ trim
  const t = sp.trim;
  if (t === 'tabard') P.poly([[X(-0.08), Y(shy + 0.01)], [X(0.08), Y(shy + 0.01)], [X(0.09), Y(hy + 0.12)], [X(0), Y(hy + 0.18)], [X(-0.09), Y(hy + 0.12)]], P.col);
  else if (t === 'sash') P.line([[X(-0.15), Y(shy + 0.03)], [X(0.15), Y(hy - 0.02)]], 0.06 * s, P.col);
  else if (t === 'belts') { P.line([[X(-0.15), Y(shy + 0.03)], [X(0.14), Y(hy - 0.01)]], 0.035 * s, '#efe8d8'); P.line([[X(0.15), Y(shy + 0.03)], [X(-0.14), Y(hy - 0.01)]], 0.035 * s, '#efe8d8'); }
  else if (t === 'collar') P.poly([[X(-0.12), Y(shy)], [X(0.12), Y(shy)], [X(0.0), Y(shy + 0.12)]], P.col);
  else if (t === 'armband') P.rect(X(0.15), Y(-0.64), 0.07 * s, 0.06 * s, P.col);
  else if (t === 'apron') P.poly([[X(-0.1), Y(shy + 0.1)], [X(0.1), Y(shy + 0.1)], [X(0.12), Y(hy + 0.12)], [X(-0.12), Y(hy + 0.12)]], P.col);
  else if (t === 'stole') { P.line([[X(-0.07), Y(shy)], [X(-0.07), Y(seated ? -0.42 : -0.12)]], 0.06 * s, P.col); P.line([[X(0.07), Y(shy)], [X(0.07), Y(seated ? -0.42 : -0.12)]], 0.06 * s, P.col); }
  if (sp.body !== 'robe' && sp.body !== 'coat') P.line([[X(-0.15), Y(hy + 0.02)], [X(0.15), Y(hy + 0.02)]], 0.035 * s, '#3a2a1c', false);
  // arms (sleeves) and hands
  const sleeve = metal ? METAL_D : shade(cloth, -0.1);
  P.line([[X(-sx), Y(shy + 0.04)], [X(-0.23), Y(-0.48)]], 0.075 * s, sleeve);
  P.line([[X(sx), Y(shy + 0.04)], [X(0.24), Y(-0.5)]], 0.075 * s, sleeve);
  P.ell(X(-0.235), Y(-0.46), 0.045 * s, 0.045 * s, P.skin);
  P.ell(X(0.245), Y(-0.48), 0.045 * s, 0.045 * s, P.skin);
  // head
  const hx = X(0), hyy = Y(-0.83), hr = 0.13 * s;
  if (sp.head === 'hood' || sp.head === 'cowl') P.ell(hx, hyy - 0.01 * s, hr * 1.25, hr * 1.25, clothCol(P, sp.hoodCol || (sp.head === 'cowl' ? '#2a2430' : '#6a5a40')));
  P.ell(hx, hyy, hr, hr, P.skin);
  if (sp.head === 'cowl') { x.fillStyle = 'rgba(0,0,0,.55)'; x.beginPath(); x.ellipse(hx * u, (hyy + 0.01 * s) * u, hr * 0.8 * u, hr * 0.85 * u, 0, 0, 6.283); x.fill(); }
  else { x.fillStyle = '#20160e'; x.beginPath(); x.arc((hx + 0.045 * s) * u, (hyy - 0.01 * s) * u, Math.max(0.6, 0.018 * s * u), 0, 6.283); x.fill(); } // eye, facing right
  if (sp.hair) { x.fillStyle = sp.hair; x.beginPath(); x.arc(hx * u, hyy * u, hr * u, Math.PI * 0.9, Math.PI * 2.05); x.fill(); }
  paintHead(P, sp.head, hx, hyy, hr, s);
  // weapon or tool in the right hand, shield on the left
  paintHeld(P, seated ? null : sp.w, X(0.245), Y(-0.48), s, sp);
  if (sp.sh && sp.sh !== 'pavise') paintShield(P, sp.sh, X(-0.2), Y(-0.5), s);
  if (sp.leaves) { x.fillStyle = '#7fbf4a'; for (const [a, b] of [[0.3, -0.95], [0.36, -0.2], [0.42, -0.6]]) { x.beginPath(); x.ellipse(X(a) * u, Y(b) * u, 0.035 * s * u, 0.018 * s * u, 0.6, 0, 6.283); x.fill(); } }
}
function paintHead(P, head, hx, hy, hr, s) {
  const steel = figGrad(P, hy - hr, hy, METAL, 0.3);
  switch (head) {
    case 'cap': P.poly([[hx - hr * 1.05, hy - hr * 0.2], [hx - hr * 0.8, hy - hr * 1.05], [hx + hr * 0.8, hy - hr * 1.05], [hx + hr * 1.5, hy - hr * 0.25]], P.col); break;
    case 'wide': P.ell(hx, hy - hr * 0.55, hr * 1.9, hr * 0.35, '#8a6a3a'); P.ell(hx, hy - hr * 0.85, hr * 0.85, hr * 0.55, '#8a6a3a'); P.line([[hx - hr * 0.8, hy - hr * 0.65], [hx + hr * 0.8, hy - hr * 0.65]], 0.03 * s, P.col, false); break;
    case 'conical': P.poly([[hx - hr * 1.1, hy - hr * 0.2], [hx, hy - hr * 1.9], [hx + hr * 1.1, hy - hr * 0.2]], steel); break;
    case 'nasal': P.poly([[hx - hr * 1.08, hy - hr * 0.1], [hx - hr * 0.9, hy - hr * 1.05], [hx, hy - hr * 1.4], [hx + hr * 0.9, hy - hr * 1.05], [hx + hr * 1.08, hy - hr * 0.1]], steel); P.line([[hx + hr * 0.45, hy - hr * 0.3], [hx + hr * 0.5, hy + hr * 0.35]], 0.03 * s, METAL_D, false); break;
    case 'crest': P.poly([[hx - hr * 1.08, hy], [hx - hr * 0.95, hy - hr * 1.0], [hx + hr * 0.95, hy - hr * 1.0], [hx + hr * 1.08, hy]], figGrad(P, hy - hr, hy, '#c9a24a', 0.3));
      P.poly([[hx - hr * 1.2, hy - hr * 1.0], [hx - hr * 0.6, hy - hr * 1.75], [hx + hr * 0.9, hy - hr * 1.6], [hx + hr * 0.9, hy - hr * 0.95]], P.col); break;
    case 'great': P.poly([[hx - hr * 1.12, hy + hr * 0.9], [hx - hr * 1.12, hy - hr * 0.8], [hx - hr * 0.6, hy - hr * 1.2], [hx + hr * 0.6, hy - hr * 1.2], [hx + hr * 1.12, hy - hr * 0.8], [hx + hr * 1.12, hy + hr * 0.9]], steel);
      P.line([[hx - hr * 0.2, hy - hr * 0.1], [hx + hr * 1.05, hy - hr * 0.1]], 0.025 * s, '#1a1a20', false); P.line([[hx + hr * 0.4, hy + hr * 0.2], [hx + hr * 0.4, hy + hr * 0.7]], 0.02 * s, '#1a1a20', false); break;
    case 'plume': P.poly([[hx - hr * 1.08, hy], [hx - hr * 0.95, hy - hr * 1.0], [hx + hr * 0.95, hy - hr * 1.0], [hx + hr * 1.08, hy]], steel);
      P.poly([[hx, hy - hr * 1.0], [hx - hr * 0.7, hy - hr * 2.0], [hx - hr * 1.5, hy - hr * 1.6], [hx - hr * 0.6, hy - hr * 0.9]], P.col); break;
    case 'kettle': P.ell(hx, hy - hr * 0.55, hr * 1.7, hr * 0.32, steel); P.poly([[hx - hr * 0.9, hy - hr * 0.55], [hx - hr * 0.75, hy - hr * 1.2], [hx + hr * 0.75, hy - hr * 1.2], [hx + hr * 0.9, hy - hr * 0.55]], steel); break;
    case 'fur': P.ell(hx, hy - hr * 0.7, hr * 1.25, hr * 0.7, '#e8e6e0'); P.ell(hx, hy - hr * 0.45, hr * 1.3, hr * 0.28, P.col); break;
    case 'tricorn': P.poly([[hx - hr * 1.6, hy - hr * 0.5], [hx, hy - hr * 1.6], [hx + hr * 1.6, hy - hr * 0.5], [hx, hy - hr * 0.85]], '#24201c'); P.ell(hx, hy - hr * 1.15, hr * 0.15, hr * 0.15, P.col, false); break;
    case 'shako': P.poly([[hx - hr * 0.95, hy - hr * 0.45], [hx - hr * 0.85, hy - hr * 1.75], [hx + hr * 0.85, hy - hr * 1.75], [hx + hr * 0.95, hy - hr * 0.45]], '#1e2228'); P.poly([[hx - hr * 0.2, hy - hr * 1.5], [hx + hr * 0.2, hy - hr * 1.5], [hx + hr * 0.15, hy - hr * 0.95], [hx - hr * 0.15, hy - hr * 0.95]], P.col, false);
      P.line([[hx + hr * 0.5, hy - hr * 0.45], [hx + hr * 1.4, hy - hr * 0.3]], 0.03 * s, '#1e2228'); break;
    case 'brodie': P.ell(hx, hy - hr * 0.55, hr * 1.75, hr * 0.32, figGrad(P, hy - hr, hy, '#6f7450', 0.2)); P.ell(hx, hy - hr * 0.75, hr * 1.0, hr * 0.62, figGrad(P, hy - hr, hy, '#6f7450', 0.2)); break;
    case 'topper': P.ell(hx, hy - hr * 0.6, hr * 1.55, hr * 0.28, '#16181c'); P.poly([[hx - hr * 0.85, hy - hr * 0.6], [hx - hr * 0.8, hy - hr * 1.9], [hx + hr * 0.8, hy - hr * 1.9], [hx + hr * 0.85, hy - hr * 0.6]], '#16181c'); P.rect(hx - hr * 0.84, hy - hr * 0.95, hr * 1.68 / P.u * P.u, hr * 0.22, P.col, false); break;
    case 'beret': P.ell(hx - hr * 0.2, hy - hr * 0.8, hr * 1.2, hr * 0.5, P.col, undefined, -0.2); break;
    case 'turban': P.ell(hx, hy - hr * 0.75, hr * 1.15, hr * 0.7, '#f2ead6'); P.line([[hx - hr * 0.9, hy - hr * 0.6], [hx + hr * 0.9, hy - hr * 1.0]], 0.035 * s, P.col, false); P.ell(hx, hy - hr * 1.15, hr * 0.22, hr * 0.22, P.col); break;
    case 'goggles': P.ell(hx, hy - hr * 0.7, hr * 1.05, hr * 0.55, '#4a3a2a'); P.line([[hx - hr, hy - hr * 0.55], [hx + hr, hy - hr * 0.55]], 0.03 * s, '#2a2018', false); P.ell(hx + hr * 0.45, hy - hr * 0.62, hr * 0.32, hr * 0.28, '#9fd0e0'); break;
    default: break;
  }
}
function paintShield(P, kind, sx, sy, s) {
  const g = figGrad(P, sy - 0.2 * s, sy + 0.2 * s, P.col, 0.22);
  if (kind === 'round') { P.ell(sx, sy, 0.16 * s, 0.16 * s, g); P.ell(sx, sy, 0.045 * s, 0.045 * s, '#d9c79a'); P.line([[sx, sy - 0.15 * s], [sx, sy + 0.15 * s]], 0.02 * s, P.dark, false); }
  else if (kind === 'scutum') { P.poly([[sx - 0.13 * s, sy - 0.24 * s], [sx + 0.13 * s, sy - 0.24 * s], [sx + 0.14 * s, sy + 0.2 * s], [sx - 0.14 * s, sy + 0.2 * s]], g); P.ell(sx, sy - 0.02 * s, 0.045 * s, 0.045 * s, '#e3c56a'); }
  else if (kind === 'kite') { P.poly([[sx - 0.13 * s, sy - 0.18 * s], [sx + 0.13 * s, sy - 0.18 * s], [sx + 0.11 * s, sy + 0.04 * s], [sx, sy + 0.24 * s], [sx - 0.11 * s, sy + 0.04 * s]], g); P.line([[sx, sy - 0.16 * s], [sx, sy + 0.18 * s]], 0.03 * s, '#efe4c4', false); P.line([[sx - 0.1 * s, sy - 0.07 * s], [sx + 0.1 * s, sy - 0.07 * s]], 0.03 * s, '#efe4c4', false); }
}
// Things held in the right hand at (hx,hy)
function paintHeld(P, w, hx, hy, s, sp) {
  const S = v => v * s;
  switch (w) {
    case 'club': P.line([[hx - S(0.02), hy + S(0.08)], [hx + S(0.1), hy - S(0.3)]], 0.07 * s, WOOD); P.ell(hx + S(0.11), hy - S(0.32), S(0.07), S(0.09), WOOD, undefined, 0.3); break;
    case 'spear': case 'pike': case 'javelin': {
      const top = w === 'pike' ? -0.98 : w === 'javelin' ? -0.6 : -0.78, bot = w === 'pike' ? 0.46 : 0.42;
      P.line([[hx, hy + S(bot)], [hx + S(0.02), hy + S(top)]], 0.035 * s, WOOD);
      P.poly([[hx + S(0.02), hy + S(top - 0.17)], [hx + S(0.065), hy + S(top + 0.01)], [hx - S(0.025), hy + S(top + 0.01)]], METAL);
      if (w === 'pike') P.line([[hx - S(0.03), hy + S(top + 0.06)], [hx + S(0.07), hy + S(top + 0.06)]], 0.02 * s, METAL_D, false); break; }
    case 'sword': P.line([[hx, hy], [hx + S(0.05), hy - S(0.38)]], 0.045 * s, '#dfe4ea'); P.line([[hx - S(0.07), hy - S(0.03)], [hx + S(0.07), hy - S(0.03)]], 0.035 * s, '#b8913a'); break;
    case 'greatsword': P.line([[hx - S(0.06), hy + S(0.12)], [hx + S(0.12), hy - S(0.56)]], 0.055 * s, '#e4e8ee'); P.line([[hx - S(0.07), hy - S(0.02)], [hx + S(0.11), hy + S(0.03)]], 0.04 * s, '#b8913a'); P.line([[hx - S(0.065), hy + S(0.05)], [hx - S(0.09), hy + S(0.14)]], 0.04 * s, WOOD_D); break;
    case 'bow': { const x = P.x, u = P.u; x.beginPath(); x.arc((hx - S(0.08)) * u, (hy - S(0.06)) * u, S(0.34) * u, -1.15, 1.15);
      x.strokeStyle = FIG_INK; x.lineWidth = 0.05 * s * u + P.lw * 2; x.stroke(); x.strokeStyle = WOOD; x.lineWidth = 0.05 * s * u; x.stroke();
      const a0 = [hx - S(0.08) + Math.cos(-1.15) * S(0.34), hy - S(0.06) + Math.sin(-1.15) * S(0.34)], a1 = [hx - S(0.08) + Math.cos(1.15) * S(0.34), hy - S(0.06) + Math.sin(1.15) * S(0.34)];
      P.line([a0, [hx - S(0.02), hy - S(0.06)], a1], 0.012 * s, '#f2ead8', false); break; }
    case 'crossbow': P.line([[hx - S(0.12), hy + S(0.02)], [hx + S(0.2), hy - S(0.06)]], 0.05 * s, WOOD); { const x = P.x, u = P.u; x.beginPath(); x.arc((hx + S(0.08)) * u, (hy + S(0.08)) * u, S(0.17) * u, -2.4, -0.7); x.strokeStyle = FIG_INK; x.lineWidth = 0.045 * s * u + P.lw * 2; x.stroke(); x.strokeStyle = METAL_D; x.lineWidth = 0.045 * s * u; x.stroke(); } break;
    case 'musket': case 'rifle':
      P.line([[hx - S(0.06), hy + S(0.18)], [hx + S(0.06), hy - S(0.58)]], 0.045 * s, WOOD);
      P.line([[hx + S(0.03), hy - S(0.38)], [hx + S(0.065), hy - S(0.62)]], 0.025 * s, '#4a4e56', false);
      if (w === 'rifle') P.line([[hx + S(0.065), hy - S(0.62)], [hx + S(0.08), hy - S(0.74)]], 0.018 * s, METAL, false); break;
    case 'hammer': P.line([[hx, hy + S(0.05)], [hx + S(0.08), hy - S(0.3)]], 0.04 * s, WOOD); P.poly([[hx + S(0.0), hy - S(0.36)], [hx + S(0.17), hy - S(0.32)], [hx + S(0.16), hy - S(0.25)], [hx - S(0.01), hy - S(0.29)]], METAL_D); break;
    case 'spyglass': P.line([[hx - S(0.02), hy], [hx + S(0.2), hy - S(0.22)]], 0.05 * s, '#b8913a'); P.line([[hx + S(0.12), hy - S(0.14)], [hx + S(0.24), hy - S(0.26)]], 0.065 * s, '#8a6a2a'); break;
    case 'book': P.rect(hx - S(0.05), hy - S(0.12), S(0.15), S(0.18), P.col); P.rect(hx - S(0.03), hy - S(0.1), S(0.11), S(0.14), '#f4ecd8', false); P.line([[hx + S(0.025), hy - S(0.1)], [hx + S(0.025), hy + S(0.04)]], 0.012 * s, '#8a7a5a', false); break;
    case 'lantern': P.line([[hx, hy], [hx, hy + S(0.08)]], 0.015 * s, '#2a2a2a'); { const g = P.x.createRadialGradient(hx * P.u, (hy + S(0.16)) * P.u, 0, hx * P.u, (hy + S(0.16)) * P.u, S(0.22) * P.u); g.addColorStop(0, 'rgba(255,200,90,.7)'); g.addColorStop(1, 'rgba(255,200,90,0)'); P.x.fillStyle = g; P.x.beginPath(); P.x.arc(hx * P.u, (hy + S(0.16)) * P.u, S(0.22) * P.u, 0, 6.283); P.x.fill(); }
      P.rect(hx - S(0.05), hy + S(0.08), S(0.1), S(0.14), '#ffd27a'); break;
    case 'staff': P.line([[hx, hy + S(0.46)], [hx + S(0.02), hy - S(0.5)]], 0.04 * s, '#9a7a4a'); P.ell(hx + S(0.02), hy - S(0.54), S(0.06), S(0.06), '#ffe39a'); break;
    case 'dagger': P.line([[hx, hy], [hx + S(0.1), hy - S(0.14)]], 0.03 * s, '#dfe4ea'); break;
    case 'flask': P.poly([[hx - S(0.03), hy - S(0.2)], [hx + S(0.03), hy - S(0.2)], [hx + S(0.03), hy - S(0.12)], [hx + S(0.1), hy + S(0.02)], [hx - S(0.1), hy + S(0.02)], [hx - S(0.03), hy - S(0.12)]], '#d8eef4');
      P.poly([[hx - S(0.07), hy - S(0.03)], [hx + S(0.07), hy - S(0.03)], [hx + S(0.095), hy + S(0.015)], [hx - S(0.095), hy + S(0.015)]], '#5fe0a0', false); break;
    case 'wrench': P.line([[hx, hy + S(0.04)], [hx + S(0.1), hy - S(0.24)]], 0.04 * s, METAL); { P.x.beginPath(); P.x.arc((hx + S(0.11)) * P.u, (hy - S(0.28)) * P.u, S(0.06) * P.u, 0.6, 5.2); P.x.strokeStyle = FIG_INK; P.x.lineWidth = 0.035 * s * P.u + P.lw * 2; P.x.stroke(); P.x.strokeStyle = METAL; P.x.lineWidth = 0.035 * s * P.u; P.x.stroke(); }
      paintGear(P, hx - S(0.3), hy + S(0.32), S(0.1)); break;
    case 'coins': P.ell(hx + S(0.02), hy + S(0.06), S(0.09), S(0.1), '#a07a3a'); P.line([[hx - S(0.03), hy - S(0.03)], [hx + S(0.07), hy - S(0.03)]], 0.02 * s, '#e3c56a', false); P.ell(hx + S(0.12), hy - S(0.12), S(0.04), S(0.04), '#f2d264'); break;
    case 'brush': P.line([[hx, hy + S(0.02)], [hx + S(0.1), hy - S(0.22)]], 0.025 * s, WOOD); P.ell(hx + S(0.11), hy - S(0.25), S(0.025), S(0.04), '#d84a4a');
      P.ell(-0.24 * s + hx - S(0.24), hy + S(0.0), S(0.13), S(0.09), '#e8d5ac'); for (const [a, b, c] of [[-0.08, -0.03, '#d84a4a'], [0.0, -0.05, '#4a8ad8'], [0.06, 0.0, '#f2d264']]) P.ell(hx - S(0.48) + S(a), hy + S(b), S(0.025), S(0.025), c, false); break;
    default: break;
  }
}
function paintGear(P, cx, cy, r) {
  const x = P.x, u = P.u; x.beginPath();
  for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, rr = i % 2 ? r * 0.72 : r; x.lineTo((cx + Math.cos(a) * rr) * u, (cy + Math.sin(a) * rr) * u); }
  x.closePath(); figFill(P, '#b8913a'); P.ell(cx, cy, r * 0.3, r * 0.3, '#3a2a1c', false);
}

function paintHorse(P, sp) {
  const coat = sp.coat, dk = shade(coat, -0.28), x = P.x, u = P.u;
  // legs (far pair darker)
  P.line([[-0.24, -0.36], [-0.27, -0.02]], 0.06, dk); P.line([[0.22, -0.36], [0.26, -0.02]], 0.06, dk);
  P.line([[-0.32, -0.36], [-0.36, -0.02]], 0.065, coat); P.line([[0.3, -0.36], [0.32, -0.02]], 0.065, coat);
  // body, neck, head
  P.ell(0, -0.48, 0.42, 0.17, figGrad(P, -0.65, -0.3, coat, 0.15));
  P.poly([[0.22, -0.58], [0.38, -0.86], [0.48, -0.9], [0.44, -0.62], [0.36, -0.42]], coat);
  P.poly([[0.38, -0.92], [0.62, -0.78], [0.62, -0.7], [0.46, -0.72], [0.4, -0.66]], coat);
  P.line([[0.26, -0.62], [0.38, -0.88], [0.42, -0.96]], 0.05, shade(coat, -0.45), false); // mane
  P.line([[-0.4, -0.54], [-0.52, -0.32]], 0.06, shade(coat, -0.45)); // tail
  x.fillStyle = '#16100a'; x.beginPath(); x.arc(0.5 * u, -0.8 * u, Math.max(0.6, 0.018 * u), 0, 6.283); x.fill();
  if (sp.barding) { // civ-coloured caparison
    P.poly([[-0.36, -0.6], [0.24, -0.62], [0.3, -0.36], [0.16, -0.3], [0.0, -0.36], [-0.16, -0.3], [-0.32, -0.36]], figGrad(P, -0.62, -0.3, P.col, 0.15));
    P.line([[-0.32, -0.38], [0.28, -0.38]], 0.025, '#efe0b8', false);
  } else { P.poly([[-0.14, -0.64], [0.12, -0.64], [0.1, -0.46], [-0.12, -0.46]], P.col); }
  // rider
  paintFoot(P, sp.rider, -0.02, -0.28, 0.82, true);
  const hx = -0.02 + 0.245 * 0.82, hy = -0.28 - 0.48 * 0.82;
  if (sp.w === 'lance') { P.line([[hx - 0.38, hy + 0.12], [hx + 0.44, hy - 0.46]], 0.035, '#d9c9a0'); P.poly([[hx + 0.5, hy - 0.52], [hx + 0.39, hy - 0.46], [hx + 0.45, hy - 0.4]], METAL); P.poly([[hx + 0.26, hy - 0.33], [hx + 0.38, hy - 0.42], [hx + 0.36, hy - 0.3]], P.col, false); }
  else if (sp.w === 'javelin') { P.line([[hx - 0.04, hy + 0.2], [hx + 0.08, hy - 0.48]], 0.03, WOOD); P.poly([[hx + 0.09, hy - 0.6], [hx + 0.12, hy - 0.46], [hx + 0.05, hy - 0.47]], METAL); }
  else if (sp.w === 'banner') { P.line([[hx, hy + 0.2], [hx + 0.02, hy - 0.66]], 0.03, '#d9c9a0'); P.poly([[hx + 0.02, hy - 0.66], [hx + 0.34, hy - 0.6], [hx + 0.26, hy - 0.5], [hx + 0.34, hy - 0.4], [hx + 0.02, hy - 0.42]], P.col); P.ell(hx + 0.13, hy - 0.53, 0.035, 0.035, '#f2d264', false); }
  if (sp.sh) paintShield(P, sp.sh, -0.02 - 0.2 * 0.82, -0.28 - 0.5 * 0.82, 0.8);
}

function paintWheel(P, cx, cy, r, col) {
  P.ell(cx, cy, r, r, col || WOOD);
  P.ell(cx, cy, r * 0.62, r * 0.62, shade(col || WOOD, -0.25), false);
  P.line([[cx - r * 0.7, cy], [cx + r * 0.7, cy]], 0.018, shade(col || WOOD, 0.2), false); P.line([[cx, cy - r * 0.7], [cx, cy + r * 0.7]], 0.018, shade(col || WOOD, 0.2), false);
  P.ell(cx, cy, r * 0.2, r * 0.2, METAL_D, false);
}
function paintSiege(P, gun) {
  // a little crewman stands behind every gun so siege units read as units, not scenery
  const crew = { body: gun === 'fieldgun' ? 'uniform' : gun === 'catapult' ? 'tunic' : 'coat', cloth: gun === 'fieldgun' ? '#6b7046' : gun === 'catapult' ? '#8a6a44' : 'civ', legs: '#3f3a32', trim: gun === 'catapult' ? 'sash' : 'collar',
    head: gun === 'fieldgun' ? 'brodie' : gun === 'catapult' ? 'cap' : gun === 'artillery' ? 'shako' : 'tricorn' };
  paintFoot(P, crew, -0.46, -0.02, 0.72);
  if (gun === 'catapult') {
    P.poly([[-0.34, -0.2], [0.42, -0.2], [0.42, -0.12], [-0.34, -0.12]], WOOD);
    P.poly([[0.0, -0.2], [0.12, -0.52], [0.2, -0.52], [0.16, -0.2]], WOOD_D);
    P.line([[0.4, -0.2], [-0.24, -0.78]], 0.05, WOOD); P.ell(-0.28, -0.82, 0.09, 0.06, LEATHER); P.ell(-0.28, -0.88, 0.06, 0.06, '#8a8680');
    P.line([[0.14, -0.5], [0.08, -0.4]], 0.03, P.col, false);
    paintWheel(P, -0.22, -0.1, 0.11); paintWheel(P, 0.3, -0.1, 0.11);
  } else if (gun === 'cannon' || gun === 'drake') {
    P.poly([[-0.3, -0.12], [0.2, -0.22], [0.26, -0.14], [-0.24, -0.04]], WOOD);
    const bc = gun === 'drake' ? '#a5452e' : '#b48a3c';
    P.poly([[-0.18, -0.26], [0.5, -0.42], [0.53, -0.32], [-0.16, -0.12]], figGrad(P, -0.42, -0.12, bc, 0.25));
    P.ell(-0.18, -0.19, 0.07, 0.08, bc);
    if (gun === 'drake') { P.poly([[0.48, -0.46], [0.66, -0.48], [0.6, -0.38], [0.66, -0.3], [0.5, -0.3]], '#c95a36'); P.ell(0.56, -0.44, 0.015, 0.015, '#ffd84a', false); }
    else P.ell(0.52, -0.37, 0.04, 0.055, '#2a2018');
    P.line([[0.0, -0.22], [0.1, -0.24]], 0.04, P.col, false);
    paintWheel(P, 0.02, -0.12, 0.13);
  } else if (gun === 'artillery' || gun === 'fieldgun') {
    const steel = gun === 'fieldgun' ? '#5e6448' : '#5a5e66';
    P.line([[-0.38, -0.02], [0.0, -0.18]], 0.05, shade(steel, -0.2));
    P.poly([[-0.1, -0.3], [0.62, -0.5], [0.64, -0.44], [-0.08, -0.2]], figGrad(P, -0.5, -0.2, steel, 0.25));
    if (gun === 'fieldgun') P.poly([[0.02, -0.5], [0.16, -0.54], [0.2, -0.16], [0.06, -0.12]], figGrad(P, -0.54, -0.12, steel, 0.2));
    P.poly([[0.04, -0.4], [0.14, -0.42], [0.15, -0.34], [0.05, -0.32]], P.col, false);
    paintWheel(P, 0.08, -0.14, 0.15, gun === 'fieldgun' ? '#3a3c34' : '#6a4a2a');
  }
}
function paintTank(P) {
  const hull = '#6b6e4c';
  P.poly([[-0.62, -0.08], [-0.66, -0.3], [-0.5, -0.46], [0.5, -0.46], [0.68, -0.3], [0.62, -0.08], [0.5, 0.0], [-0.5, 0.0]], '#3a3a30');
  for (let i = -4; i <= 4; i++) P.ell(i * 0.12, -0.08, 0.05, 0.05, '#55574a', false);
  P.poly([[-0.5, -0.44], [0.48, -0.44], [0.56, -0.3], [-0.56, -0.3]], figGrad(P, -0.44, -0.3, hull, 0.2));
  P.poly([[-0.3, -0.44], [-0.22, -0.66], [0.2, -0.66], [0.28, -0.44]], figGrad(P, -0.66, -0.44, hull, 0.25));
  P.line([[0.2, -0.58], [0.72, -0.62]], 0.06, '#4f5238');
  P.poly([[-0.48, -0.42], [-0.32, -0.42], [-0.32, -0.32], [-0.48, -0.32]], P.col, false); // civ insignia
  P.ell(-0.4, -0.37, 0.03, 0.03, '#f2ecdc', false);
  P.line([[-0.1, -0.66], [-0.12, -0.84]], 0.02, '#2a2a2a', false); P.poly([[-0.12, -0.84], [0.06, -0.8], [-0.11, -0.76]], P.col, false);
}
function paintSea(P) { // little bow wave so ships sit in the water
  P.x.fillStyle = 'rgba(230,245,255,.55)'; P.x.beginPath(); P.x.ellipse(0, 0.0, 0.72 * P.u, 0.06 * P.u, 0, 0, 6.283); P.x.fill();
}
function paintShip(P, hull) {
  const u = P.u, x = P.x;
  paintSea(P);
  const sail = (pts, col) => P.poly(pts, col || '#f2ead6');
  if (hull === 'galley' || hull === 'reef' || hull === 'bireme') {
    const wood = hull === 'reef' ? '#9a5a4a' : WOOD;
    for (let i = -3; i <= 3; i++) P.line([[i * 0.15, -0.14], [i * 0.15 - 0.08, 0.04]], 0.022, '#c9a46a');
    P.poly([[-0.66, -0.26], [0.6, -0.26], [0.72, -0.36], [0.52, -0.06], [-0.5, -0.06]], figGrad(P, -0.3, -0.06, wood, 0.2));
    if (hull === 'bireme') P.poly([[0.6, -0.12], [0.8, -0.1], [0.62, -0.06]], METAL_D);
    if (hull === 'reef') P.line([[-0.5, 0.06], [0.5, 0.06]], 0.035, '#c98a6a');
    P.line([[0, -0.26], [0, -0.98]], 0.035, WOOD_D);
    const sc = hull === 'reef' ? '#ffb4a6' : '#f2ead6';
    sail([[-0.3, -0.92], [0.3, -0.92], [0.34, -0.4], [-0.34, -0.4]], sc);
    x.save(); x.beginPath(); x.rect(-0.34 * u, -0.92 * u, 0.68 * u, 0.52 * u); x.clip();
    x.fillStyle = P.col; for (let i = 0; i < 3; i++) x.fillRect((-0.3 + i * 0.22) * u, -0.92 * u, 0.1 * u, 0.52 * u); x.restore();
    P.x.strokeStyle = FIG_INK; P.x.lineWidth = P.lw; P.x.strokeRect(-0.3 * u, -0.92 * u, 0.6 * u, 0.52 * u);
  } else if (hull === 'caravel') {
    P.poly([[-0.62, -0.32], [-0.5, -0.4], [0.48, -0.3], [0.7, -0.4], [0.5, -0.02], [-0.48, -0.02]], figGrad(P, -0.4, -0.02, WOOD, 0.2));
    P.line([[-0.2, -0.32], [-0.2, -1.0]], 0.03, WOOD_D); P.line([[0.22, -0.3], [0.22, -0.88]], 0.03, WOOD_D);
    sail([[-0.2, -1.0], [-0.2, -0.4], [-0.56, -0.44]]); sail([[0.22, -0.88], [0.22, -0.38], [0.54, -0.42]]);
    P.ell(-0.33, -0.58, 0.05, 0.06, P.col, false); P.ell(0.33, -0.52, 0.05, 0.06, P.col, false);
    P.poly([[-0.2, -1.0], [-0.04, -0.96], [-0.2, -0.92]], P.col, false);
  } else if (hull === 'frigate' || hull === 'corsair') {
    const sc = hull === 'corsair' ? '#2c2c30' : '#f2ead6';
    P.poly([[-0.7, -0.34], [-0.56, -0.44], [0.54, -0.36], [0.76, -0.42], [0.54, -0.02], [-0.52, -0.02]], figGrad(P, -0.44, -0.02, '#5a3a22', 0.2));
    P.line([[-0.56, -0.2], [0.56, -0.2]], 0.05, P.col, false);
    for (let i = -3; i <= 3; i++) P.rect(i * 0.14 - 0.025, -0.24, 0.05, 0.05, '#1a120a', false);
    for (const mx of [-0.34, 0.06, 0.4]) { const top = mx === 0.06 ? -1.12 : -0.98; P.line([[mx, -0.36], [mx, top]], 0.03, WOOD_D);
      sail([[mx - 0.16, top + 0.08], [mx + 0.16, top + 0.08], [mx + 0.18, top + 0.3], [mx - 0.18, top + 0.3]], sc); sail([[mx - 0.2, top + 0.34], [mx + 0.2, top + 0.34], [mx + 0.22, -0.46], [mx - 0.22, -0.46]], sc); }
    P.poly([[0.06, -1.12], [0.26, -1.08], [0.06, -1.03]], P.col, false);
    if (hull === 'corsair') { x.fillStyle = '#f2ecdc'; x.beginPath(); x.arc(0.06 * u, -0.66 * u, 0.06 * u, 0, 6.283); x.fill(); }
  } else if (hull === 'ironclad') {
    P.poly([[-0.72, -0.2], [0.6, -0.2], [0.76, -0.24], [0.6, 0.0], [-0.62, 0.0]], figGrad(P, -0.24, 0, '#4a4e56', 0.2));
    P.poly([[-0.36, -0.2], [-0.3, -0.38], [0.26, -0.38], [0.32, -0.2]], figGrad(P, -0.38, -0.2, '#5c606a', 0.25));
    P.rect(-0.08, -0.72, 0.12, 0.34, '#2c2c30'); P.rect(-0.08, -0.66, 0.12, 0.06, P.col, false);
    x.fillStyle = 'rgba(70,70,76,.55)'; for (let i = 0; i < 3; i++) { x.beginPath(); x.arc((-0.06 - i * 0.12) * u, (-0.82 - i * 0.08) * u, (0.06 + i * 0.025) * u, 0, 6.283); x.fill(); }
    P.line([[0.3, -0.3], [0.5, -0.32]], 0.04, '#2a2a30');
    P.line([[-0.5, -0.2], [-0.5, -0.56]], 0.02, '#2a2a30'); P.poly([[-0.5, -0.56], [-0.32, -0.52], [-0.5, -0.47]], P.col, false);
  } else if (hull === 'destroyer') {
    P.poly([[-0.78, -0.22], [0.62, -0.22], [0.84, -0.3], [0.66, 0.0], [-0.68, 0.0]], figGrad(P, -0.3, 0, '#6a7480', 0.18));
    P.line([[-0.7, -0.1], [0.66, -0.1]], 0.025, P.col, false);
    P.poly([[-0.24, -0.22], [-0.2, -0.46], [0.22, -0.46], [0.26, -0.22]], '#7c8692');
    P.rect(-0.12, -0.62, 0.14, 0.18, '#555c66'); P.rect(-0.12, -0.6, 0.14, 0.04, P.col, false);
    P.line([[0.12, -0.46], [0.12, -0.84]], 0.02, '#3a3f46'); P.line([[0.04, -0.74], [0.2, -0.74]], 0.02, '#3a3f46', false);
    P.ell(0.44, -0.28, 0.07, 0.05, '#555c66'); P.line([[0.44, -0.3], [0.66, -0.34]], 0.025, '#3a3f46');
    P.ell(-0.48, -0.28, 0.07, 0.05, '#555c66'); P.line([[-0.48, -0.3], [-0.7, -0.34]], 0.025, '#3a3f46');
  }
}
function paintWagon(P) {
  // settlers: a covered wagon pulled by an ox, a family walking alongside
  P.line([[0.3, -0.24], [0.5, -0.24]], 0.03, WOOD_D);
  P.ell(0.62, -0.32, 0.17, 0.11, '#8a6a4a'); P.ell(0.78, -0.38, 0.07, 0.06, '#8a6a4a'); P.line([[0.5, -0.24], [0.5, -0.04]], 0.045, '#6a4a2a'); P.line([[0.72, -0.24], [0.72, -0.04]], 0.045, '#6a4a2a');
  P.line([[0.74, -0.44], [0.7, -0.5]], 0.02, '#efe4cc', false);
  P.rect(-0.46, -0.36, 0.78, 0.14, WOOD);
  P.x.beginPath(); P.x.moveTo(-0.44 * P.u, -0.36 * P.u); P.x.bezierCurveTo(-0.44 * P.u, -0.86 * P.u, 0.3 * P.u, -0.86 * P.u, 0.3 * P.u, -0.36 * P.u); P.x.closePath(); figFill(P, figGrad(P, -0.8, -0.36, '#efe6d0', 0.12));
  P.line([[-0.2, -0.72], [-0.2, -0.38]], 0.02, '#c9bc9c', false); P.line([[0.06, -0.72], [0.06, -0.38]], 0.02, '#c9bc9c', false);
  P.line([[-0.42, -0.42], [0.28, -0.42]], 0.04, P.col, false);
  paintWheel(P, -0.3, -0.12, 0.12); paintWheel(P, 0.18, -0.12, 0.12);
  paintFoot(P, { body: 'tunic', cloth: '#9a7a50', legs: '#5a4630', trim: 'sash', head: 'wide' }, -0.62, 0.0, 0.7);
}
function paintCamel(P) {
  const c = '#c9a46a', d = shade(c, -0.25);
  P.line([[-0.22, -0.36], [-0.26, -0.02]], 0.05, d); P.line([[0.18, -0.36], [0.22, -0.02]], 0.05, d);
  P.line([[-0.3, -0.36], [-0.32, -0.02]], 0.055, c); P.line([[0.26, -0.36], [0.28, -0.02]], 0.055, c);
  P.ell(0, -0.46, 0.36, 0.14, figGrad(P, -0.6, -0.32, c, 0.15));
  P.ell(-0.06, -0.6, 0.16, 0.12, c);
  P.poly([[0.28, -0.5], [0.42, -0.72], [0.56, -0.74], [0.56, -0.66], [0.44, -0.64], [0.36, -0.42]], c);
  // packs in civ colours
  P.rect(-0.3, -0.7, 0.2, 0.2, P.col); P.rect(0.0, -0.72, 0.18, 0.22, '#c98a4a'); P.line([[-0.32, -0.6], [0.2, -0.6]], 0.02, '#efe4cc', false);
  P.ell(0.5, -0.71, 0.012, 0.012, '#16100a', false);
  paintFoot(P, { body: 'robe', cloth: '#e6d8b8', trim: 'sash', head: 'turban' }, 0.7, 0.0, 0.66);
}
