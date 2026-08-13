"""REPL slash commands for the local model ladder.

    /local              show tiers, running servers, VRAM and routing state
    /tier [name]        pin routing to a tier, or clear the pin with no argument
    /profile [name]     show or switch the resource profile
    /cloud [off|manual|auto]
                        show or set cloud policy; bare `/cloud` with policy
                        'manual' arms the NEXT request to go off-box

Register alongside the built-ins:

    from src.local.commands import register_local_commands
    register_local_commands()
"""

from __future__ import annotations

from typing import Any, Optional

from ..command_system.registry import get_command_registry
from ..command_system.types import CommandContext, LocalCommand, LocalCommandResult
from .config import ConfigError, load_config, set_active_profile


def _text(msg: str) -> LocalCommandResult:
    return LocalCommandResult(type="text", value=msg)


def _find_provider(context: CommandContext) -> Optional[Any]:
    """Locate the active provider, which is a LocalProvider when local is in use."""
    # CommandContext.provider is the supported route; the rest are fallbacks
    # for contexts built by older callers that predate that field.
    if getattr(context, "provider", None) is not None:
        return context.provider
    for holder in (context.conversation, context):
        for attr in ("provider", "_provider", "llm_provider"):
            candidate = getattr(holder, attr, None)
            if candidate is not None:
                return candidate
    return None


def _require_local(context: CommandContext) -> tuple[Optional[Any], Optional[LocalCommandResult]]:
    provider = _find_provider(context)
    if provider is None or not hasattr(provider, "router"):
        return None, _text(
            "The local model ladder is not active.\n"
            "Switch to it with:  clawd login  ->  provider 'local'\n"
            "or set default_provider to 'local' in ~/.clawd/config.json"
        )
    return provider, None


# ---------------------------------------------------------------------------
# /local
# ---------------------------------------------------------------------------


def local_command_call(args: str, context: CommandContext) -> LocalCommandResult:
    provider, err = _require_local(context)
    if err:
        return err

    from .supervisor import query_free_vram_mb

    cfg = provider.cfg
    lines = [
        f"profile   : {cfg.profile.name}  "
        f"(vram budget {cfg.profile.vram_mb} MB, {cfg.profile.threads} threads, "
        f"ctx<={cfg.profile.max_context})",
    ]
    free = query_free_vram_mb()
    if free is not None:
        lines.append(f"gpu       : {free} MB free")

    lines.append("")
    lines.append(f"{'tier':<11} {'device':<8} {'spec':<12} {'ctx':>7}  model")
    for name, tier in cfg.tiers.items():
        if not tier.serve:
            continue
        lines.append(
            f"{name:<11} {tier.device:<8} {tier.spec_type:<12} {tier.context:>7}  {tier.file}"
        )

    running = provider.supervisor.status()
    lines.append("")
    if running:
        lines.append("running:")
        for r in running:
            state = "ok" if r["alive"] else "dead"
            lines.append(
                f"  {r['tier']:<11} {state:<5} idle {r['idle_s']:>4}s  {r['url']}"
            )
    else:
        lines.append("running: nothing loaded yet (tiers start on first use)")

    rstate = provider.router.status()
    lines.append("")
    lines.append(f"routing   : cloud={rstate['cloud_policy']}"
                 + (f", pinned={rstate['pinned_tier']}" if rstate["pinned_tier"] else ""))
    if rstate["consecutive_tool_failures"]:
        lines.append(f"            {rstate['consecutive_tool_failures']} consecutive tool failures")
    if rstate["escalated_from"]:
        lines.append(f"            escalated from {rstate['escalated_from']}")

    lines.append("")
    lines.append("roles:")
    for role, tier in cfg.roles.items():
        lines.append(f"  {role:<12} -> {tier}")

    return _text("\n".join(lines))


# ---------------------------------------------------------------------------
# /tier
# ---------------------------------------------------------------------------


def tier_command_call(args: str, context: CommandContext) -> LocalCommandResult:
    provider, err = _require_local(context)
    if err:
        return err

    name = args.strip()
    if not name:
        provider.router.force_tier(None)
        return _text("Tier pin cleared; routing follows role assignment again.")

    try:
        provider.router.force_tier(name)
    except ValueError:
        known = ", ".join(t for t, v in provider.cfg.tiers.items() if v.serve)
        return _text(f"Unknown tier {name!r}. Available: {known}")

    tier = provider.cfg.tiers[name]
    note = ""
    if tier.device in ("gpu", "hybrid"):
        note = ("\nNote: only one GPU-resident tier fits in 8 GB, so this may "
                "evict the current one on next use.")
    return _text(f"Pinned to tier '{name}' ({tier.file}).{note}")


