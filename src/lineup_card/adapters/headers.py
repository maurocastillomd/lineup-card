"""Vendor exports put the unit in the header: "Jump Height (Imp-Mom) [cm]".

Read the unit from the header and refuse anything unexpected, so a file
exported in inches never slips in as centimetres.
"""

from __future__ import annotations

import re

KNOWN_UNITS = {"cm", "in", "m/s", "s", "N", "Ns", "W", "kg", "AU"}
_HEADER = re.compile(r"^(?P<name>.*?)\s*\[(?P<unit>[^\]]+)\]\s*$")


def parse_header(header: str) -> tuple[str, str | None]:
    match = _HEADER.match(header.strip())
    if not match:
        return header.strip(), None
    return match["name"], match["unit"]


def find_column(headers: list[str], name: str, unit: str) -> str:
    """Return the header for `name`, checking its unit is `unit`."""
    for header in headers:
        found_name, found_unit = parse_header(header)
        if found_name != name:
            continue
        if found_unit not in KNOWN_UNITS:
            raise ValueError(f"Unknown unit [{found_unit}] in column '{header}'")
        if found_unit != unit:
            raise ValueError(f"Column '{header}' has unit [{found_unit}], expected [{unit}]")
        return header
    raise ValueError(f"Export is missing the column '{name} [{unit}]'")
