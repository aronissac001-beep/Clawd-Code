"""Break a large request into steps that each fit in a context window.

This exists because of a specific, observed failure. Asked to "make Tetris",
a 9B with a 32k window wrote twelve files of scaffolding, hit the context
ceiling three times, and produced no game -- it also wrote AudioManager.gd and
then AudioManager2.gd, having forgotten the first, and never wrote the
project.godot the whole thing depends on.

The mechanism is simple: every tool result echoes a whole file back into the
history, so a dozen writes exhaust the window. Once truncation starts the model
loses the original instruction and its own plan, and keeps generating plausible
next files forever.

Decomposition fixes that by giving each step a FRESH context carrying only a
compact summary of what exists so far, rather than the full transcript.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Optional

# Rough token estimate. Deliberately crude -- it decides whether to plan, not
# how to pack a window, so being within 25% is plenty.
CHARS_PER_TOKEN = 3.6

# Signals that a request will not fit one pass. Any one of these is weak on its
# own; the score threshold is what matters.
_BUILD_VERBS = re.compile(
    r"\b(build|create|make|implement|write|develop|generate|scaffold|port|migrate|"
    r"refactor|rewrite|convert|add)\b", re.I)
_PROJECT_NOUNS = re.compile(
    r"\b(game|app|application|website|site|server|api|engine|clone|dashboard|"
    r"editor|framework|library|system|platform|tool|suite|project)\b", re.I)
_MULTI = re.compile(
    r"\b(and then|after that|then|also|plus|as well as|followed by|"
    r"multiple|several|each|every|all of the)\b", re.I)
_NAMED_GAMES = re.compile(
    r"\b(tetris|snake|pong|breakout|chess|sudoku|minesweeper|platformer|"
    r"roguelike|rpg|shooter|solitaire|2048)\b", re.I)


@dataclass
class Step:
    id: int
    title: str
    prompt: str
    depends_on: list[int] = field(default_factory=list)
    status: str = "pending"       # pending | running | done | failed | skipped
    worker: Optional[str] = None
    result: str = ""
    error: str = ""

    def to_dict(self) -> dict:
        return {
            "id": self.id, "title": self.title, "prompt": self.prompt,
            "depends_on": list(self.depends_on), "status": self.status,
            "worker": self.worker, "result": self.result[:2000], "error": self.error,
        }


@dataclass
class Plan:
    goal: str
    steps: list[Step]

    def to_dict(self) -> dict:
        return {"goal": self.goal, "steps": [s.to_dict() for s in self.steps]}

    def ready(self) -> list[Step]:
        """Steps whose dependencies have all completed."""
        done = {s.id for s in self.steps if s.status == "done"}
        return [
            s for s in self.steps
            if s.status == "pending" and all(d in done for d in s.depends_on)
        ]

    def unfinished(self) -> bool:
        return any(s.status in ("pending", "running") for s in self.steps)

    def blocked(self) -> list[Step]:
        """Pending steps that can never run because a dependency failed."""
        dead = {s.id for s in self.steps if s.status in ("failed", "skipped")}
        return [
            s for s in self.steps
            if s.status == "pending" and any(d in dead for d in s.depends_on)
        ]


def estimate_tokens(text: str) -> int:
    return int(len(text) / CHARS_PER_TOKEN)


def complexity_score(prompt: str) -> tuple[int, list[str]]:
    """How likely this request is to overflow a single context, and why.

    Returns (score, reasons). Explaining the score matters: an automatic
    decision to restructure someone's request should be inspectable, not
    magic.
    """
    score = 0
    why: list[str] = []

    if _NAMED_GAMES.search(prompt):
        score += 3
        why.append("names a complete game")
    if _BUILD_VERBS.search(prompt) and _PROJECT_NOUNS.search(prompt):
        score += 3
        why.append("asks to build a whole project")
    if _MULTI.search(prompt):
        score += 1
        why.append("describes several stages")

    words = len(prompt.split())
    if words > 120:
        score += 2
        why.append(f"long request ({words} words)")
    elif words > 60:
        score += 1

    # An explicit file count is a strong signal.
    m = re.search(r"\b(\d+)\s+(files?|modules?|scenes?|screens?|endpoints?)\b", prompt, re.I)
    if m and int(m.group(1)) >= 3:
        score += 2
        why.append(f"mentions {m.group(1)} {m.group(2)}")

    return score, why


def should_plan(prompt: str, threshold: int = 3) -> tuple[bool, int, list[str]]:
    score, why = complexity_score(prompt)
    return score >= threshold, score, why


PLANNER_SYSTEM = """You break a software task into small independent steps.

