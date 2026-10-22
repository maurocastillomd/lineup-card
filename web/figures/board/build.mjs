// Availability board: an anatomy figure for the Lineup Card.
// Run: node web/figures/board/build.mjs   (writes board.svg next to this file)
//
// TRUTH
// - One peg per player on today's roster (28, read from ../../data/days/<latest>.json via ../../data/index.json).
// - Five rails, one per role, top to bottom: SP, RP, C, IF, OF. Pegs fill each rail from the left.
// - Each peg carries four tags; the card shows the one whose data-for matches the peg's data-status
//   (check_in, watch, no_change, not_enough_data). The default data-status is the latest day's status.
// - Glyphs carry meaning without colour: check_in two bars, watch one bar, no_change a ring,
//   not_enough_data a dashed ring. The check_in tag is the single lit accent.
//
// OBJECT: a wall-mounted peg board in a staff room. A player's tag hangs on his peg; turning the tag
// over is the morning's call. The key rack at the right holds one sample of each tag.
//
// PARTS LIST
// Base
//   - 4 wall brackets (2 on the top edge, 1 on each side), each a wall flange + arm, 2 screws per bracket
//   - halo behind the board (its shadow on the wall)
// Structure
//   - board slab with bevel, inset groove on the front face
//   - 5 rails (raised strips), 2 end stops per rail with a screw each
//   - empty peg bores on the rails where a role has fewer players than slots
//   - ruler strip along the bottom, ticks every 4 units, a major every 5th, 2 end screws
// Mechanism
//   - 28 pegs: collar washer, shaft, knurled cap with a centre dot
//   - each peg: a hanging ring and four tags (only one shown), each tag a plate with a hole and a glyph
// Controls
//   - header nameplate with three rule lines and 2 screws
//   - key rack at the right end: framed recess, groove, 4 hook pins with ball ends, 4 sample tags, 4 screws
// Subject
//   - the tags; check_in tags are lit.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./vendor/iso-kit.mjs";
import * as G from "./vendor/lathe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "..", "..", "data");
const index = JSON.parse(readFileSync(join(DATA, "index.json"), "utf8"));
const day = JSON.parse(readFileSync(join(DATA, "days", `${index.latest}.json`), "utf8"));
const ROLES = ["SP", "RP", "C", "IF", "OF"];
const players = [...day.players].sort((a, b) => a.id.localeCompare(b.id));
const byRole = ROLES.map((role) => players.filter((p) => p.pos === role));
const STATUSES = ["check_in", "watch", "no_change", "not_enough_data"];

// ---- world (x along the board, y out of the wall toward the viewer, z up) ----
const SLOTS = Math.max(8, ...byRole.map((list) => list.length));
const PITCH = 15;
const RAIL_X0 = 8;
const RAIL_X1 = RAIL_X0 + 6 + SLOTS * PITCH;
const pegX = (i) => RAIL_X0 + 3 + PITCH / 2 + i * PITCH;
const RACK = { x: RAIL_X1 + 10, w: 26 };
const W = RACK.x + RACK.w + 8;
const ROW_Z = [138, 112, 86, 60, 34];
const H = 170;
const T = 6; // board thickness
const WALL = -16; // wall plane
const RAIL_D = 2.5;
const PEG_R = 1.8;
const CAP_R = 2.7;
const CAP0 = 8.4;
const CAP1 = 10.6;
const TAG = { w: 9, h: 11.5, y: 6.2, d: 1.2, top: 4.6 }; // top = how far below the peg axis the tag starts
const RING_Y = TAG.y + TAG.d / 2;

const WIDTH = 380;
const HEIGHT = 400;
const P = k.fitProjection(
  [...k.boxCorners({ x: -14, y: WALL, w: W + 28, d: -WALL + CAP1 }, -2, H + 12)],
  WIDTH,
  HEIGHT,
  { pad: 8, azimuth: 64, elevation: 24 },
);

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const box = (x0, y0, z0, x1, y1, z1, r = 0.4, bevel = 0) => k.slabOf({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r }, z0, z1 - z0, P, 3, bevel);
const front = (pts) => k.pathOf(pts.map(at), true);
const Y = [0, 1, 0];

// screw on a face that looks toward +y: a ring and a dot
function screwY(x, y, z, r = 1.1) {
  return L(k.sideRing([x, y, z], r, "y", P, 16), { tone: "lo" }) + D([at([x, y, z])], { size: 0.45, tone: "mid" });
}

