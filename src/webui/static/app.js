/* Clawd Code UI.
 *
 * No framework and no build step: the app is served from a Python process on
 * localhost and has to survive being opened by a pywebview shell with whatever
 * WebView2 happens to be installed. A bundler would buy component ergonomics
 * and cost the ability to edit one file and reload.
 */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, body, method) {
  const opts = { method: method || (body ? 'POST' : 'GET') };
  if (body) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { detail: text }; }
  if (!res.ok) throw new Error(data.detail || `${res.status} ${res.statusText}`);
  return data;
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
}

const state = {
  busy: false,
  planMode: false,
  view: localStorage.getItem('view') || 'normal',
  model: 'auto',
  modelLabel: 'Auto',
  catalog: null,
  attachments: [],
  diffs: [],
  status: {},
  mediaModels: [],
  mediaTask: 'text-to-image',
  mediaSource: null,
  jobPoll: null,
};

/* ------------------------------------------------------------ markdown */

/* A sentinel that cannot occur in prose. It used to be a NUL byte, which the
 * editor wrote into the file literally and corrupted it. */
const MARK = 'CODEBLOCK';

const KEYWORDS = new Set(('def class return if elif else for while in not and or is None ' +
  'True False import from as with try except finally raise lambda yield global await ' +
  'async pass break continue const let var function new this typeof instanceof export ' +
  'default extends super null undefined interface type enum public private static void ' +
  'struct impl fn match use pub mut').split(' '));

function highlight(code) {
  const out = [];
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    if (c === '#' || (c === '/' && code[i + 1] === '/')) {
      let j = code.indexOf('\n', i);
      if (j < 0) j = n;
      out.push(`<span class="tok-com">${esc(code.slice(i, j))}</span>`);
      i = j;
    } else if (c === '"' || c === "'" || c === '`') {
      const triple = code.substr(i, 3);
      const quote = (triple === '"""' || triple === "'''") ? triple : c;
      let j = i + quote.length;
      while (j < n && code.substr(j, quote.length) !== quote) {
        if (code[j] === '\\') j++;
        j++;
      }
      j = Math.min(n, j + quote.length);
      out.push(`<span class="tok-str">${esc(code.slice(i, j))}</span>`);
      i = j;
    } else if (/[0-9]/.test(c) && !/[\w.]/.test(code[i - 1] || '')) {
      let j = i;
      while (j < n && /[0-9a-fA-FxX._]/.test(code[j])) j++;
      out.push(`<span class="tok-num">${esc(code.slice(i, j))}</span>`);
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[\w]/.test(code[j])) j++;
      const word = code.slice(i, j);
      if (KEYWORDS.has(word)) out.push(`<span class="tok-kw">${esc(word)}</span>`);
      else if (code[j] === '(') out.push(`<span class="tok-fn">${esc(word)}</span>`);
      else out.push(esc(word));
      i = j;
    } else {
      out.push(esc(c));
      i++;
    }
  }
  return out.join('');
}

function md(src) {
  const blocks = [];
  let text = String(src ?? '').replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push({ lang, code: code.replace(/\n$/, '') });
    return MARK;
  });

  text = esc(text)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const html = text.split('\n\n').map((para) => {
    const trimmed = para.trim();
    if (!trimmed) return '';
    if (trimmed === MARK) return MARK;
    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) return `<h${heading[1].length}>${heading[2]}</h${heading[1].length}>`;
    if (/^[-*]\s/m.test(trimmed) && trimmed.split('\n').every((l) => /^[-*]\s/.test(l.trim()))) {
      return `<ul>${trimmed.split('\n').map((l) => `<li>${l.replace(/^\s*[-*]\s/, '')}</li>`).join('')}</ul>`;
    }
    if (/^\d+\.\s/m.test(trimmed) && trimmed.split('\n').every((l) => /^\d+\.\s/.test(l.trim()))) {
      return `<ol>${trimmed.split('\n').map((l) => `<li>${l.replace(/^\s*\d+\.\s/, '')}</li>`).join('')}</ol>`;
    }
    if (trimmed.startsWith('&gt;')) return `<blockquote>${trimmed.replace(/^&gt;\s?/gm, '')}</blockquote>`;
    return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  let index = 0;
  return html.replace(new RegExp(MARK, 'g'), () => {
    const block = blocks[index++];
    if (!block) return '';
    return `<div class="codeblock">${block.lang ? `<span class="lang">${esc(block.lang)}</span>` : ''}` +
      `<button class="copy">Copy</button><pre><code>${highlight(block.code)}</code></pre></div>`;
  });
}

/* ------------------------------------------------------------ messages */

function clearEmpty() { $('#empty')?.remove(); }

function addMessage(role, text, badge) {
  clearEmpty();
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  const who = role === 'user' ? 'You' : role === 'error' ? 'Error' : 'Clawd';
  el.innerHTML = `<div class="msg-head">${who}${badge ? `<span class="badge">${esc(badge)}</span>` : ''}</div>` +
    `<div class="body">${md(text)}</div>`;
  $('#thread').append(el);
  scrollDown();
  return el;
}

