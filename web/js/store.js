// Review decisions live in this browser only. Every access is guarded:
// private windows and blocked storage must not break the page.
// scope "" is the hosted demo (old keys, unchanged); the offline edition scopes keys by club.
const PREFIX = "lineupcard:review:";
// The club name is encoded, so no club name can contain the ":" that ends another's prefix.
const scopePart = (scope) => (scope ? `${encodeURIComponent(scope)}:` : "");
export const reviewKey = (date, scope = "") => `${PREFIX}${scopePart(scope)}${date}`;

export function loadReview(date, scope = "") {
  try {
    return JSON.parse(localStorage.getItem(reviewKey(date, scope))) ?? emptyReview();
  } catch {
    return emptyReview();
  }
}

// True when anything at all is saved for this date (even a partial review).
export function hasSavedReview(date, scope = "") {
  try {
    return localStorage.getItem(reviewKey(date, scope)) !== null;
  } catch {
    return false;
  }
}

export function saveReview(date, review, scope = "") {
  try {
    localStorage.setItem(reviewKey(date, scope), JSON.stringify(review));
    return true;
  } catch {
    return false;
  }
}

// Removes every saved review for one club. Returns how many were removed.
export function clearReviews(scope) {
  if (!scope) return 0;   // never clear every club at once
  const start = `${PREFIX}${scopePart(scope)}`;
  let n = 0;
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(start)) keys.push(k);
    }
    for (const k of keys) { localStorage.removeItem(k); n++; }
  } catch {
    // storage blocked: nothing to clear
  }
  return n;
}

export const emptyReview = (reviewer = "M. Castillo") => ({ todayIds: [], decisions: {}, approvedAt: null, reviewer });
