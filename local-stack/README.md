# Clawd-Code local model stack

A tiered local-inference setup for Clawd-Code, tuned for an **RTX 4060 Laptop
(8 GB) + i7-12650H + 32 GB RAM**. Requests are routed to the smallest model
that can handle them, with escalation when a model gets stuck.

---

## The hardware constraint

Memory bandwidth sets the ceiling on generation speed:

| | bandwidth | note |
|---|---|---|
| VRAM | ~272 GB/s | ~7.0–7.8 GB usable (desktop compositor holds ~0.4–1.1 GB) |
| System RAM | ~76 GB/s | 32 GB, ~3.5× slower than VRAM |

Two consequences drive the whole design:

1. **MoE beats dense at this VRAM tier.** A dense 27B at Q4 reads ~16.8 GB per
   token → ~4 tok/s, unusable interactively. A 35B MoE with 3B active reads
   ~1.8 GB per token, so its experts can live in system RAM and still generate
   at a usable rate. That is the only reason a 30B-class tier exists here.

2. **Only one GPU-resident tier fits at a time.** The workhorse alone is
   ~5.7 GB of weights plus ~0.5 GB of quantised KV cache. The supervisor
   therefore evicts rather than co-loads, and the reflex tier is deliberately
   placed on the CPU so it stays warm without competing for VRAM.

---

## The ladder

| Tier | Model | Size | Placement | Speculation | **Measured** | Role |
|---|---|---|---|---|---|---|
| `draft` | Qwen3.5-0.8B | 546 MB | — | — | — | draft for workhorse (unused with MTP) |
| `reflex` | Qwen3.5-4B | 2.6 GB | CPU | none | 8.5 tok/s | fallback for battery / cpu_only |
| `workhorse` | Qwen3.5-9B-MTP | 5.7 GB | GPU | `draft-mtp` | **37.3 tok/s** | main agent loop, tool calling |
| `deep` | Qwen3.6-35B-A3B | 20.6 GB | GPU attn + RAM experts | **none** | **32.0 tok/s** | planning, hard debugging |
| `vision` | Qwen2.5-VL-7B | 5.3 GB | GPU | none | 8.7 s to first token | reading attached images |

### The vision tier is off the ladder

`vision` is never routed to by role and escalation cannot reach it. A vision
model is markedly worse at tool-driven coding than the workhorse, so promoting
to it would be a downgrade. It is used in exactly two situations: you pick it in
the model menu, or a message arrives carrying an image and no model is pinned —
in which case that one turn borrows it and routing is handed back afterwards.

It is also the one tier made of two files:

```yaml
vision:
  repo: ggml-org/Qwen2.5-VL-7B-Instruct-GGUF
  file: Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf      # language weights
  mmproj: mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf  # vision tower
```

llama.cpp will start happily with only the first and then ignore every image
without complaint, which reads as the model being unobservant rather than
blind. `fetch` and `verify` treat both as required, and a tier configured with
an `mmproj` refuses to start without it.

`ggml-org` is the llama.cpp team's own Hugging Face org, so the projector
format matches the server that loads it. Community requants of the same model
are a coin flip on that.

### Prefill is the number that matters

Generation speed is the wrong metric for an agent. Every turn re-sends ~10k
tokens of tool schemas and file content **before producing a single token**, so
prompt processing governs latency:

| Tier | Prefill | Generation | 10k-token turn |
|---|---|---|---|
| workhorse | **1196 tok/s** | 37.6 tok/s | 8 s |
| deep (`n_cpu_moe=36`) | **747 tok/s** | 28.5 tok/s | 13 s |
| deep (`n_cpu_moe=40`) | 221 tok/s | 21.5 tok/s | 45 s |
| deep **with mmap** | **9.2 tok/s** | 32.0 tok/s | **~18 min** |

That last row is the trap. With mmap enabled, deep generates at a healthy
32 tok/s and is still completely unusable, because expert weights are paged
through the mapping on every prefill batch. llama.cpp warns about this in its
own startup log. `--load-mode none` (the replacement for the deprecated
`--no-mmap`) is **mandatory** for MoE CPU offload — it is a 24x difference.

