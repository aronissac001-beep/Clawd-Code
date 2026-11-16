'use strict';
// ============================================================================
// ZONEFALL — art module A: human characters (layered gear), beasts, weapons
// and FX sprites. Everything is hand-placed pixel code at ART resolution,
// lit from the top-left, outlined with ART.PAL.black. Facing right is the
// authored direction; left-facing frames are mirrored copies.
// ============================================================================
(function () {
  const P = ART.PAL;
  const INK = P.black, WARM = '#fff1cf', COOL = '#262b44';
  // 4-step ramp with hue shifting: warm highlights, cool purple-ish shadows.
  const rampCache = {};
  function T(c) {
    if (rampCache[c]) return rampCache[c];
    return (rampCache[c] = { l: ART.mix(c, WARM, 0.24), b: c, d: ART.mix(c, COOL, 0.36), k: ART.mix(c, INK, 0.6) });
  }
  function X(g, x, y, c) { if (!c) return; g.fillStyle = c; g.fillRect(x, y, 1, 1); }
  function R(g, x, y, w, h, c) { if (!c || w <= 0 || h <= 0) return; g.fillStyle = c; g.fillRect(x, y, w, h); }
  // paint a char template at (x,y); '.'/' ' skip, '_' erases
  function stamp(g, x, y, rows, map) {
    for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) {
      const ch = rows[j][i]; if (ch === '.' || ch === ' ') continue;
      if (ch === '_') { g.clearRect(x + i, y + j, 1, 1); continue; }
      const c = map[ch]; if (c) { g.fillStyle = c; g.fillRect(x + i, y + j, 1, 1); }
    }
  }
  const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + (s | 0) * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  function rotCCW(src) { // pixel-exact 90deg counter-clockwise
    const [c, g] = ART.canvas(src.height, src.width);
    g.translate(0, src.width); g.rotate(-Math.PI / 2); g.drawImage(src, 0, 0); return c;
  }
  function flipY(src) { const [c, g] = ART.canvas(src.width, src.height); g.translate(0, src.height); g.scale(1, -1); g.drawImage(src, 0, 0); return c; }
  function crop(src) { // crop to opaque bounds
    const d = src.getContext('2d').getImageData(0, 0, src.width, src.height).data;
    let x0 = src.width, y0 = src.height, x1 = -1, y1 = -1;
    for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) if (d[(y * src.width + x) * 4 + 3] > 0) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return src;
    const [c, g] = ART.canvas(x1 - x0 + 1, y1 - y0 + 1); g.drawImage(src, -x0, -y0); return c;
  }
  const OL = (c) => ART.outline(c, INK);
  const flash = (inner) => OL(ART.silhouette(inner, '#ffffff'));
  function mirrorSet(set) {
    const o = {};
    for (const k in set) o[k] = Array.isArray(set[k]) ? set[k].map(ART.flipX.bind(ART)) : ART.flipX(set[k]);
    if (set.dead) { o.dead.ox = set.dead.width - 1 - set.dead.ox; o.dead.oy = set.dead.oy; }
    return o;
  }

  // ==========================================================================
  // HUMANS
  // ==========================================================================
  const DEF = {
    skin: P.skin, hair: '#4a3328', hairStyle: 'short', top: '#8a7a55', pants: '#3e4250', boots: '#3a2a26',
    vest: null, helmet: null, helmetCol: null, bag: null, big: false,
  };
  const HELM_COL = {
    cap: '#5b6b3a', bucket: '#8d97a6', gas: '#3d4239', riot: '#323a58', mil: '#56633b', hood: null,
    bandana: '#b8303a', balaclava: '#34312f', boss: '#2e2f3c',
  };
  const BAG_COL = { small: '#7a5a3a', ruck: '#6b5d45', mil: '#4f5c35' };

  // Look presets — each reads differently at a glance (silhouette + colour).
  ART.LOOKS = {
    player: { skin: '#e2ab84', hair: '#5a3a26', hairStyle: 'short', top: '#a38d5c', pants: '#3b4052', boots: '#3e2731', gloves: '#4a3a2e' },
    scav: { skin: '#d3a07c', hair: '#3e3028', top: '#6e553e', pants: '#5a5141', boots: '#3a2c26', helmet: 'hood', helmetCol: '#8a7156', tatter: true },
    bandit: { skin: '#c8906c', hair: '#1f1a20', hairStyle: 'short', top: '#2e2a36', pants: '#3a4262', boots: '#221c22', helmet: 'bandana', leather: true },
    soldier: { skin: '#d9a27e', hair: '#3a2a20', top: '#5a6739', camo: '#3c4a28', pants: '#4f5935', boots: '#24211f', vest: '#6e6044', helmet: 'mil', gloves: '#2c2b26', bag: 'small', bagCol: '#4a5532' },
    thug: { skin: '#c88a66', top: '#a8502a', pants: '#56413a', boots: '#2e2420', helmet: 'balaclava', tatter: true, stripe: '#6b2c22' },
    gunner: { skin: '#d8a07a', hair: '#6b3d22', hairStyle: 'long', top: '#7c5a3a', pants: '#4a3e36', boots: '#2c2420', helmet: 'cap', helmetCol: '#b4492e', vest: '#7a7266' },
    breacher: { skin: '#d49a74', top: '#d27a32', stripe: '#fee761', pants: '#4b4038', boots: '#2c2420', helmet: 'bucket', bag: 'small', bagCol: '#6e5134', gloves: '#3a3028' },
    brute: { big: true, skin: '#c8906c', top: '#4d3c32', pants: '#3b3532', boots: '#221e1e', vest: '#68707e', helmet: 'riot', gloves: '#262428' },
    rocketeer: { skin: '#d8a07a', hair: '#2e2420', top: '#6e4277', pants: '#3e3448', boots: '#241e26', helmet: 'gas', bag: 'mil', bagCol: '#566338', tatter: true },
    warlord: { big: true, skin: '#c8906c', top: '#4a1f28', pants: '#28252e', boots: '#1c1a20', vest: '#30303e', helmet: 'boss', helmetCol: '#2a2a36', visor: '#ff3344', trim: '#8a2a34', gloves: '#1e1c24', cape: '#6e1f2a' },
    ironjack: { big: true, skin: '#c8906c', top: '#3a4152', pants: '#2e3442', boots: '#1e2028', vest: '#6c7890', helmet: 'boss', helmetCol: '#5f6b82', visor: '#5ae0ff', trim: '#d8a03a', gloves: '#2a2e38' },
  };

  // body geometry (inner, pre-outline coordinates)
  function geom(big) {
    return big
      ? { W: 20, H: 23, hx: 7, hy: 3, tx: 5, ty: 9, tw: 9, th: 7, legW: 3, foot: 22, hips: [6, 10], cx: 9 }
      : { W: 16, H: 20, hx: 5, hy: 2, tx: 4, ty: 8, tw: 7, th: 6, legW: 2, foot: 19, hips: [5, 8], cx: 7 };
  }

  const camoAt = (x, y) => hash((x + (y >> 1)) >> 1, y >> 1, 77) < 0.3;

  function drawLeg(g, L, hip, top, foot, leg, w, front) {
    const Pt = T(L.pants), Bt = T(L.boots);
    const dx = leg.dx || 0, lift = leg.lift || 0;
    const fy = foot - lift, bt = fy - 1, n = bt - top;
    for (let i = 0; i < n; i++) {
      const y = top + i, x = hip + Math.round(dx * (i + 1) / (n + 1)) + (lift && i === n - 1 ? (dx >= 0 ? 1 : 0) : 0);
      for (let k = 0; k < w; k++) {
        let c = front ? (k === w - 1 ? Pt.d : Pt.b) : (k === w - 1 ? Pt.k : Pt.d);
        if (front && k === 0 && i === 0) c = Pt.l;
        if (L.camo && front && k < w - 1 && camoAt(x + k + 3, i)) c = T(L.camo).b;
        X(g, x + k, y, c);
      }
    }
    const bx = hip + dx + (lift ? (dx >= 0 ? 1 : 0) : 0);
    for (let k = 0; k < w; k++) X(g, bx + k, bt, front ? (k === 0 ? Bt.l : Bt.b) : Bt.d);
    for (let k = 0; k <= w; k++) X(g, bx + k, fy, front ? (k === w ? Bt.d : Bt.b) : Bt.k);
    if (front) X(g, bx + w, fy, Bt.d);
  }

  // horizontal extent [x0, x1] of torso row y (big bodies taper to the waist)
  function span(Gm, y, top, belt) {
    if (y === top) return [Gm.tx + 1, Gm.tx + Gm.tw - 2];
    if (Gm.tw > 7 && y >= belt - 2) return [Gm.tx + 1, Gm.tx + Gm.tw - 2];
    return [Gm.tx, Gm.tx + Gm.tw - 1];
  }
  function drawTorso(g, L, Gm, top, belt) {
    const Tt = T(L.top), { tx, tw } = Gm;
    for (let y = top; y < belt; y++) {
      const [a, z] = span(Gm, y, top, belt);
      for (let x = a; x <= z; x++) {
        let c = Tt.b;
        if (y === top) c = Tt.l;
        else if (x === z || y === belt - 1) c = Tt.d;
        else if (x === a && y > top + 1) c = Tt.d;
        else if (y === top + 1 && x <= a + 1) c = Tt.l;
        if (L.camo && c === Tt.b && camoAt(x, y - top)) c = T(L.camo).b;
        X(g, x, y, c);
      }
    }
    if (!L.vest) { // jacket front: zip line + chest pocket
      const zx = tx + tw - 2;
      for (let y = top + 1; y < belt - 1; y++) X(g, zx, y, Tt.d);
      X(g, tx + 1, top + 3, Tt.d); X(g, tx + 2, top + 3, Tt.d);
    }
    if (L.leather) { X(g, tx + 1, top + 1, Tt.l); X(g, tx + 2, top + 1, ART.mix(Tt.l, '#ffffff', 0.3)); X(g, tx + 1, top + 2, Tt.l); }
    if (L.stripe) { R(g, tx, belt - 2, tw, 1, L.stripe); X(g, tx + tw - 1, belt - 2, ART.mix(L.stripe, COOL, 0.35)); }
    // collar: darker band under the chin
    X(g, Gm.hx + 1, top, Tt.d); X(g, Gm.hx + 2, top, Tt.d); X(g, Gm.hx + 3, top, Tt.b);
    // belt + buckle
    { const [a, z] = span(Gm, belt, top, belt); R(g, a, belt, z - a + 1, 1, '#3a2a28'); X(g, tx + tw - 3, belt, '#b49a62'); }
    if (L.tatter) { // ragged hem hanging over the thighs
      X(g, tx, belt + 1, Tt.d); X(g, tx + 2, belt + 1, Tt.d); X(g, tx + tw - 1, belt + 1, Tt.k);
      X(g, tx, belt, Tt.d); X(g, tx + 1, belt, Tt.b); X(g, tx + tw - 1, belt, Tt.d);
      X(g, tx + 3, top + 2, Tt.k); X(g, tx + 1, belt - 2, Tt.k); // patches/holes
    }
  }

  function drawVest(g, L, Gm, top, belt) {
    const V = T(L.vest), { tx, tw } = Gm;
    const x0 = tx + 1, x1 = tx + tw - 1;
    for (let y = top + 1; y < belt; y++) { const z = span(Gm, y, top, belt)[1]; for (let x = x0; x <= z; x++) {
      let c = V.b;
      if (y === top + 1) c = V.l;
      else if (x === z) c = V.d;
      X(g, x, y, c);
    } }
    // shoulder straps
    X(g, x0, top, V.b); X(g, x0 + 1, top, V.l);
    // molle webbing line + pouches along the bottom
    for (let x = x0; x < x1; x += 2) X(g, x, top + 2, V.d);
    const py = belt - 2;
    for (let x = x0; x + 1 < x1; x += 3) { X(g, x, py, V.l); X(g, x + 1, py, V.b); X(g, x, py + 1, V.d); X(g, x + 1, py + 1, V.k); }
    if (L.trim) R(g, x0, top + 1, x1 - x0, 1, L.trim);
    if (L.big) { // heavy plate: extra highlight ridge
      X(g, x0 + 1, top + 3, V.l); X(g, x0 + 2, top + 3, V.l);
    }
  }

  function drawBag(g, L, Gm, top, phase) {
    const C = T(L.bagCol || BAG_COL[L.bag] || BAG_COL.ruck), tx = Gm.tx;
    const m = { A: C.l, a: C.b, b: C.d, c: C.k, r: '#7c6a4c', R: '#9c8a64', s: '#2a2422', m: '#b49a62' };
    const sw = phase ? 1 : 0; // satchel swings while walking
    if (L.bag === 'small') stamp(g, tx - 2, top + 2 + sw, ['AAa', 'Aab', 'cmb', 'abb', 'bbc'], m);
    else if (L.bag === 'ruck') stamp(g, tx - 3, top - 2, ['.RRr', 'Rrrr', 'AAab', 'Acab', 'Aaab', 'aabb', 'abbc'], m);
    else stamp(g, tx - 4, top - 3, ['.AAa.', 'AAaab', 'Aaaab', 'Aaaab', 'Abccb', 'aAaab', 'aaaab', 'abbbb', 'bbbcc'], m);
  }
  function drawCape(g, L, Gm, top, belt, pose) {
    const C = T(L.cape), x = Gm.tx - 1, bot = belt + 4 + (pose.bob || 0);
    for (let y = top; y <= bot; y++) {
      const t = (y - top) / (bot - top), wv = (pose.swing ? 1 : 0) * (t > 0.6 ? 1 : 0);
      const xa = x - Math.round(t * 2) - wv;
      for (let xx = xa; xx <= x + 2; xx++) X(g, xx, y, xx === xa ? C.b : y === bot ? C.k : C.d);
    }
    X(g, x - 2, bot, null);
  }
  function drawBagStrap(g, L, Gm, top) {
    const C = T(L.bagCol || BAG_COL[L.bag] || BAG_COL.ruck), x = Gm.tx + 2;
    X(g, x, top, C.k); X(g, x, top + 1, C.k); X(g, x + 1, top + 2, C.k);
    if (L.bag === 'small') { X(g, x - 1, top + 3, C.k); X(g, x - 2, top + 4, C.k); }
  }

  const HAIR = {
    short: { y: 0, rows: ['.HHhh.', 'Hhhhhk', 'hhhSSs', 'hkdses', 'hksSss', '.ddsd.'] },
    long: { y: 0, rows: ['.HHhh.', 'Hhhhhh', 'hhhhSs', 'hhdses', 'hksSss', 'hkdsd.', 'kk....', 'k.....'] },
    bald: { y: 0, rows: ['.SSSs.', 'SSssss', 'sssSSs', 'sddses', 'ssssss', '.ddsd.'] },
    mohawk: { y: -2, rows: ['..HH..', '.Hhhh.', '.dhhd.', 'dssskd', 'sssSSs', 'sddses', 'ssssss', '.ddsd.'] },
  };

  function drawHead(g, L, x, y, dead) {
    const S = T(L.skin), H = T(L.hair);
    const st = HAIR[L.hairStyle] || HAIR.short;
    const m = { H: H.l, h: H.b, k: H.d, S: S.l, s: S.b, d: S.d, e: dead ? S.d : '#211a26' };
    stamp(g, x, y + st.y, st.rows, m);
  }

  function drawHelmet(g, L, x, y, dead) {
    const type = L.helmet; if (!type) return;
    const base = L.helmetCol || HELM_COL[type] || L.top;
    const C = T(base), S = T(L.skin);
    const m = { A: C.l, a: C.b, b: C.d, c: C.k, e: dead ? S.d : '#211a26', s: S.b, z: S.d, S: S.l, r: '#8a4a2a', R: '#b0622e' };
    switch (type) {
      case 'cap':
        stamp(g, x, y, ['.AAaa.', 'AAaaab', '...bccc'], m);
        X(g, x + 2, y, C.l); break;
      case 'mil':
        stamp(g, x - 1, y - 1, ['..AAAa..', '.AAaaaab', 'Aaaaaaab', 'cbbbbbbc'], m);
        if (L.camo) { X(g, x + 1, y + 1, T(L.camo).b); X(g, x + 4, y, T(L.camo).b); X(g, x + 3, y + 1, T(L.camo).b); }
        X(g, x + 2, y + 3, C.k); X(g, x + 2, y + 4, C.k); break;
      case 'bucket':
        stamp(g, x - 1, y - 2, ['AAAAAAa', 'AaaaaRb', 'aaAaRrb', 'acaaacb', 'bbbbbbc'], m); break;
      case 'gas': {
        const G = { g: '#2b4a52', G: '#9fd8e0', f: '#5a6250', F: '#848c72', o: '#33372f' };
        stamp(g, x, y, ['......', '..cc..', '.cbaAa', '..baGg', '..bbaFf', '...bcff'], Object.assign({}, m, G));
        break;
      }
      case 'riot': {
        const v = { v: '#3e5c7c', V: '#a8cce4', w: '#2a3a52' };
        stamp(g, x - 1, y - 1, ['..AAAa..', '.AAaaaab', 'Aaaaaaab', 'aaabVVvv', 'aabbvVvw', '.bbcwww.'], Object.assign({}, m, v));
        break;
      }
      case 'boss': {
        const vc = L.visor || '#ff3344', tc = L.trim || C.l;
        const v = { v: vc, V: ART.mix(vc, '#ffffff', 0.55), t: tc, T: ART.mix(tc, '#ffffff', 0.35), w: ART.mix(vc, INK, 0.5) };
        stamp(g, x - 1, y - 2, ['..TTt...', '.AAAaaa.', 'AAaaaaab', 'Aaaaaabb', 'aaaabbbb', 'aabwvVvv', 'abbcbbbb', '.bttbtt.'], Object.assign({}, m, v));
        break;
      }
      case 'hood':
        stamp(g, x - 1, y - 1, ['..AAAa..', '.AAaaaa.', 'AaaaaaAb', 'aaabqSz.', 'aaabqez.', 'aaabqqz.', 'abbbcz..', 'abb.....'], Object.assign({}, m, { q: ART.mix(S.b, S.d, 0.5), S: S.b }));
        break;
      case 'bandana':
        stamp(g, x - 1, y + 4, ['baaAaaaa', 'c..abbb.'], m); break;
      case 'balaclava':
        stamp(g, x, y, ['.AAaa.', 'Aaaaaa', 'aaaaab', 'aabzes', 'aaaaab', '.bbbb.'], m); break;
    }
  }

  function drawArm(g, L, Gm, oy) {
    const Tt = T(L.top), Hd = T(L.gloves || L.skin);
    const big = L.big, uw = big ? 3 : 2;
    const sx = Gm.tx + Gm.tw - (big ? 5 : 4), sy = Gm.ty + 1 + oy, hxp = Gm.tx + Gm.tw;
    const A = { l: ART.mix(Tt.l, WARM, 0.15), b: Tt.l, d: Tt.b, k: Tt.k };   // sleeve is nearer the light
    // selective dark edge: separates the arm from the torso behind it
    X(g, sx - 1, sy, A.k); X(g, sx - 1, sy + 1, A.k); X(g, sx - 1, sy + 2, A.k); X(g, sx, sy + 3, A.k);
    for (let k = 0; k < uw; k++) { X(g, sx + k, sy, k === 0 ? A.l : A.b); X(g, sx + k, sy + 1, k === uw - 1 ? A.d : A.b); }
    R(g, sx, sy + 2, hxp - sx, 1, A.b); X(g, sx, sy + 2, A.d);
    R(g, sx + 1, sy + 3, hxp - sx - 1, 1, Tt.d);
    if (L.camo) X(g, sx + 2, sy + 2, T(L.camo).l);
    X(g, hxp, sy + 2, Hd.l); X(g, hxp, sy + 3, Hd.d);
    if (big && L.vest) { // pauldron
      const V = T(L.vest);
      R(g, sx, sy - 1, uw, 1, V.l); R(g, sx - 1, sy, uw + 2, 1, V.b); X(g, sx - 1, sy, V.l); X(g, sx + uw, sy, V.d);
      R(g, sx - 1, sy + 1, uw + 2, 1, L.trim || V.d); X(g, sx + 1, sy, ART.mix(V.l, '#ffffff', 0.3));
    }
  }

  function drawHuman(L, Gm, pose) {
    const [c, g] = ART.canvas(Gm.W, Gm.H);
    const up = pose.bob || 0, br = pose.br || 0;
    const top = Gm.ty + up + br, belt = Gm.ty + Gm.th - 1 + up;
    if (L.cape) drawCape(g, L, Gm, top, belt, pose);
    if (L.bag) drawBag(g, L, Gm, top, pose.swing);
    drawLeg(g, L, Gm.hips[0], belt + 1, Gm.foot, pose.legs[0], Gm.legW, false);
    drawLeg(g, L, Gm.hips[1], belt + 1, Gm.foot, pose.legs[1], Gm.legW, true);
    drawTorso(g, L, Gm, top, belt);
    if (L.vest) drawVest(g, L, Gm, top, belt);
    if (L.bag) drawBagStrap(g, L, Gm, top);
    const hy = Gm.hy + up + br;
    drawHead(g, L, Gm.hx, hy, pose.dead);
    drawHelmet(g, L, Gm.hx, hy, pose.dead);
    if (!pose.noArm) drawArm(g, L, Gm, up + br);
    return c;
  }

  const Z = { dx: 0, lift: 0 };
  const HUMAN_POSES = {
    idle: [{ legs: [Z, Z] }, { legs: [Z, Z], br: 1 }],
    walk: [
      { legs: [{ dx: -2 }, { dx: 2 }], swing: 0 },
      { legs: [{ dx: 0, lift: 1 }, { dx: 0 }], bob: -1, swing: 1 },
      { legs: [{ dx: 2 }, { dx: -2 }], swing: 0 },
      { legs: [{ dx: 0 }, { dx: 0, lift: 1 }], bob: -1, swing: 1 },
    ],
  };

  const charCache = {};
  ART.character = function (look) {
    if (typeof look === 'string') look = ART.LOOKS[look] || {};
    look = look || {};
    const key = JSON.stringify(look);
    if (charCache[key]) return charCache[key];
    const L = Object.assign({}, DEF);
    for (const k in look) if (look[k] !== undefined && look[k] !== null) L[k] = look[k];
    if (look.helmet === null) L.helmet = null;
    const Gm = geom(!!L.big);
    const inner = (p) => drawHuman(L, Gm, p);
    const idleIn = HUMAN_POSES.idle.map(inner);
    const right = {
      idle: idleIn.map(OL),
      walk: HUMAN_POSES.walk.map(p => OL(inner(p))),
      hurt: flash(idleIn[0]),
    };
    // dead: body falls backwards (head to the left), lying on the ground
    const deadIn = drawHuman(L, Gm, { legs: [{ dx: -1 }, { dx: 1 }], noArm: true, dead: true });
    const dead = OL(crop(rotCCW(deadIn)));
    dead.ox = dead.width >> 1; dead.oy = dead.height - 1;
    right.dead = dead;
    const w = Gm.W + 2, h = Gm.H + 2;
    const sy = Gm.ty + 1 + 2 + 1, hx = Gm.tx + Gm.tw + 1;
    const res = {
      w, h, ox: Gm.cx + 1, oy: h - 1,
      hand: { x: hx, y: sy },
      handL: { x: w - 1 - hx, y: sy },
      // per-frame vertical offset of the upper body (hand moves with it)
      bob: { idle: [0, 1], walk: [0, -1, 0, -1] },
      right, left: mirrorSet(right), look: L,
    };
    charCache[key] = res;
    return res;
  };

  // ==========================================================================
  // BEASTS
  // ==========================================================================
  // quadruped leg cycle: plant forward -> mid -> back -> lifted swing
  const QCYC = [{ dx: 1, l: 0 }, { dx: 0, l: 0 }, { dx: -1, l: 0 }, { dx: 0, l: 1 }];

  // ---- DOG: mangy mutated hound (inner 14x9) ----
  const DOG = { W: 14, H: 9, fur: '#7b6852', mange: '#b5736a', eye: '#ff4a3a' };
  function dogLeg(g, x, top, leg, C, near) {
    const dx = leg.dx || 0, lift = leg.l || 0, by = 8 - lift;
    for (let y = top; y <= by; y++) {
      const t = (y - top) / Math.max(1, by - top);
      X(g, x + Math.round(dx * t), y, near ? (y === top ? C.b : C.d) : C.k);
    }
    if (near) X(g, x + dx + 1, by, C.d);
  }
  function drawDog(pose) {
    const [c, g] = ART.canvas(DOG.W, DOG.H);
    const F = T(DOG.fur), by = pose.bob || 0, br = pose.br || 0, atk = pose.atk, dead = pose.dead;
    const L = pose.legs;
    // far legs
    dogLeg(g, 3, 5 + by, L[0], F, false); dogLeg(g, 9, 5 + by, L[2], F, false);
    // tail (thin, rat-like)
    const ty = by + (pose.tail || 0);
    X(g, 1, 2 + ty, F.d); X(g, 0, 1 + ty, F.d); if (!pose.tail) X(g, 0, 0 + ty, F.k);
    // body
    const b = 2 + by;
    R(g, 3, b + br, 7, 1, F.l);
    R(g, 2, b + 1, 9, 2, F.b);
    R(g, 2, b + 3, 3, 1, F.d); R(g, 7, b + 3, 4, 1, F.d);
    X(g, 2, b + 1, F.d);
    if (!br) { X(g, 4, b - 1, F.d); X(g, 6, b - 1, F.b); X(g, 8, b - 1, F.d); } // mangy spikes
    X(g, 5, b + 2, F.d); X(g, 7, b + 2, F.d); X(g, 6, b + 2, F.k); // ribs
    X(g, 4, b + 1 + 0, DOG.mange); X(g, 5, b + br, DOG.mange); X(g, 8, b + 1, ART.mix(DOG.mange, F.b, 0.4));
    X(g, 3, b + 1, F.l);
    // head
    const hy = (atk ? 1 : 0) + by + br;
    X(g, 9, 0 + hy, F.d); X(g, 10, 0 + hy, F.k); // ear swept back
    R(g, 9, 1 + hy, 3, 1, F.l); X(g, 12, 1 + hy, F.b);
    R(g, 9, 2 + hy, 4, 1, F.b); X(g, 11, 2 + hy, dead ? F.k : DOG.eye);
    R(g, 10, 3 + hy, 3, 1, F.b); X(g, 13, 3 + hy, INK);
    if (atk) { X(g, 12, 3 + hy, '#e8e0d0'); R(g, 10, 4 + hy, 3, 1, F.d); X(g, 13, 4 + hy, '#e8e0d0'); X(g, 11, 5 + hy, F.k); }
    else { R(g, 10, 4 + hy, 2, 1, F.d); X(g, 12, 4 + hy, '#e8e0d0'); }
    // near legs
    dogLeg(g, 4, 5 + by, L[1], F, true); dogLeg(g, 10, 5 + by, L[3], F, true);
    return c;
  }

  // ---- BOAR: bulky tusked boar (inner 18x11) ----
  const BOAR = { W: 18, H: 11, fur: '#5a3f30', snout: '#b07a6a', eye: '#e43b44' };
  function boarLeg(g, x, top, leg, C, near) {
    const dx = leg.dx || 0, lift = leg.l || 0, by = 10 - lift;
    for (let y = top; y <= by; y++) {
      const ox = y === by ? dx : (y > top ? Math.round(dx / 2) : 0);
      const hoof = y === by;
      X(g, x + ox, y, hoof ? INK : near ? C.b : C.d); X(g, x + ox + 1, y, hoof ? '#2a2026' : near ? C.d : C.k);
    }
  }
  function drawBoar(pose) {
    const [c, g] = ART.canvas(BOAR.W, BOAR.H);
    const F = T(BOAR.fur), by = pose.bob || 0, br = pose.br || 0, atk = pose.atk, dead = pose.dead;
    const L = pose.legs;
    boarLeg(g, 3, 8 + by, L[0], F, false); boarLeg(g, 11, 8 + by, L[2], F, false);
    const b = by;
    // body mass
    const rows = [[9, 11], [5, 12], [3, 13], [2, 13], [2, 13], [2, 13], [2, 12], [3, 11], [4, 10]];
    rows.forEach(([a, z], i) => {
      if (br && i === 0) return;
      for (let x = a; x <= z; x++) {
        let col = F.b;
        if (i <= 1 + br) col = F.l; else if (i >= 6) col = F.d;
        if (x === a && i > 1) col = F.d;
        X(g, x, b + i + (br && i === 1 ? 0 : 0), col);
      }
    });
    // bristle ridge along the back, hump at shoulders
    [[9, 0], [11, 0], [6, 1], [8, 1], [10, 1], [12, 1], [4, 2]].forEach(([x, y]) => { if (!(br && y === 0)) X(g, x, b + y, F.k); });
    X(g, 10, b + 0, F.d);
    // flank shading / mud
    X(g, 5, b + 4, F.d); X(g, 6, b + 5, F.d); X(g, 4, b + 5, ART.mix(F.b, '#6b5a40', 0.5)); X(g, 8, b + 3, F.l);
    // tail
    X(g, 1, b + 3, F.d); X(g, 0, b + 4, F.k);
    // head (lowered)
    const hy = b + (atk ? 1 : 0);
    X(g, 12, hy + 2, F.d); X(g, 13, hy + 1, F.k); // ear
    R(g, 12, hy + 3, 4, 1, F.b); X(g, 12, hy + 3, F.l);
    R(g, 12, hy + 4, 5, 1, F.b); X(g, 14, hy + 4, dead ? F.k : BOAR.eye);
    R(g, 12, hy + 5, 5, 1, F.b);
    R(g, 13, hy + 6, 4, 1, F.d);
    R(g, 16, hy + 5, 2, 2, BOAR.snout); X(g, 17, hy + 5, ART.mix(BOAR.snout, '#ffffff', 0.25)); X(g, 17, hy + 6, ART.mix(BOAR.snout, INK, 0.45));
    // tusks
    X(g, 15, hy + 7, '#ead4aa'); X(g, 16, hy + 7, '#ead4aa'); X(g, 17, hy + 7 - (atk ? 1 : 0), '#fff4dc');
    if (atk) X(g, 17, hy + 7, '#c8b48a');
    boarLeg(g, 5, 8 + by, L[1], F, true); boarLeg(g, 13, 8 + by, L[3], F, true);
    return c;
  }

  // ---- LURKER: hunched pale mutant with long clawed arms (inner 14x18) ----
  const LURK = { W: 14, H: 18, skin: '#a497b4', eye: '#d6ff5a', claw: '#ead4aa', rag: '#3e3540' };
  function lurkLeg(g, hip, top, leg, C, front) {
    const dx = leg.dx || 0, lift = leg.lift || 0, fy = 17 - lift;
    // digitigrade: thigh forward, shin back
    const knee = top + 2;
    for (let y = top; y <= fy; y++) {
      let x = hip;
      if (y >= knee && y < fy - 1) x = hip + 1 + Math.round(dx * (y - knee) / (fy - knee));
      if (y >= fy - 1) x = hip + dx;
      X(g, x, y, front ? C.b : C.d); X(g, x + 1, y, front ? C.d : C.k);
    }
    X(g, hip + dx + 2, fy, front ? LURK.claw : C.k); // toe claw
  }
  function lurkArm(g, sx, sy, hx, hy, C, front, up) {
    const col = front ? C.b : C.d, sh = front ? C.d : C.k;
    const ex = Math.round((sx + hx) / 2) + (up ? -1 : 1), ey = Math.round((sy + hy) / 2);
    ART.line(g, sx, sy, ex, ey, col); ART.line(g, sx + 1, sy, ex + 1, ey, sh);
    ART.line(g, ex, ey, hx, hy, col); ART.line(g, ex + 1, ey, hx + 1, hy, sh);
    const k = front ? LURK.claw : ART.mix(LURK.claw, COOL, 0.4);
    if (up) { X(g, hx, hy - 1, k); X(g, hx + 1, hy - 1, k); X(g, hx + 2, hy, k); X(g, hx - 1, hy - 2, k); X(g, hx + 1, hy - 2, k); }
    else { X(g, hx, hy + 1, k); X(g, hx + 1, hy + 1, k); X(g, hx + 2, hy + 1, k); X(g, hx + 2, hy, k); }
  }
  function drawLurker(pose) {
    const [c, g] = ART.canvas(LURK.W, LURK.H);
    const C = T(LURK.skin), by = pose.bob || 0, br = pose.br || 0, atk = pose.atk, dead = pose.dead;
    const sw = pose.swing || 0;
    // far arm
    if (atk) lurkArm(g, 5, 5 + by, 7, 1, C, false, true);
    else lurkArm(g, 4, 6 + by + br, 3 - sw, 14, C, false, false);
    lurkLeg(g, 4, 11 + by, pose.legs[0], C, false);
    lurkLeg(g, 6, 11 + by, pose.legs[1], C, true);
    // hunched torso
    const rows = [[5, 7], [4, 8], [3, 9], [3, 9], [3, 9], [3, 8], [4, 8], [4, 8], [4, 7]];
    const tb = 3 + by;
    rows.forEach(([a, z], i) => {
      const y = tb + i + (i === 0 ? br : 0);
      for (let x = a; x <= z; x++) {
        let col = C.b;
        if (i <= 1 || (x === a && i <= 3)) col = C.l;
        if (x === z || i >= 7) col = C.d;
        X(g, x, y, col);
      }
    });
    // spine knobs + ribs
    X(g, 4, tb + 1 + br, C.l); X(g, 3, tb + 3, ART.mix(C.l, '#ffffff', 0.3)); X(g, 5, tb + 0 + br, ART.mix(C.l, '#ffffff', 0.3));
    X(g, 6, tb + 4, C.d); X(g, 7, tb + 4, C.d); X(g, 6, tb + 6, C.d); X(g, 7, tb + 6, C.d); X(g, 5, tb + 5, C.k);
    // rag loincloth
    R(g, 4, tb + 8, 4, 1, LURK.rag); X(g, 5, tb + 9, LURK.rag); X(g, 7, tb + 9, ART.mix(LURK.rag, INK, 0.4));
    // head: low and forward
    const hy = 4 + by + br + (atk ? -1 : 0);
    R(g, 9, hy, 3, 1, C.l);
    R(g, 8, hy + 1, 5, 1, C.b); X(g, 8, hy + 1, C.l);
    R(g, 8, hy + 2, 5, 1, C.b); X(g, 11, hy + 1, dead ? C.k : LURK.eye); X(g, 12, hy + 1, dead ? C.d : ART.mix(LURK.eye, C.b, 0.5));
    X(g, 10, hy + 1, C.d);
    if (atk) { R(g, 10, hy + 3, 3, 1, '#3a1f2e'); X(g, 11, hy + 3, '#e8e0d0'); R(g, 9, hy + 4, 3, 1, C.d); }
    else { R(g, 9, hy + 3, 4, 1, C.d); X(g, 11, hy + 3, '#3a1f2e'); X(g, 12, hy + 3, '#e8e0d0'); }
    // near arm
    if (atk) lurkArm(g, 8, 6 + by, 11, 1, C, true, true);
    else lurkArm(g, 8, 6 + by + br, 10 + sw, 14, C, true, false);
    return c;
  }

  const BEASTS = {
    dog: {
      draw: drawDog, ox: 8,
      idle: [{ legs: [QCYC[1], QCYC[1], QCYC[1], QCYC[1]] }, { legs: [QCYC[1], QCYC[1], QCYC[1], QCYC[1]], br: 1, tail: 1 }],
      walk: [0, 1, 2, 3].map(f => ({ legs: [QCYC[f], QCYC[(f + 2) % 4], QCYC[(f + 2) % 4], QCYC[f]], bob: f % 2 ? -1 : 0, tail: f % 2 })),
      attack: { legs: [{ dx: -1 }, { dx: -1 }, { dx: 1, l: 2 }, { dx: 2, l: 2 }], bob: -1, atk: true },
    },
    boar: {
      draw: drawBoar, ox: 10,
      idle: [{ legs: [QCYC[1], QCYC[1], QCYC[1], QCYC[1]] }, { legs: [QCYC[1], QCYC[1], QCYC[1], QCYC[1]], br: 1 }],
      walk: [0, 1, 2, 3].map(f => ({ legs: [QCYC[f], QCYC[(f + 2) % 4], QCYC[(f + 2) % 4], QCYC[f]], bob: f % 2 ? -1 : 0 })),
      attack: { legs: [{ dx: -1 }, { dx: -1 }, { dx: 1 }, { dx: 1 }], atk: true },
    },
    lurker: {
      draw: drawLurker, ox: 7,
      idle: [{ legs: [Z, Z] }, { legs: [Z, Z], br: 1 }],
      walk: [
        { legs: [{ dx: -2 }, { dx: 1 }], swing: -1 },
        { legs: [{ dx: 0, lift: 1 }, { dx: 0 }], bob: -1, swing: 0 },
        { legs: [{ dx: 1 }, { dx: -2 }], swing: 1 },
        { legs: [{ dx: 0 }, { dx: 0, lift: 1 }], bob: -1, swing: 0 },
      ],
      attack: { legs: [{ dx: -2 }, { dx: 1 }], atk: true },
    },
  };

  const beastCache = {};
  ART.beast = function (kind) {
    if (!BEASTS[kind]) kind = 'dog';
    if (beastCache[kind]) return beastCache[kind];
    const B = BEASTS[kind];
    const idleIn = B.idle.map(B.draw);
    const right = {
      idle: idleIn.map(OL),
      walk: B.walk.map(p => OL(B.draw(p))),
      hurt: flash(idleIn[0]),
      attack: OL(B.draw(B.attack)),
    };
    let deadIn;
    if (kind === 'lurker') deadIn = crop(rotCCW(B.draw({ legs: [{ dx: -1 }, { dx: 1 }], dead: true })));
    else deadIn = crop(flipY(B.draw(Object.assign({}, B.idle[0], { dead: true, legs: [{ dx: -1 }, { dx: 1 }, { dx: -1 }, { dx: 1 }] }))));
    const dead = OL(deadIn); dead.ox = dead.width >> 1; dead.oy = dead.height - 1;
    right.dead = dead;
    const w = right.idle[0].width, h = right.idle[0].height;
    const res = { w, h, ox: B.ox, oy: h - 1, right, left: mirrorSet(right) };
    beastCache[kind] = res;
    return res;
  };

  // ==========================================================================
  // WEAPONS — horizontal, pointing right. Templates are pre-outline; grip (gx,gy)
  // and muzzle (mx,my) are given in template coords and shifted for the outline.
  // ==========================================================================
  const WP = {
    k: '#24262f', m: '#3c4250', M: '#5c6576', L: '#8d99ad', H: '#c3cddc',
    w: '#55331f', W: '#87532f', V: '#b27646', t: '#8e8468', T: '#c2b690',
    r: '#7e4024', R: '#ad5a2a', o: '#3e4a2a', O: '#5d6c3a', P: '#7f8e4e',
    y: '#c08a2a', Y: '#f0c050', g: '#2ce8f5', G: '#124e89', s: '#7e8aa0', S: '#c3cddc', E: '#ffffff',
    b: '#2a2630', n: '#6f6a66', N: '#a39d94', c: '#5a4a3a', f: P.skin, F: P.skin2, d: '#a86e52',
  };
  const WEAPONS = {
    pipe_pistol: { g: [2, 2], m: [8, 1], rows: [
      'mMLLLLLLH',
      'mmtTtMmMm',
      '.VWm.....',
      '.Ww......',
      '.ww......'] },
    revolver: { g: [2, 2], m: [9, 1], rows: [
      '..mLLLLLLH',
      '.mMHHMMMMm',
      '.WmLMm....',
      'VWw.m.....',
      'Ww........'] },
    boomstick: { g: [5, 2], m: [15, 1], rows: [
      '.....mLLLLLLLLLH',
      'VVWWWmMMMMMMMMML',
      'WWwwwbVWWWWWw...',
      'ww...b..........'] },
    pump: { g: [6, 2], m: [16, 0], rows: [
      '......kMLLLLLLLLH',
      'MMMMMmkMMmmmmmmmm',
      'mmmm.km.wVVWWwm..',
      'm.....k..........'] },
    smg: { g: [4, 2], m: [12, 1], rows: [
      '...kLLLLL...',
      'mMMMMMMMMMLLH',
      'm..kMMMMm....',
      '...kk.mM.....',
      '......mM.....',
      '......mm.....'] },
    ar: { g: [6, 2], m: [17, 1], rows: [
      '......m.......m...',
      'VWWWwMMMMMVWWWLLLH',
      'WWww.wMmmMwww.....',
      'Ww....kk.mM.......',
      '.......k..mM......',
      '...........m......'] },
    hunting: { g: [6, 4], m: [19, 3], rows: [
      '.......mMMMMMg......',
      '......mMLLLLMG......',
      '........k..k.m......',
      'VWWWWWWMMMMMLLLLLLLH',
      'WWwwwwkWWWWWWWw.....',
      'ww....k.............'] },
    rpg: { g: [5, 3], m: [17, 1], rows: [
      '.......k.....oOOo.',
      'PPPPPPPPPPPPoOPPPO',
      'OOOOOOOOOOOOoOOOOo',
      'oo...o..o....oOOo.',
      '.....o..o.........'] },
    knife: { g: [1, 1], m: [6, 1], rows: [
      '...mSH.',
      'wWWmSSE',
      '...m...'] },
    machete: { g: [1, 1], m: [10, 1], rows: [
      '....SSSHHH.',
      'wWWmSSSSSSE',
      '...m.ssssss'] },
    hatchet: { g: [1, 2], m: [9, 1], rows: [
      '......NNN.',
      '......nNNN',
      'wWWWWWtTtW',
      '......nnn.',
      '.......n..'] },
    pickaxe: { g: [1, 2], m: [10, 0], rows: [
      '.........LH',
      '........ML.',
      'wWWWWWWWMMW',
      '........ML.',
      '.........Lm'] },
    salv_axe: { g: [1, 3], m: [11, 0], rows: [
      '.......EEEE.',
      '.......SRRRr',
      '........RrRr',
      'tTtmMMMMLMMm',
      '........mm..'] },
    salv_pick: { g: [1, 2], m: [11, 0], rows: [
      '..........RH',
      '.........Rr.',
      'tTtmMMMMMMrr',
      '.........Rr.',
      '..........R.'] },
    fists: { g: [0, 1], m: [2, 1], rows: [
      'ffF',
      'fFd',
      'Fdd'] },
  };
  const wCache = {};
  ART.weapon = function (id) {
    if (!WEAPONS[id]) id = id && /pick/.test(id) ? 'pickaxe' : id && /axe|hatch/.test(id) ? 'hatchet' : 'pipe_pistol';
    if (wCache[id]) return wCache[id];
    const W = WEAPONS[id];
    const c = OL(ART.ascii(W.rows, WP));
    const res = { c, w: c.width, h: c.height, gx: W.g[0] + 1, gy: W.g[1] + 1, mx: W.m[0] + 2, my: W.m[1] + 1 };
    wCache[id] = res;
    return res;
  };
  ART.WEAPON_IDS = Object.keys(WEAPONS);

  // ==========================================================================
  // FX
  // ==========================================================================
  function buildFX() {
    const FXP = { W: '#ffffff', w: '#fff6c8', Y: P.yellow, O: P.gold, F: P.flame, R: P.rust };
    const MUZ = [
      ['...O....', '..OYO.O.', '.OYWYYO.', 'OYWWWWYO', '.OYWYYO.', '..OYO.O.', '...O....'],
      ['........', '.O...O..', '.OYOYOO.', 'OYWWWWWY', '.OYOYOO.', '.O...O..', '........'],
      ['.O...O..', '..Y.Y...', '.OYWY.O.', 'OYWWWYYO', '.OYWY.O.', '..Y.Y...', '.O...O..'],
    ];
    MUZ.forEach((rows, i) => ART.add('fx_muzzle' + i, ART.ascii(rows, FXP), 0, 3));

    // explosion: flash -> fireball -> smoke ring
    const EXP = [
      { r: 6, bands: [[0.55, '#ffffff'], [1, P.yellow]] },
      { r: 10, bands: [[0.35, '#ffffff'], [0.65, P.yellow], [1, P.gold]] },
      { r: 13, bands: [[0.25, '#fff6c8'], [0.5, P.yellow], [0.78, P.flame], [1, P.rust]] },
      { r: 14, bands: [[0.25, P.yellow], [0.5, P.flame], [0.72, P.rust], [1, '#4a3a3e']] },
      { r: 15, bands: [[0.2, P.flame], [0.42, '#6e3a34'], [0.75, '#4a4450'], [1, '#625c66']], holes: 0.1 },
      { r: 15, ring: 0.45, bands: [[0.7, '#5c5662'], [1, '#7a7480']], holes: 0.3 },
      { r: 15, ring: 0.65, bands: [[1, '#8a8490']], holes: 0.62 },
    ];
    EXP.forEach((E, f) => {
      const [c, g] = ART.canvas(32, 32), rr = ART.rng(900 + f), wob = [];
      for (let i = 0; i < 12; i++) wob.push(0.82 + rr() * 0.3);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const dx = x + 0.5 - 16, dy = (y + 0.5 - 16) * 1.08, d = Math.hypot(dx, dy);
        const a = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) * 12, i0 = Math.floor(a) % 12, t = a - Math.floor(a);
        const R0 = E.r * (wob[i0] * (1 - t) + wob[(i0 + 1) % 12] * t);
        let q = d / R0 + (hash(x, y, f) - 0.5) * 0.12;
        if (q > 1) continue;
        if (E.ring && q < E.ring) continue;
        if (E.holes && hash(x >> 1, y >> 1, f + 50) < E.holes * (E.ring ? 1 : q)) continue;
        let col = E.bands[E.bands.length - 1][1];
        for (const [lim, cc] of E.bands) if (q <= lim) { col = cc; break; }
        // top-left lit smoke
        if (f >= 4 && dx + dy < -E.r * 0.5) col = ART.mix(col, '#ffffff', 0.15);
        X(g, x, y, col);
      }
      if (f >= 3 && f <= 5) { // embers / debris
        for (let i = 0; i < 6 + f; i++) { const an = rr() * 6.283, d = E.r * (0.6 + rr() * 0.5); X(g, 16 + Math.cos(an) * d, 16 + Math.sin(an) * d, i % 2 ? P.gold : P.flame); }
      }
      ART.add('fx_explode' + f, c, 16, 16);
    });

    // blood & goo splats (ground decals, no outline)
    function splat(name, w, h, seed, cols) {
      const [c, g] = ART.canvas(w, h), r = ART.rng(seed), cx = w / 2, cy = h / 2;
      const blobs = 3 + ((w * h) / 30 | 0);
      ART.ellipse(g, cx - 0.5, cy - 0.5, Math.max(1, w / 4 | 0), Math.max(1, h / 4 | 0), cols[0]);
      for (let i = 0; i < blobs; i++) {
        const a = r() * 6.283, d = r() * Math.min(cx, cy) * 0.75;
        ART.disc(g, cx - 0.5 + Math.cos(a) * d * (w / h), cy - 0.5 + Math.sin(a) * d, r() < 0.5 ? 1 : 0, cols[0]);
      }
      for (let i = 0; i < 4 + w / 3; i++) { const a = r() * 6.283, d = (0.65 + r() * 0.35); X(g, Math.round(cx - 0.5 + Math.cos(a) * (cx - 0.6) * d), Math.round(cy - 0.5 + Math.sin(a) * (cy - 0.6) * d), cols[0]); }
      // inner darker pool + wet highlight
      ART.ellipse(g, cx - 0.5, cy - 0.5 + 0.5, Math.max(0, w / 7 | 0), Math.max(0, h / 7 | 0), cols[1]);
      X(g, Math.floor(cx) - 1, Math.floor(cy) - 1, cols[2]);
      ART.add(name, c, w >> 1, h >> 1);
    }
    const BL = [P.blood, '#6e1a2a', '#d0505a'];
    [[6, 5], [8, 7], [10, 8], [12, 9]].forEach(([w, h], i) => splat('fx_blood' + i, w, h, 300 + i * 7, BL));
    const GOO = ['#6fa03a', '#3f6a2a', '#b4e070'];
    [[8, 7], [11, 8]].forEach(([w, h], i) => splat('fx_goo' + i, w, h, 400 + i * 7, GOO));

    { // scorch
      const [c, g] = ART.canvas(24, 14);
      for (let y = 0; y < 14; y++) for (let x = 0; x < 24; x++) {
        const q = Math.hypot((x + 0.5 - 12) / 12, (y + 0.5 - 7) / 7) + (hash(x, y, 9) - 0.5) * 0.25;
        if (q > 1) continue;
        if (q > 0.72 && hash(x, y, 10) < 0.5) continue;
        X(g, x, y, q < 0.4 ? 'rgba(16,12,14,0.85)' : q < 0.72 ? 'rgba(24,20,24,0.7)' : 'rgba(30,26,28,0.45)');
        if (q < 0.5 && hash(x, y, 11) < 0.06) X(g, x, y, 'rgba(120,60,30,0.7)');
      }
      ART.add('fx_scorch', c, 12, 7);
    }
    ART.add('fx_casing', ART.ascii(['Yy'], { Y: P.gold, y: '#a8661e' }), 1, 0);
    ART.add('fx_spark0', ART.ascii(['.Y.', 'YWY', '.Y.'], { W: '#ffffff', Y: P.yellow }), 1, 1);
    ART.add('fx_spark1', ART.ascii(['O.O', '.W.', 'O.O'], { W: '#fff6c8', O: P.gold }), 1, 1);
    const DU = { A: '#c8b89a', a: '#a8987c', b: '#857762' };
    ART.add('fx_dust0', ART.ascii(['.....', '.Aa..', 'Aaab.', '.bb..'], DU), 2, 3);
    ART.add('fx_dust1', ART.ascii(['.Aa..', 'AaaAa', 'aabab', '.b.b.'], DU), 2, 3);
    ART.add('fx_dust2', ART.ascii(['.A..a', 'A....', '...a.', 'b..b.'], DU), 2, 3);
    const SM = { A: '#c4c0c8', a: '#9a96a2', b: '#6e6a78', c: '#55525e' };
    ART.add('fx_smoke0', ART.ascii(['......', '..Aa..', '.AAab.', '.Aabb.', '..bb..', '......'], SM), 3, 3);
    ART.add('fx_smoke1', ART.ascii(['..AA..', '.AAaa.', 'AAaaab', 'Aaaabb', '.abbb.', '..bc..'], SM), 3, 3);
    ART.add('fx_smoke2', ART.ascii(['.A..a.', 'A.a.a.', '.a.b.b', 'a.b...', '.b.b.c', '..c...'], SM), 3, 3);
    const SA = { A: '#9a7a4e', a: '#7a5a3a', b: '#553c28', c: INK, R: '#ff3a3a', r: '#6a2020', m: '#8b9bb4' };
    ART.add('fx_satchel', ART.ascii(['.cmc..', 'cAAAac', 'cARaac', 'cabbbc', '.cccc.'], SA), 3, 4);
    ART.add('fx_satchel_off', ART.ascii(['.cmc..', 'cAAAac', 'cAraac', 'cabbbc', '.cccc.'], SA), 3, 4);
    ART.add('fx_grenade', ART.ascii(['.cm.', 'cPOc', 'cOoc', '.cc.'], { c: INK, P: '#8e9c5a', O: '#5d6c3a', o: '#3e4a2a', m: '#c3cddc' }), 2, 2);
    ART.add('fx_rocket', ART.ascii(['.c.cc..', 'YmMMOPc', '.c.cc..'], { c: INK, Y: P.gold, m: '#3c4250', M: '#8d99ad', O: '#5d6c3a', P: '#7f8e4e' }), 3, 1);
  }

  ART.builders.push(function () {
    buildFX();
    // pre-warm presets so the first frame of a raid never stalls
    for (const k in ART.LOOKS) ART.character(ART.LOOKS[k]);
    ['dog', 'boar', 'lurker'].forEach(k => ART.beast(k));
    for (const id of ART.WEAPON_IDS) { const w = ART.weapon(id); ART.add('wpn_' + id, w.c, w.gx, w.gy); }
  });
})();
