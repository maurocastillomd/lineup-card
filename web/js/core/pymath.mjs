// Python-compatible number helpers. The offline edition must give the same
// numbers as the Python reference (src/lineup_card), to the last digit, so
// rounding, sums and SD copy CPython's exact behaviour.

// Python tuple order: compare item by item with < (strings by code point,
// never localeCompare). Used for every sorted() on tuples.
export function cmpTuple(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

// round(x, n): round the exact binary value, ties to even (CPython).
export function pyRound(x, n = 0) {
  return Number(pyFixed(x, n));
}

// f"{x:.nf}" as text, same rounding as round().
export function pyFixed(x, n) {
  if (!Number.isFinite(x)) throw new Error("finite numbers only");
  const neg = x < 0 || Object.is(x, -0);
  const exact = Math.abs(x).toFixed(100);           // exact for every value we meet
  const [whole, frac] = exact.split(".");
  const tail = frac.slice(n);
  const tie = tail[0] === "5" && /^0*$/.test(tail.slice(1));
  let out;
  if (tie) {
    const kept = n ? `${whole}.${frac.slice(0, n)}` : whole;
    const last = Number(kept[kept.length - 1]);
    out = last % 2 === 0 ? kept : Math.abs(x).toFixed(n);     // even stays; odd rounds up
  } else {
    out = Math.abs(x).toFixed(n);
  }
  // Python keeps the sign of a negative that rounds to zero: "-0.0", round() -> -0.0.
  return neg ? `-${out}` : out;
}

// f"{x:g}": 6 significant digits, trailing zeros removed.
export function pyG(x) {
  if (x === 0) return "0";
  const exp = Number(Math.abs(x).toExponential(5).split("e")[1]);
  if (exp < -4 || exp >= 6) {
    let [m, e] = x.toExponential(5).split("e");
    m = m.includes(".") ? m.replace(/0+$/, "").replace(/\.$/, "") : m;
    const sign = e[0] === "-" ? "-" : "+";
    return `${m}e${sign}${e.replace(/^[+-]/, "").padStart(2, "0")}`;
  }
  const s = pyFixed(x, Math.max(0, 5 - exp));
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

// math.fsum: CPython's exactly rounded sum (Shewchuk partials).
export function fsum(xs) {
  const p = [];
  for (let x of xs) {
    let i = 0;
    for (let y of p) {
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo !== 0) p[i++] = lo;
      x = hi;
    }
    p.length = i;
    p.push(x);
  }
  let n = p.length;
  if (n === 0) return 0;
  let hi = p[--n];
  let lo = 0;
  while (n > 0) {
    const x = hi;
    const y = p[--n];
    hi = x + y;
    lo = y - (hi - x);
    if (lo !== 0) break;
  }
  if (n > 0 && ((lo < 0 && p[n - 1] < 0) || (lo > 0 && p[n - 1] > 0))) {
    const y = lo * 2;
    const x = hi + y;
    if (y === x - hi) hi = x;
  }
  return hi;
}

export const fmean = (xs) => {
  if (!xs.length) throw new Error("fmean requires at least one data point");
  return fsum(xs) / xs.length;
};

export function median(xs) {
  if (!xs.length) throw new Error("no median for empty data");
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// A double as k * 2**e with k a BigInt, exactly.
function exact(x) {
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, x);
  const hi = v.getUint32(0);
  const lo = v.getUint32(4);
  const bits = (hi >>> 20) & 0x7ff;
  let k = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e;
  if (bits === 0) e = -1074;
  else { k |= 1n << 52n; e = bits - 1075; }
  if (hi >>> 31) k = -k;
  return { k, e };
}

// Does y*y compare to p/q? -1, 0 or 1. y >= 0, p >= 0, q > 0.
function cmpSquare(y, p, q) {
  const { k, e } = exact(y);
  let left = k * k * q;          // y^2 * q = k^2 * 2^(2e) * q
  let right = p;
  if (e >= 0) left <<= BigInt(2 * e); else right <<= BigInt(-2 * e);
  return left < right ? -1 : left > right ? 1 : 0;
}

const nextUp = (y) => {
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, y);
  v.setBigUint64(0, v.getBigUint64(0) + 1n);
  return v.getFloat64(0);
};
const nextDown = (y) => {
  if (y === 0) return 0;
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, y);
  v.setBigUint64(0, v.getBigUint64(0) - 1n);
  return v.getFloat64(0);
};

// Correctly rounded sqrt(p / q) for BigInt p >= 0, q > 0.
function sqrtFrac(p, q) {
  // First guess from 64 extra bits of the quotient; the caller keeps p/q in (1/2, 4].
  let y = Math.sqrt(Number((p << 64n) / q) / 2 ** 64);
  while (y > 0 && cmpSquare(y, p, q) > 0) y = nextDown(y);
  while (cmpSquare(nextUp(y), p, q) <= 0) y = nextUp(y);
  // now y^2 <= p/q < next^2: pick the nearer of y and next by the midpoint
  const up = nextUp(y);
  const mid = exact(y);                      // midpoint = (y + up) / 2, exactly
  const m = exact(up);
  const shift = BigInt(mid.e - m.e);
  const [ka, kb, e] = mid.e >= m.e ? [mid.k << shift, m.k, m.e] : [mid.k, m.k << -shift, mid.e];
  const midK = ka + kb;                      // midpoint = midK * 2^(e-1)
  let left = midK * midK * q;                // mid^2 * q vs p, scaled by 2^(2e-2)
  let right = p;
  const s = 2 * (e - 1);
  if (s >= 0) left <<= BigInt(s); else right <<= BigInt(-s);
  if (right < left) return y;
  if (right > left) return up;
  return (exact(y).k & 1n) === 0n ? y : up;  // exact tie: even mantissa
}

// statistics.stdev (Python 3.13): sqrt of the exact sample variance, correctly rounded.
export function stdev(xs) {
  const n = xs.length;
  if (n < 2) throw new Error("stdev requires at least two data points");
  if (!xs.every(Number.isFinite)) throw new Error("finite numbers only");
  const parts = xs.map(exact);
  // Zeros carry no exponent: leaving them out keeps the BigInts small.
  const live = parts.filter((p) => p.k !== 0n);
  const E = live.length ? Math.min(...live.map((p) => p.e)) : 0;
  const ks = parts.map((p) => (p.k === 0n ? 0n : p.k << BigInt(p.e - E)));
  let S = 0n;
  let Q = 0n;
  for (const k of ks) { S += k; Q += k * k; }
  const N = BigInt(n);
  let p = N * Q - S * S;                     // n(n-1) * variance / 2^(2E)
  let q = N * (N - 1n);
  if (p === 0n) return 0;
  // Scale p/q into [1, 4) by an even power of two, so the sqrt sits in the
  // normal range; scaling back by a power of two keeps the rounding exact.
  let t = p.toString(2).length - q.toString(2).length;
  t -= t & 1;
  if (t >= 0) q <<= BigInt(t); else p <<= BigInt(-t);
  const half = E + t / 2;
  return sqrtFrac(p, q) * 2 ** Math.trunc(half / 2) * 2 ** (half - Math.trunc(half / 2));
}

export function pyInt(cell) {
  const s = String(cell).trim();
  if (!/^[+-]?\d+$/.test(s)) throw new Error(`invalid whole number '${cell}'`);
  return Number(s);
}

export function pyFloat(cell) {
  const s = String(cell).trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) throw new Error(`invalid number '${cell}'`);
  return Number(s);
}
