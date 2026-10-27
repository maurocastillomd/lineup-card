// Where a page gets its data. The hosted demo fetches JSON files; the offline
// edition (offline.js) builds the same shape in memory from dropped CSVs.
//   getIndex() -> { dates, latest }     getDay(date) -> day JSON
//   getExample(date) -> review | null   getBoard() -> SVG text | null
//   go(screen, date)                    scope: storage scope ("" = demo)
//   reviewer: default reviewer name

export function fetchSource() {
  const json = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(url); return r.json(); };
  return {
    scope: "",
    reviewer: "M. Castillo",
    getIndex: () => json("data/index.json"),
    getDay: (date) => json(`data/days/${date}.json`),
    getExample: async (date) => { const r = await fetch(`examples/review-${date}.json`); return r.ok ? r.json() : null; },
    getBoard: async () => { const r = await fetch("figures/board/board.svg"); return r.ok ? r.text() : null; },
    go: (screen, date) => { location.href = `${screen === "card" ? "card" : "index"}.html?date=${date}`; },
  };
}
