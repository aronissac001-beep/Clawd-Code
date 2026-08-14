"""Run a plan's steps across local and remote workers, in parallel where possible.

Two constraints shape this:

**The GPU is one resource.** Local tiers share a single 8 GB card and the
supervisor evicts to make room, so running two local steps at once would
thrash models in and out. Local therefore gets exactly one slot.

**OpenRouter is rate limited, not resource limited.** Free models allow roughly
20 requests/minute, and there are ~16 of them. Several can run concurrently, so
remote workers are where the parallelism actually comes from.

Each step runs with a FRESH conversation carrying only a short summary of what
previous steps produced. That is the entire point: the failure this addresses
was a model losing its own plan to context truncation after a dozen file
writes.
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

from .planner import Plan, Step


@dataclass
class Worker:
    """One execution lane."""

    name: str            # shown in the UI, e.g. "local:workhorse"
    kind: str            # "local" | "openrouter"
    model: Optional[str] = None
    busy: bool = False

    @property
    def label(self) -> str:
        return self.name


@dataclass
class RunState:
    plan: Plan
    workers: list[Worker]
    started_at: float = field(default_factory=time.time)
    cancelled: bool = False
    log: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "plan": self.plan.to_dict(),
            "workers": [{"name": w.name, "kind": w.kind, "model": w.model,
                         "busy": w.busy} for w in self.workers],
            "elapsed": round(time.time() - self.started_at, 1),
            "cancelled": self.cancelled,
        }


def build_workers(cfg, openrouter_key: Optional[str], max_remote: int = 3) -> list[Worker]:
    """Assemble the worker pool.

    Local first -- it is free, private and already warm. Remote workers are
    added only when a key exists and the cost mode cannot spend money, because
    silently fanning a big task across paid models would be an expensive
    surprise.
    """
    workers = [Worker(name="local:workhorse", kind="local")]

    if not openrouter_key:
        return workers
    if cfg is not None and not cfg.cloud.is_free_only:
        # Paid models are allowed but we will not spread a whole plan across
        # them without being asked; one lane is enough to be useful.
        max_remote = 1

    try:
        from .openrouter import ModelCatalog

        catalog = ModelCatalog(cache_dir=cfg.stack_dir if cfg else ".")
        free = [m for m in catalog.free_models() if m.context_length >= 32000]
        # Prefer coding-tuned models, then the largest contexts.
        free.sort(key=lambda m: (0 if "code" in m.id.lower() else 1, -m.context_length))
        for m in free[:max_remote]:
            workers.append(Worker(name=f"or:{m.id.split('/')[-1]}", kind="openrouter",
                                  model=m.id))
    except Exception:
        pass  # remote workers are a bonus; local alone still works

    return workers


class Orchestrator:
    """Executes a Plan, running independent steps concurrently."""

    def __init__(
        self,
        plan: Plan,
        workers: list[Worker],
        run_step: Callable[[Step, Worker, str], str],
        on_event: Optional[Callable[[dict], None]] = None,
    ):
        """
        run_step(step, worker, context_summary) -> result text, or raises.
        Supplied by the caller so this module stays free of provider details.
        """
        self.state = RunState(plan=plan, workers=workers)
        self._run_step = run_step
        self._on_event = on_event
        self._lock = threading.Lock()
        self._done_summaries: list[str] = []

    # -- helpers -----------------------------------------------------------

    def _emit(self, **payload) -> None:
        if self._on_event:
            try:
                self._on_event(payload)
            except Exception:
                pass

    def _claim_worker(self, prefer_local: bool) -> Optional[Worker]:
        """Take a free lane. Foundational steps prefer local: it is the model
        that will keep working on this project afterwards."""
        with self._lock:
            pool = self.state.workers
            order = pool if prefer_local else sorted(
                pool, key=lambda w: 0 if w.kind == "openrouter" else 1)
            for w in order:
                if not w.busy:
                    w.busy = True
                    return w
        return None

    def _release(self, w: Worker) -> None:
        with self._lock:
            w.busy = False

    def _summary(self) -> str:
        """Compact carry-forward context.

        Deliberately short. Passing the full transcript is exactly what caused
        the original failure; a worker needs to know what exists, not every
        token that produced it.
        """
        if not self._done_summaries:
            return "Nothing has been built yet. This is the first step."
        lines = ["Previous steps completed:"]
        lines += [f"  - {s}" for s in self._done_summaries[-8:]]
        return "\n".join(lines)

    def cancel(self) -> None:
        self.state.cancelled = True

    def _local_worker(self) -> Optional[Worker]:
        return next((w for w in self.state.workers if w.kind == "local"), None)

    def _run_with_retry(self, step: Step, worker: Worker, summary: str) -> str:
        """Run a step, retrying once on the local model if a remote one fails.

        Remote workers have no tools and must answer in a strict JSON file map;
        a model that replies in prose produces nothing. Falling back to local --
        which has real tools and cannot misformat its way out of writing a file
        -- turns that from a dead step into a slower one.
        """
        try:
            return self._run_step(step, worker, summary)
        except Exception as exc:
            if worker.kind != "openrouter" or self.state.cancelled:
                raise
            local = self._local_worker()
            if local is None:
                raise
            self._emit(type="retry", step_id=step.id, from_worker=worker.name,
                       to_worker=local.name, reason=str(exc)[:200])
            # Wait for the single local lane rather than running two local
            # steps at once, which would thrash models through the 8 GB GPU.
            for _ in range(2400):
                if self.state.cancelled:
                    raise
                with self._lock:
                    if not local.busy:
                        local.busy = True
                        break
                time.sleep(0.25)
            else:
                raise
            try:
                step.worker = local.name
                return self._run_step(step, local, summary)
            finally:
                self._release(local)

    # -- execution ---------------------------------------------------------

    def run(self, max_workers: int = 4) -> RunState:
        plan = self.state.plan
        pool = ThreadPoolExecutor(max_workers=max(1, min(max_workers, len(self.state.workers))))
        running: dict[Future, tuple[Step, Worker]] = {}

        try:
            while plan.unfinished() and not self.state.cancelled:
                # Retire anything that finished.
                for fut in [f for f in running if f.done()]:
                    step, worker = running.pop(fut)
                    self._release(worker)
                    try:
                        text = fut.result()
                        step.status = "done"
                        step.result = text or ""
                        with self._lock:
                            self._done_summaries.append(f"{step.title} (by {worker.name})")
                        self._emit(type="step", step=step.to_dict())
                    except Exception as exc:
                        step.status = "failed"
                        step.error = str(exc)[:400]
                        self._emit(type="step", step=step.to_dict())

                # Steps whose dependencies died can never run.
                for s in plan.blocked():
                    s.status = "skipped"
                    s.error = "a step it depends on did not finish"
                    self._emit(type="step", step=s.to_dict())

                # Dispatch whatever is ready into whatever lanes are free.
                dispatched = False
                for step in plan.ready():
                    if self.state.cancelled:
                        break
                    # Step 1 builds the foundation everything else needs; keep
                    # it on the local model that will continue the project.
                    worker = self._claim_worker(prefer_local=(step.id == 1 or not step.depends_on))
                    if worker is None:
                        break
                    step.status = "running"
                    step.worker = worker.name
                    self._emit(type="step", step=step.to_dict())
                    summary = self._summary()
                    fut = pool.submit(self._run_with_retry, step, worker, summary)
                    running[fut] = (step, worker)
                    dispatched = True

                if not dispatched and not running:
                    break        # nothing ready and nothing in flight: deadlock guard
                time.sleep(0.25)

            # Drain.
            for fut, (step, worker) in list(running.items()):
                try:
                    text = fut.result(timeout=1800)
                    step.status = "done"
                    step.result = text or ""
                except Exception as exc:
                    step.status = "failed"
                    step.error = str(exc)[:400]
                self._release(worker)
                self._emit(type="step", step=step.to_dict())

            if self.state.cancelled:
                for s in plan.steps:
                    if s.status in ("pending", "running"):
                        s.status = "skipped"
                        s.error = "cancelled"
        finally:
            pool.shutdown(wait=False)

        return self.state
