// Dawn Card and Beacon reward dialogs (rework, stream H2). Registers the simulation side
// (js/game/systems/dawncards.js) and the two pending-choice screens. Each is one tap: the
// card is the answer. Text stays at 14px or more; every card is a full-width touch target.
import { BUS } from '../game/hooks.js';
import { BUILDINGS } from '../data/buildings.js';
import { register as registerSim, cardText, rewardText } from '../game/systems/dawncards.js';
import { el } from './dom.js';

function costLine(type) {
  const d = BUILDINGS[type];
  const c = d && d.levels && d.levels[0] && d.levels[0].cost;
  if (!c) return '';
  const parts = Object.entries(c).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`);
  return parts.length ? ` Costs ${parts.join(', ')}.` : '';
}

/** Show options as cards with a small kind tag above each title. */
function showCards(ctl, title, lead, cards) {
  const opts = cards.map((c, i) => ({
    icon: c.icon, title: c.title, text: c.text,
    onPick: () => { ctl.cmd({ t: 'choose', i }); if (ctl.autosave) ctl.autosave(); if (ctl.coach && ctl.coach.event) ctl.coach.event('dawnclosed'); },
  }));
  const d = ctl.app.modal.choice(title, lead, opts);
  d.classList.add('dawncards');
  d.querySelectorAll('.choice').forEach((b, i) => {
    const tag = el('span', 'dc-kind k-' + cards[i].tag);
    tag.textContent = cards[i].kind;
    b.insertBefore(tag, b.querySelector('h4'));
  });
}

function dawnCardUI(ctl, s) {
  const cards = s.pending.options.map((o) => {
    const t = cardText(s, o);
    return { ...t, text: t.text + (o.k === 'bp' ? costLine(o.type) : ''), tag: o.k };
  });
  showCards(ctl, `Dawn ${s.cycle.night}: choose a card`, 'One card a dawn. Upgrades last the whole run.', cards);
}

function beaconPickUI(ctl, s) {
  const cards = s.pending.options.map((o) => ({ ...rewardText(o), tag: o.k }));
  showCards(ctl, 'The Long Night is held', 'The Beacon can be lit. Choose what its light grants your road: a relic or a lasting bonus.', cards);
}

const CSS = `
.dawncards .choice { position: relative; }
.dawncards .dc-kind { display: block; font-size: 14px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; color: #7a4e12; margin: 2px 0; }
.dawncards .dc-kind.k-up { color: #8a3a12; }
.dawncards .dc-kind.k-hero { color: #3a5a8a; }
.dawncards .dc-kind.k-sup { color: #5a5a40; }
.dawncards .dc-kind.k-relic { color: #6a3a8a; }
`;
function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('dawncards-css')) return;
  const st = document.createElement('style');
  st.id = 'dawncards-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

let done = false;
export function register() {
  if (done) return;
  done = true;
  registerSim();
  injectCss();
  BUS.pendingUI.dawnCard = dawnCardUI;
  BUS.pendingUI.beaconPick = beaconPickUI;
}
