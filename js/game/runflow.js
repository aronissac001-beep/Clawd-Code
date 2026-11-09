// RunFlow: the app-level director for a run. Shows the Realm Map, resolves
// non-region nodes (events, merchant, shrine), hands regions to the
// GameController, folds finished regions back into the run and saves after
// every step so a run can be resumed anywhere.
import { RUN } from '../data/balance.js';
import { BUILDINGS } from '../data/buildings.js';
import { BEACONS } from '../data/beacons.js';
import { NODE_TYPES } from './realmmap.js';
import {
  createNewRun, enterNode, travelOptions, currentNode, resolveEvent, eventView, buyItem,
  resolveShrine, WHEEL, finishRegion, beaconOptions, takeBeacon, bankedEmbers, relicViews,
  ownedSets, pendingChainEvent, RUN_VERSION,
} from './run.js';
import { serializeState, deserializeState, migrateState } from './state.js';
import { saveRun, clearRun } from '../engine/save.js';
import { audio } from '../engine/audio.js';
import { renderRealmMap } from '../ui/realmmap-ui.js';
import {
  showEventDialog, showEventResult, showMerchant, showShrine, showWheel, showBeaconChoice,
  showRelicList, showRunSummary,
} from '../ui/runscreens.js';
import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

// ---- (De)serialisation -----------------------------------------------------------
export function serializeRun(run) {
  const out = { ...run, region: run.region ? serializeState(run.region) : null };
  return JSON.parse(JSON.stringify(out));
}

/** Accepts a v2 run or a v1 (Phase 1) single-region save and returns a live run. */
export function deserializeRun(data) {
  if (!data || typeof data !== 'object') throw new Error('Save data is not a realm.');
  if (Array.isArray(data.terrain)) {
    // Phase 1 save: a lone region. Wrap it in a fresh run and resume the region.
    const region = deserializeState(data);
    const run = createNewRun({ seedText: region.seedText || 'EMBER-1', difficulty: region.difficulty || 'standard' });
    const first = run.map.steps[0][0];
    run.pos = first; run.visited = [first];
    run.blueprints = region.blueprints.slice();
    region.standalone = false;
    run.region = region;
    return run;
  }
  if ((data.v || 0) > RUN_VERSION) throw new Error('This save comes from a newer version of Embercrown.');
  const run = { ...data };
  if (run.region) run.region = deserializeState(migrateState(run.region));
  run.flags = run.flags || { seenEvents: [] };
  run.next = run.next || {};
  return run;
}

export class RunFlow {
  constructor(app) {
    this.app = app;
    this.run = null;
    this.mapView = null;
  }

  save() {
    if (!this.run || this.run.ended) return true;
    return saveRun(serializeRun(this.run));
  }

  newRun(opts) {
    this.run = createNewRun(opts);
    this.save();
    this.showMap(true);
  }

  resume(data) {
    this.run = deserializeRun(data);
    if (this.run.region) this.playRegion(this.run.region);
    else this.showMap();
  }

  // ---- Realm Map -------------------------------------------------------------------
  showMap(first = false) {
    const app = this.app;
    if (app.ctl.active) app.ctl.stop();
    app.modal.close();
    audio.setMode('menu');
    const screens = document.getElementById('screens');
    if (this.mapView) { this.mapView.destroy(); this.mapView = null; }
    screens.innerHTML = '';
    const wrap = el('div', 'screen realm-screen');
    wrap.style.padding = '0';
    screens.appendChild(wrap);
    this.mapView = renderRealmMap(wrap, this.run, {
      onTravel: (id) => this.travel(id),
      onRelic: (id) => this.showRelics(id),
      onMenu: () => this.openMenu(),
    });
    if (first) {
      app.modal.dialog('The Realm Map', el('div', '', `<p class="lead">The Hollowing has swallowed the old empire. Carry the Heartflame east, one region at a time. Each Beacon you light pushes back the dark.</p><p class="lead">Pick a path. The grey front follows one step behind you, so there is no turning back. At the end of the road the <b>Gloomwyrm</b> waits.</p>`), [{ label: 'Set out', icon: 'flame' }]);
    } else {
      const chain = pendingChainEvent(this.run);
      if (chain) setTimeout(() => this.presentEvent(chain), 350);
    }
  }

  refreshMap() { if (this.mapView) this.mapView.update(this.run); }

  travel(nodeId) {
    if (!travelOptions(this.run).includes(nodeId)) return;
    const res = enterNode(this.run, nodeId);
    if (!res) return;
    this.save();
    audio.play('ok');
    switch (res.kind) {
      case 'region': this.playRegion(res.region); break;
      case 'event': this.refreshMap(); this.presentEvent(res.event); break;
      case 'merchant': this.refreshMap(); this.presentMerchant(res.shop); break;
      case 'shrine': this.refreshMap(); this.presentShrine(res.options); break;
    }
  }

  // ---- Node screens -----------------------------------------------------------------
  presentEvent(ev) {
    const app = this.app;
    showEventDialog(app.modal, eventView(ev, this.run), (i) => {
      const res = resolveEvent(this.run, ev, i);
      if (!res) return;
      this.save();
      audio.play(res.win ? 'coin' : 'error');
      showEventResult(app.modal, { title: ev.choices[i].label, lines: res.lines, good: res.win }, () => this.afterNode());
    });
  }

  presentMerchant(shop) {
    const app = this.app;
    showMerchant(app.modal, shop, this.run, (i) => {
      const r = buyItem(this.run, shop, i);
      if (r.ok) { this.save(); this.refreshMap(); }
      return r;
    }, () => this.afterNode());
  }

