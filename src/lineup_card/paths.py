"""Folder checks shared by the scripts that write real data."""

from __future__ import annotations

import os
from pathlib import Path


def is_inside(target: Path, root: Path) -> bool:
    """True when target is root or anything under it, however it is spelled:
    links and .. are resolved, the same folder is found by file identity
    (os.path.samefile) and, for a case-insensitive disk like macOS, by a
    case-insensitive path comparison too."""
    t, r = target.resolve(), root.resolve()
    if r.exists():
        for part in (t, *t.parents):
            if part.exists():
                try:
                    if os.path.samefile(part, r):
                        return True
                except OSError:
                    pass
    tl, rl = str(t).lower(), str(r).lower()
    try:
        return os.path.commonpath([tl, rl]) == rl
    except ValueError:
        return False