// ---- base: brackets and halo ----
const BRACKETS = [
  { kind: "top", x: 34 },
  { kind: "top", x: W - 34 },
  { kind: "side", x: 0, z: 48, dir: -1 },
  { kind: "side", x: W, z: 48, dir: 1 },
];

function bracketFlange(b) {
  if (b.kind === "top") {
    const x0 = b.x - 7, x1 = b.x + 7;
    return S(box(x0, WALL, H - 8, x1, WALL + 1.6, H + 12, 0.6, 0.4), { tone: "lo" }) +
      screwY(b.x - 3.5, WALL + 1.6, H + 7.5, 0.9) + screwY(b.x + 3.5, WALL + 1.6, H + 7.5, 0.9);
  }
  const x0 = b.dir < 0 ? b.x - 14 : b.x, x1 = b.dir < 0 ? b.x : b.x + 14;
  const sx = b.dir < 0 ? b.x - 8 : b.x + 8;
  return S(box(x0, WALL, b.z - 8, x1, WALL + 1.6, b.z + 8, 0.6, 0.4), { tone: "lo" }) +
    screwY(sx, WALL + 1.6, b.z + 4, 0.9) + screwY(sx, WALL + 1.6, b.z - 4, 0.9);
}

function bracketArm(b) {
  if (b.kind === "top") {
    const arm = S(box(b.x - 3, WALL + 1.6, H, b.x + 3, -1.5, H + 1.4, 0.3, 0.3), { tone: "mid" });
    return arm + D([at([b.x, -4, H + 1.4])], { size: 0.45, tone: "mid" });
  }
  if (b.dir < 0) return S(box(b.x - 1.4, WALL + 1.6, b.z - 3, b.x, -1.5, b.z + 3, 0.3), { tone: "mid" });
  return S(box(b.x, WALL + 1.6, b.z - 3, b.x + 1.4, -1.5, b.z + 3, 0.3), { tone: "mid" }) +
    D([at([b.x + 1.4, -4, b.z])], { size: 0.45, tone: "mid" });
}

function board() {
  const plan = { x: 0, y: -T, w: W, d: T, r: 1.5 };
  const out = [`<path class="iso-halo" d="${box(-2, WALL, -4, W + 2, WALL + 1, H + 2).fill}" transform="translate(4 6)"/>`];
  out.push(...BRACKETS.map(bracketFlange));
  out.push(...BRACKETS.filter((b) => b.dir < 0).map(bracketArm));
  out.push(S(k.slabOf(plan, 0, H, P, 4, 1.2), { tone: "mid" }));
  // inset groove on the front face
  const g = 3.5;
  out.push(L(front([[g, 0, g], [W - g, 0, g], [W - g, 0, H - g], [g, 0, H - g]]), { tone: "faint" }));
  // divider groove between rails and key rack
  out.push(L(k.segment([RAIL_X1 + 5, 0, g], [RAIL_X1 + 5, 0, H - g], P), { tone: "faint" }));
  out.push(...BRACKETS.filter((b) => !(b.dir < 0)).map(bracketArm));
  return out.join("");
}

// ---- structure ----
function ruler() {
  const x0 = RAIL_X0, x1 = RAIL_X1, z0 = 5, z1 = 11, d = 1;
  const out = [S(box(x0, 0, z0, x1, d, z1, 0.3), { tone: "lo", crease: "faint" })];
  const ticks = k.sideTicks(x0 + 4, x1 - 4, 4, 5, d, z1, [1.6, 3], P, "x");
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([x0 + 2, d, (z0 + z1) / 2]), at([x1 - 2, d, (z0 + z1) / 2])], { size: 0.4, tone: "mid" }));
  return out.join("");
}

function nameplate() {
  const x0 = RAIL_X0, x1 = RAIL_X0 + 92, z0 = 149, z1 = 163, d = 1.4;
  const out = [S(box(x0, 0, z0, x1, d, z1, 0.4, 0.4), { tone: "hi", crease: "lo" })];
  out.push(L(front([[x0 + 2, d, z0 + 2], [x1 - 2, d, z0 + 2], [x1 - 2, d, z1 - 2], [x0 + 2, d, z1 - 2]]), { tone: "faint" }));
  const rules = [[158, 70], [155, 52], [152, 60]];
  for (const [z, len] of rules) out.push(L(k.segment([x0 + 9, d, z], [x0 + 9 + len, d, z], P), { tone: "lo", free: true }));
  out.push(D([at([x0 + 4.5, d, (z0 + z1) / 2]), at([x1 - 4.5, d, (z0 + z1) / 2])], { size: 0.45, tone: "mid" }));
  return out.join("");
}

