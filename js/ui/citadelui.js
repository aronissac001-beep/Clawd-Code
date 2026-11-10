// The Ember Citadel hub screen and the New Realm screen's Perks / Omens of Ruin
// section. UI only: meta.citadel and meta.embers change here (then app.saveMeta());
// run effects are applied by js/game/meta/citadel.js when a run starts.
import { el, tapButton } from './dom.js';
import { icon } from './icons.js';
import { audio } from '../engine/audio.js';
import { CitadelArt } from '../engine/citadelart.js';
import { CITADEL_UPGRADES, CITADEL_LIST, TIER_GATE, TIER_NAMES } from '../data/citadel.js';
import { PERKS } from '../data/perks.js';
import { RUIN_EMBER_STEP } from '../data/omens.js';
import {
  citadelMeta, upgradeStatus, buyUpgrade, perkSlots, perkUnlocked, listPerks, listOmens,
  sanitizePerks, sanitizeOmens, ruinOf, omensOpen,
} from '../game/meta/citadel.js';

const ROMAN = ['', 'I', 'II', 'III', 'IV'];
const KIND_LABEL = { unlock: 'Unlock', passive: 'Lasting bonus', cosmetic: 'Cosmetic' };

function bannerColors(meta) {
  const c = meta.citadel || {};
  const u = c.banner && CITADEL_UPGRADES[c.banner];
  return u && u.heraldry ? [u.heraldry.field, u.heraldry.charge] : null;
}

// ---- The Citadel screen ----------------------------------------------------------------
let view = null;

export function openCitadel(app) {
  if (app.ctl && app.ctl.active) app.ctl.stop();
  app.modal.close();
  audio.setMode && audio.setMode('menu');
  const meta = app.meta;
  const C = citadelMeta(meta);
  if (view) view.art.destroy();
  const screen = el('div', 'screen cit-screen');
  const top = el('div', 'cit-top');
  const back = el('button', 'big-btn secondary cit-back', icon('x') + '<span>Back</span>');
  back.setAttribute('aria-label', 'Back to the menu');
  tapButton(back, () => { if (view) view.art.destroy(); view = null; app.toMenu(); });
  const title = el('h2', 'cit-title', 'Ember Citadel');
  const embers = el('div', 'cit-embers panel');
  top.append(back, title, embers);
  const main = el('div', 'cit-main');
  const artBox = el('div', 'cit-art panel');
  const canvas = el('canvas');
  canvas.setAttribute('aria-label', 'Your Citadel on its hill');
  canvas.setAttribute('role', 'img');
  const cap = el('p', 'hint cit-cap');
  artBox.append(canvas);
  const list = el('div', 'cit-list');
  main.append(artBox, list);
  screen.append(top, main);
  const screens = document.getElementById('screens');
  screens.innerHTML = '';
  screens.appendChild(screen);

  const art = new CitadelArt(canvas, { reduceMotion: !!(meta.settings && meta.settings.reduceMotion) });
  view = { art, screen };
  art.set(C.owned, bannerColors(meta));
  art.start();

  const refreshHead = () => {
    embers.innerHTML = `${icon('flame')}<b>${meta.embers}</b><span>Embers</span>`;
    const total = CITADEL_LIST.length;
    cap.textContent = `${C.owned.length} of ${total} built` + (C.bestRuin ? ` · highest Ruin conquered: ${C.bestRuin}` : '');
  };

  const render = () => {
    refreshHead();
    const scroll = list.scrollTop;
    list.innerHTML = '';
    list.appendChild(cap);
    for (let tier = 1; tier <= 4; tier++) {
      const sec = el('section', 'cit-tier');
      const gate = TIER_GATE[tier] || 0;
      const open = C.owned.length >= gate;
      const h = el('h3', '', `Tier ${ROMAN[tier]} · ${TIER_NAMES[tier]}`);
      if (!open) h.appendChild(el('span', 'cit-gate', ` opens at ${gate} built`));
      sec.appendChild(h);
      for (const u of CITADEL_LIST.filter((x) => x.tier === tier)) sec.appendChild(row(u));
      list.appendChild(sec);
    }
    list.scrollTop = scroll;
  };

  const row = (u) => {
    const st = upgradeStatus(meta, u.id);
    const r = el('div', 'cit-row panel' + (st.owned ? ' owned' : st.ok ? ' ready' : ''));
    r.dataset.id = u.id;
    const ic = el('div', 'cit-ic', icon(u.icon || 'castle'));
    const body = el('div', 'cit-body');
    const name = el('div', 'cit-name');
    name.textContent = u.name;
    const kind = el('span', 'cit-kind ' + u.kind);
    kind.textContent = KIND_LABEL[u.kind] || u.kind;
    name.appendChild(kind);
    const text = el('p', 'cit-text');
    text.textContent = u.text;
    body.append(name, text);
    if (!st.owned && !st.ok) { const why = el('p', 'cit-why'); why.textContent = st.reason; body.appendChild(why); }
    const act = el('div', 'cit-act');
    if (st.owned) {
      if (u.kind === 'cosmetic') {
        const flying = C.banner === u.id;
        const b = el('button', 'hbtn cit-fly' + (flying ? ' on' : ''), `<span>${flying ? 'Flying' : 'Fly'}</span>`);
        b.setAttribute('aria-label', flying ? `Stop flying ${u.name}` : `Fly ${u.name}`);
        tapButton(b, () => {
          C.banner = flying ? null : u.id;
          app.saveMeta();
          art.set(C.owned, bannerColors(meta) || ['#c9973e', '#7a2a1c']);
          render();
        });
        act.appendChild(b);
      } else act.appendChild(el('div', 'cit-owned', icon('check') + '<span>Built</span>'));
    } else {
      const b = el('button', 'big-btn cit-buy', `${icon('flame')}<span>${u.cost}</span>`);
      b.setAttribute('aria-label', `Build ${u.name} for ${u.cost} Embers`);
      b.disabled = !st.ok;
      tapButton(b, () => {
        const res = buyUpgrade(meta, u.id);
        if (!res.ok) { app.toasts.show(res.msg, 'bad'); audio.play('error'); return; }
        app.saveMeta();
        audio.play('build');
        app.toasts.show(res.msg, 'good');
        art.set(C.owned, bannerColors(meta), u.id);
        render();
      }, { sound: 'ok' });
      act.appendChild(b);
    }
    r.append(ic, body, act);
    return r;
  };
  render();
  return view;
}

