"""One player, three IDs. The crosswalk maps VALD and Catapult identities
to a Lineup Card ID. Anything it cannot map is held out for review, never
guessed."""

from __future__ import annotations

import csv
from pathlib import Path

from pydantic import BaseModel

POSITIONS = ("SP", "RP", "C", "IF", "OF")


class Player(BaseModel):
    lc_id: str
    name: str
    pos: str


def _key(text: str) -> str:
    return " ".join(text.lower().split())


class Crosswalk:
    def __init__(self, players: dict[str, Player], vald: dict[str, str], catapult: dict[str, str]):
        self.players, self._vald, self._catapult = players, vald, catapult

    @classmethod
    def load(cls, path: Path) -> "Crosswalk":
        players: dict[str, Player] = {}
        vald: dict[str, str] = {}
        catapult: dict[str, str] = {}
        with path.open(newline="", encoding="utf-8-sig") as stream:
            for row in csv.DictReader(stream):
                lc_id = row["lc_id"].strip()
                if row["pos"].strip() not in POSITIONS:
                    raise ValueError(f"Unknown position '{row['pos']}' for {lc_id}")
                if lc_id in players:
                    raise ValueError(f"duplicate Lineup Card ID {lc_id}")
                players[lc_id] = Player(lc_id=lc_id, name=row["name"].strip(), pos=row["pos"].strip())
                for table, raw in ((vald, row["vald_external_id"].strip()),
                                   (catapult, _key(row["catapult_name"]))):
                    if raw in table:
                        raise ValueError(f"duplicate source identity '{raw}'")
                    table[raw] = lc_id
        return cls(players, vald, catapult)

    def from_vald(self, external_id: str) -> str | None:
        return self._vald.get(external_id.strip())

    def from_catapult(self, name: str) -> str | None:
        return self._catapult.get(_key(name))

    def player(self, lc_id: str) -> Player:
        return self.players[lc_id]