# ---------------------------------------------------------------------------
# /profile
# ---------------------------------------------------------------------------


def profile_command_call(args: str, context: CommandContext) -> LocalCommandResult:
    name = args.strip()
    try:
        cfg = load_config()
    except ConfigError as exc:
        return _text(f"config error: {exc}")

    if not name:
        rows = [f"active: {cfg.profile.name}", ""]
        rows.append(f"{'profile':<12} {'vram':>7} {'ram':>7} {'thr':>4} {'ctx':>7}  deep")
        for pname, p in cfg.profiles.items():
            mark = "*" if pname == cfg.profile.name else " "
            rows.append(
                f"{mark}{pname:<11} {p.vram_mb:>7} {p.ram_mb:>7} {p.threads:>4} "
                f"{p.max_context:>7}  {'yes' if p.allow_deep_tier else 'no'}"
            )
        return _text("\n".join(rows))

    if name not in cfg.profiles:
        return _text(f"Unknown profile {name!r}. Known: {', '.join(cfg.profiles)}")

    set_active_profile(cfg.stack_dir, name)
    provider = _find_provider(context)
    msg = [f"Resource profile -> {name}."]
    if provider is not None and hasattr(provider, "supervisor"):
        provider.supervisor.shutdown()
        msg.append("Running servers stopped; they restart with the new budget on next use.")
    else:
        msg.append("Restart the REPL for this to take effect.")
    return _text("\n".join(msg))


# ---------------------------------------------------------------------------
# /cloud
# ---------------------------------------------------------------------------


def cloud_command_call(args: str, context: CommandContext) -> LocalCommandResult:
    provider, err = _require_local(context)
    if err:
        return err

    arg = args.strip().lower()
    router = provider.router
    cloud = provider.cfg.cloud

    if not arg:
        if router.cloud_policy == "manual":
            try:
                router.arm_cloud()
            except Exception as exc:  # CloudBlocked
                return _text(str(exc))
            return _text(
                f"Next request will go to {cloud.provider}/{cloud.model}.\n"
                "Your prompt, code and context will leave this machine."
            )
        return _text(
            f"cloud policy : {router.cloud_policy}\n"
            f"provider     : {cloud.provider}/{cloud.model}\n"
            f"auto calls   : {router.status()['cloud_calls_used']}"
            f"/{cloud.auto_max_calls_per_session}\n\n"
            "Set with: /cloud off | /cloud manual | /cloud auto"
        )

    if arg not in ("off", "manual", "auto"):
        return _text("Usage: /cloud [off|manual|auto]")

    router.set_cloud_policy(arg)
    blurb = {
        "off": "Fully local. Nothing leaves this machine.",
        "manual": "Local by default. Bare `/cloud` sends the next request off-box.",
        "auto": (f"Escalates to {cloud.provider}/{cloud.model} automatically once the "
                 f"deep tier also fails, up to {cloud.auto_max_calls_per_session} times "
                 "per session. Code leaves the machine when it fires."),
    }[arg]
    return _text(f"cloud policy -> {arg}\n{blurb}")


# ---------------------------------------------------------------------------
# registration
# ---------------------------------------------------------------------------

