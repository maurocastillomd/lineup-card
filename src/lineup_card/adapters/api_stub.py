"""Where a live VALD or Catapult connection would plug in.

A real client needs a club account, API credentials and a data agreement.
It would return the same rows the CSV readers return, so nothing after
this point changes. Without credentials it stops with a clear message.
"""

from __future__ import annotations

from datetime import date


class VendorAPI:
    def __init__(self, vendor: str, token: str | None = None):
        self.vendor, self.token = vendor, token

    def fetch(self, start: date, end: date) -> list:
        raise RuntimeError(
            f"{self.vendor} live connection needs a club account, API credentials "
            "and a data agreement. Use the CSV exports in the inbox instead.")