Optimising for generation alone would also have chosen `n_cpu_moe=40` over 36
and been 3.4x slower where it counts.

### Verified on a real refactor

Both GPU tiers were given the same 4-file dependency-injection refactor and
graded by a hidden test suite (baseline: 5 failed, 1 passed).

| | workhorse 9B | deep 35B-A3B |
|---|---|---|
| pytest | **6/6** | **6/6** |
| leftover globals | none | none |
| turns | 12 | **6** |
| input tokens | 130,256 | **53,793** |
| wall clock | **114 s** | 166 s |
| self-verification | tried to run python | **grepped for all 3 symbols** |

Deep needed half the turns and 2.4x fewer tokens, and verified its own work
properly — but finished slower in wall-clock terms. Use it when a task needs
planning over many steps; use the workhorse for everything else.

---

All figures measured on this hardware, 256-token generations, best of 4 warm
runs. Two results worth internalising:

- **A 35B model runs at 32 tok/s on an 8 GB laptop GPU** — within 15% of the
  9B. Only 3B parameters are active per token, so once the experts sit in page
  cache the MoE is barely slower than a model a quarter its size. A dense 27B
  at Q4 would read ~16.8 GB per token and land near 4 tok/s.
- **First run after load is ~3x slower** (10.5 vs 32.0 tok/s) while 20 GB of
  experts fault into the page cache. That is cache warming, not a defect;
  budget for it after a tier switch.

### Why 9B for the main loop

Reliable tool calling emerges around 7–9B. Below that, models do not
self-correct after a failed tool call — they repeat it verbatim until the
context fills. Since Clawd-Code *is* a tool-calling agent, this sets the floor
regardless of how fast a 4B would be.

### Why speculation is on for `workhorse` but off for `deep`

This is counter-intuitive and worth stating plainly.

- **Dense models**: every token re-reads all weights, so verifying a batch of
  drafted tokens costs little more than generating one. Speculation wins
  (~1.5–2×), and code is the ideal workload because drafts are accepted ~80% of
  the time versus ~50% for open-ended chat.
- **MoE models**: measured **net-negative** on 35B-A3B — baseline 135–140 tok/s
  dropped to 120–121 tok/s with a draft model (−13%), and to 85.6 tok/s with
  aggressive windowing (−39%), *despite 100% draft acceptance*. With 3B active
  over 8-of-256 routed experts, each verified token drags a fresh expert slice
  through memory; on bandwidth-bound hardware that exceeds the acceptance gain.
  ([benchmark](https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/discussions/14))

CPU expert offload makes this *worse*, not better, since the experts stream
from RAM at ~76 GB/s. Hence `spec_type: none` on the deep tier.

---

## Resource profiles

One knob. `active_profile` in `clawd-local.yaml`, or `/profile <name>` in the REPL.

| Profile | VRAM | RAM | Threads | Context | Deep tier |
|---|---|---|---|---|---|
| `battery` | 3.6 GB | 6 GB | 4 | 8K | no |
| `balanced` | 6.8 GB | 20 GB | 6 | 16K | yes |
| `max` | 7.2 GB | 26 GB | 10 | 32K | yes |
| `cpu_only` | 0 | 24 GB | 10 | 8K | yes |

**Thread note:** `threads: 6` pins generation to the 6 P-cores. Including the
4 E-cores usually *reduces* throughput on Alder Lake, because llama.cpp splits
work evenly and then waits on the slower cores. `threads_batch` does use all
16, since prompt processing parallelises differently.

---

## Commands

### Shell

```bash
clawd-local doctor
```

```bash
clawd-local fetch all
```

```bash
clawd-local bench workhorse
```

```bash
clawd-local tune deep
```

`tune` walks `--n-cpu-moe` downwards from full offload, benchmarking each
value, and writes the best result back into `clawd-local.yaml`.

