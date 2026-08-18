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

/* How long a chat stream may say nothing at all before we assume it is dead.
 * Silence, not total duration -- an SSE event of any kind rearms it, so a slow
 * local model that is still emitting tokens is never cut off. Generous enough
 * to cover a cold model load, which is the slowest legitimate silence here. */
const IDLE_TIMEOUT_MS = 180000;

const state = {
  busy: false,
  abort: null,          // AbortController for the turn in flight
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
  sessionFilter: '',
  currentSession: null,
  groupBy: 'project',
  turn: null,
};

/* The empty state has one job: make the layout legible at a glance. Three
 * lines naming what is where beats a paragraph nobody reads. */
const EMPTY_HTML = `
  <div class="empty" id="empty">
    <div class="mark">🦞</div>
    <h2>What are we building?</h2>
    <p>Runs on your own GPU. Nothing leaves the machine unless you pick a cloud model.</p>
    <div class="starters">
      <button class="starter">Explain this codebase</button>
      <button class="starter">Find and fix a bug</button>
      <button class="starter">Write tests for my last change</button>
      <button class="starter">Make me a hero image</button>
    </div>
    <div class="orient">
      <span><b>↓ below</b> pick the model, and how much freedom it has</span>
      <span><b>→ Views</b> changes, files, terminal, your running app</span>
      <span><b>← left</b> every past chat, grouped by project</span>
    </div>
  </div>`;

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

/* Art the agent just generated, shown in the message rather than buried in the
 * tool card. `pixel` switches off the browser's smoothing -- scaling a 64px
 * sprite with bilinear filtering undoes the whole point of quantising it -- and
 * puts a checkerboard behind it so transparency reads as transparency. */
function renderArt(images) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-media art';
  wrap.innerHTML = images.map((img) => {
    const cls = img.pixel ? 'pixel' : '';
    // Eager, unlike the gallery thumbnails. These are a handful of images the
    // user has just asked for and is waiting on -- deferring them delays the
    // only part of the reply that matters, and a lazy image in a backgrounded
    // window may not load at all.
    const tag = /\.(mp4|webm)$/i.test(img.url)
      ? `<video src="${esc(img.url)}" controls loop muted></video>`
      : `<img class="${cls}" src="${esc(img.url)}" alt="${esc(img.label || '')}">`;
    return `<figure class="${img.pixel ? 'shot-pixel' : ''}">${tag}` +
      (img.label ? `<figcaption>${esc(img.label)}</figcaption>` : '') +
      `</figure>`;
  }).join('');
  // Each image settles the layout as it decodes; without this the view drifts
  // away from the bottom as they arrive.
  wrap.querySelectorAll('img, video').forEach((node) => {
    node.addEventListener('load', () => scrollDown(), { once: true });
  });
  return wrap;
}

/* Autoscroll, coalesced to one layout flush per frame.
 *
 * Reading `scrollHeight` forces the engine to lay out the whole thread there
 * and then. Doing that once per streamed token made a turn quadratic in its
 * own length: measured on an 18k-character reply (1286 events), 2324ms of
 * blocked main thread, against 0.6ms once the scroll is coalesced into a
 * frame. That blocked thread is why the window stopped responding to clicks
 * and typing while an answer was streaming.
 *
 * Coalescing is safe because the intermediate positions were never seen -- the
 * browser paints once per frame regardless, so 1285 of those 1286 layouts were
 * computed and thrown away.
 */
let scrollBox = null;
let scrollQueued = false;
let followTail = true;      // is the reader parked at the bottom?

function scroller() {
  if (!scrollBox || !scrollBox.isConnected) scrollBox = $('#chat-scroll');
  return scrollBox;
}

function scrollDown(force) {
  if (force) followTail = true;
  // Someone who has scrolled up to read is not asking to be dragged back down
  // every time a token arrives.
  if (!followTail || scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => {
    scrollQueued = false;
    // Re-checked, not assumed: a frame can be a long time coming -- rAF does
    // not run at all while the window is hidden -- and the reader may have
    // scrolled up to read something in the meantime.
    if (!followTail) return;
    const box = scroller();
    if (box) box.scrollTop = box.scrollHeight;
  });
}

/* A repeating poll that stops while nobody is looking, and never lets two of
 * its own requests overlap.
 *
 * setInterval was wrong twice over here. It fires whether or not the previous
 * call has returned, so a slow /api/status quietly stacks requests -- each one
 * holding a server threadpool worker and landing out of order, so a stale
 * response can overwrite a fresh one. And it keeps running when the window is
 * hidden or the desktop shell is minimised, which is the one time none of the
 * work can matter.
 */
function whileVisible(fn, everyMs) {
  let timer = null;
  let inFlight = false;

  async function tick() {
    timer = null;
    if (document.hidden) return;          // resumed by visibilitychange
    if (!inFlight) {
      inFlight = true;
      try { await fn(); } catch { /* a failed poll is not fatal; try again */ }
      finally { inFlight = false; }
    }
    arm();
  }
  function arm() {
    if (timer === null && !document.hidden) timer = setTimeout(tick, everyMs);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(timer); timer = null; }
    else { fn(); arm(); }                 // catch up on what was missed
  });
  arm();
}

/* Track whether the reader is at the bottom. Reading layout inside a scroll
 * handler is free -- it has already been computed for the scroll itself. */
function watchScroll() {
  const box = scroller();
  if (!box) return;
  box.addEventListener('scroll', () => {
    followTail = box.scrollHeight - box.scrollTop - box.clientHeight < 48;
  }, { passive: true });
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
  // Sending is an explicit request to be at the bottom, even if the reader had
  // scrolled up through history a moment ago.
  const userEl = addMessage('user', text || '(image)');
  scrollDown(true);
  addAttachmentStrip(userEl, attachments);
  clearAttachments();
  closeComplete();

  // A leading slash is a command, not a prompt: it runs locally and returns a
  // result rather than costing a model round trip.
  if (text.startsWith('/')) {
    try {
      const res = await api('/api/command', { line: text });
      if (res.clear) {
        $('#thread').innerHTML = EMPTY_HTML;
        state.diffs = [];
        renderDiffDock();
      } else {
        addMessage('assistant', res.text || 'done');
      }
      refreshStatus();
      state.catalog = null;
      loadSessions();
    } catch (err) { addMessage('error', err.message); }
    return;
  }

  setBusy(true);
  const el = addMessage('assistant', '', state.model === 'auto' ? null : state.modelLabel);
  const body = el.querySelector('.body');
  const live = document.createElement('span');
  // Append into a text node rather than reassigning `textContent` each event.
  // Reassigning tears down and rebuilds the node with the whole buffer every
  // time -- O(n) per token, so O(n^2) per turn. appendData writes the delta.
  const liveText = document.createTextNode('');
  live.append(liveText);
  body.append(live);
  let buffer = '';
  let rendered = false;         // has the final markdown replaced the live text?
  const openTools = new Map();

  // The turn needs an owner. `setBusy(true)` disables the composer for the
  // whole request, and the read loop below has no natural end: if the model
  // call hangs, the socket times out somewhere between 30 and 600 seconds and
  // until then the only way out of the UI is a page reload. A watchdog on
  // *silence* -- not on total duration -- ends that, while never cutting off a
  // slow model that is still producing tokens.
  const ctl = new AbortController();
  state.abort = ctl;
  let idleTimer = null;
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      // Tell the server to stand down too, or its worker keeps the session
      // busy and the next message is refused.
      api('/api/stop', {}).catch(() => {});
      ctl.abort();
    }, IDLE_TIMEOUT_MS);
  };
  armIdle();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctl.signal,
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
      armIdle();                       // any traffic at all resets the watchdog
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
          liveText.appendData(ev.data);
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
            // Generated art goes in the message itself, not inside the
            // collapsed tool card. Asking for a sprite and being handed a
            // folded-away <details> to click is not being shown a sprite.
            if (ev.images && ev.images.length) {
              el.insertBefore(renderArt(ev.images), el.querySelector('.body'));
              card.open = false;
              scrollDown();
            }
            openTools.delete(ev.name);
          }
        } else if (ev.type === 'done') {
          body.innerHTML = md(ev.text || buffer);
          rendered = true;
          // Markdown changes the message's height -- code blocks, lists and
          // headings all lay out taller than the raw text did -- so the last
          // coalesced scroll now lands short of the bottom.
          scrollDown();
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
            $('#s-tokens').textContent =
              `${ev.session_tokens.in.toLocaleString()} in / ${ev.session_tokens.out.toLocaleString()} out`;
            updateContextRing(ev.session_tokens.in);
          }
        } else if (ev.type === 'notice') {
          const note = document.createElement('div');
          note.className = 'msg-head';
          note.style.cssText = 'margin:-14px 0 10px;color:var(--accent)';
          note.textContent = ev.data;
          el.before(note);
        } else if (ev.type === 'stopped') {
          body.innerHTML = md(buffer) + '<p><em>Stopped.</em></p>';
          rendered = true;
          scrollDown();
        } else if (ev.type === 'error') {
          addMessage('error', ev.data || 'something went wrong');
        }
      }
    }
    // A stream that ends without 'done' -- a dropped connection, a server
    // restart mid-turn -- used to leave the reply as raw unformatted text.
    // The old guard tested `body.innerHTML.trim()`, which is never empty: the
    // live <span> is in there from the first token onwards.
    if (!rendered && buffer) body.innerHTML = md(buffer);
  } catch (err) {
    if (!rendered && buffer) body.innerHTML = md(buffer);   // keep the partial
    // An abort is the user pressing Stop, or the watchdog giving up. Neither
    // is a crash, and both already show their own message.
    if (err.name !== 'AbortError') addMessage('error', err.message);
  } finally {
    clearTimeout(idleTimer);
    const aborted = ctl.signal.aborted;
    state.abort = null;
    if (aborted) await settleBusy(); else setBusy(false);
    refreshStatus();
  }
}

