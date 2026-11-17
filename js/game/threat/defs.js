// Threats and defence (owner H): content and tuning lookups for js/game/threat/* and
// js/game/defence/*. Numbers come from js/data/ (balance.js 'threat' and 'caps', storytellers.js,
// incidents.js, raiders.js); this module only finds them. The default registry is G's CONTENT;
// core/content.js (A) may install a validated one with setThreatContent(reg).

import { CONTENT } from '../../data/index.js';

let REG = CONTENT;
export function setThreatContent(reg) { REG = reg; }
export const registry = () => REG;
export const def = (kind, id) => (id === null || id === undefined ? null : REG.get(kind, id));
export const all = (kind) => REG.all(kind);
export function bal(section) { const b = REG.get('balance', section); return (b && b.values) || {}; }
/** A text template's variants (text/*.js), or [] when absent. */
export function variants(id) { const t = REG.get('text', id); return (t && (t.variants || (t.text ? [t.text] : []))) || []; }