// ---- New Realm screen section -------------------------------------------------------------
/** BUS.setup section: starting perks and the Omens of Ruin (Campaign and Endless only). */
export function citadelSetup(container, opts, app) {
  if (opts.mode !== 'campaign' && opts.mode !== 'endless') return;
  const meta = app.meta;
  const C = citadelMeta(meta);
  const owned = C.owned;
  const slots = perkSlots(owned);
  opts.perks = sanitizePerks(owned, opts.perks || C.lastPerks);
  opts.omens = omensOpen(meta) ? sanitizeOmens(opts.omens || C.lastOmens) : [];
  const box = el('div', 'panel cit-setup');
  container.appendChild(box);
  const remember = () => { C.lastPerks = opts.perks.slice(); C.lastOmens = opts.omens.slice(); app.saveMeta(); };

  const draw = () => {
    box.innerHTML = '';
    const head = el('div', 'cit-shead');
    head.appendChild(el('b', '', 'Starting perks'));
    head.appendChild(el('span', 'hint', `${slots} slot${slots > 1 ? 's' : ''}${slots < 3 ? ' · more in the Citadel' : ''}`));
    box.appendChild(head);
    const rowEl = el('div', 'cit-slots');
    for (let i = 0; i < 3; i++) {
      if (i < slots) {
        const id = opts.perks[i];
        const p = id && PERKS[id];
        const b = el('button', 'cit-slot' + (p ? ' full' : ''), p ? `${icon(p.icon)}<span></span>` : `${icon('plus')}<span>Choose a perk</span>`);
        if (p) b.querySelector('span').textContent = p.name;
        b.setAttribute('aria-label', p ? `Perk slot ${i + 1}: ${p.name}. Change` : `Perk slot ${i + 1}: empty. Choose a perk`);
        b.dataset.slot = String(i);
        tapButton(b, () => openPerkPicker(app, opts, Math.min(i, opts.perks.length), () => { remember(); draw(); }));
        rowEl.appendChild(b);
      } else {
        const b = el('button', 'cit-slot locked', `${icon('lock')}<span>Slot ${ROMAN[i + 1]}</span>`);
        b.setAttribute('aria-label', `Perk slot ${i + 1} is locked`);
        tapButton(b, () => app.toasts.show(`Build Perk Slot ${ROMAN[i + 1]} in the Ember Citadel to take ${i + 1} perks.`, ''));
        rowEl.appendChild(b);
      }
    }
    box.appendChild(rowEl);
    if (omensOpen(meta)) {
      const ruin = ruinOf(opts.omens);
      const b = el('button', 'big-btn secondary cit-omenbtn' + (ruin ? ' on' : ''), `${icon('omen')}<span></span>`);
      b.querySelector('span').textContent = ruin ? `Omens of Ruin: ${opts.omens.length} taken · Ruin ${ruin} · Embers +${Math.round(ruin * RUIN_EMBER_STEP * 100)}%` : 'Omens of Ruin: none taken';
      tapButton(b, () => openOmens(app, opts, () => { remember(); draw(); }));
      box.appendChild(b);
    } else box.appendChild(el('p', 'hint', 'Win a run to open the Omens of Ruin: optional hardships that raise the Embers you bank.'));
  };
  draw();
}