/* Wait for the server to actually be free before re-enabling the composer.
 *
 * Aborting the connection ends our read loop; it does not end the server's
 * turn. Cancellation is checked between model calls, so a request already
 * with the provider runs to completion with nobody listening. Clearing `busy`
 * on our side the moment the socket closes therefore offers the user an input
 * box whose next message comes straight back as "a request is already in
 * flight" -- measured: a send 29ms after Stop was refused.
 *
 * Staying disabled with the button still reading "Stopping…" is both honest
 * and shorter than the round trip through an error message.
 */
async function settleBusy(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let busy = false;
    try { busy = !!(await api('/api/status')).busy; } catch { busy = false; }
    if (!busy) break;
    if (Date.now() > deadline) break;      // give the input back regardless
    await new Promise((r) => setTimeout(r, 300));
  }
  setBusy(false);
}

function setBusy(value) {
  state.busy = value;
  $('#send').style.display = value ? 'none' : '';
  const stop = $('#stop');
  stop.style.display = value ? '' : 'none';
  if (value) { stop.textContent = 'Stop'; stop.disabled = false; }
  $('#input').disabled = value;
}

/* ------------------------------------------------------------ plan mode */

async function runPlan(goal) {
  setBusy(true);
  try {
    const plan = await api('/api/plan', { goal });
    if (!plan.steps || !plan.steps.length) {
      addMessage('assistant', 'No plan needed — sending as a normal request.');
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

  /* Add the new entry rather than rebuilding the dock.
   *
   * Not for the milliseconds -- rebuilding forty collapsed <details> costs
   * about 5ms. For what the rebuild destroyed: every diff the user had
   * expanded snapped shut and the dock scrolled back to the top, on every
   * single file the agent touched. Opening the Changes tab to read a diff
   * while the agent was still working was therefore impossible, which reads
   * as "the UI doesn't respond to me" far more than any amount of jank. */
  const box = $('#view-diff');
  const badge = $('#diff-count');
  if (box.firstElementChild?.classList.contains('dock-empty')) box.innerHTML = '';
  box.prepend(diffEntryEl(state.diffs[0]));
  while (box.children.length > state.diffs.length) box.lastElementChild.remove();
  badge.style.display = '';
  badge.textContent = state.diffs.length;
}

function diffEntryEl(entry) {
  const details = document.createElement('details');
  details.className = 'tool';
  details.innerHTML = `<summary><span class="tname">${esc(entry.file.split(/[\\/]/).pop())}</span>` +
    `<span class="targ">${esc(entry.file)}</span>` +
    `<span class="tstate"><span class="file-row" style="padding:0">` +
    `<span class="stat-add">+${entry.added}</span> <span class="stat-del">−${entry.removed}</span></span></span></summary>`;
  details.append(renderDiff(entry.patch));
  return details;
}

/* A full rebuild, for the reset paths -- /clear, switching workspace, loading
 * a session. There is nothing to preserve there, and it happens once. */
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
  for (const entry of state.diffs) box.append(diffEntryEl(entry));
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

  placeMenu(menu, anchor);
  $('#backdrop').classList.add('on');
  if (searchable) search.focus();
}

/* Put a menu where it can actually be used.
 *
 * It used to be pinned to `rect.bottom + 6` unconditionally. Every control on
 * the bottom bar -- the model picker, permission mode, effort, view density --
 * therefore opened its menu below the bottom of the window, off screen and
 * unreachable. The menu is `position: fixed`, so nothing scrolled it back into
 * view either.
 *
 * Below is still preferred, because that is where a menu is expected. It flips
 * above when there is not room, and the height is capped to whichever side it
 * lands on so a long list scrolls inside the menu instead of running off the
 * edge again.
 */
function placeMenu(menu, anchor) {
  const GAP = 6;
  const EDGE = 8;
  const rect = anchor.getBoundingClientRect();
  menu.classList.add('on');           // must be laid out before it can be measured

  const spaceBelow = window.innerHeight - rect.bottom - GAP - EDGE;
  const spaceAbove = rect.top - GAP - EDGE;

  // Reset any cap from a previous open, or the measurement below inherits it.
  menu.style.maxHeight = '';
  const wanted = menu.offsetHeight;
  const above = wanted > spaceBelow && spaceAbove > spaceBelow;
  const room = Math.max(120, above ? spaceAbove : spaceBelow);

  menu.style.maxHeight = `${Math.min(room, Math.round(window.innerHeight * 0.6))}px`;
  const height = menu.offsetHeight;
  const width = menu.offsetWidth;

  const top = above ? rect.top - GAP - height : rect.bottom + GAP;
  menu.style.top = `${Math.max(EDGE, Math.min(top, window.innerHeight - height - EDGE))}px`;
  menu.style.left = `${Math.max(EDGE, Math.min(rect.left, window.innerWidth - width - EDGE))}px`;
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

async function loadTurnSettings() {
  try {
    const data = await api('/api/turn-settings');
    state.turn = data;
    $('#perm-label').textContent = data.mode_label;
    $('#effort-label').textContent = data.effort_label;
    $('#perm-chip').classList.toggle('on', data.permission_mode !== 'ask');
    $('#effort-chip').classList.toggle('on', data.effort !== 'medium');
  } catch { /* the chips just stay at their defaults */ }
}

function openTurnMenu(chip, group, entries, current, field) {
  const items = Object.entries(entries).map(([value, meta]) => ({
    value, label: meta.label, detail: meta.detail,
  }));
  openMenu(chip, [{ label: group, items }], current, async (value, item) => {
    try {
      await api('/api/turn-settings', { [field]: value });
      await loadTurnSettings();
      toast(`${group}: ${item.label}`);
    } catch (err) { toast(err.message); }
  }, false);
}

/* The + beside the prompt box: everything you might want to bring into a
 * message, in one place, the way Claude Code groups it. */
function openPlusMenu() {
  openMenu($('#plus-btn'), [
    { label: 'Add', items: [
      { value: 'image', label: 'Attach an image', detail: 'or paste / drop one' },
      { value: 'file', label: 'Mention a file', detail: '@ in the composer' },
    ] },
    { label: 'Make', items: [
      { value: 'media', label: 'Generate an image or video', detail: 'fal' },
      { value: 'plan', label: 'Plan a big job', detail: 'split into parallel steps' },
    ] },
    { label: 'Set up', items: [
      { value: 'integrations', label: 'Integrations', detail: 'what is connected' },
      { value: 'settings', label: 'Settings', detail: 'models, resources, tools' },
    ] },
  ], null, (value) => {
    if (value === 'image') $('#file-input').click();
    else if (value === 'file') {
      const box = $('#input');
      box.value += (box.value && !box.value.endsWith(' ') ? ' ' : '') + '@';
      box.focus(); refreshComplete();
    } else if (value === 'media') showDock('media');
    else if (value === 'plan') showDock('plan');
    else if (value === 'integrations') openIntegrations();
    else if (value === 'settings') openSettings();
  }, false);
}

const PANES = [
  { value: 'diff', label: 'Changes', detail: 'Ctrl+Shift+D' },
  { value: 'files', label: 'Files', detail: 'browse and edit' },
  { value: 'preview', label: 'App', detail: 'your dev server' },
  { value: 'terminal', label: 'Terminal', detail: 'Ctrl+`' },
  { value: 'plan', label: 'Plan', detail: 'Ctrl+Shift+P' },
  { value: 'media', label: 'Images', detail: 'Ctrl+Shift+G' },
];

function openViewsMenu() {
  openMenu($('#views-chip'), [{ label: 'Open a pane', items: PANES }],
    null, (value) => showDock(value), false);
}

async function openServerMenu() {
  let data;
  try { data = await api('/api/preview/configs'); }
  catch (err) { return toast(err.message); }

  const running = data.running || [];
  const items = (data.configs || []).map((c) => {
    const live = running.find((r) => r.name === c.name && r.alive);
    return {
      value: c.name,
      label: (live ? 'Stop ' : 'Start ') + c.name,
      detail: live ? (live.listening ? `running on ${live.url}` : 'starting…')
        : (c.port ? `port ${c.port}` : 'attach'),
    };
  });
  if (!items.length) {
    items.push({ value: '__setup', label: 'Set up a dev server',
                 detail: 'no .claude/launch.json yet' });
  }

  openMenu($('#server-chip'), [{ label: 'Dev server', items }], null, async (value) => {
    if (value === '__setup') return showDock('preview');
    const live = running.find((r) => r.name === value && r.alive);
    try {
      await api(live ? '/api/preview/stop' : '/api/preview/start', { name: value });
      showDock('preview');
      pollPreview();
    } catch (err) { toast(err.message); }
  }, false);
}

function updateServerChip() {
  const live = (preview.running || []).filter((r) => r.alive);
  const dot = $('#server-dot');
  const listening = live.find((r) => r.listening);
  dot.className = `dot-idle${listening ? ' live' : live.length ? ' starting' : ''}`;
  $('#server-label').textContent = listening ? listening.name
    : live.length ? 'starting…' : 'Server';
}

function openPermMenu() {
  openTurnMenu($('#perm-chip'), 'Permission mode', state.turn?.modes || {},
    state.turn?.permission_mode, 'permission_mode');
}

function openEffortMenu() {
  openTurnMenu($('#effort-chip'), 'Response budget', state.turn?.efforts || {},
    state.turn?.effort, 'effort');
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
    // The form is always usable now: Pollinations needs no key. The key box is
    // an upsell to the better models, not a gate on the feature.
    $('#media-nokey').style.display = data.has_key ? 'none' : '';
    $('#media-form').style.display = '';
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
  // Nothing to see: keep the timer, skip the round trip and the rebuild.
  if (document.hidden) {
    clearTimeout(state.jobPoll);
    state.jobPoll = setTimeout(pollJobs, 2000);
    return;
  }
  try {
    const data = await api('/api/media/jobs');
    renderJobs(data.jobs || []);
    const active = (data.jobs || []).some((j) => j.status === 'queued' || j.status === 'running');
    clearTimeout(state.jobPoll);
    if (active || force) state.jobPoll = setTimeout(pollJobs, 2000);
  } catch { /* the dock is not worth an error toast on every tick */ }
}

/* ------------------------------------------------------------ app preview */

const preview = { configs: [], running: [], poll: null };

async function loadPreview() {
  let data;
  try { data = await api('/api/preview/configs'); }
  catch (err) { return toast(err.message); }

  preview.configs = data.configs || [];
  preview.running = data.running || [];

  const setup = $('#preview-setup');
  if (!preview.configs.length) {
    setup.style.display = '';
    if (!$('#preview-config').value) $('#preview-config').value = data.suggestion || '';
    $('#preview-pick').innerHTML = '<option>no configurations</option>';
    $('#preview-start').disabled = true;
    return;
  }

  setup.style.display = 'none';
  $('#preview-start').disabled = false;
  $('#preview-pick').innerHTML = preview.configs.map((c) =>
    `<option value="${esc(c.name)}">${esc(c.name)}${
      c.attach_only ? ' (attach)' : ''}${c.port ? ` · :${c.port}` : ''}</option>`).join('');

  renderPreviewState();
}

function currentPreview() {
  const name = $('#preview-pick').value;
  return preview.running.find((r) => r.name === name);
}

function renderPreviewState() {
  const running = currentPreview();
  const box = $('#preview-logs-box');
  $('#preview-start').style.display = running && running.alive ? 'none' : '';
  $('#preview-stop').style.display = running && running.alive && running.managed ? '' : 'none';

  if (!running) {
    $('#preview-frame-wrap').style.display = 'none';
    box.style.display = 'none';
    return;
  }

  box.style.display = '';
  $('#preview-logs').textContent = (running.logs || []).join('\n');
  $('#preview-state').textContent = running.listening ? 'listening'
    : running.alive ? 'starting…' : 'stopped';
  $('#preview-state').className = `tstate ${running.listening ? 'ok'
    : running.alive ? 'run' : 'err'}`;

  // Only point the iframe at the app once something is actually answering:
  // loading too early gives a connection-refused page that does not retry.
  const frame = $('#preview-frame');
  if (running.listening && running.url) {
    $('#preview-frame-wrap').style.display = '';
    if (frame.dataset.url !== running.url) {
      frame.dataset.url = running.url;
      frame.src = running.url;
    }
  } else {
    $('#preview-frame-wrap').style.display = 'none';
  }
}

async function pollPreview() {
  if (document.hidden) {
    clearTimeout(preview.poll);
    preview.poll = setTimeout(pollPreview, 4000);
    return;
  }
  try {
    const data = await api('/api/preview/status');
    preview.running = data.running || [];
    renderPreviewState();
    updateServerChip();
    const busy = preview.running.some((r) => r.alive && !r.listening);
    clearTimeout(preview.poll);
    if (preview.running.some((r) => r.alive)) {
      preview.poll = setTimeout(pollPreview, busy ? 1000 : 4000);
    }
  } catch { /* the pane degrades to whatever it last showed */ }
}

/* ------------------------------------------------------------ terminal */

const term = { ws: null, connected: false };

function termConnect() {
  if (term.ws && term.ws.readyState <= 1) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws/terminal`);
  term.ws = ws;
  $('#term-status').textContent = 'connecting…';

  ws.onopen = () => {
    term.connected = true;
    $('#term-status').textContent = 'connected';
    termFit();
  };
  ws.onclose = () => {
    term.connected = false;
    $('#term-status').textContent = 'disconnected';
  };
  ws.onerror = () => { $('#term-status').textContent = 'error'; };
  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'screen') termDraw(msg);
    else if (msg.type === 'exit') $('#term-status').textContent = 'shell exited';
    else if (msg.type === 'error') $('#term').textContent = msg.message;
  };
}

function termDraw(msg) {
  const box = $('#term');
  const cursor = msg.cursor || {};
  const out = [];

  msg.rows.forEach((runs, y) => {
    if (!runs.length) { out.push(''); return; }
    let x = 0;
    let line = '';
    for (const run of runs) {
      const classes = [];
      if (run.fg && run.fg !== 'default') classes.push(`fg-${run.fg}`);
      if (run.bg && run.bg !== 'default') classes.push(`bg-${run.bg}`);
      if (run.b) classes.push('b');
      if (run.r) classes.push('rev');

      // Split the run if the cursor sits inside it, so it can be highlighted
      // without a span per character everywhere else.
      if (!cursor.hidden && y === cursor.y && cursor.x >= x && cursor.x < x + run.t.length) {
        const at = cursor.x - x;
        const cls = classes.join(' ');
        line += `<span class="${cls}">${esc(run.t.slice(0, at))}</span>` +
                `<span class="cur">${esc(run.t[at] || ' ')}</span>` +
                `<span class="${cls}">${esc(run.t.slice(at + 1))}</span>`;
      } else {
        line += classes.length
          ? `<span class="${classes.join(' ')}">${esc(run.t)}</span>`
          : esc(run.t);
      }
      x += run.t.length;
    }
    if (!cursor.hidden && y === cursor.y && cursor.x >= x) {
      line += `${' '.repeat(Math.max(0, cursor.x - x))}<span class="cur"> </span>`;
    }
    out.push(line);
  });

  box.innerHTML = out.join('\n');
}

function termFit() {
  if (!term.connected) return;
  const box = $('#term');
  // Measure one character rather than assuming a ratio: the mono stack differs
  // per platform and a wrong width wraps every line in the wrong place.
  const probe = document.createElement('span');
  probe.textContent = '0'.repeat(50);
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
  probe.style.font = getComputedStyle(box).font;
  document.body.append(probe);
  const charW = probe.offsetWidth / 50;
  const charH = probe.offsetHeight * 1.35;
  probe.remove();

  const cols = Math.max(20, Math.floor((box.clientWidth - 24) / charW));
  const rows = Math.max(8, Math.floor((box.clientHeight - 20) / charH));
  term.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
}

function termKey(e) {
  if (!term.connected) return;
  const send = (data) => {
    e.preventDefault();
    term.ws.send(JSON.stringify({ type: 'input', data }));
  };
  const map = {
    Enter: '\r', Backspace: '\x7f', Tab: '\t', Escape: '\x1b',
    ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D',
    Home: '\x1b[H', End: '\x1b[F', Delete: '\x1b[3~',
    PageUp: '\x1b[5~', PageDown: '\x1b[6~',
  };
  if (map[e.key]) return send(map[e.key]);
  if (e.ctrlKey && e.key.length === 1 && /[a-z]/i.test(e.key)) {
    // Ctrl+C, Ctrl+D and friends as control codes.
    return send(String.fromCharCode(e.key.toLowerCase().charCodeAt(0) - 96));
  }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) return send(e.key);
}

/* ------------------------------------------------------------ plan pane */

let planSteps = [];

function renderPlanSteps() {
  const box = $('#plan-steps');
  if (!planSteps.length) {
    box.innerHTML = '<div class="dock-empty">No plan yet.</div>';
    return;
  }
  box.innerHTML = planSteps.map((s, i) => (
    `<div class="step ${s.state || ''}" data-step="${i}">` +
    `<span class="n">${s.state === 'done' ? '✓' : i + 1}</span>` +
    `<span style="flex:1">${esc(s.title || s.goal || '')}</span>` +
    `<span class="lane">${esc(s.lane || '')}</span></div>`)).join('');
}

async function makePlan() {
  const goal = $('#plan-goal').value.trim();
  if (!goal) return toast('Describe the goal first.');
  $('#plan-make').disabled = true;
  try {
    const plan = await api('/api/plan', { goal });
    planSteps = (plan.steps || []).map((s) => ({ ...s, state: '' }));
    renderPlanSteps();
    $('#plan-run').disabled = !planSteps.length;
    if (!planSteps.length) toast('No plan needed — send it as a normal message.');
  } catch (err) { toast(err.message); }
  finally { $('#plan-make').disabled = false; }
}

async function runPlanPane() {
  if (!planSteps.length) return;
  $('#plan-run').disabled = true;
  $('#plan-cancel').style.display = '';
  try {
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
        if (ev.type === 'step' && planSteps[ev.index]) {
          planSteps[ev.index].state = ev.state === 'done' ? 'done' : 'run';
          if (ev.lane) planSteps[ev.index].lane = ev.lane;
          renderPlanSteps();
        } else if (ev.type === 'summary' || ev.type === 'done') {
          addMessage('assistant', ev.text || 'Plan finished.');
        } else if (ev.type === 'error') {
          addMessage('error', ev.data || 'plan failed');
        }
      }
    }
  } catch (err) { toast(err.message); }
  finally {
    $('#plan-run').disabled = false;
    $('#plan-cancel').style.display = 'none';
    refreshStatus();
  }
}

/* ------------------------------------------------------------ pixel art */

const pixel = { options: null, kind: 'sprite', dirs: 4, poll: null };

async function loadPixel() {
  if (pixel.options) return renderPixelForm();
  try { pixel.options = await api('/api/pixel/options'); }
  catch (err) { return toast(err.message); }

  const o = pixel.options;
  $('#pixel-grid').innerHTML = o.sizes.map((s) =>
    `<option value="${s}"${s === 64 ? ' selected' : ''}>${s} × ${s}</option>`).join('');
  $('#pixel-palette').innerHTML = o.palettes.map((p) =>
    `<option value="${p}"${p === 24 ? ' selected' : ''}>${p} colours</option>`).join('');
  $('#pixel-lora').innerHTML = o.loras.map((l) =>
    `<option value="${esc(l.id)}">${esc(l.label)}</option>`).join('');
  $('#pixel-backend').innerHTML = o.backends.map((b) =>
    `<option value="${esc(b)}">${b === 'fal' ? 'fal (better, uses credit)'
      : 'Pollinations (free, no key)'}</option>`).join('');
  $('#pixel-action').innerHTML = Object.entries(o.animations).map(([name, frames]) =>
    `<option value="${esc(name)}">${esc(name)} · ${frames} frames</option>`).join('');

  renderPixelForm();
  pollPixel();
}

function renderPixelForm() {
  $('#pixel-action-field').style.display = pixel.kind === 'animation' ? '' : 'none';
  $('#pixel-dirs-field').style.display = pixel.kind === 'rotation' ? '' : 'none';

  const lora = (pixel.options?.loras || []).find((l) => l.id === $('#pixel-lora').value);
  const backend = $('#pixel-backend').value;
  const notes = [];
  if (lora?.notes) notes.push(lora.notes);
  if (backend === 'pollinations') notes.push('Pollinations ignores the style LoRA.');
  if (pixel.kind !== 'sprite') {
    notes.push('Every frame uses one seed and one design brief, so the '
      + 'character stays the same across the set.');
  }
  $('#pixel-note').textContent = notes.join(' ');
}

async function generatePixel() {
  const brief = $('#pixel-brief').value.trim();
  if (!brief) return toast('Describe the character first.');

  $('#pixel-go').disabled = true;
  try {
    await api('/api/pixel/generate', {
      kind: pixel.kind,
      brief,
      lora: $('#pixel-lora').value,
      grid: Number($('#pixel-grid').value),
      palette: Number($('#pixel-palette').value),
      backend: $('#pixel-backend').value,
      action: $('#pixel-action').value,
      directions: pixel.dirs,
      art_direct: $('#pixel-art-direct').checked,
    });
    toast('Started.');
    pollPixel(true);
  } catch (err) { toast(err.message); }
  finally { $('#pixel-go').disabled = false; }
}

function renderPixelJobs(jobs) {
  const box = $('#pixel-jobs');
  if (!jobs.length) {
    box.innerHTML = '<div class="dock-empty">Nothing made yet.</div>';
    return;
  }
  box.innerHTML = jobs.map((j) => {
    const url = (name) => `/api/pixel/file/${encodeURIComponent(j.id)}/${encodeURIComponent(name)}`;
    const running = j.status === 'queued' || j.status === 'running';

    const shots = (j.frames || []).map((f) => `
      <div class="shot">
        <img class="pixel" src="${url(f.preview || f.file)}" loading="lazy" alt="${esc(f.label)}">
        <div class="acts">
          <button data-pixel-save="${esc(f.file)}" data-job="${esc(j.id)}">Save</button>
          <button data-pixel-open="${url(f.file)}">PNG</button>
        </div>
        <span class="shot-label">${esc(f.label)}</span>
      </div>`).join('');

    return `<div class="job">
      <div class="job-head">
        <span class="st ${j.status}">${j.status}</span>
        <span style="color:var(--text-faint)">${esc(j.kind)} · ${j.grid}px · ${j.palette} colours</span>
        <span class="el">${j.elapsed}s</span>
        ${running ? `<button class="btn btn-sm btn-ghost" data-pixel-cancel="${j.id}">✕</button>` : ''}
      </div>
      <div class="prompt">${esc(j.brief)}</div>
      ${j.design ? `<div class="help" style="margin-top:4px">design: ${esc(j.design)}</div>` : ''}
      ${(j.logs || []).filter((l) => l.includes('art direction')).map((l) =>
        `<div class="err">${esc(l)}</div>`).join('')}
      ${j.error ? `<div class="err">${esc(j.error)}</div>` : ''}
      ${running ? `<div class="bar"><i></i></div>
        <div class="help">${esc((j.logs || []).slice(-1)[0] || '')}</div>` : ''}
      ${shots ? `<div class="gallery pixels">${shots}</div>` : ''}
      ${j.gif ? `<img class="pixel" style="margin-top:8px;max-width:180px"
                     src="${url(j.gif.file)}" alt="animation">` : ''}
      ${j.sheet ? `<div style="margin-top:8px">
        <img class="pixel" style="max-width:100%;border:1px solid var(--border)"
             src="${url(j.sheet.file)}" alt="sprite sheet">
        <div class="help">sheet · ${j.sheet.size[0]}×${j.sheet.size[1]} ·
          <button class="btn btn-sm btn-ghost" data-pixel-save="${esc(j.sheet.file)}"
                  data-job="${esc(j.id)}">save</button></div></div>` : ''}
    </div>`;
  }).join('');
}

async function pollPixel(force) {
  if (document.hidden) {
    clearTimeout(pixel.poll);
    pixel.poll = setTimeout(pollPixel, 2500);
    return;
  }
  try {
    const data = await api('/api/pixel/jobs');
    renderPixelJobs(data.jobs || []);
    const busy = (data.jobs || []).some((j) => j.status === 'queued' || j.status === 'running');
    clearTimeout(pixel.poll);
    if (busy || force) pixel.poll = setTimeout(pollPixel, 2500);
  } catch { /* the pane keeps whatever it last drew */ }
}

/* ------------------------------------------------------------ status */

function updateContextRing(tokensIn) {
  /* A rough proportion of the active tier's window. Exact accounting would
   * need the provider to report it; this is the same "are we near the edge"
   * signal without pretending to more precision than we have. */
  const tier = (state.status.tiers || []).find((t) => t.name === state.status.pinned) ||
    (state.status.tiers || [])[0];
  const limit = tier?.context || 32768;
  const pct = Math.min(100, Math.round((tokensIn / limit) * 100));
  const ring = $('#ctx-ring');
  ring.style.setProperty('--pct', `${pct}%`);
  ring.title = `Context used: ${pct}% of ${Math.round(limit / 1024)}k`;
}

async function refreshStatus() {
  try {
    const s = await api('/api/status');
    state.status = s;

    /* The server is the authority on whether a turn is running, and this is
     * the only place the two are compared. It closes both directions of a gap
     * that used to need a restart to escape:
     *
     *  - Reload the page mid-turn and the composer looked alive while the
     *    server was still working, so the next message came back 409.
     *  - Abort a stream (Stop, or the watchdog) and the server's worker keeps
     *    going; this re-disables the composer and brings Stop back rather
     *    than letting the user fire a message that will be refused. */
    if (typeof s.busy === 'boolean' && s.busy !== state.busy) setBusy(s.busy);

    const workspace = s.workspace || '';
    $('#crumb').textContent = workspace.split(/[\\/]/).pop();
    $('#crumb').title = workspace;
    $('#s-vram').textContent = s.vram_free_mb == null ? '' : `${(s.vram_free_mb / 1024).toFixed(1)} GB free`;

    const guard = s.write_guard?.stats;
    if (guard) {
      const caught = (guard.rejected_destructive || 0) + (guard.rejected_noise || 0) +
        (guard.rejected_placeholder || 0) + (guard.line_numbers_stripped || 0) +
        (guard.unescaped || 0);
      $('#s-guard').textContent = caught
        ? `guard caught ${caught}` : `${guard.writes_checked || 0} writes checked`;
    }
  } catch { /* the server may still be starting */ }
}

/* ------------------------------------------------------------ integrations */

/* What this machine is actually wired up to. Shown from the sidebar so the
 * answer to "can it make images / can it reach the cloud" is one click away
 * rather than buried in a settings tab. */
async function openIntegrations() {
  $('#integrations').classList.add('on');
  $('#backdrop').classList.add('on');
  const body = $('#integrations-body');
  body.innerHTML = '<div class="dock-empty">Checking…</div>';

  const [media, catalog, tools] = await Promise.all([
    api('/api/media/models').catch(() => ({})),
    api('/api/models/catalog').catch(() => ({})),
    api('/api/tools').catch(() => ({ tools: [] })),
  ]);

  const localCount = (catalog.local || []).length;
  const freeCount = (catalog.free || []).length;
  const paidCount = (catalog.paid || []).length;
  const vision = (catalog.local || []).some((m) => /vision/i.test(m.label));

  const rows = [
    {
      icon: '💻', name: 'Local models',
      detail: localCount ? `${localCount} tiers on your GPU${vision ? ', including vision' : ''}`
        : 'no tiers configured',
      on: localCount > 0,
    },
    {
      icon: '☁️', name: 'OpenRouter',
      detail: catalog.cloud_error ? catalog.cloud_error.slice(0, 60)
        : `${freeCount} free and ${paidCount} paid models · ${catalog.cost_mode || 'free_only'}`,
      on: !catalog.cloud_error && (freeCount + paidCount) > 0,
    },
    {
      icon: '🎨', name: 'fal — images and video',
      detail: media.has_key ? `${(media.models || []).length} models across ${(media.tasks || []).length} tasks`
        : 'no API key yet — add one in Settings → Media',
      on: !!media.has_key,
    },
    {
      icon: '🛠️', name: 'Tools',
      detail: `${(tools.tools || []).filter((t) => t.enabled).length} of ${(tools.tools || []).length} enabled`,
      on: (tools.tools || []).length > 0,
    },
  ];

  const free = await api('/api/free-providers').catch(() => ({ providers: [] }));

  body.innerHTML = rows.map((r) => `
    <div class="integration">
      <span class="icon">${r.icon}</span>
      <span class="body"><b>${esc(r.name)}</b><span>${esc(r.detail)}</span></span>
      <span class="status ${r.on ? 'on' : 'off'}">${r.on ? 'ready' : 'off'}</span>
    </div>`).join('') + `

    <div class="side-section" style="padding:16px 0 4px">Free model providers</div>
    <div class="help" style="margin-bottom:10px">
      Extra free lanes, so one provider rate-limiting you is not a dead end.
      <b>Each is off until you turn it on</b> — enabling one means your prompts
      reach that company.
    </div>

    ${(free.providers || []).map((p) => `
      <div class="provider">
        <div class="provider-main">
          <b>${esc(p.label)}</b>
          <div class="provider-meta">${esc(p.limits)}</div>
          <div class="provider-meta">${esc(p.speed)}</div>
          <div class="provider-warn">${esc(p.privacy)}</div>
          ${p.cooling_down_s
            ? `<div class="provider-err">rate-limited — resting ${p.cooling_down_s}s</div>` : ''}
        </div>
        <div class="provider-side">
          ${p.has_key
            ? '<span class="pill free">key saved</span>'
            : `<input type="password" data-key-for="${esc(p.id)}" placeholder="paste API key">
               <a href="https://${esc(p.signup)}" target="_blank" rel="noopener"
                  class="provider-meta">${esc(p.signup)} ↗</a>`}
          <label class="provider-toggle">
            <input type="checkbox" data-enable="${esc(p.id)}" ${p.enabled ? 'checked' : ''}>
            <span>${p.enabled ? 'on' : 'off'}</span>
          </label>
        </div>
      </div>`).join('')}

    <label class="integration" style="cursor:pointer">
      <span class="icon">⚡</span>
      <span class="body">
        <b>Use them for quick jobs</b>
        <span>Summarising, naming and classifying go to a fast free provider
        instead of your GPU. Your main coding turns stay put.</span>
      </span>
      <input type="checkbox" id="fast-roles" ${free.fast_roles?.enabled ? 'checked' : ''}>
    </label>

    <div class="help" style="margin-top:10px">
      Keys live in ~/.clawd/config.json. Environment variables take priority.
    </div>`;

  body.onchange = async (e) => {
    const enable = e.target.closest('[data-enable]');
    const fast = e.target.closest('#fast-roles');
    try {
      if (enable) {
        const keyBox = body.querySelector(`[data-key-for="${CSS.escape(enable.dataset.enable)}"]`);
        await api('/api/free-providers', {
          id: enable.dataset.enable,
          enabled: enable.checked,
          api_key: keyBox?.value || null,
        });
        openIntegrations();
      } else if (fast) {
        await api('/api/free-providers/fast-roles', { enabled: fast.checked });
        toast(fast.checked ? 'Quick jobs will use a free provider.'
                           : 'Everything stays on your machine.');
      }
    } catch (err) {
      toast(err.message);
      e.target.checked = !e.target.checked;
    }
  };

  $('#integration-count').textContent =
    rows.filter((r) => r.on).length + (free.providers || []).filter((p) => p.enabled).length;
}

async function refreshIntegrationCount() {
  try {
    const media = await api('/api/media/models');
    const catalog = await api('/api/models/catalog');
    const on = [(catalog.local || []).length > 0, !catalog.cloud_error,
      !!media.has_key].filter(Boolean).length;
    $('#integration-count').textContent = on;
  } catch { /* the badge is decoration */ }
}

/* ------------------------------------------------------------ sessions */

function ago(seconds) {
  const d = Date.now() / 1000 - seconds;
  if (d < 90) return 'now';
  if (d < 3600) return `${Math.round(d / 60)}m`;
  if (d < 86400) return `${Math.round(d / 3600)}h`;
  return `${Math.round(d / 86400)}d`;
}

async function loadSessions() {
  try {
    const data = await api('/api/sessions');
    const box = $('#sessions');
    let list = data.sessions || [];
    state.currentSession = data.current;

    const needle = (state.sessionFilter || '').toLowerCase();
    if (needle) {
      list = list.filter((s) => `${s.title} ${s.project}`.toLowerCase().includes(needle));
    }

    if (!list.length) {
      box.innerHTML = `<div class="dock-empty" style="padding:14px 8px;font-size:12px">${
        needle ? 'Nothing matches.' : 'No sessions yet.'}</div>`;
      return;
    }

    $('#session-title').value = list.find((s) => s.id === data.current)?.title || 'New session';

    // Group by project, current project first: sessions in the folder you are
    // working in are the ones you want to switch between.
    const groups = new Map();
    for (const s of list) {
      const key = state.groupBy === 'none' ? '' : (s.project || 'elsewhere');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    const here = (state.status.workspace || '').split(/[\\/]/).pop();
    const ordered = [...groups.entries()].sort((a, b) =>
      (b[0] === here) - (a[0] === here) || a[0].localeCompare(b[0]));

    box.innerHTML = ordered.map(([project, rows]) => (
      (groups.size > 1 ? `<div class="side-section" style="padding:9px 6px 3px">${esc(project)}</div>` : '') +
      rows.map((s) => `<div class="session${s.id === data.current ? ' active' : ''}" data-id="${esc(s.id)}">` +
        '<span class="dot"></span>' +
        `<span class="label" title="${esc(s.title)}">${esc(s.title || s.id)}</span>` +
        `<span class="when">${ago(s.saved_at)}</span>` +
        `<button class="kill" data-del="${esc(s.id)}">✕</button></div>`).join('')
    )).join('');
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

/* ------------------------------------------------------------ autocomplete */

/* The composer promises "/ for commands, @ for files". Both are driven from
 * the same popup: a token is detected at the caret, candidates are fetched,
 * and the selection is spliced back in place of the token. */

const complete = { open: false, kind: null, start: 0, items: [], cursor: 0 };

function tokenAtCaret() {
  const box = $('#input');
  const upto = box.value.slice(0, box.selectionStart);
  const match = upto.match(/(^|\s)([/@])([^\s]*)$/);
  if (!match) return null;
  return {
    kind: match[2],
    query: match[3],
    start: upto.length - match[3].length - 1,
  };
}

/* Which completion request is current. A response for "@ser" that arrives
 * after the one for "@server" must not repaint the popup with stale entries,
 * and one still in flight when send() runs must not reopen the picker and
 * swallow the next Enter. */
let completeSeq = 0;

async function refreshComplete() {
  const token = tokenAtCaret();
  if (!token) return closeComplete();

  const seq = ++completeSeq;
  let items = [];
  try {
    if (token.kind === '/') {
      const data = await api('/api/commands');
      items = (data.commands || [])
        .filter((c) => c.name.startsWith(token.query))
        .map((c) => ({
          value: `/${c.name}`,
          label: `/${c.name}${c.args ? ' ' + c.args : ''}`,
          detail: c.help || '',
        }));
    } else {
      const data = await api(`/api/files?q=${encodeURIComponent(token.query)}&limit=12`);
      items = (data.files || []).map((f) => ({ value: f, label: f.split(/[\\/]/).pop(), detail: f }));
    }
  } catch { return closeComplete(); }

  if (seq !== completeSeq) return;        // a newer keystroke already won
  if (!items.length) return closeComplete();
  Object.assign(complete, { open: true, kind: token.kind, start: token.start, items, cursor: 0 });
  drawComplete();
}

function drawComplete() {
  const pop = $('#complete');
  pop.innerHTML = complete.items.map((it, i) =>
    `<button class="menu-item${i === complete.cursor ? ' cursor' : ''}" data-i="${i}">` +
    `<span class="m-label">${esc(it.label)}</span>` +
    `<span class="m-detail">${esc(it.detail)}</span></button>`).join('');
  pop.classList.add('on');

  const rect = $('.composer').getBoundingClientRect();
  pop.style.left = `${rect.left}px`;
  pop.style.width = `${rect.width}px`;
  pop.style.bottom = `${window.innerHeight - rect.top + 6}px`;
}

function closeComplete() {
  complete.open = false;
  $('#complete').classList.remove('on');
}

function applyComplete(index) {
  const item = complete.items[index];
  if (!item) return;
  const box = $('#input');
  const after = box.value.slice(box.selectionStart);
  // A file mention goes in as a bare path: the model needs somewhere to look,
  // not a sigil it has to strip.
  const insert = complete.kind === '@' ? item.value : item.value;
  box.value = box.value.slice(0, complete.start) + insert + ' ' + after;
  const caret = complete.start + insert.length + 1;
  box.setSelectionRange(caret, caret);
  closeComplete();
  box.focus();
  autoGrow();
}

/* ------------------------------------------------------------ shortcuts */

const SHORTCUTS = [
  ['Ctrl /', 'Show this list'],
  ['Ctrl N', 'New session'],
  ['Ctrl B', 'Toggle sidebar'],
  ['Ctrl Shift D', 'Toggle side panel'],
  ['Ctrl Shift I', 'Model menu'],
  ['Ctrl O', 'Cycle view density'],
  ['Ctrl Shift M', 'Permission mode'],
  ['Ctrl Shift E', 'Effort'],
  ['Ctrl Shift G', 'Media panel'],
  ['Ctrl `', 'Terminal panel'],
  ['Ctrl Shift P', 'Plan panel'],
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
    if (view === 'terminal') { termConnect(); setTimeout(() => $('#term').focus(), 60); }
    if (view === 'preview') { loadPreview().then(pollPreview); }
    // pollJobs alongside loadPixel, matching the media view above. loadPixel
    // early-returns once the options are cached, so on every visit after the
    // first it drew the form and never refreshed the gallery -- which is
    // exactly the path a user takes after asking the chat for a sprite.
    if (view === 'pixel') { loadPixel(); pollPixel(true); }
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

const openFile = { path: null, original: '' };

async function showFile(path) {
  let data;
  try { data = await api(`/api/file?path=${encodeURIComponent(path)}`); }
  catch (err) { return toast(err.message); }

  openFile.path = data.path;
  $('#file-browse').style.display = 'none';
  $('#file-open').style.display = '';
  $('#file-name').textContent = path;
  $('#file-dirty').style.display = 'none';
  $('#file-save').disabled = true;

  const body = $('#file-body');
  const media = $('#file-media');

  if (data.kind === 'text') {
    openFile.original = data.content;
    body.value = data.content;
    body.style.display = '';
    media.style.display = 'none';
  } else {
    body.style.display = 'none';
    media.style.display = '';
    // HTML, PDFs, images and video open as previews rather than as text, the
    // same split the Browser pane makes.
    if (data.kind === 'media') {
      const ext = data.path.split('.').pop().toLowerCase();
      media.innerHTML =
        ['mp4', 'webm', 'mov'].includes(ext) ? `<video src="${esc(data.url)}" controls></video>`
        : ext === 'pdf' ? `<embed src="${esc(data.url)}" type="application/pdf">`
        : `<img src="${esc(data.url)}" alt="">`;
    } else {
      media.innerHTML = `<div class="dock-empty">${
        data.kind === 'too_big'
          ? `${Math.round(data.size / 1024)} KB — too large to edit here.`
          : 'Binary file.'}</div>`;
    }
  }
}

function closeFile() {
  $('#file-browse').style.display = '';
  $('#file-open').style.display = 'none';
  openFile.path = null;
}

async function saveFile() {
  if (!openFile.path) return;
  try {
    await api('/api/file', { path: openFile.path, content: $('#file-body').value });
    openFile.original = $('#file-body').value;
    $('#file-dirty').style.display = 'none';
    $('#file-save').disabled = true;
    toast('Saved.');
  } catch (err) { toast(err.message); }
}

/* ------------------------------------------------------------ wiring */

function init() {
  // ?pane=terminal&theme=dark opens straight into a view. Useful for a
  // bookmark or a second window pinned to the terminal, and it means a
  // screenshot of any pane is one URL away.
  const params = new URLSearchParams(location.search);

  $('#thread').innerHTML = EMPTY_HTML;
  watchScroll();

  setView(params.get('view') || state.view);
  document.documentElement.dataset.theme =
    params.get('theme') || localStorage.getItem('theme') || 'light';
  renderShortcuts();
  refreshStatus();
  loadSessions();
  whileVisible(refreshStatus, 6000);
  whileVisible(loadSessions, 20000);

  const pane = params.get('pane');
  if (pane) setTimeout(() => showDock(pane), 250);

  // ?sheet=integrations opens a panel straight from the URL. Useful for a
  // bookmark, and the only way to screenshot a modal without driving a mouse.
  const sheet = params.get('sheet');
  if (sheet === 'integrations') setTimeout(openIntegrations, 300);
  else if (sheet === 'settings') setTimeout(openSettings, 300);
  else if (sheet === 'shortcuts') setTimeout(() => {
    $('#shortcuts').classList.add('on');
    $('#backdrop').classList.add('on');
  }, 300);

  $('#send').onclick = () => send();
  /* Stop is cooperative first, forceful second.
   *
   * /api/stop sets a flag the worker reads *between* model calls, which is
   * right: a tool already running should finish rather than leave half a file
   * written. But a model call that is itself hung never reaches the check, and
   * then the one button a user presses when the UI stops responding was the
   * one that could not help. So: ask nicely, and if the turn has not ended in
   * five seconds, take the connection down. refreshStatus reconciles the
   * server's own flag afterwards. */
  $('#stop').onclick = () => {
    const btn = $('#stop');
    btn.textContent = 'Stopping…';
    btn.disabled = true;
    api('/api/stop', {}).catch(() => {});
    setTimeout(() => { if (state.busy) state.abort?.abort(); }, 5000);
  };
  // One request per pause, not one per keystroke. Typing "@server" used to
  // fire six /api/files calls, each walking the workspace tree, and the first
  // five were obsolete before they returned.
  let completeTimer = null;
  $('#input').addEventListener('input', () => {
    autoGrow();
    clearTimeout(completeTimer);
    completeTimer = setTimeout(refreshComplete, 150);
  });
  $('#input').addEventListener('blur', () => setTimeout(closeComplete, 150));
  $('#input').addEventListener('keydown', (e) => {
    if (complete.open) {
      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        complete.cursor = (complete.cursor + 1) % complete.items.length;
        return drawComplete();
      }
      if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault();
        complete.cursor = (complete.cursor - 1 + complete.items.length) % complete.items.length;
        return drawComplete();
      }
      if (e.key === 'Enter') { e.preventDefault(); return applyComplete(complete.cursor); }
      if (e.key === 'Escape') { e.preventDefault(); return closeComplete(); }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $('#complete').onmousedown = (e) => {
    const btn = e.target.closest('[data-i]');
    if (btn) { e.preventDefault(); applyComplete(Number(btn.dataset.i)); }
  };

  $('#model-chip').onclick = openModelMenu;
  $('#view-chip').onclick = openViewMenu;
  $('#perm-chip').onclick = openPermMenu;
  $('#effort-chip').onclick = openEffortMenu;
  $('#plus-btn').onclick = openPlusMenu;
  $('#views-chip').onclick = openViewsMenu;
  $('#server-chip').onclick = openServerMenu;
  $('#dock-close').onclick = () => {
    $('#dock').classList.add('hidden');
    $('#splitter').classList.add('hidden');
  };
  loadTurnSettings();
  refreshIntegrationCount();

  $('#toggle-sidebar').onclick = () => $('#app').classList.toggle('sidebar-hidden');
  $('#toggle-theme').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
  };
  $('#open-settings').onclick = openSettings;
  $('#open-integrations').onclick = openIntegrations;

  // Rename by typing in the toolbar title, as in Claude Code.
  $('#session-title').addEventListener('change', async (e) => {
    const title = e.target.value.trim() || 'New session';
    e.target.value = title;
    try {
      await api('/api/sessions/save', { id: state.currentSession, title });
      loadSessions();
    } catch (err) { toast(err.message); }
  });
  $('#session-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.target.blur();
  });

  $('#session-group').onchange = (e) => {
    state.groupBy = e.target.value;
    loadSessions();
  };

  $('#new-session').onclick = async () => {
    try { await api('/api/sessions/new', {}); }
    catch (err) { return toast(err.message); }
    $('#thread').innerHTML = EMPTY_HTML;
    state.diffs = [];
    renderDiffDock();
    refreshStatus();
    loadSessions();
  };

  $('#session-filter').oninput = (e) => {
    state.sessionFilter = e.target.value;
    loadSessions();
  };

  // The project name in the toolbar is also how you change project.
  $('#crumb').onclick = async () => {
    // In the desktop shell there is no window.prompt, and a native folder
    // chooser is the right control anyway. Fall back to prompt() only in a
    // real browser tab.
    let path = null;
    const native = window.pywebview?.api?.pick_folder;
    if (native) {
      try { path = await native(); } catch { path = null; }
    } else {
      path = prompt('Project folder:', state.status.workspace || '');
    }
    if (!path) return;
    try { await api('/api/workspace', { path }); toast('Project changed.'); refreshStatus(); }
    catch (err) { toast(err.message); }
  };

  /* attachments */
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
    if (row) showFile(row.dataset.file);
  };
  $('#file-back').onclick = closeFile;
  $('#file-save').onclick = saveFile;
  $('#file-body').addEventListener('input', () => {
    const dirty = $('#file-body').value !== openFile.original;
    $('#file-dirty').style.display = dirty ? '' : 'none';
    $('#file-save').disabled = !dirty;
  });
  $('#file-body').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveFile(); }
  });
  $('#file-mention').onclick = () => {
    const box = $('#input');
    box.value += (box.value && !box.value.endsWith(' ') ? ' ' : '') +
      $('#file-name').textContent + ' ';
    box.focus(); autoGrow();
  };

  /* app preview */
  $('#preview-pick').onchange = renderPreviewState;
  $('#preview-start').onclick = async () => {
    try {
      await api('/api/preview/start', { name: $('#preview-pick').value });
      toast('Starting…');
      pollPreview();
    } catch (err) { toast(err.message); }
  };
  $('#preview-stop').onclick = async () => {
    await api('/api/preview/stop', { name: $('#preview-pick').value }).catch(() => {});
    $('#preview-frame').removeAttribute('src');
    $('#preview-frame').dataset.url = '';
    pollPreview();
  };
  $('#preview-reload').onclick = () => {
    const frame = $('#preview-frame');
    if (frame.dataset.url) frame.src = frame.dataset.url;
  };
  $('#preview-external').onclick = () => {
    const running = currentPreview();
    if (running?.url) window.open(running.url, '_blank');
    else toast('Nothing is running yet.');
  };
  $('#preview-save').onclick = async () => {
    try {
      await api('/api/preview/configs', { content: $('#preview-config').value });
      toast('Saved launch.json');
      loadPreview();
    } catch (err) { toast(err.message); }
  };

  /* pixel art */
  $('#pixel-kind').onclick = (e) => {
    const btn = e.target.closest('[data-kind]');
    if (!btn) return;
    pixel.kind = btn.dataset.kind;
    $$('#pixel-kind button').forEach((b) => b.classList.toggle('on', b === btn));
    renderPixelForm();
  };
  $('#pixel-dirs').onclick = (e) => {
    const btn = e.target.closest('[data-dirs]');
    if (!btn) return;
    pixel.dirs = Number(btn.dataset.dirs);
    $$('#pixel-dirs button').forEach((b) => b.classList.toggle('on', b === btn));
  };
  $('#pixel-lora').onchange = renderPixelForm;
  $('#pixel-backend').onchange = renderPixelForm;
  $('#pixel-go').onclick = generatePixel;
  $('#pixel-jobs').onclick = async (e) => {
    const save = e.target.closest('[data-pixel-save]');
    const open = e.target.closest('[data-pixel-open]');
    const cancel = e.target.closest('[data-pixel-cancel]');
    if (save) {
      try {
        // Sprites belong in the project, unlike experiments -- they are assets.
        const r = await api('/api/media/save',
          { file: `pixel/${save.dataset.job}/${save.dataset.pixelSave}`,
            directory: 'assets/sprites' });
        toast(`Saved to ${r.path}`);
      } catch (err) { toast(err.message); }
    } else if (open) {
      window.open(open.dataset.pixelOpen, '_blank');
    } else if (cancel) {
      await api(`/api/pixel/jobs/${cancel.dataset.pixelCancel}/cancel`, {}).catch(() => {});
      pollPixel(true);
    }
  };

  /* terminal */
  $('#term').addEventListener('keydown', termKey);
  $('#term').addEventListener('paste', (e) => {
    if (!term.connected) return;
    e.preventDefault();
    term.ws.send(JSON.stringify({ type: 'input', data: e.clipboardData.getData('text') }));
  });
  $('#term-restart').onclick = () => {
    if (term.ws) term.ws.close();
    term.ws = null;
    termConnect();
  };
  window.addEventListener('resize', () => { if (term.connected) termFit(); });

  /* plan pane */
  $('#plan-make').onclick = makePlan;
  $('#plan-run').onclick = runPlanPane;
  $('#plan-cancel').onclick = () => api('/api/plan/stop', {}).catch(() => {});

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
        if (typeof m.content === 'string' && m.content.trim()) {
          addMessage(m.role === 'user' ? 'user' : 'assistant', m.content);
        }
      }
      if (!$('#thread').children.length) $('#thread').innerHTML = EMPTY_HTML;
      state.model = data.model || 'auto';
      $('#model-label').textContent = state.model === 'auto' ? 'Auto'
        : state.model.split(':').slice(1).join(':').split('/').pop();
      $('#model-chip').classList.toggle('on', state.model !== 'auto');
      $$('.session').forEach((s) => s.classList.toggle('active', s === row));
      state.diffs = [];
      renderDiffDock();
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
    else if (e.shiftKey && e.key.toLowerCase() === 'g') { e.preventDefault(); showDock('media'); }
    else if (e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); showDock('plan'); }
    else if (e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); openPermMenu(); }
    else if (e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); openEffortMenu(); }
    else if (e.key === '`') { e.preventDefault(); showDock('terminal'); }
  });
}

document.addEventListener('DOMContentLoaded', init);