def openrouter_command_call(args: str, context: CommandContext) -> LocalCommandResult:
    """/openrouter [free|mixed|models|status]"""
    provider, err = _require_local(context)
    if err:
        return err

    from .openrouter import CatalogError, ModelCatalog

    cfg = provider.cfg
    cloud = cfg.cloud
    arg = args.strip().lower()
    catalog = ModelCatalog(cache_dir=cfg.stack_dir)

    if arg in ("free", "free_only"):
        cloud.cost_mode = "free_only"
        cloud.provider = "openrouter"
        return _text(
            "OpenRouter cost mode -> free_only\n"
            "Every request is verified against the live catalogue and refused "
            "unless the model bills zero on ALL pricing fields.\n"
            "This cannot spend money."
        )

    if arg == "mixed":
        cloud.cost_mode = "mixed"
        cloud.provider = "openrouter"
        return _text(
            "OpenRouter cost mode -> mixed\n"
            f"Paid models are now permitted, capped at "
            f"{cloud.max_paid_calls_per_session} paid calls this session, with a "
            "confirmation before the first one.\n"
            "THIS SPENDS REAL MONEY. Use `/openrouter free` to go back."
        )

    if arg in ("models", "list"):
        try:
            free = catalog.free_models()
        except CatalogError as exc:
            return _text(str(exc))
        lines = [f"{len(free)} free models right now "
                 f"(the roster rotates; refreshed hourly):", ""]
        for m in free[:25]:
            ctx = f"{m.context_length // 1000}k" if m.context_length else "?"
            lines.append(f"  {m.id:<52} ctx={ctx}")
        if len(free) > 25:
            lines.append(f"  ... and {len(free) - 25} more")
        lines.append("")
        lines.append("Pin one with:  /openrouter use <model-id>")
        lines.append("Or leave the default `openrouter/free` auto-router, which")
        lines.append("picks a zero-cost model that fits each request.")
        return _text("\n".join(lines))

    if arg.startswith("use "):
        model_id = args.strip()[4:].strip()
        if cloud.cost_mode == "free_only":
            try:
                info = catalog.assert_free(model_id)
            except CatalogError as exc:
                return _text(str(exc))
            cloud.model = model_id
            return _text(f"OpenRouter model -> {model_id} ({info.price_summary})")
        info = catalog.get(model_id)
        cloud.model = model_id
        price = info.price_summary if info else "unknown pricing"
        return _text(f"OpenRouter model -> {model_id} ({price})")

    # Bare /openrouter, or 'status'
    try:
        free_count = len(catalog.free_models())
    except CatalogError as exc:
        free_count = -1
        lines = [f"catalogue unavailable: {exc}", ""]
    else:
        lines = []

    spends = cloud.cost_mode == "mixed"
    lines += [
        f"provider   : {cloud.provider}",
        f"cost mode  : {cloud.cost_mode}"
        + ("   (CAN SPEND MONEY)" if spends else "   (cannot spend money)"),
        f"model      : {cloud.model}",
        f"free models: {free_count if free_count >= 0 else 'unknown'}",
        f"policy     : {cloud.policy}  "
        f"(off = never leave the machine, manual = /cloud arms one request, "
        f"auto = escalate on repeated failure)",
        "",
        "  /openrouter free           zero-cost models only, enforced",
        "  /openrouter mixed          allow paid models (spends money)",
        "  /openrouter models         list what is free right now",
        "  /openrouter use <id>       pin a specific model",
    ]
    return _text("\n".join(lines))


LOCAL_COMMAND = LocalCommand(
    name="local",
    description="Show local model ladder status",
    aliases=["ladder"],
    supports_non_interactive=True,
)

TIER_COMMAND = LocalCommand(
    name="tier",
    description="Pin routing to a tier (no argument clears the pin)",
    argument_hint="[reflex|workhorse|deep]",
    supports_non_interactive=True,
)

PROFILE_COMMAND = LocalCommand(
    name="profile",
    description="Show or switch the resource profile",
    argument_hint="[battery|balanced|max|cpu_only]",
    supports_non_interactive=True,
)

CLOUD_COMMAND = LocalCommand(
    name="cloud",
    description="Show or set cloud escalation policy",
    argument_hint="[off|manual|auto]",
    supports_non_interactive=True,
)

OPENROUTER_COMMAND = LocalCommand(
    name="openrouter",
    description="Show or switch OpenRouter cost mode (free-only vs mixed)",
    aliases=["or"],
    argument_hint="[free|mixed|models|use <id>]",
    supports_non_interactive=True,
)

LOCAL_COMMAND.set_call(local_command_call)
TIER_COMMAND.set_call(tier_command_call)
PROFILE_COMMAND.set_call(profile_command_call)
CLOUD_COMMAND.set_call(cloud_command_call)
OPENROUTER_COMMAND.set_call(openrouter_command_call)


def get_local_commands() -> list[LocalCommand]:
    return [LOCAL_COMMAND, TIER_COMMAND, PROFILE_COMMAND, CLOUD_COMMAND,
            OPENROUTER_COMMAND]


def register_local_commands(registry=None) -> None:
    """Register the local-stack slash commands."""
    reg = registry or get_command_registry()
    for cmd in get_local_commands():
        reg.register(cmd)