function rail(z, used) {
  const out = [];
  const stopA = [RAIL_X0 - 4, RAIL_X0], stopB = [RAIL_X1, RAIL_X1 + 4];
  out.push(S(box(stopA[0], 0, z - 4, stopA[1], 4, z + 4, 0.5, 0.3), { tone: "mid" }), screwY(stopA[0] + 2, 4, z, 0.8));
  out.push(S(box(RAIL_X0, 0, z - 3, RAIL_X1, RAIL_D, z + 3, 0.4, 0.4), { tone: "mid" }));
  // empty bores
  for (let i = used; i < SLOTS; i++) {
    out.push(`<path class="bore" d="${k.sideRing([pegX(i), RAIL_D, z], PEG_R, "y", P, 18)}"/>`);
    out.push(L(k.sideRing([pegX(i), RAIL_D, z], PEG_R + 0.7, "y", P, 18), { tone: "faint" }));
  }
  out.push(S(box(stopB[0], 0, z - 4, stopB[1], 4, z + 4, 0.5, 0.3), { tone: "mid" }), screwY(stopB[0] + 2, 4, z, 0.8));
  return out.join("");
}

// ---- mechanism: peg, ring, tag ----
function pegBack(x, z) {
  const F = G.frameAlong([x, 0, z], Y);
  return S(G.disc(RAIL_D, RAIL_D + 0.7, CAP_R + 0.2, F, P, { steps: 20 }), { tone: "mid" }) +
    S(G.disc(RAIL_D + 0.7, RING_Y, PEG_R, F, P, { steps: 16 }), { tone: "mid", crease: "none" });
}

function pegFront(x, z) {
  const F = G.frameAlong([x, 0, z], Y);
  const out = [S(G.disc(RING_Y, CAP0, PEG_R, F, P, { steps: 16 }), { tone: "mid", crease: "none" })];
  const ribs = G.ribsOf(F, CAP0 + 0.5, CAP1 - 0.4, CAP_R, 16, P, { fade: [0.05, 0.45], seams: true });
  out.push(S(G.disc(CAP0, CAP1, CAP_R, F, P, { steps: 24 }), { tone: "hi", crease: "lo", inner: k.fadedSvg(ribs, { tone: "lo" }) }));
  out.push(L(k.sideRing([x, CAP1, z], CAP_R - 0.7, "y", P, 20), { tone: "faint" }));
  out.push(D([at([x, CAP1, z])], { size: 0.4, tone: "mid" }));
  return out.join("");
}

function ring(x, z) {
  const R = (TAG.top + 1.4 + PEG_R + 0.2) / 2;
  const cz = z + PEG_R + 0.2 - R;
  return L(k.sideRing([x, RING_Y, cz], R, "y", P, 28), { tone: "hi" });
}

// glyph shapes on the tag face (filled, so they scale with the drawing)
function glyph(kind, x, y, z) {
  const rect = (x0, z0, x1, z1) => front([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]]);
  const arc = (r0, r1, a0, a1, n = 10) => {
    const outer = [], inner = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      outer.push([x + Math.cos(a) * r1, y, z + Math.sin(a) * r1]);
      inner.push([x + Math.cos(a) * r0, y, z + Math.sin(a) * r0]);
    }
    return front([...outer, ...inner.reverse()]);
  };
  if (kind === "check_in") return rect(x - 3, z + 0.6, x + 3, z + 2.2) + rect(x - 3, z - 2.2, x + 3, z - 0.6);
  if (kind === "watch") return rect(x - 3, z - 0.8, x + 3, z + 0.8);
  if (kind === "no_change") return arc(1.9, 3, 0, Math.PI, 14) + arc(1.9, 3, Math.PI, 2 * Math.PI, 14);
  const n = 6, gap = 0.32;
  let d = "";
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 2 * Math.PI + gap, a1 = ((i + 1) / n) * 2 * Math.PI - gap;
    d += arc(1.9, 3, a0, a1, 4);
  }
  return d;
}

function tag(kind, x, z, cls = "tag") {
  const z1 = z - TAG.top, z0 = z1 - TAG.h;
  const lit = kind === "check_in";
  const body = S(box(x - TAG.w / 2, TAG.y, z0, x + TAG.w / 2, TAG.y + TAG.d, z1, 0.3, 0.3), { tone: "hi", crease: "lo", lit });
  const fy = TAG.y + TAG.d;
  const hole = `<path class="bore" d="${k.sideRing([x, fy, z1 - 1.4], 0.7, "y", P, 12)}"/>`;
  const g = `<path class="glyph" data-glyph="${kind}" d="${glyph(kind, x, fy, z1 - 7)}"/>`;
  return `<g class="${cls}" data-for="${kind}">${body}${hole}${g}</g>`;
}