function addAttachmentStrip(parent, items) {
  if (!items.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'msg-media';
  wrap.innerHTML = items.map((a) => (a.kind === 'video'
    ? `<video src="${esc(a.url)}" controls></video>`
    : `<img src="${esc(a.url)}" alt="">`)).join('');
  parent.querySelector('.body').before(wrap);
}

function scrollDown() {
  const box = $('#chat-scroll');
  box.scrollTop = box.scrollHeight;
}

function renderDiff(hunks) {
  const wrap = document.createElement('div');
  wrap.className = 'diff';
  wrap.innerHTML = (hunks || []).map((h) => {
    const lines = (h.lines || []).map((raw) => {
      const sign = raw[0];
      const cls = sign === '+' ? 'add' : sign === '-' ? 'del' : '';
      return `<div class="ln ${cls}">${esc(raw)}</div>`;
    }).join('');
    return `<div class="hunk"><div class="hh">@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@</div>${lines}</div>`;
  }).join('');
  return wrap;
}

function addToolCard(name, input, before) {
  const card = document.createElement('details');
  card.className = 'tool';
  const first = input && typeof input === 'object' ? Object.values(input)[0] : input;
  card.innerHTML = `<summary><span class="tname">${esc(name)}</span>` +
    `<span class="targ">${esc(String(first ?? '').slice(0, 130))}</span>` +
    `<span class="tstate run">running…</span></summary>`;
  (before ? before.querySelector('.body') : $('#thread')).before?.(card);
  if (before) before.querySelector('.body').before(card);
  else $('#thread').append(card);
  scrollDown();
  return card;
}

/* ------------------------------------------------------------ chat */

async function send(textOverride) {
  if (state.busy) return;
  const box = $('#input');
  const text = (textOverride ?? box.value).trim();
  if (!text && !state.attachments.length) return;

  const attachments = state.attachments.slice();
  box.value = '';
  autoGrow();
  const userEl = addMessage('user', text || '(image)');
  addAttachmentStrip(userEl, attachments);
  clearAttachments();

  if (state.planMode) return runPlan(text);

  setBusy(true);
  const el = addMessage('assistant', '', state.model === 'auto' ? null : state.modelLabel);
  const body = el.querySelector('.body');
  const live = document.createElement('span');
  body.append(live);
  let buffer = '';
  const openTools = new Map();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        attachments: attachments.map((a) => a.name),
        model: state.model,
      }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let carry = '';

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      const parts = carry.split('\n\n');
      carry = parts.pop();

      for (const part of parts) {
        const line = part.replace(/^data: /, '').trim();
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }

        if (ev.type === 'text') {
          buffer += ev.data;
          live.textContent = buffer;
          scrollDown();
        } else if (ev.type === 'tool') {
          if (ev.kind === 'tool_use') {
            openTools.set(ev.name, addToolCard(ev.name, ev.input, el));
          } else {
            const card = openTools.get(ev.name) || addToolCard(ev.name, ev.input, el);
            const status = card.querySelector('.tstate');
            status.className = `tstate ${ev.is_error ? 'err' : 'ok'}`;
            status.textContent = ev.is_error ? 'failed' : 'done';
            if (ev.patch) {
              card.append(renderDiff(ev.patch));
              recordDiff(ev.file, ev.patch);
            } else if (ev.output) {
              const out = document.createElement('div');
              out.className = 'tbody';
              out.textContent = ev.output;
              card.append(out);
            }
            openTools.delete(ev.name);
          }
        } else if (ev.type === 'done') {
          body.innerHTML = md(ev.text || buffer);
          const usage = ev.usage || {};
          const bits = [];
          if (usage.input_tokens) bits.push(`${usage.input_tokens} in`);
          if (usage.output_tokens) bits.push(`${usage.output_tokens} out`);
          if (ev.turns) bits.push(`${ev.turns} turn${ev.turns === 1 ? '' : 's'}`);
          if (ev.route) bits.push(ev.route.target);
          if (bits.length) {
            const meta = document.createElement('div');
            meta.className = 'msg-head';
            meta.style.marginTop = '7px';
            meta.textContent = bits.join(' · ');
            el.append(meta);
          }
          if (ev.session_tokens) {
            $('#s-tokens').textContent = `${ev.session_tokens.in} / ${ev.session_tokens.out}`;
            updateContextRing(ev.session_tokens.in);
          }
        } else if (ev.type === 'stopped') {
          body.innerHTML = md(buffer) + '<p><em>Stopped.</em></p>';
        } else if (ev.type === 'error') {
          addMessage('error', ev.data || 'something went wrong');
        }
      }
    }
    if (!body.innerHTML.trim() && buffer) body.innerHTML = md(buffer);
  } catch (err) {
    addMessage('error', err.message);
  } finally {
    setBusy(false);
    refreshStatus();
  }
}

function setBusy(value) {
  state.busy = value;
  $('#send').style.display = value ? 'none' : '';
  $('#stop').style.display = value ? '' : 'none';
  $('#input').disabled = value;
}

/* ------------------------------------------------------------ plan mode */

