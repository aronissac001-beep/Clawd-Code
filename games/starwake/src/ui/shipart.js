// ===== shipart.js : procedural sprites for ships, monsters and starbases (cached per design and color) =====
// Ships face +x. Hulls are dark plated metal with a light top edge; the owner's color runs along trim lines,
// the nose and the engine housings. Engine flames are not baked in: the renderer adds them live.
(() => {
  const mk = Art.mk, hash = Art.hash, cache = new Map();
  const hexRgb = c => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const shade = (c, k) => { const [r, g, b] = hexRgb(c); return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`; };
  function plate(g, pts, S, col) {
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, x * S, y * S)); g.closePath();
    const gr = g.createLinearGradient(0, -S * 0.3, 0, S * 0.3); gr.addColorStop(0, col[0]); gr.addColorStop(0.5, col[1]); gr.addColorStop(1, col[2]);
    g.fillStyle = gr; g.fill(); g.lineWidth = Math.max(1, S * 0.012); g.strokeStyle = 'rgba(8,10,20,.9)'; g.stroke();
  }
  const METAL = ['#8e98b8', '#48506e', '#1a1e30'], DARK = ['#6a7392', '#353b55', '#141826'];
  function trim(g, pts, S, color, w) { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, x * S, y * S)); g.strokeStyle = color; g.lineWidth = Math.max(1, S * (w || 0.02)); g.lineCap = 'round'; g.stroke(); }
  function dot(g, x, y, r, col, S) { g.fillStyle = col; g.beginPath(); g.arc(x * S, y * S, r * S, 0, 7); g.fill(); }
  function nozzle(g, x, y, r, S, color) { g.fillStyle = '#0c0e18'; g.fillRect((x - r * 0.6) * S, (y - r) * S, r * 0.9 * S, r * 2 * S); g.fillStyle = shade(color, 0.6); g.fillRect((x - r * 0.75) * S, (y - r * 1.1) * S, r * 0.3 * S, r * 2.2 * S); }
  function turret(g, x, y, r, S, color, ang) { dot(g, x, y, r, '#2a3048', S); g.strokeStyle = 'rgba(200,210,240,.8)'; g.lineWidth = Math.max(1, S * 0.012); g.beginPath(); g.arc(x * S, y * S, r * S, 0, 7); g.stroke(); g.strokeStyle = '#c8d0ec'; g.lineWidth = Math.max(1, S * 0.02); g.beginPath(); g.moveTo(x * S, y * S); g.lineTo((x + Math.cos(ang || 0) * r * 2) * S, (y + Math.sin(ang || 0) * r * 2) * S); g.stroke(); dot(g, x, y, r * 0.45, color, S); }
  function windows(g, x0, x1, y, S, n) { g.fillStyle = 'rgba(200,236,255,.85)'; for (let i = 0; i < n; i++) g.fillRect((x0 + (x1 - x0) * i / Math.max(1, n - 1)) * S - 0.5, y * S - 0.5, Math.max(1, S * 0.012), Math.max(1, S * 0.012)); }
  // engines: where the renderer puts flames, in sprite units (x, y, size) relative to the center, ship facing +x
  const ENGINES = {
    picket: [[-0.4, 0, 0.07]], lancer: [[-0.38, -0.17, 0.06], [-0.38, 0.17, 0.06]], warden: [[-0.42, -0.14, 0.07], [-0.42, 0, 0.07], [-0.42, 0.14, 0.07]],
    monarch: [[-0.46, -0.18, 0.07], [-0.46, -0.06, 0.07], [-0.46, 0.06, 0.07], [-0.46, 0.18, 0.07]], surveyor: [[-0.36, 0, 0.06]], builder: [[-0.36, -0.12, 0.05], [-0.36, 0.12, 0.05]], colony: [[-0.4, 0, 0.08]], army: [[-0.36, -0.1, 0.05], [-0.36, 0.1, 0.05]],
  };
  const DRAW = {
    picket(g, S, c) { plate(g, [[0.42, 0], [0.05, -0.1], [-0.2, -0.28], [-0.32, -0.26], [-0.22, -0.08], [-0.38, -0.06], [-0.38, 0.06], [-0.22, 0.08], [-0.32, 0.26], [-0.2, 0.28], [0.05, 0.1]], S, METAL);
      trim(g, [[0.3, 0], [-0.1, 0]], S, c, 0.025); trim(g, [[-0.1, -0.2], [-0.26, -0.24]], S, c); trim(g, [[-0.1, 0.2], [-0.26, 0.24]], S, c); dot(g, 0.16, 0, 0.035, 'rgba(180,230,255,.95)', S); nozzle(g, -0.38, 0, 0.06, S, c); },
    lancer(g, S, c) { plate(g, [[-0.36, -0.24], [0.12, -0.2], [0.2, -0.14], [-0.36, -0.1]], S, DARK); plate(g, [[-0.36, 0.24], [0.12, 0.2], [0.2, 0.14], [-0.36, 0.1]], S, DARK);
      plate(g, [[0.46, 0], [0.24, -0.08], [-0.1, -0.12], [-0.3, -0.08], [-0.3, 0.08], [-0.1, 0.12], [0.24, 0.08]], S, METAL);
      trim(g, [[0.36, -0.02], [-0.2, -0.06]], S, c); trim(g, [[0.36, 0.02], [-0.2, 0.06]], S, c); trim(g, [[0.12, -0.2], [-0.34, -0.22]], S, c, 0.03); trim(g, [[0.12, 0.2], [-0.34, 0.22]], S, c, 0.03);
      dot(g, 0.22, 0, 0.04, 'rgba(180,230,255,.95)', S); nozzle(g, -0.36, -0.17, 0.06, S, c); nozzle(g, -0.36, 0.17, 0.06, S, c); windows(g, -0.2, 0.1, 0, S, 5); },
    warden(g, S, c) { plate(g, [[0.44, -0.06], [0.44, 0.06], [0.3, 0.2], [-0.1, 0.28], [-0.4, 0.24], [-0.44, 0.1], [-0.44, -0.1], [-0.4, -0.24], [-0.1, -0.28], [0.3, -0.2]], S, METAL);
      plate(g, [[0.3, -0.1], [0.3, 0.1], [-0.3, 0.14], [-0.3, -0.14]], S, DARK);
      trim(g, [[0.42, 0], [0.32, 0]], S, c, 0.05); trim(g, [[0.25, -0.2], [-0.35, -0.24]], S, c, 0.03); trim(g, [[0.25, 0.2], [-0.35, 0.24]], S, c, 0.03);
      turret(g, 0.16, 0, 0.06, S, c, 0); turret(g, -0.04, -0.15, 0.05, S, c, -0.3); turret(g, -0.04, 0.15, 0.05, S, c, 0.3); turret(g, -0.2, 0, 0.05, S, c, 0);
      for (const y of [-0.14, 0, 0.14]) nozzle(g, -0.42, y, 0.06, S, c); windows(g, -0.3, 0.2, -0.09, S, 6); windows(g, -0.3, 0.2, 0.09, S, 6); },
    monarch(g, S, c) { plate(g, [[0.48, 0], [0.38, -0.08], [0.2, -0.12], [0.1, -0.3], [-0.1, -0.32], [-0.2, -0.22], [-0.46, -0.24], [-0.48, 0], [-0.46, 0.24], [-0.2, 0.22], [-0.1, 0.32], [0.1, 0.3], [0.2, 0.12], [0.38, 0.08]], S, METAL);
      plate(g, [[0.34, -0.05], [0.34, 0.05], [-0.4, 0.08], [-0.4, -0.08]], S, DARK); plate(g, [[0.04, -0.06], [0.04, 0.06], [-0.14, 0.09], [-0.14, -0.09]], S, ['#b6bfdc', '#5c6582', '#22263a']);
      trim(g, [[0.46, 0], [-0.44, 0]], S, c, 0.022); trim(g, [[0.08, -0.29], [-0.18, -0.21]], S, c, 0.03); trim(g, [[0.08, 0.29], [-0.18, 0.21]], S, c, 0.03); trim(g, [[0.36, -0.07], [0.2, -0.11]], S, c); trim(g, [[0.36, 0.07], [0.2, 0.11]], S, c);
      g.fillStyle = 'rgba(10,12,22,.9)'; g.fillRect(0.2 * S, -0.04 * S, 0.12 * S, 0.08 * S); g.fillStyle = 'rgba(255,214,140,.7)'; g.fillRect(0.21 * S, -0.025 * S, 0.1 * S, 0.05 * S);
      for (const [x, y] of [[0.24, -0.16], [0.24, 0.16], [-0.02, -0.22], [-0.02, 0.22], [-0.26, -0.14], [-0.26, 0.14]]) turret(g, x, y, 0.045, S, c, y < 0 ? -0.2 : 0.2);
      for (const y of [-0.18, -0.06, 0.06, 0.18]) nozzle(g, -0.46, y, 0.06, S, c); windows(g, -0.36, 0.3, -0.05, S, 9); windows(g, -0.36, 0.3, 0.05, S, 9); },
    surveyor(g, S, c) { plate(g, [[0.3, 0], [0.14, -0.12], [-0.3, -0.1], [-0.36, 0], [-0.3, 0.1], [0.14, 0.12]], S, METAL);
      g.strokeStyle = '#c8d0ec'; g.lineWidth = Math.max(1, S * 0.015); g.beginPath(); g.moveTo(0, 0); g.lineTo(0.08 * S, -0.2 * S); g.stroke();
      g.save(); g.translate(0.1 * S, -0.24 * S); g.rotate(-0.5); g.fillStyle = '#d6dcf2'; g.beginPath(); g.ellipse(0, 0, 0.15 * S, 0.06 * S, 0, 0, 7); g.fill(); g.fillStyle = shade(c, 0.9); g.beginPath(); g.ellipse(0, 0.01 * S, 0.11 * S, 0.035 * S, 0, 0, 7); g.fill(); g.restore();
      trim(g, [[0.2, 0], [-0.24, 0]], S, c, 0.03); dot(g, 0.16, 0.05, 0.03, 'rgba(180,230,255,.95)', S); nozzle(g, -0.35, 0, 0.06, S, c); },
    builder(g, S, c) { plate(g, [[0.2, -0.16], [0.2, 0.16], [-0.34, 0.16], [-0.34, -0.16]], S, DARK);
      g.strokeStyle = '#9aa4c4'; g.lineWidth = Math.max(1, S * 0.02); g.beginPath(); g.moveTo(0.1 * S, -0.16 * S); g.lineTo(0.36 * S, -0.3 * S); g.lineTo(0.42 * S, -0.18 * S); g.moveTo(0.1 * S, 0.16 * S); g.lineTo(0.36 * S, 0.3 * S); g.lineTo(0.42 * S, 0.18 * S); g.stroke();
      g.strokeStyle = 'rgba(160,170,200,.6)'; g.lineWidth = Math.max(1, S * 0.01); for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo((-0.3 + k * 0.13) * S, -0.15 * S); g.lineTo((-0.24 + k * 0.13) * S, 0.15 * S); g.stroke(); }
      g.fillStyle = shade(c, 0.95); g.fillRect(-0.06 * S, -0.08 * S, 0.14 * S, 0.16 * S); dot(g, 0.36, -0.3, 0.025, '#ffd27a', S); dot(g, 0.36, 0.3, 0.025, '#ffd27a', S); nozzle(g, -0.34, -0.11, 0.05, S, c); nozzle(g, -0.34, 0.11, 0.05, S, c); },
    colony(g, S, c) { plate(g, [[0.34, 0], [0.26, -0.12], [-0.3, -0.12], [-0.38, 0], [-0.3, 0.12], [0.26, 0.12]], S, METAL);
      g.strokeStyle = '#b8c2e0'; g.lineWidth = Math.max(1.5, S * 0.05); g.beginPath(); g.ellipse(0, 0, 0.07 * S, 0.28 * S, 0, 0, 7); g.stroke();
      g.strokeStyle = shade(c, 1); g.lineWidth = Math.max(1, S * 0.02); g.beginPath(); g.ellipse(0, 0, 0.07 * S, 0.28 * S, 0, 0, 7); g.stroke();
      g.fillStyle = 'rgba(140,220,150,.85)'; g.beginPath(); g.arc(0.18 * S, 0, 0.06 * S, 0, 7); g.fill(); windows(g, -0.26, 0.1, 0.07, S, 5); nozzle(g, -0.38, 0, 0.08, S, c); },
    army(g, S, c) { plate(g, [[0.3, -0.12], [0.36, 0], [0.3, 0.12], [-0.32, 0.16], [-0.34, 0], [-0.32, -0.16]], S, DARK);
      for (const y of [-0.2, 0.2]) { g.fillStyle = '#5a6382'; g.fillRect(-0.24 * S, (y - 0.04) * S, 0.4 * S, 0.08 * S); g.fillStyle = shade(c, 0.9); g.fillRect(-0.2 * S, (y - 0.015) * S, 0.32 * S, 0.03 * S); }
      trim(g, [[0.3, 0], [-0.26, 0]], S, c, 0.035); nozzle(g, -0.33, -0.1, 0.05, S, c); nozzle(g, -0.33, 0.1, 0.05, S, c); },
  };
  Art.SHIP_ENGINES = ENGINES;
  Art.ship = (hull, color, S) => {
    S = S || 96; const k = 's:' + hull + ':' + color + ':' + S; if (cache.has(k)) return cache.get(k);
    const c = mk(S), g = c.getContext('2d'); g.translate(S / 2, S / 2); g.lineJoin = 'round';
    (DRAW[hull] || DRAW.picket)(g, S * 0.95, color);
    cache.set(k, c); return c;
  };
  // ---- monsters, guardians and the Hollow Choir ----
  const MDRAW = {
    voidmoth(g, S, t) { for (const sgn of [-1, 1]) { const wg = g.createRadialGradient(-0.05 * S, sgn * 0.22 * S, 0, -0.05 * S, sgn * 0.22 * S, 0.34 * S); wg.addColorStop(0, 'rgba(190,140,255,.85)'); wg.addColorStop(0.6, 'rgba(110,70,200,.55)'); wg.addColorStop(1, 'rgba(40,20,90,0)'); g.fillStyle = wg;
        g.beginPath(); g.moveTo(0.05 * S, sgn * 0.02 * S); g.bezierCurveTo(0.3 * S, sgn * 0.3 * S, -0.1 * S, sgn * 0.5 * S, -0.3 * S, sgn * 0.32 * S); g.bezierCurveTo(-0.2 * S, sgn * 0.15 * S, -0.1 * S, sgn * 0.05 * S, 0.05 * S, sgn * 0.02 * S); g.fill();
        g.strokeStyle = 'rgba(230,200,255,.6)'; g.lineWidth = Math.max(1, S * 0.008); for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(0, sgn * 0.03 * S); g.quadraticCurveTo(-0.05 * S, sgn * (0.15 + k * 0.05) * S, (-0.22 + k * 0.05) * S, sgn * (0.3 + k * 0.03) * S); g.stroke(); } }
      g.fillStyle = '#2a1840'; g.beginPath(); g.ellipse(0, 0, 0.2 * S, 0.05 * S, 0, 0, 7); g.fill(); g.fillStyle = '#e8c8ff'; g.beginPath(); g.arc(0.16 * S, 0, 0.025 * S, 0, 7); g.fill(); },
    crystal(g, S) { for (let k = 0; k < 9; k++) { const a = -Math.PI / 2 + (k - 4) * 0.32, L = (0.22 + hash(k, 1, 5) * 0.22) * S, w = 0.06 * S; g.save(); g.rotate(a + Math.PI / 2); const cg = g.createLinearGradient(-w, 0, w, 0); cg.addColorStop(0, `hsl(${280 + k * 6},70%,75%)`); cg.addColorStop(1, `hsl(${290 + k * 6},60%,35%)`); g.fillStyle = cg; g.beginPath(); g.moveTo(-w, 0.08 * S); g.lineTo(0, -L); g.lineTo(w, 0.08 * S); g.fill(); g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 0.08 * S); g.lineTo(0, -L); g.stroke(); g.restore(); }
      const gl = g.createRadialGradient(0, 0, 0, 0, 0, 0.22 * S); gl.addColorStop(0, 'rgba(255,230,255,.9)'); gl.addColorStop(1, 'rgba(200,120,255,0)'); g.fillStyle = gl; g.beginPath(); g.arc(0, 0, 0.22 * S, 0, 7); g.fill(); },
    warden_ai(g, S) { g.strokeStyle = '#d8c48a'; g.lineWidth = 0.04 * S; g.beginPath(); g.arc(0, 0, 0.36 * S, 0, 7); g.stroke(); g.lineWidth = 0.015 * S; g.strokeStyle = '#8a7a50'; for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; g.beginPath(); g.moveTo(Math.cos(a) * 0.3 * S, Math.sin(a) * 0.3 * S); g.lineTo(Math.cos(a) * 0.44 * S, Math.sin(a) * 0.44 * S); g.stroke(); }
      g.fillStyle = '#2a2a34'; g.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; g.lineTo(Math.cos(a) * 0.24 * S, Math.sin(a) * 0.24 * S); } g.fill(); g.strokeStyle = '#d8c48a'; g.lineWidth = 0.02 * S; g.stroke();
      const eg = g.createRadialGradient(0, 0, 0, 0, 0, 0.13 * S); eg.addColorStop(0, '#fff6d0'); eg.addColorStop(0.4, '#ffb347'); eg.addColorStop(1, 'rgba(255,120,40,0)'); g.fillStyle = eg; g.beginPath(); g.arc(0, 0, 0.13 * S, 0, 7); g.fill(); g.fillStyle = '#1a0a04'; g.beginPath(); g.ellipse(0, 0, 0.02 * S, 0.07 * S, 0, 0, 7); g.fill(); },
    stormmother(g, S) { for (let k = 0; k < 40; k++) { const a = k * 0.6, r = (0.08 + k * 0.009) * S; g.fillStyle = `rgba(${150 + k * 2},${190 + k},255,${0.05 + (40 - k) / 400})`; g.beginPath(); g.arc(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6, r * 0.6, 0, 7); g.fill(); }
      g.strokeStyle = 'rgba(240,250,255,.95)'; g.lineWidth = Math.max(1, 0.012 * S); for (let k = 0; k < 4; k++) { let x = 0, y = 0; g.beginPath(); g.moveTo(0, 0); for (let j = 0; j < 5; j++) { x += Math.cos(k * 1.6 + j) * 0.08 * S; y += Math.sin(k * 1.6 + j * 0.7) * 0.08 * S; g.lineTo(x, y); } g.stroke(); }
      const c = g.createRadialGradient(0, 0, 0, 0, 0, 0.12 * S); c.addColorStop(0, '#ffffff'); c.addColorStop(1, 'rgba(140,200,255,0)'); g.fillStyle = c; g.beginPath(); g.arc(0, 0, 0.12 * S, 0, 7); g.fill(); },
    scavenger(g, S) { plate(g, [[0.4, 0.02], [0.18, -0.16], [-0.06, -0.12], [-0.14, -0.26], [-0.34, -0.2], [-0.3, 0], [-0.36, 0.18], [-0.12, 0.22], [0.1, 0.12]], S, ['#a08a70', '#5a4636', '#22180f']);
      for (let k = 0; k < 6; k++) { g.fillStyle = ['#7a6a5a', '#8a4a3a', '#5a6a7a'][k % 3]; g.fillRect((-0.28 + hash(k, 1, 9) * 0.5) * S, (-0.15 + hash(k, 2, 9) * 0.3) * S, 0.08 * S, 0.05 * S); }
      trim(g, [[0.34, 0.02], [-0.2, 0.05]], S, '#ff6a3a', 0.025); turret(g, 0.05, -0.06, 0.04, S, '#ff6a3a', -0.2); nozzle(g, -0.32, -0.1, 0.05, S, '#ff6a3a'); nozzle(g, -0.33, 0.1, 0.05, S, '#ff6a3a'); },
    leviathan(g, S) { const bg = g.createLinearGradient(0, -0.2 * S, 0, 0.2 * S); bg.addColorStop(0, '#5a7eb4'); bg.addColorStop(0.6, '#2a3c66'); bg.addColorStop(1, '#141c34'); g.fillStyle = bg;
      g.beginPath(); g.moveTo(0.44 * S, 0); g.bezierCurveTo(0.4 * S, -0.2 * S, 0, -0.22 * S, -0.3 * S, -0.06 * S); g.lineTo(-0.46 * S, -0.18 * S); g.lineTo(-0.4 * S, 0); g.lineTo(-0.46 * S, 0.18 * S); g.lineTo(-0.3 * S, 0.06 * S); g.bezierCurveTo(0, 0.2 * S, 0.4 * S, 0.18 * S, 0.44 * S, 0); g.fill();
      g.fillStyle = '#20305a'; g.beginPath(); g.moveTo(0.05 * S, 0.12 * S); g.lineTo(-0.08 * S, 0.3 * S); g.lineTo(-0.12 * S, 0.12 * S); g.fill();
      for (let k = 0; k < 10; k++) { g.fillStyle = 'rgba(140,240,255,.85)'; g.beginPath(); g.arc((0.3 - k * 0.06) * S, (-0.06 + Math.sin(k) * 0.03) * S, 0.012 * S, 0, 7); g.fill(); } g.fillStyle = '#e8fbff'; g.beginPath(); g.arc(0.32 * S, -0.04 * S, 0.02 * S, 0, 7); g.fill(); },
    hollow_drone(g, S) { plate(g, [[0.4, 0], [0.0, -0.2], [-0.1, -0.06], [-0.34, -0.24], [-0.22, 0], [-0.34, 0.24], [-0.1, 0.06], [0.0, 0.2]], S, ['#3a2a52', '#1a1028', '#07040c']); trim(g, [[0.32, 0], [-0.12, 0]], S, '#b07aff', 0.03); dot(g, 0.12, 0, 0.04, '#e6ccff', S); },
    hollow_reaver(g, S) { plate(g, [[0.46, 0], [0.2, -0.1], [0.1, -0.34], [-0.06, -0.14], [-0.22, -0.36], [-0.3, -0.1], [-0.44, 0], [-0.3, 0.1], [-0.22, 0.36], [-0.06, 0.14], [0.1, 0.34], [0.2, 0.1]], S, ['#3a2a52', '#1a1028', '#07040c']);
      trim(g, [[0.4, 0], [-0.36, 0]], S, '#b07aff', 0.025); trim(g, [[0.1, -0.3], [0, -0.12]], S, '#b07aff'); trim(g, [[0.1, 0.3], [0, 0.12]], S, '#b07aff'); dot(g, 0.2, 0, 0.05, '#f0e0ff', S); },
    hollow_spire(g, S) { const sg = g.createLinearGradient(-0.1 * S, 0, 0.1 * S, 0); sg.addColorStop(0, '#1a1028'); sg.addColorStop(0.5, '#3c2a5a'); sg.addColorStop(1, '#07040c'); g.fillStyle = sg;
      g.beginPath(); g.moveTo(0, -0.48 * S); g.lineTo(0.12 * S, 0.3 * S); g.lineTo(0.22 * S, 0.44 * S); g.lineTo(-0.22 * S, 0.44 * S); g.lineTo(-0.12 * S, 0.3 * S); g.closePath(); g.fill();
      g.strokeStyle = '#c08aff'; g.lineWidth = Math.max(1, 0.012 * S); g.shadowColor = '#b07aff'; g.shadowBlur = 0.04 * S; g.beginPath(); g.moveTo(0, -0.4 * S); g.lineTo(0.03 * S, -0.1 * S); g.lineTo(-0.04 * S, 0.1 * S); g.lineTo(0.05 * S, 0.36 * S); g.stroke(); g.shadowBlur = 0;
      for (let k = 0; k < 5; k++) { g.fillStyle = 'rgba(200,150,255,.9)'; g.fillRect(-0.01 * S, (-0.3 + k * 0.14) * S, 0.02 * S, 0.02 * S); } },
  };
  Art.monster = (key, S) => {
    S = S || 128; const k = 'm:' + key + ':' + S; if (cache.has(k)) return cache.get(k);
    const c = mk(S), g = c.getContext('2d'); g.translate(S / 2, S / 2); g.lineJoin = 'round'; (MDRAW[key] || MDRAW.scavenger)(g, S * 0.95);
    cache.set(k, c); return c;
  };
  // ---- starbases: a hub that grows rings and arms with each level, with modules drawn on the arm ends ----
  const MOD = {
    shipyard(g, S, c) { g.strokeStyle = '#a8b2d0'; g.lineWidth = Math.max(1, S * 0.012); g.strokeRect(-0.05 * S, -0.04 * S, 0.12 * S, 0.08 * S); g.fillStyle = shade(c, 0.8); g.fillRect(-0.02 * S, -0.015 * S, 0.06 * S, 0.03 * S); },
    anchorage(g, S, c) { g.strokeStyle = '#a8b2d0'; g.lineWidth = Math.max(1, S * 0.012); g.beginPath(); g.moveTo(0, -0.06 * S); g.lineTo(0, 0.06 * S); g.moveTo(-0.04 * S, -0.06 * S); g.lineTo(0.04 * S, -0.06 * S); g.moveTo(-0.04 * S, 0.06 * S); g.lineTo(0.04 * S, 0.06 * S); g.stroke(); dot(g, 0, -0.06, 0.012, '#ffd27a', S); dot(g, 0, 0.06, 0.012, '#ffd27a', S); },
    battery(g, S, c) { turret(g, 0, 0, 0.04, S, c, 0); },
    tradehub(g, S, c) { for (let k = 0; k < 3; k++) { g.fillStyle = ['#c9a86a', '#8aa0c8', '#c88a6a'][k]; g.fillRect((-0.05 + k * 0.035) * S, -0.03 * S, 0.03 * S, 0.06 * S); } },
    drydock(g, S, c) { g.strokeStyle = '#a8b2d0'; g.lineWidth = Math.max(1, S * 0.014); g.beginPath(); g.arc(0, 0, 0.05 * S, -1.2, 1.2); g.stroke(); dot(g, 0.05, 0, 0.012, '#7dfcb0', S); },
  };
  Art.starbase = (lvl, mods, color, S) => {
    S = S || 128; const k = 'b:' + lvl + ':' + mods.join(',') + ':' + color + ':' + S; if (cache.has(k)) return cache.get(k);
    const c = mk(S), g = c.getContext('2d'); g.translate(S / 2, S / 2); g.lineJoin = 'round';
    const arms = [3, 3, 6, 6][lvl], rArm = [0.2, 0.3, 0.38, 0.44][lvl] * S, rHub = [0.08, 0.1, 0.12, 0.14][lvl] * S;
    if (lvl >= 2) { g.strokeStyle = '#4a5270'; g.lineWidth = 0.035 * S; g.beginPath(); g.arc(0, 0, rArm * 0.72, 0, 7); g.stroke(); g.strokeStyle = shade(color, 0.85); g.lineWidth = 0.01 * S; g.beginPath(); g.arc(0, 0, rArm * 0.72, 0, 7); g.stroke(); }
    if (lvl >= 3) { g.strokeStyle = '#3a4060'; g.lineWidth = 0.05 * S; g.setLineDash([0.06 * S, 0.03 * S]); g.beginPath(); g.arc(0, 0, rArm * 1.02, 0, 7); g.stroke(); g.setLineDash([]); }
    for (let i = 0; i < arms; i++) { const a = i * 2 * Math.PI / arms - Math.PI / 2; g.strokeStyle = '#7a84a6'; g.lineWidth = Math.max(1.5, 0.025 * S); g.beginPath(); g.moveTo(Math.cos(a) * rHub, Math.sin(a) * rHub); g.lineTo(Math.cos(a) * rArm, Math.sin(a) * rArm); g.stroke(); dot(g, Math.cos(a) * rArm / S, Math.sin(a) * rArm / S, 0.022, '#5a6280', S); dot(g, Math.cos(a) * rArm / S, Math.sin(a) * rArm / S, 0.01, color, S); }
    const hg = g.createRadialGradient(-rHub * 0.3, -rHub * 0.3, 0, 0, 0, rHub); hg.addColorStop(0, '#c8d0ec'); hg.addColorStop(0.6, '#5a6382'); hg.addColorStop(1, '#22263a'); g.fillStyle = hg;
    g.beginPath(); for (let k2 = 0; k2 < 8; k2++) { const a = k2 * Math.PI / 4; g.lineTo(Math.cos(a) * rHub, Math.sin(a) * rHub); } g.closePath(); g.fill(); g.strokeStyle = color; g.lineWidth = Math.max(1, 0.015 * S); g.stroke();
    dot(g, 0, 0, rHub / S * 0.35, color, S);
    mods.forEach((m, i) => { const a = (i + 0.5) * 2 * Math.PI / Math.max(arms, mods.length) - Math.PI / 2, r = rArm * (lvl >= 2 ? 0.72 : 0.62); g.save(); g.translate(Math.cos(a) * r, Math.sin(a) * r); g.rotate(a); (MOD[m] || MOD.battery)(g, S, color); g.restore(); });
    if (lvl === 0) { g.strokeStyle = '#a8b2d0'; g.lineWidth = Math.max(1, 0.012 * S); g.beginPath(); g.moveTo(0, -rHub); g.lineTo(0, -rHub - 0.12 * S); g.stroke(); dot(g, 0, -(rHub / S) - 0.12, 0.015, '#ff6b81', S); }
    cache.set(k, c); return c;
  };
  // a soft additive glow used for engine flames and lights
  const glowC = {};
  Art.glow = (col) => { if (glowC[col]) return glowC[col]; const c = mk(32), g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return (glowC[col] = c); };
})();