function openPerkPicker(app, opts, slot, done) {
  const owned = citadelMeta(app.meta).owned;
  const d = el('div', 'dialog panel cit-picker');
  d.appendChild(el('h2', '', 'Choose a Perk'));
  d.appendChild(el('p', 'lead', `Slot ${slot + 1}. A perk lasts the whole run.`));
  const list = el('div', 'cit-plist');
  const current = opts.perks[slot] || null;
  const pick = (id) => {
    const p = opts.perks.slice();
    const other = id ? p.indexOf(id) : -1;
    if (id === null) { if (slot < p.length) p.splice(slot, 1); }
    else if (other >= 0 && other !== slot) { p[other] = p[slot] || null; p[slot] = id; }
    else p[slot] = id;
    opts.perks = sanitizePerks(owned, p.filter(Boolean));
    app.modal.close();
    done();
  };
  for (const p of listPerks()) {
    const open = perkUnlocked(owned, p);
    const inSlot = opts.perks.indexOf(p.id);
    const b = el('button', 'cit-prow' + (open ? '' : ' locked') + (inSlot === slot ? ' on' : ''));
    b.dataset.perk = p.id;
    b.innerHTML = `${icon(open ? p.icon : 'lock')}<div><b></b><p></p><i></i></div>`;
    b.querySelector('b').textContent = p.name;
    b.querySelector('p').textContent = p.text;
    const note = b.querySelector('i');
    if (!open) note.textContent = `Unlocked by ${CITADEL_UPGRADES[p.requires] ? CITADEL_UPGRADES[p.requires].name : 'the Citadel'} in the Ember Citadel.`;
    else if (inSlot === slot) note.textContent = 'Chosen for this slot.';
    else if (inSlot >= 0) note.textContent = `In slot ${inSlot + 1}: tap to swap.`;
    else note.remove();
    tapButton(b, () => {
      if (!open) { app.toasts.show(note.textContent, ''); audio.play('error'); return; }
      pick(p.id);
    });
    list.appendChild(b);
  }
  d.appendChild(list);
  const acts = el('div', 'actions');
  if (current) {
    const clr = el('button', 'big-btn secondary', '<span>Empty this slot</span>');
    tapButton(clr, () => pick(null));
    acts.appendChild(clr);
  }
  const close = el('button', 'big-btn', '<span>Done</span>');
  tapButton(close, () => app.modal.close());
  acts.appendChild(close);
  d.appendChild(acts);
  app.modal.show(d, { dismissable: true });
}

function openOmens(app, opts, done) {
  const d = el('div', 'dialog panel cit-picker');
  d.appendChild(el('h2', '', 'Omens of Ruin'));
  d.appendChild(el('p', 'lead', 'Take on hardships for the whole run. Each point of Ruin banks 15% more Embers at the end.'));
  const total = el('div', 'cit-ruin panel');
  const list = el('div', 'cit-plist');
  const chosen = new Set(opts.omens);
  const sum = () => {
    const ids = [...chosen];
    const ruin = ruinOf(ids);
    total.innerHTML = `${icon('omen')}<b>Ruin ${ruin}</b><span>Embers +${Math.round(ruin * RUIN_EMBER_STEP * 100)}%</span>`;
  };
  for (const o of listOmens()) {
    const b = el('button', 'cit-prow omen' + (chosen.has(o.id) ? ' on' : ''));
    b.dataset.omen = o.id;
    b.setAttribute('aria-pressed', chosen.has(o.id) ? 'true' : 'false');
    b.innerHTML = `${icon(o.icon || 'omen')}<div><b></b><p></p></div><span class="cit-pips"></span>`;
    b.querySelector('b').textContent = o.name;
    b.querySelector('p').textContent = o.text;
    b.querySelector('.cit-pips').textContent = `Ruin ${o.ruin}`;
    tapButton(b, () => {
      if (chosen.has(o.id)) chosen.delete(o.id); else chosen.add(o.id);
      b.classList.toggle('on', chosen.has(o.id));
      b.setAttribute('aria-pressed', chosen.has(o.id) ? 'true' : 'false');
      sum();
    });
    list.appendChild(b);
  }
  sum();
  d.append(total, list);
  const acts = el('div', 'actions');
  const none = el('button', 'big-btn secondary', '<span>Clear all</span>');
  tapButton(none, () => { chosen.clear(); for (const b of list.children) { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); } sum(); });
  const ok = el('button', 'big-btn', '<span>Done</span>');
  tapButton(ok, () => app.modal.close());
  acts.append(none, ok);
  d.appendChild(acts);
  app.modal.show(d, { dismissable: true, onClose: () => { opts.omens = sanitizeOmens([...chosen]); done(); } });
}

