"""Catch the three ways models corrupt files on the way to disk.

All three were observed in one Godot project built by the local 9B -- 5 of 19
files were unusable:

1. LINE NUMBERS ECHOED BACK. The Read tool returns cat -n style numbered lines
   so the model can reference positions. Smaller models then write that content
   straight back, numbers included, producing files like
   "1\\t[gd_scene]\\n2\\t\\n3\\t[node ...]". This is a known failure mode:
   models handle line numbers poorly even when they are explicitly provided.

2. ESCAPED NEWLINES. The model emits "\\n" as two literal characters rather
   than a newline, so the whole file lands on one line. Valid JSON, unrunnable
   code.

3. PLACEHOLDER CONTENT. The model writes "..." or an empty string as a stand-in
   it intends to fill later, and never does. Three files in that project were
   exactly three bytes.

Sanitising is preferable to rejecting for 1 and 2 -- the content is recoverable
and the model rarely does better on a retry. Placeholders are rejected, because
silently accepting them is what let a project reach "finished" with empty files
in it.
"""

from __future__ import annotations

import re

# "  12\tcode" or "12|code" or "12: code" -- the shapes Read tools emit.
_NUMBERED = re.compile(r"^\s{0,6}\d{1,6}(?:\t|\s*[|:]\s?)")

# Content that is a stand-in rather than an implementation.
_PLACEHOLDERS = {"", "...", "…", "# ...", "// ...", "pass", "TODO", "# TODO"}

# Extensions where near-empty content is almost certainly a placeholder rather
# than a legitimately tiny file.
_CODE_SUFFIXES = {".py", ".gd", ".js", ".ts", ".tsx", ".jsx", ".java", ".c",
                  ".cpp", ".h", ".cs", ".go", ".rs", ".rb", ".php", ".swift",
                  ".kt", ".tscn", ".godot", ".html", ".css", ".sh", ".ps1"}


class WriteRejected(ValueError):
    """Raised when content should not be written at all."""


def strip_line_numbers(text: str) -> tuple[str, bool]:
    """Remove Read-style line-number prefixes, if the file clearly has them.

    Requires most non-blank lines to be numbered AND the numbers to run in
    sequence, so a genuine file that merely starts lines with digits -- a CSV,
    a changelog, a data table -- is left untouched.
    """
    lines = text.split("\n")
    candidates = [l for l in lines if l.strip()]
    if len(candidates) < 3:
        return text, False

    numbered = [l for l in candidates if _NUMBERED.match(l)]
    if len(numbered) < len(candidates) * 0.8:
        return text, False

    seq = []
    for l in numbered[:12]:
        m = re.match(r"^\s*(\d+)", l)
        if m:
            seq.append(int(m.group(1)))
    if len(seq) < 3 or not all(b - a == 1 for a, b in zip(seq, seq[1:])):
        return text, False

    return "\n".join(_NUMBERED.sub("", l, count=1) if l.strip() else l
                     for l in lines), True


def unescape_newlines(text: str) -> tuple[str, bool]:
    """Turn literal backslash-n into real newlines when escapes dominate.

    Requiring ZERO real newlines was too strict: a real corrupted scene file
    had 113 literal "\\n" against 2 genuine ones and slipped through. The test
    is now dominance, which still leaves normal code alone -- a 50-line file
    containing one print("a\\nb") has escapes vastly outnumbered by real lines.
    """
    escaped = text.count("\\n")
    real = text.count("\n")
    if escaped < 3 or escaped < max(real * 5, 1):
        return text, False
    return (text.replace("\\r\\n", "\n")
                .replace("\\n", "\n")
                .replace("\\t", "\t")
                .replace('\\"', '"')), True


def check_placeholder(path: str, text: str) -> None:
    """Refuse content that is a stand-in rather than an implementation."""
    stripped = text.strip()
    if stripped in _PLACEHOLDERS:
        raise WriteRejected(
            f"refusing to write placeholder content ({stripped!r}) to {path}. "
            f"Write the actual implementation, or leave the file out of this step."
        )
    suffix = "." + path.rsplit(".", 1)[-1].lower() if "." in path else ""
    if suffix in _CODE_SUFFIXES and len(stripped) < 12:
        raise WriteRejected(
            f"refusing to write {len(stripped)} bytes to {path} -- that is a "
            f"placeholder, not an implementation."
        )


def guard(path: str, text: str) -> tuple[str, list[str]]:
    """Sanitise recoverable corruption, reject placeholders.

    Returns (clean_text, notes). Notes are surfaced to the model so it learns
    the write was altered rather than silently succeeding.
    """
    notes: list[str] = []
    text, changed = unescape_newlines(text)
    if changed:
        notes.append("converted literal \\n escapes to real newlines")
    text, changed = strip_line_numbers(text)
    if changed:
        notes.append("stripped line-number prefixes (do not copy Read output verbatim)")
    check_placeholder(path, text)
    return text, notes