function peg(p, x, z) {
  const title = `<title>${p.name} · ${p.pos}</title>`;
  const tags = STATUSES.map((s) => tag(s, x, z)).join("");
  return `<g class="peg" data-id="${p.id}" data-status="${p.status}">${title}${pegBack(x, z)}${ring(x, z)}${tags}${pegFront(x, z)}</g>`;
}

// ---- controls: key rack ----
function keyRack() {
  const x0 = RACK.x, x1 = RACK.x + RACK.w, z0 = 16, z1 = 163;
  const out = [S(box(x0, 0, z0, x1, 1.6, z1, 0.6, 0.5), { tone: "lo", crease: "faint" })];
  out.push(L(front([[x0 + 2.5, 1.6, z0 + 2.5], [x1 - 2.5, 1.6, z0 + 2.5], [x1 - 2.5, 1.6, z1 - 2.5], [x0 + 2.5, 1.6, z1 - 2.5]]), { tone: "faint" }));
  for (const [sx, sz] of [[x0 + 4.5, z0 + 5], [x1 - 4.5, z0 + 5], [x0 + 4.5, z1 - 5], [x1 - 4.5, z1 - 5]]) out.push(screwY(sx, 1.6, sz, 0.8));
  const cx = (x0 + x1) / 2;
  STATUSES.forEach((s, i) => {
    const z = ROW_Z[i] + 2;
    const F = G.frameAlong([cx, 0, z], Y);
    out.push(`<g class="key" data-key="${s}">`);
    out.push(S(G.disc(1.6, 2.4, 2, F, P, { steps: 16 }), { tone: "mid" }));
    out.push(S(G.disc(2.4, RING_Y, 0.9, F, P, { steps: 12 }), { tone: "mid", crease: "none" }));
    out.push(ring(cx, z));
    out.push(tag(s, cx, z, "key-tag"));
    out.push(S(G.disc(RING_Y, CAP0 - 1, 0.9, F, P, { steps: 12 }), { tone: "mid", crease: "none" }));
    out.push(S(G.sphereOf([cx, CAP0 - 0.4, z], 1.5, P, { steps: 24 }), { tone: "hi" }));
    out.push(`</g>`);
  });
  return out.join("");
}

// ---- assemble, bottom rail first (upper tags hang in front of lower rails) ----
const rows = ROLES.map((role, r) => ({ role, z: ROW_Z[r], list: byRole[r] })).sort((a, b) => a.z - b.z);
const body = [board(), ruler(), nameplate(), keyRack()];
for (const row of rows) {
  body.push(`<g class="rail" data-role="${row.role}">`);
  body.push(rail(row.z, row.list.length));
  row.list.forEach((p, i) => body.push(peg(p, pegX(i), row.z)));
  body.push(`</g>`);
}

const STYLE = `<style>
.board-fig .bore{fill:var(--anatomy-shade-0);stroke:var(--anatomy-lo);stroke-width:var(--anatomy-weight)}
.board-fig .glyph{fill:var(--anatomy-hi);stroke:none}
.board-fig .glyph[data-glyph="check_in"]{fill:var(--anatomy-lit)}
.board-fig .peg .tag{display:none}
.board-fig .peg[data-status="check_in"] .tag[data-for="check_in"],
.board-fig .peg[data-status="watch"] .tag[data-for="watch"],
.board-fig .peg[data-status="no_change"] .tag[data-for="no_change"],
.board-fig .peg[data-status="not_enough_data"] .tag[data-for="not_enough_data"]{display:inline}
</style>`;

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  standalone: "light",
  className: "board-fig",
  label:
    `Availability board for ${index.latest}: a wall peg board with five rails, one per role (SP, RP, C, IF, OF), and one peg per player (${players.length}). ` +
    "Each peg carries a hanging tag: two bars means check in, one bar means watch, a ring means no change, a dashed ring means not enough data. " +
    "A key rack at the right holds one sample of each tag. Fictional roster; not a fitness-to-play decision.",
  body: [STYLE, ...body],
});

const out = join(HERE, "board.svg");
writeFileSync(out, svg + "\n");
console.log(out);