async function runPlan(goal) {
  setBusy(true);
  try {
    const plan = await api('/api/plan', { goal });
    if (!plan.steps || !plan.steps.length) {
      addMessage('assistant', 'No plan needed — sending as a normal request.');
      state.planMode = false;
      syncPlanToggle();
      setBusy(false);
      return send(goal);
    }

    clearEmpty();
    const card = document.createElement('div');
    card.className = 'plan-card';
    card.innerHTML = `<h4>Plan · ${plan.steps.length} steps</h4>` +
      plan.steps.map((s, i) => `<div class="step" data-step="${i}">` +
        `<span class="n">${i + 1}</span><span>${esc(s.title || s.goal || '')}</span>` +
        `<span class="lane">${esc(s.lane || '')}</span></div>`).join('');
    $('#thread').append(card);
    scrollDown();

    const res = await fetch('/api/plan/run', { method: 'POST' });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let carry = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      const parts = carry.split('\n\n');
      carry = parts.pop();
      for (const part of parts) {
        const line = part.replace(/^data: /, '').trim();
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'step') {
          const row = card.querySelector(`[data-step="${ev.index}"]`);
          if (row) {
            row.className = `step ${ev.state === 'done' ? 'done' : 'run'}`;
            if (ev.lane) row.querySelector('.lane').textContent = ev.lane;
          }
        } else if (ev.type === 'summary' || ev.type === 'done') {
          addMessage('assistant', ev.text || 'Plan finished.');
        } else if (ev.type === 'error') {
          addMessage('error', ev.data || 'plan failed');
        }
      }
    }
  } catch (err) {
    addMessage('error', err.message);
  } finally {
    setBusy(false);
    refreshStatus();
  }
}

function syncPlanToggle() {
  $('#plan-toggle').classList.toggle('btn-primary', state.planMode);
}

/* ------------------------------------------------------------ diff dock */

function recordDiff(file, patch) {
  if (!file) return;
  let added = 0; let removed = 0;
  for (const hunk of patch || []) {
    for (const line of hunk.lines || []) {
      if (line[0] === '+') added++;
      else if (line[0] === '-') removed++;
    }
  }
  state.diffs.unshift({ file, patch, added, removed });
  state.diffs = state.diffs.slice(0, 40);
  renderDiffDock();
}

function renderDiffDock() {
  const box = $('#view-diff');
  const badge = $('#diff-count');
  if (!state.diffs.length) {
    box.innerHTML = '<div class="dock-empty">No changes yet. Edits Clawd makes will show up here.</div>';
    badge.style.display = 'none';
    return;
  }
  badge.style.display = '';
  badge.textContent = state.diffs.length;
  box.innerHTML = '';
  for (const entry of state.diffs) {
    const details = document.createElement('details');
    details.className = 'tool';
    details.innerHTML = `<summary><span class="tname">${esc(entry.file.split(/[\\/]/).pop())}</span>` +
      `<span class="targ">${esc(entry.file)}</span>` +
      `<span class="tstate"><span class="file-row" style="padding:0">` +
      `<span class="stat-add">+${entry.added}</span> <span class="stat-del">−${entry.removed}</span></span></span></summary>`;
    details.append(renderDiff(entry.patch));
    box.append(details);
  }
}

/* ------------------------------------------------------------ menus */

let menuPick = null;

function openMenu(anchor, groups, current, onPick, searchable) {
  const menu = $('#menu');
  const search = $('#menu-search');
  menuPick = onPick;
  search.style.display = searchable ? '' : 'none';
  search.value = '';

  const draw = (filter) => {
    const needle = (filter || '').toLowerCase();
    const list = $('#menu-list');
    list.innerHTML = '';
    for (const group of groups) {
      const items = group.items.filter((it) =>
        !needle || `${it.label} ${it.detail || ''} ${it.value}`.toLowerCase().includes(needle));
      if (!items.length) continue;
      if (group.label) {
        const head = document.createElement('div');
        head.className = 'menu-group';
        head.textContent = group.label;
        list.append(head);
      }
      for (const item of items.slice(0, 120)) {
        const btn = document.createElement('button');
        btn.className = `menu-item${item.value === current ? ' on' : ''}`;
        btn.innerHTML = `<span class="m-label">${esc(item.label)}</span>` +
          (item.free ? '<span class="pill free">free</span>' : '') +
          (item.vision ? '<span class="pill eye">vision</span>' : '') +
          (item.detail ? `<span class="m-detail">${esc(item.detail)}</span>` : '');
        btn.onclick = () => { closeMenu(); menuPick(item.value, item); };
        list.append(btn);
      }
    }
    if (!list.children.length) {
      list.innerHTML = '<div class="dock-empty">Nothing matches.</div>';
    }
  };

  draw('');
  search.oninput = () => draw(search.value);

  const rect = anchor.getBoundingClientRect();
  menu.classList.add('on');
  menu.style.top = `${rect.bottom + 6}px`;
  const width = menu.offsetWidth;
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
  $('#backdrop').classList.add('on');
  if (searchable) search.focus();
}

function closeMenu() {
  $('#menu').classList.remove('on');
  if (!$$('.sheet.on').length) $('#backdrop').classList.remove('on');
}

async function openModelMenu() {
  if (!state.catalog) {
    try { state.catalog = await api('/api/models/catalog'); }
    catch (err) { return toast(err.message); }
  }
  const c = state.catalog;
  const groups = [
    { label: '', items: [{ value: 'auto', label: 'Auto', detail: 'router picks, with escalation' }] },
    { label: 'Local ladder', items: (c.local || []).map((m) => ({ ...m, value: m.id })) },
  ];
  if (c.free?.length) {
    groups.push({ label: 'OpenRouter · free', items: c.free.map((m) => ({ ...m, value: m.id })) });
  }
  if (c.paid?.length) {
    groups.push({ label: 'OpenRouter · paid', items: c.paid.map((m) => ({ ...m, value: m.id })) });
  }
  if (c.cloud_error) {
    groups.push({ label: 'OpenRouter', items: [{ value: 'auto', label: 'unavailable', detail: c.cloud_error.slice(0, 60) }] });
  }

  openMenu($('#model-chip'), groups, state.model, async (value, item) => {
    try {
      await api('/api/model', { spec: value });
      state.model = value;
      state.modelLabel = item.label;
      $('#model-label').textContent = item.label;
      $('#model-chip').classList.toggle('on', value !== 'auto');
      toast(`Model: ${item.label}`);
    } catch (err) { toast(err.message); }
  }, true);
}