**The tuning curve is not monotonic, and the failure mode is silent.** Measured
on this machine (40-layer model, 6.8 GB budget):

| `n_cpu_moe` | tok/s | VRAM free | |
|---|---|---|---|
| 40 (all experts on CPU) | 23.7 | 4.6 GB | wastes headroom |
| **32** | **32.0** | 981 MB | **optimum** |
| 24 | 12.1 | 43 MB | cliff |
| 16 | 8.6 | 83 MB | |
| 8 | 6.5 | 83 MB | |

Below the optimum llama.cpp does **not** refuse to load — it silently degrades
by ~2.6x as the driver spills GPU allocations into host memory. A naive "use
the smallest N that loads" rule therefore picks a configuration nearly three
times slower than the best one, with no error to warn you.

The correct rule is **the smallest N that still leaves VRAM headroom**. Since
context length, quantisation and profile all move the cliff, re-run `tune`
after changing any of them.

Other subcommands: `status`, `profile [name]`, `start <tier>`, `stop <tier|all>`,
`args <tier>` (prints the exact llama-server command line, useful for debugging).

### REPL

| Command | Effect |
|---|---|
| `/local` | tiers, running servers, VRAM, routing state, role map |
| `/tier [name]` | pin routing to a tier; bare `/tier` clears the pin |
| `/profile [name]` | show or switch resource profile |
| `/cloud [off\|manual\|auto]` | show or set cloud policy |

---

## Routing

### Roles

Most agent tokens are not hard reasoning. Compaction, file summaries and commit
messages go to the 4B; only the main loop uses the 9B. This is the single
highest-leverage optimisation in the stack.

```yaml
roles:
  main: workhorse
  compaction: reflex
  summarize: reflex
  classify: reflex
  plan: deep
  debug: deep
  title: reflex
```

### Escalation

The router watches for the characteristic small-model failure mode and promotes
to a stronger tier when it appears:

- 2 consecutive failed tool calls
- the same tool call repeated twice (the degenerate loop)
- 2 malformed tool-call payloads

It demotes again after a clean turn.

### Cloud policy

| Policy | Behaviour |
|---|---|
| `off` | Fully local. No network calls, no API key needed. |
| `manual` | Local by default. Bare `/cloud` sends the **next** request off-box. |
| `auto` | Escalates automatically once the deep tier also fails, capped at 5 calls/session, with a first-time confirmation prompt. |

`auto` sends your code and context to a third party when it fires. It is off by
default for that reason; `manual` is the shipped default.

---

## Honest expectations

This does not match Claude or GPT for agentic coding. For calibration, Devstral
24B scores 46.8% on SWE-bench Verified; Qwen3.6-27B reaches 77.2 but needs 24 GB
of VRAM. Your realistic ceiling on 8 GB is the 9B/35B-A3B tier, meaningfully
below both.

What you get instead: privacy, zero marginal cost, and offline operation. The
`manual` cloud policy exists so you can reach for a frontier model on the hard
20% without giving up the other 80%.

---

## Layout

```
local-stack/
  clawd-local.yaml     the config (this is the knob)
  bin/                 llama.cpp b10405, CUDA 13.3
  models/              GGUF weights
  logs/                per-tier llama-server logs

Clawd-Code/src/local/
  config.py            profile resolution and clamping
  backends.py          llama-server / Ollama command construction
  supervisor.py        VRAM budgeting, eviction, health checks
  router.py            role routing, escalation, cloud gating
  commands.py          /local /tier /profile /cloud
  cli.py               clawd-local entry point

Clawd-Code/src/providers/
  local_provider.py    OpenAI-compatible provider over the ladder
```

## Backends

`llamacpp` is primary and is the only backend exposing `--n-cpu-moe` and
`--spec-type`, which the deep and workhorse tiers depend on. Ollama can serve
individual tiers where those flags do not matter:

```yaml
backends:
  ollama:
    tier_overrides:
      reflex: qwen3.5:4b
```
