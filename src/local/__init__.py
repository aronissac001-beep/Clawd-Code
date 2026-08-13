"""Local model stack: tiered llama.cpp / Ollama inference for Clawd-Code.

Public surface:

    load_config()      -> StackConfig resolved against the active profile
    ModelSupervisor    -> starts/stops/evicts local servers within a VRAM budget
    Router             -> role -> tier routing, failure escalation, cloud policy
"""

from __future__ import annotations

from .config import (
    ConfigError,
    Profile,
    StackConfig,
    Tier,
    load_config,
    set_active_profile,
    set_tier_value,
)
from .router import CloudBlocked, Decision, Router
from .supervisor import ModelSupervisor, SupervisorError, query_free_vram_mb

__all__ = [
    "ConfigError",
    "Profile",
    "StackConfig",
    "Tier",
    "load_config",
    "set_active_profile",
    "set_tier_value",
    "CloudBlocked",
    "Decision",
    "Router",
    "ModelSupervisor",
    "SupervisorError",
    "query_free_vram_mb",
]