function openViewMenu() {
  const items = [
    { value: 'summary', label: 'Summary', detail: 'final answers and changes only' },
    { value: 'normal', label: 'Normal', detail: 'tool calls collapsed' },
    { value: 'verbose', label: 'Verbose', detail: 'every step, expanded' },
  ];
  openMenu($('#view-chip'), [{ label: 'Density', items }], state.view, setView, false);
}

function setView(value) {
  state.view = value;
  localStorage.setItem('view', value);
  $('#thread').dataset.view = value;
  $('#view-label').textContent = value[0].toUpperCase() + value.slice(1);
}

/* ------------------------------------------------------------ attachments */

function renderAttachments() {
  const box = $('#attachments');
  box.style.display = state.attachments.length ? '' : 'none';
  box.innerHTML = state.attachments.map((a, i) => (
    `<span class="att">${a.kind === 'image' ? `<img src="${esc(a.url)}">` : ''}` +
    `<span>${esc(a.original || a.name)}</span>` +
    `<button class="x" data-drop="${i}">✕</button></span>`)).join('');
}

function clearAttachments() {
  state.attachments = [];
  renderAttachments();
}

async function uploadFile(file) {
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  try {
    const meta = await api('/api/upload', { name: file.name, data });
    state.attachments.push(meta);
    renderAttachments();
    return meta;
  } catch (err) {
    toast(err.message);
    return null;
  }
}

/* ------------------------------------------------------------ media */

async function loadMedia() {
  try {
    const data = await api('/api/media/models');
    state.mediaModels = data.models || [];
    $('#media-nokey').style.display = data.has_key ? 'none' : '';
    $('#media-form').style.display = data.has_key ? '' : 'none';
    renderMediaModels();
  } catch (err) { toast(err.message); }
}

function renderMediaModels() {
  const select = $('#media-model');
  const models = state.mediaModels.filter((m) => m.task === state.mediaTask);
  select.innerHTML = models.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('');
  const needsImage = state.mediaTask.startsWith('image-to');
  $('#media-source-field').style.display = needsImage ? '' : 'none';
  renderMediaParams();
}

function renderMediaParams() {
  const model = state.mediaModels.find((m) => m.id === $('#media-model').value);
  $('#media-notes').textContent = model?.notes || '';
  const box = $('#media-params');
  if (!model) { box.innerHTML = ''; return; }

  box.innerHTML = `<div class="grid2">${model.params.map((p) => {
    const id = `mp-${p.name}`;
    if (p.kind === 'select') {
      return `<div class="field"><label>${esc(p.label)}</label><select id="${id}" data-param="${esc(p.name)}">` +
        p.options.map((o) => `<option${o === p.default ? ' selected' : ''}>${esc(o)}</option>`).join('') +
        '</select></div>';
    }
    const type = (p.kind === 'int' || p.kind === 'float') ? 'number' : 'text';
    const step = p.kind === 'float' ? ' step="0.1"' : '';
    const value = p.default === null || p.default === undefined ? '' : p.default;
    return `<div class="field"><label>${esc(p.label)}</label>` +
      `<input type="${type}"${step} id="${id}" data-param="${esc(p.name)}" value="${esc(value)}"` +
      `${p.min !== null ? ` min="${p.min}"` : ''}${p.max !== null ? ` max="${p.max}"` : ''}>` +
      (p.help ? `<div class="help">${esc(p.help)}</div>` : '') + '</div>';
  }).join('')}</div>`;
}

async function generateMedia() {
  const prompt = $('#media-prompt').value.trim();
  if (!prompt) return toast('A prompt is required.');

  const params = {};
  for (const el of $$('[data-param]')) {
    if (el.value !== '') params[el.dataset.param] = el.value;
  }
  try {
    await api('/api/media/generate', {
      model: $('#media-model').value,
      task: state.mediaTask,
      prompt,
      params,
      image: state.mediaSource?.name || null,
    });
    toast('Queued.');
    pollJobs(true);
  } catch (err) { toast(err.message); }
}