Rules:
- Each step must be completable by itself, writing at most 1-3 files.
- The FIRST step must create whatever the project needs to run at all
  (project manifest, entry point, config). Nothing works without it.
- Order matters: put foundations before features, features before polish.
- Mark a step as depending on another ONLY when it genuinely needs its output.
  Steps that do not depend on each other will be run at the same time.
- Aim for 4 to 8 steps. Fewer is better than more.
- Each prompt must be self-contained: the worker doing it will NOT see this
  conversation, only your prompt text and a short list of existing files.

Reply with ONLY a JSON object, no prose, no code fence:
{"steps":[{"id":1,"title":"short label","prompt":"full instruction","depends_on":[]}]}"""


def build_planner_messages(goal: str, workspace_files: list[str]) -> list[dict]:
    files = "\n".join(f"  {f}" for f in workspace_files[:40]) or "  (empty folder)"
    return [
        {"role": "system", "content": PLANNER_SYSTEM},
        {"role": "user", "content":
            f"Task:\n{goal}\n\nFiles that already exist:\n{files}\n\n"
            f"Produce the JSON plan."},
    ]


def parse_plan(goal: str, raw: str) -> Plan:
    """Pull a plan out of a model response.

    Models wrap JSON in prose or fences no matter how firmly they are told not
    to, so this extracts the outermost object rather than trusting the shape.
    """
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()

    start, depth, chunk = text.find("{"), 0, None
    if start >= 0:
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    chunk = text[start:i + 1]
                    break
    if chunk is None:
        raise ValueError("planner returned no JSON object")

    data = json.loads(chunk)
    raw_steps = data.get("steps")
    if not isinstance(raw_steps, list) or not raw_steps:
        raise ValueError("plan contains no steps")

    steps: list[Step] = []
    seen: set[int] = set()
    for i, s in enumerate(raw_steps, start=1):
        if not isinstance(s, dict):
            continue
        sid = int(s.get("id") or i)
        while sid in seen:            # models do repeat ids
            sid += 1
        seen.add(sid)
        prompt = str(s.get("prompt") or s.get("description") or "").strip()
        if not prompt:
            continue
        deps = [int(d) for d in (s.get("depends_on") or []) if str(d).isdigit()]
        steps.append(Step(
            id=sid,
            title=str(s.get("title") or f"Step {sid}")[:80],
            prompt=prompt,
            depends_on=deps,
        ))

    if not steps:
        raise ValueError("plan had no usable steps")

    # Drop dependencies on ids that do not exist, and any that point forward or
    # at themselves -- either would deadlock the executor.
    ids = {s.id for s in steps}
    order = {s.id: i for i, s in enumerate(steps)}
    for s in steps:
        s.depends_on = [
            d for d in s.depends_on
            if d in ids and d != s.id and order[d] < order[s.id]
        ]
    return Plan(goal=goal, steps=steps)


def fallback_plan(goal: str) -> Plan:
    """Used when the planner model returns something unusable.

    A generic scaffold-then-build shape is still far better than one giant
    request, because each step gets its own fresh context.
    """
    return Plan(goal=goal, steps=[
        Step(1, "Set up the project",
             f"{goal}\n\nDo ONLY this step: create the minimum needed for the "
             f"project to run at all -- manifest/config, entry point, and a "
             f"folder layout. No features yet.", []),
        Step(2, "Core data and logic",
             f"{goal}\n\nDo ONLY this step: implement the core data structures "
             f"and logic. No UI, no polish.", [1]),
        Step(3, "Main behaviour",
             f"{goal}\n\nDo ONLY this step: wire the core logic into something "
             f"that actually runs and responds to input.", [2]),
        Step(4, "Finish and verify",
             f"{goal}\n\nDo ONLY this step: check the pieces fit together, fix "
             f"anything obviously missing, and state how to run it.", [3]),
    ])
