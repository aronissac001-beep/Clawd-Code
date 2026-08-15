# The desktop app

A local-first coding agent with a Claude Code shaped interface. Everything runs
on your machine by default; going off-box is a choice you make in the model
picker, not something that happens quietly.

```bash
# desktop window
python -m src.webui.app --workspace /path/to/project

# or a browser tab
python -m src.webui --port 8765
```

Both serve the same UI. The desktop build wraps it in a real window via
WebView2, adds a native folder picker, and releases GPU memory on close.

---

## Layout

```
┌──────────┬────────────────────────────────┬──────────────────┐
│ sessions │ chat                           │ dock             │
│          │                                │  Diff  Files App │
│ filter   │                                │  Term  Plan      │
│ grouped  │                                │  Media Tasks     │
│ by       │                                │                  │
│ project  ├────────────────────────────────┤                  │
│          │ composer                       │                  │
├──────────┤  / commands  @ files  📎 image │                  │
│ vram     │                                │                  │
│ tokens   │                                │                  │
│ guard    │                                │                  │
└──────────┴────────────────────────────────┴──────────────────┘
```

Drag the divider to resize the dock. `Ctrl+\` closes it.

### Panes

| Pane | What it does |
|---|---|
| **Diff** | Every edit the agent made this turn, per file, with `+`/`−` counts |
| **Files** | Search, open, edit and save. Images, video and PDFs preview |
| **App** | Runs your dev server from `.claude/launch.json` and shows it |
| **Term** | A real shell rooted at the workspace |
| **Plan** | Split a large job into steps and run independent ones in parallel |
| **Media** | Generate images and video through fal |
| **Tasks** | Background work in the current session |

### Keyboard

| | |
|---|---|
| `Ctrl` `/` | All shortcuts |
| `Ctrl` `N` | New session |
| `Ctrl` `B` | Toggle sidebar |
| `Ctrl` `Shift` `D` | Diff pane |
| `Ctrl` `Shift` `I` | Model menu |
| `Ctrl` `Shift` `M` | Permission mode |
| `Ctrl` `Shift` `E` | Effort |
| `Ctrl` `Shift` `G` | Media pane |
| `Ctrl` `Shift` `P` | Plan pane |
| ``Ctrl` `` ` `` | Terminal |
| `Ctrl` `O` | Cycle view density |
| `Ctrl` `\` | Close the dock |
| `Esc` | Stop generating |

`?pane=terminal&theme=dark` opens straight into a view, if you want a second
window pinned to one.

---

## Choosing a model

`Ctrl+Shift+I` lists the local ladder and the entire OpenRouter catalogue
together, with free/paid and vision badges and a search box over 500+ models.

- **Auto** — the router picks per role and escalates when a tier struggles
- **local:*tier*** — pin one rung of the ladder
- **openrouter:*model*** — send every turn off-box to a named model

The selection is sticky. That matters more than it sounds: the agent loop makes
several provider calls to answer one message, so a one-shot cloud escape would
send turn 1 to your chosen model and quietly drop the rest onto the local ladder.

### View density

`Ctrl+O` cycles **Summary** (answers and changes only), **Normal** (tool calls
collapsed) and **Verbose** (every step, expanded). Summary is for when several
things are running and you are scanning; Verbose is for when you want to know
why the agent did something.

### Permission mode

`Ctrl+Shift+M`:

| Mode | Effect |
|---|---|
| Read only | Write, Edit and Bash are denied outright |
| Ask | Anything needing approval is refused |
| Accept edits | File changes go through; shell still refused |
| Full access | Nothing withheld |

There is no interactive approval prompt in this UI, so **Ask genuinely means
refuse** rather than proceed. The other modes decide up front what would have
been approved.

### Effort

`Ctrl+Shift+E` sets the response budget: low (1k), medium (the tier's own
limit), high (8k), max (16k tokens).

This is a length cap, not a reasoning-depth control — local llama.cpp models
have no such knob and a menu that pretended otherwise would be a placebo. It is
still the setting that matters: llama.cpp generates until the context window is
exhausted and then truncates mid-stream, which reaches you as an *empty* reply
after minutes of compute.

---

## Images and video

### Sending an image to the agent

Paste, drop, or use 📎. Attachments are stored, shown inline, and passed to the
model as real image content.

If you have not pinned a model, a turn carrying an image is **routed
automatically to a tier with a vision projector**, and routing is handed back
afterwards. Without that, the image would go to a text-only model, which accepts
the request and answers as though the picture were not there — indistinguishable
from an unobservant model.

Set up a local vision tier once:

```bash
python -m src.local.cli fetch vision     # ~5.3 GB, weights + projector
```

llama.cpp keeps a vision model's tower in a separate `mmproj` file from its
language weights. A tier configured with one but missing it will refuse to
start rather than come up blind.

### Generating images and video

The **Media** pane drives [fal.ai](https://fal.ai). Add a key in Settings →
Media, or set `FAL_KEY`.

| Task | Models |
|---|---|
| Image | FLUX schnell / dev / 1.1 Pro Ultra, Recraft v3 |
| Edit | FLUX Kontext, FLUX dev img2img |
| Video | Kling v3 Pro, Hailuo 02 |
| Animate | Kling v3 Pro, Hailuo 02 (image → video) |

Any fal endpoint id works, not just these — the catalogue moves, so the list is
a starting point rather than a closed set.

Results download to `~/.clawd/media` at generation time, because fal's URLs
expire. They land **outside your project**: a gallery of experiments is not
something to drop into a git repo. *Save* copies one in when it earns a place.

From a result you can send it to the composer, save it to the workspace, or use
it as the seed for a video.

---

## The app preview pane

Reads `.claude/launch.json` — the same file Claude Code uses, so a project
configured for one works in the other:

```json
{
  "version": "0.0.1",
  "configurations": [
    {"name": "web", "runtimeExecutable": "npm",
     "runtimeArgs": ["run", "dev"], "port": 5173}
  ]
}
```

An entry with a `url` and no command attaches to a server that is already
running. With no config at all, the pane offers a guess as editable text — it
will not run one on its own, because guessing a start command means running an
arbitrary command in your repository.

The iframe points straight at `localhost:PORT` rather than proxying, so the app
sees its own origin and cookies, paths and websockets behave normally.

---

## Sessions

Chats save after every turn, including failed ones — often the more interesting
kind. Each is titled from its opening request and grouped by project, with the
folder you are working in first. Switching saves the outgoing chat and restores
the model the incoming one was using.

---

## The write guard

Small models corrupt files in a few recurring ways, and the sidebar keeps a
running count of what was caught. It rejects content that is placeholder text,
unstructured noise, or would gut an existing file; it repairs echoed line
numbers and escaped newlines in place.

It applies to what *models* write. Hand edits in the Files pane go through
untouched — a person deleting most of a file has decided to.

---

## Where things live

```
~/.clawd/config.json          provider keys, including fal
~/.clawd/media/               generations and uploads
~/.clawd/ui-sessions/         saved chats
local-stack/clawd-local.yaml  tiers, profiles, roles, routing
local-stack/models/           GGUF weights
.claude/launch.json           dev server config, per project
```

See [local-stack/README.md](../local-stack/README.md) for the model ladder,
resource profiles and routing.