function renderJobs(jobs) {
  const box = $('#media-jobs');
  if (!jobs.length) {
    box.innerHTML = '<div class="dock-empty">Nothing generated yet.</div>';
    return;
  }
  box.innerHTML = jobs.map((j) => {
    const shots = (j.outputs || []).map((o) => {
      const src = o.file ? `/api/media/file/${encodeURIComponent(o.file)}` : o.url;
      const media = o.kind === 'video'
        ? `<video src="${esc(src)}" controls muted loop></video>`
        : `<img src="${esc(src)}" loading="lazy" alt="">`;
      return `<div class="shot">${media}<div class="acts">` +
        `<button data-save="${esc(o.file || '')}">Save</button>` +
        `<button data-attach="${esc(src)}" data-kind="${esc(o.kind)}">To chat</button>` +
        `<button data-open="${esc(src)}">Open</button></div></div>`;
    }).join('');
    const running = j.status === 'queued' || j.status === 'running';
    return `<div class="job">
      <div class="job-head"><span class="st ${j.status}">${j.status}</span>
        <span style="color:var(--text-faint)">${esc(j.model.split('/').slice(-2).join('/'))}</span>
        <span class="el">${j.elapsed}s</span>
        ${running ? `<button class="btn btn-sm btn-ghost" data-cancel="${j.id}">✕</button>` : ''}</div>
      <div class="prompt">${esc(j.prompt)}</div>
      ${j.error ? `<div class="err">${esc(j.error)}</div>` : ''}
      ${running ? '<div class="bar"><i></i></div>' : ''}
      ${shots ? `<div class="gallery">${shots}</div>` : ''}
    </div>`;
  }).join('');
}

async function pollJobs(force) {
  try {
    const data = await api('/api/media/jobs');
    renderJobs(data.jobs || []);
    const active = (data.jobs || []).some((j) => j.status === 'queued' || j.status === 'running');
    clearTimeout(state.jobPoll);
    if (active || force) state.jobPoll = setTimeout(pollJobs, 2000);
  } catch { /* the dock is not worth an error toast on every tick */ }
}

/* ------------------------------------------------------------ status */

function updateContextRing(tokensIn) {
  /* A rough proportion of the active tier's window. Exact accounting would
   * need the provider to report it; this is the same "are we near the edge"
   * signal without pretending to more precision than we have. */
  const tier = (state.status.tiers || []).find((t) => t.name === state.status.pinned) ||
    (state.status.tiers || [])[0];
  const window = tier?.context || 32768;
  const pct = Math.min(100, Math.round((tokensIn / window) * 100));
  $('#ctx-ring').style.setProperty('--pct', `${pct}%`);
  $('#ctx-label').textContent = `${pct}%`;
}

async function refreshStatus() {
  try {
    const s = await api('/api/status');
    state.status = s;
    const workspace = s.workspace || '';
    $('#crumb').innerHTML = `<b>${esc(workspace.split(/[\\/]/).pop())}</b> ${esc(workspace)}`;
    $('#s-workspace').textContent = workspace.split(/[\\/]/).pop() || '—';
    $('#s-vram').textContent = s.vram_free_mb == null ? '—' : `${(s.vram_free_mb / 1024).toFixed(1)} GB`;

    const guard = s.write_guard?.stats;
    if (guard) {
      const caught = (guard.rejected_destructive || 0) + (guard.rejected_noise || 0) +
        (guard.rejected_placeholder || 0) + (guard.line_numbers_stripped || 0) +
        (guard.unescaped || 0);
      $('#s-guard').textContent = `${guard.writes_checked || 0} checked, ${caught} caught`;
    }
  } catch { /* the server may still be starting */ }
}

/* ------------------------------------------------------------ sessions */

async function loadSessions() {
  try {
    const data = await api('/api/sessions');
    const box = $('#sessions');
    const list = data.sessions || [];
    if (!list.length) {
      box.innerHTML = '<div class="dock-empty" style="padding:14px 8px;font-size:12px">No saved sessions.</div>';
      return;
    }
    box.innerHTML = list.map((s) => `<div class="session" data-id="${esc(s.id)}">` +
      '<span class="dot"></span>' +
      `<span class="label">${esc(s.title || s.id)}</span>` +
      `<button class="kill" data-del="${esc(s.id)}">✕</button></div>`).join('');
  } catch { /* sessions are optional */ }
}

/* ------------------------------------------------------------ settings */

async function openSettings() {
  $('#settings').classList.add('on');
  $('#backdrop').classList.add('on');
  renderSettingsPane($('#settings-tabs .tab.active').dataset.pane);
}

