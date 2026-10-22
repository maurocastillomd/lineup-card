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

// True when anything at all is saved for this date (even a partial review).
export function hasSavedReview(date) {
  try {
    return localStorage.getItem(key(date)) !== null;
  } catch {
    return false;
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
