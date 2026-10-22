// Review decisions live in this browser only (demo). Every access is guarded:
// private windows and blocked storage must not break the page.
const key = (date) => `lineupcard:review:${date}`;

export function loadReview(date) {
  try {
    return JSON.parse(localStorage.getItem(key(date))) ?? emptyReview();
  } catch {
    return emptyReview();
  }
}

export function saveReview(date, review) {
  try {
    localStorage.setItem(key(date), JSON.stringify(review));
    return true;
  } catch {
    return false;
  }
}

export const emptyReview = () => ({ todayIds: [], decisions: {}, approvedAt: null, reviewer: "M. Castillo" });