async function renderSettingsPane(pane) {
  const body = $('#settings-body');
  body.innerHTML = '<div class="dock-empty">Loading…</div>';

  if (pane === 'media') {
    const data = await api('/api/media/models').catch(() => ({}));
    body.innerHTML = `
      <div class="field">
        <label>fal API key</label>
        <input type="password" id="set-fal" placeholder="${data.has_key ? 'A key is configured' : 'fal_…'}">
        <div class="help">From fal.ai/dashboard/keys. Stored in ~/.clawd/config.json.
          The environment variable FAL_KEY takes priority if set.</div>
      </div>
      <button class="btn btn-primary" id="set-fal-save">Save</button>`;
    $('#set-fal-save').onclick = async () => {
      try {
        await api('/api/media/key', { key: $('#set-fal').value });
        toast('Key saved.');
        loadMedia();
      } catch (err) { toast(err.message); }
    };
    return;
  }

  if (pane === 'tools') {
    const data = await api('/api/tools').catch(() => ({ tools: [] }));
    body.innerHTML = (data.tools || []).map((t) => `
      <label class="file-row" style="font-family:var(--font)">
        <input type="checkbox" data-tool="${esc(t.name)}" ${t.enabled ? 'checked' : ''}>
        <span style="flex:1"><b>${esc(t.name)}</b>
          <span style="color:var(--text-faint)">${esc(t.description || '')}</span></span>
      </label>`).join('') || '<div class="dock-empty">No tools registered.</div>';
    body.onchange = async (e) => {
      const box = e.target.closest('[data-tool]');
      if (!box) return;
      await api('/api/tools', { name: box.dataset.tool, enabled: box.checked }).catch((err) => toast(err.message));
    };
    return;
  }

  const settings = await api('/api/settings').catch((err) => ({ error: err.message }));
  if (settings.error) { body.innerHTML = `<div class="dock-empty">${esc(settings.error)}</div>`; return; }

  if (pane === 'resources') {
    const profiles = Object.entries(settings.profiles || {});
    body.innerHTML = `
      <div class="field">
        <label>Active profile</label>
        <select id="set-profile">${profiles.map(([n]) =>
          `<option${n === settings.active_profile ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <div class="help">How much of the machine Clawd is allowed to use.</div>
      </div>
      ${profiles.map(([name, p]) => `
        <div class="field"><label>${esc(name)}</label>
          <div class="grid2">
            <div class="field"><label>VRAM budget (MB)</label>
              <input type="number" data-profile="${esc(name)}" data-key="vram_mb" value="${p.vram_mb}"></div>
            <div class="field"><label>RAM budget (MB)</label>
              <input type="number" data-profile="${esc(name)}" data-key="ram_mb" value="${p.ram_mb}"></div>
            <div class="field"><label>Threads</label>
              <input type="number" data-profile="${esc(name)}" data-key="threads" value="${p.threads}"></div>
            <div class="field"><label>Max context</label>
              <input type="number" data-profile="${esc(name)}" data-key="max_context" value="${p.max_context}"></div>
          </div>
        </div>`).join('')}
      <button class="btn btn-primary" id="set-res-save">Save resources</button>`;

    $('#set-profile').onchange = async (e) => {
      await api('/api/settings', { section: 'active_profile', values: { name: e.target.value } })
        .then(() => toast('Profile switched.')).catch((err) => toast(err.message));
    };
    $('#set-res-save').onclick = async () => {
      const byProfile = {};
      for (const el of $$('[data-profile]')) {
        (byProfile[el.dataset.profile] ||= {})[el.dataset.key] = Number(el.value);
      }
      try {
        for (const [name, values] of Object.entries(byProfile)) {
          await api('/api/settings', { section: 'profile', name, values });
        }
        toast('Saved.');
      } catch (err) { toast(err.message); }
    };
    return;
  }

  if (pane === 'models') {
    body.innerHTML = (settings.tiers || []).map((t) => `
      <details class="tool" style="margin-bottom:9px">
        <summary><span class="tname">${esc(t.name)}</span>
          <span class="targ">${esc(t.file || '')}</span>
          <span class="tstate ${t.downloaded ? 'ok' : 'err'}">${t.downloaded ? `${t.size_mb} MB` : 'not downloaded'}</span>
        </summary>
        <div style="padding:11px 13px">
          <div class="grid2">
            <div class="field"><label>Device</label>
              <select data-tier="${esc(t.name)}" data-key="device">${settings.devices.map((d) =>
                `<option${d === t.device ? ' selected' : ''}>${esc(d)}</option>`).join('')}</select></div>
            <div class="field"><label>Context</label>
              <input type="number" data-tier="${esc(t.name)}" data-key="context" value="${t.context}"></div>
            <div class="field"><label>Max output tokens</label>
              <input type="number" data-tier="${esc(t.name)}" data-key="max_output_tokens" value="${t.max_output_tokens}"></div>
            <div class="field"><label>CPU expert layers</label>
              <input type="number" data-tier="${esc(t.name)}" data-key="n_cpu_moe" value="${t.n_cpu_moe ?? ''}"></div>
            <div class="field"><label>Speculation</label>
              <select data-tier="${esc(t.name)}" data-key="spec_type">${settings.spec_types.map((s) =>
                `<option${s === t.spec_type ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
            <div class="field"><label>Serve</label>
              <select data-tier="${esc(t.name)}" data-key="serve">
                <option value="true"${t.serve ? ' selected' : ''}>yes</option>
                <option value="false"${!t.serve ? ' selected' : ''}>no</option></select></div>
          </div>
          <button class="btn btn-sm btn-primary" data-save-tier="${esc(t.name)}">Save ${esc(t.name)}</button>
        </div>
      </details>`).join('');

    body.onclick = async (e) => {
      const btn = e.target.closest('[data-save-tier]');
      if (!btn) return;
      const name = btn.dataset.saveTier;
      const values = {};
      for (const el of $$(`[data-tier="${CSS.escape(name)}"]`)) {
        let v = el.value;
        if (v === 'true' || v === 'false') v = v === 'true';
        else if (el.type === 'number') v = v === '' ? null : Number(v);
        values[el.dataset.key] = v;
      }
      try { await api('/api/settings', { section: 'tier', name, values }); toast(`${name} saved.`); }
      catch (err) { toast(err.message); }
    };
    return;
  }

  if (pane === 'cloud') {
    const c = settings.cloud || {};
    body.innerHTML = `
      <div class="grid2">
        <div class="field"><label>Policy</label>
          <select id="c-policy">${['off', 'manual', 'auto'].map((p) =>
            `<option${p === c.policy ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>
          <div class="help">off — never leave the machine. manual — only when you ask.
            auto — when a local model is failing.</div></div>
        <div class="field"><label>Cost mode</label>
          <select id="c-cost">${['free_only', 'mixed'].map((m) =>
            `<option${m === c.cost_mode ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select>
          <div class="help">free_only verifies every pricing field before each call,
            not just the model name.</div></div>
        <div class="field"><label>Provider</label>
          <input type="text" id="c-provider" value="${esc(c.provider || '')}"></div>
        <div class="field"><label>Model</label>
          <input type="text" id="c-model" value="${esc(c.model || '')}"></div>
      </div>
      <button class="btn btn-primary" id="c-save">Save cloud settings</button>`;
    $('#c-save').onclick = async () => {
      try {
        await api('/api/settings', { section: 'cloud', values: {
          policy: $('#c-policy').value, cost_mode: $('#c-cost').value,
          provider: $('#c-provider').value, model: $('#c-model').value,
        } });
        state.catalog = null;
        toast('Saved.');
      } catch (err) { toast(err.message); }
    };
  }
}

function closeSheets() {
  $$('.sheet.on').forEach((s) => s.classList.remove('on'));
  if (!$('#menu').classList.contains('on')) $('#backdrop').classList.remove('on');
}

/* ------------------------------------------------------------ composer */

function autoGrow() {
  const box = $('#input');
  box.style.height = 'auto';
  box.style.height = `${Math.min(260, box.scrollHeight)}px`;
}

/* ------------------------------------------------------------ shortcuts */

const SHORTCUTS = [
  ['Ctrl /', 'Show this list'],
  ['Ctrl N', 'New session'],
  ['Ctrl B', 'Toggle sidebar'],
  ['Ctrl Shift D', 'Toggle side panel'],
  ['Ctrl Shift I', 'Model menu'],
  ['Ctrl O', 'Cycle view density'],
  ['Ctrl Shift M', 'Media panel'],
  ['Ctrl \\', 'Close side panel'],
  ['Esc', 'Stop generating / close overlays'],
  ['Enter', 'Send'],
  ['Shift Enter', 'Newline'],
];

function renderShortcuts() {
  $('#shortcut-list').innerHTML = SHORTCUTS.map(([keys, what]) =>
    `<div class="krow"><span>${esc(what)}</span><span class="kk">` +
    keys.split(' ').map((k) => `<kbd>${esc(k)}</kbd>`).join('') + '</span></div>').join('');
}

/* ------------------------------------------------------------ dock */

function showDock(view) {
  $('#dock').classList.remove('hidden');
  $('#splitter').classList.remove('hidden');
  if (view) {
    $$('.dock-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
    $$('.dock-view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
    if (view === 'media') { loadMedia(); pollJobs(); }
    if (view === 'files') loadFiles('');
  }
}

function toggleDock() {
  const hidden = $('#dock').classList.toggle('hidden');
  $('#splitter').classList.toggle('hidden', hidden);
}

async function loadFiles(query) {
  try {
    const data = await api(`/api/files?q=${encodeURIComponent(query || '')}&limit=60`);
    const box = $('#file-list');
    box.innerHTML = (data.files || []).map((f) =>
      `<div class="file-row" data-file="${esc(f)}">${esc(f)}</div>`).join('') ||
      '<div class="dock-empty">No matches.</div>';
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------ wiring */

function init() {
  setView(state.view);
  document.documentElement.dataset.theme = localStorage.getItem('theme') || 'light';
  renderShortcuts();
  refreshStatus();
  loadSessions();
  setInterval(refreshStatus, 6000);

  $('#send').onclick = () => send();
  $('#stop').onclick = () => api('/api/stop', {}).catch(() => {});
  $('#input').addEventListener('input', autoGrow);
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  $('#plan-toggle').onclick = () => {
    state.planMode = !state.planMode;
    syncPlanToggle();
    toast(state.planMode ? 'Plan mode on — large requests split into parallel steps.' : 'Plan mode off.');
  };

  $('#model-chip').onclick = openModelMenu;
  $('#view-chip').onclick = openViewMenu;
  $('#toggle-dock').onclick = () => toggleDock();
  $('#toggle-sidebar').onclick = () => $('#app').classList.toggle('sidebar-hidden');
  $('#toggle-theme').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
  };
  $('#open-settings').onclick = openSettings;

  $('#new-session').onclick = async () => {
    await api('/api/reset', {}).catch(() => {});
    $('#thread').innerHTML = '';
    state.diffs = [];
    renderDiffDock();
    addMessage('assistant', 'New session. What next?');
    refreshStatus();
  };

  $('#pick-folder').onclick = async () => {
    const path = prompt('Workspace folder:', state.status.workspace || '');
    if (!path) return;
    try { await api('/api/workspace', { path }); toast('Workspace changed.'); refreshStatus(); }
    catch (err) { toast(err.message); }
  };

  /* attachments */
  $('#attach').onclick = () => $('#file-input').click();
  $('#file-input').onchange = async (e) => {
    for (const file of e.target.files) await uploadFile(file);
    e.target.value = '';
  };
  $('#attachments').onclick = (e) => {
    const btn = e.target.closest('[data-drop]');
    if (!btn) return;
    state.attachments.splice(Number(btn.dataset.drop), 1);
    renderAttachments();
  };
  document.addEventListener('paste', async (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    for (const file of files) await uploadFile(file);
  });
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    dragDepth++; $('#dropzone').classList.add('on');
  });
  document.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; $('#dropzone').classList.remove('on'); }
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#dropzone').classList.remove('on');
    for (const file of e.dataTransfer.files) await uploadFile(file);
  });

  /* dock */
  $$('.dock-tab').forEach((tab) => { tab.onclick = () => showDock(tab.dataset.view); });
  $('#file-search').oninput = (e) => loadFiles(e.target.value);
  $('#file-list').onclick = (e) => {
    const row = e.target.closest('[data-file]');
    if (!row) return;
    const box = $('#input');
    box.value += (box.value && !box.value.endsWith(' ') ? ' ' : '') + row.dataset.file + ' ';
    box.focus(); autoGrow();
  };

  /* media */
  $('#media-task').onclick = (e) => {
    const btn = e.target.closest('[data-task]');
    if (!btn) return;
    state.mediaTask = btn.dataset.task;
    $$('#media-task button').forEach((b) => b.classList.toggle('on', b === btn));
    renderMediaModels();
  };
  $('#media-model').onchange = renderMediaParams;
  $('#media-go').onclick = generateMedia;
  $('#media-pick-image').onclick = () => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.onchange = async () => {
      const meta = await uploadFile(picker.files[0]);
      if (!meta) return;
      state.mediaSource = meta;
      state.attachments = state.attachments.filter((a) => a !== meta);
      renderAttachments();
      $('#media-source-name').textContent = meta.original || meta.name;
    };
    picker.click();
  };
  $('#save-fal-key').onclick = async () => {
    try { await api('/api/media/key', { key: $('#fal-key').value }); toast('Key saved.'); loadMedia(); }
    catch (err) { toast(err.message); }
  };
  $('#media-jobs').onclick = async (e) => {
    const save = e.target.closest('[data-save]');
    const attach = e.target.closest('[data-attach]');
    const open = e.target.closest('[data-open]');
    const cancel = e.target.closest('[data-cancel]');
    if (save && save.dataset.save) {
      try { const r = await api('/api/media/save', { file: save.dataset.save }); toast(`Saved to ${r.path}`); }
      catch (err) { toast(err.message); }
    } else if (attach) {
      state.attachments.push({ name: attach.dataset.attach.split('/').pop(),
        original: 'generated', kind: attach.dataset.kind, url: attach.dataset.attach });
      renderAttachments();
      toast('Added to the composer.');
    } else if (open) {
      window.open(open.dataset.open, '_blank');
    } else if (cancel) {
      await api(`/api/media/jobs/${cancel.dataset.cancel}/cancel`, {}).catch(() => {});
      pollJobs(true);
    }
  };

  /* sessions */
  $('#sessions').onclick = async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      await api(`/api/sessions/${del.dataset.del}`, null, 'DELETE').catch(() => {});
      return loadSessions();
    }
    const row = e.target.closest('[data-id]');
    if (!row) return;
    try {
      const data = await api(`/api/sessions/${row.dataset.id}`);
      $('#thread').innerHTML = '';
      for (const m of data.messages || []) {
        if (typeof m.content === 'string') addMessage(m.role === 'user' ? 'user' : 'assistant', m.content);
      }
      $$('.session').forEach((s) => s.classList.toggle('active', s === row));
    } catch (err) { toast(err.message); }
  };

  /* starters */
  $('#thread').addEventListener('click', (e) => {
    const starter = e.target.closest('.starter');
    if (starter) send(starter.textContent);
    const copy = e.target.closest('.copy');
    if (copy) {
      navigator.clipboard.writeText(copy.parentElement.querySelector('code').textContent);
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy'; }, 1400);
    }
  });

  /* settings tabs */
  $('#settings-tabs').onclick = (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    $$('#settings-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    renderSettingsPane(tab.dataset.pane);
  };
  $$('[data-close]').forEach((b) => { b.onclick = closeSheets; });
  $('#backdrop').onclick = () => { closeMenu(); closeSheets(); };

  /* splitter */
  let dragging = false;
  $('#splitter').addEventListener('mousedown', (e) => {
    dragging = true;
    e.preventDefault();
    $('#splitter').classList.add('dragging');
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const width = Math.min(Math.max(320, window.innerWidth - e.clientX), window.innerWidth - 420);
    document.documentElement.style.setProperty('--dock-w', `${width}px`);
  });
  document.addEventListener('mouseup', () => {
    dragging = false;
    $('#splitter').classList.remove('dragging');
  });

  /* keyboard */
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      if ($('#menu').classList.contains('on')) return closeMenu();
      if ($$('.sheet.on').length) return closeSheets();
      if (state.busy) api('/api/stop', {}).catch(() => {});
      return;
    }
    if (!mod) return;
    if (e.key === '/') { e.preventDefault(); closeSheets(); $('#shortcuts').classList.add('on'); $('#backdrop').classList.add('on'); }
    else if (e.key === 'n') { e.preventDefault(); $('#new-session').click(); }
    else if (e.key === 'b') { e.preventDefault(); $('#toggle-sidebar').click(); }
    else if (e.key === 'o') {
      e.preventDefault();
      const order = ['summary', 'normal', 'verbose'];
      setView(order[(order.indexOf(state.view) + 1) % order.length]);
    } else if (e.key === '\\') { e.preventDefault(); $('#dock').classList.add('hidden'); $('#splitter').classList.add('hidden'); }
    else if (e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); toggleDock(); showDock('diff'); }
    else if (e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); openModelMenu(); }
    else if (e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); showDock('media'); }
  });
}

document.addEventListener('DOMContentLoaded', init);
