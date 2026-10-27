"""Python results for the helpers the JS core must copy exactly
(tests/web/pymath.test.mjs). Run: .venv/bin/python scripts/write_pymath_vectors.py"""

from __future__ import annotations

import json
import math
import random
import statistics
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "pymath.json"


def main() -> None:
    rng = random.Random(20261027)
    floats = [0.125, 0.375, 2.5, -2.5, 0.045, 1.005, 0.0005, -0.35, 12.345, 0.0, 1e-5]
    floats += [round(rng.uniform(-3, 3), rng.randint(2, 6)) for _ in range(200)]
    floats += [rng.uniform(-3, 3) for _ in range(200)]
    rounds = [{"x": x, "n": n, "round": round(x, n), "fixed": f"{x:.{n}f}"}
              for x in floats for n in (0, 1, 2, 3, 4)]
    gs = [{"x": x, "g": f"{x:g}"} for x in [0.0312, 0.05, 1.0, 0.1234, 2.0, 0.0001, 12.5, 1e-5]]
    sets = [[0.448, 0.452, 0.439], [0.1, 0.2, 0.3], [1e16, 1.0, -1e16]]
    sets += [[round(rng.gauss(0.45, 0.04), 3) for _ in range(rng.randint(2, 30))] for _ in range(100)]
    sets += [[float(rng.randint(10, 25)) for _ in range(rng.randint(2, 30))] for _ in range(50)]
    stats = [{"xs": xs, "fsum": math.fsum(xs), "fmean": statistics.fmean(xs),
              "median": statistics.median(xs), "stdev": statistics.stdev(xs)} for xs in sets]
    OUT.write_text(json.dumps({"rounds": rounds, "g": gs, "stats": stats}))
    print(f"wrote {len(rounds)} rounds, {len(gs)} g, {len(stats)} stat sets")


if __name__ == "__main__":
    main()