  presentShrine(options) {
    const app = this.app;
    showShrine(app.modal, options, (i) => {
      const id = options[i].id;
      const res = resolveShrine(this.run, id);
      this.save();
      const done = () => showEventResult(app.modal, { title: options[i].title, lines: res.lines, good: !res.lines.some((l) => /cursed/i.test(l)) }, () => this.afterNode());
      if (res.wheelIndex != null) showWheel(app.modal, WHEEL.map((w) => ({ label: w.label, p: w.p, color: w.color })), res.wheelIndex, done);
      else { audio.play('dawn'); done(); }
    });
  }

  afterNode() {
    this.app.modal.close(); this.refreshMap(); this.save();
    // Event chains may come due after any node.
    const chain = pendingChainEvent(this.run);
    if (chain) setTimeout(() => this.presentEvent(chain), 300);
  }

  showRelics(focus = null) {
    showRelicList(this.app.modal, relicViews(this.run), ownedSets(this.run), () => {}, { focus });
  }

  openMenu() {
    const app = this.app;
    const d = el('div', 'dialog panel');
    d.appendChild(el('h2', '', 'The Road'));
    d.appendChild(el('p', 'lead')).textContent = `${this.run.heraldry.name} · seed ${this.run.seedText}`;
    const col = el('div', 'menu-col'); col.style.margin = '0 auto';
    const mk = (label, ic, fn, cls = '') => {
      const b = el('button', 'big-btn ' + cls, icon(ic) + '<span></span>');
      b.querySelector('span').textContent = label;
      b.addEventListener('pointerup', () => { audio.play('click'); fn(); });
      col.appendChild(b);
    };
    mk('Resume', 'play', () => app.modal.close());
    mk('Relics', 'gold', () => this.showRelics(), 'secondary');
    mk('Settings', 'gear', () => app.openSettings(() => this.openMenu()), 'secondary');
    mk('How to Play', 'book', () => app.openHelp(() => this.openMenu()), 'secondary');
    mk('Save & Quit', 'export', () => { this.save(); app.modal.close(); app.toMenu(); }, 'secondary');
    mk('Abandon Run', 'skull', () => app.confirm('Abandon this run?', 'The run ends now. Embers already earned are kept.', () => this.endRun({ result: 'defeat', reason: 'You turned back from the road.' }), () => this.openMenu()), 'danger');
    d.appendChild(col);
    app.modal.show(d, { dismissable: true });
  }

  // ---- Regions ---------------------------------------------------------------------
  playRegion(s) {
    document.getElementById('screens').innerHTML = '';
    if (this.mapView) { this.mapView.destroy(); this.mapView = null; }
    this.app.ctl.start(s);
    this.app.measure();
  }

  /** Called by the GameController when a region ends (Beacon lit or defeat). */
  regionOver(s) {
    const run = this.run;
    const node = currentNode(run);
    const sum = finishRegion(run, s);
    this.save();
    if (run.outcome) { this.endRun(run.outcome, sum); return; }
    const app = this.app;
    const body = el('div');
    body.innerHTML = `<p class="lead"></p><div class="statgrid">
      <div><b>${sum.nights}</b>nights held</div><div><b>${sum.kills}</b>Hollow slain</div>
      <div><b>+${sum.embers}</b>Embers</div><div><b>${run.gold}</b>gold carried</div></div>`;
    body.querySelector('.lead').textContent = s.outcome.reason;
    for (const l of sum.loot) body.appendChild(el('p', 'lead')).textContent = l;
    audio.play('victory');
    app.modal.dialog(`${node ? NODE_TYPES[node.type].name : 'Region'} Cleared`, body, [{ label: 'Choose a Beacon', icon: 'beacon', onTap: () => this.offerBeacons() }]);
  }

  offerBeacons() {
    const ids = beaconOptions(this.run);
    if (!ids.length) { this.showMap(); return; }
    showBeaconChoice(this.app.modal, ids.map((id) => ({ name: BEACONS[id].name, text: BEACONS[id].text, icon: BEACONS[id].icon })), (i) => {
      takeBeacon(this.run, ids[i]);
      this.save();
      audio.play('dawn');
      this.showMap();
    });
  }

  endRun(outcome, sum) {
    const app = this.app, run = this.run;
    run.outcome = run.outcome || outcome;
    if (app.ctl.active) app.ctl.stop();
    const banked = bankedEmbers(run);
    const m = app.meta;
    m.embers += banked; m.runs++;
    if (run.outcome.result === 'victory') m.wins++;
    m.best.nights = Math.max(m.best.nights, run.stats.nights);
    app.saveMeta(m);
    run.ended = true;
    clearRun();
    audio.setMode('silent');
    audio.play(run.outcome.result === 'victory' ? 'victory' : 'defeat');
    const node = currentNode(run);
    showRunSummary(app.modal, {
      title: run.outcome.result === 'victory' ? 'Act I Complete' : 'The Flame Fades',
      reason: run.outcome.reason,
      stats: [
        ['Regions cleared', run.regionsCleared], ['Nights survived', run.stats.nights], ['Hollow slain', run.stats.kills],
        ['Relics found', run.stats.relicsFound], ['Furthest step', node ? `${node.step + 1}/${RUN.stepsPerAct + 1}` : '-'],
        ['Embers banked', `+${banked}`], ['Embers total', m.embers],
      ],
      seed: run.seedText,
      victory: run.outcome.result === 'victory',
    }, [
      { label: 'New Realm', icon: 'flame', onTap: () => app.toSetup() },
      { label: 'Title', cls: 'secondary', onTap: () => app.toMenu() },
    ]);
    void sum;
  }
}
export { BUILDINGS };
