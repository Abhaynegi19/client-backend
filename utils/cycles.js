// Monthly billing-cycle helpers shared by the model and routes.

// The reminder ("Email dues") and "Mark paid" actions open this many days before a due date.
// Keep in sync with REMIND_DAYS in client/src/api.js
const REMIND_DAYS = 5;

const startOfTodayUTC = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
};

// Same day next month (Jan 31 -> Feb 28/29)
const addMonths = (date, n) => {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
};

const daysUntil = (date) => (date ? Math.round((new Date(date) - startOfTodayUTC()) / 86400000) : NaN);

// Unpaid cycles: start at the client's current due date (the oldest unpaid one) and go
// forward month by month while each cycle is overdue or inside the reminder window.
// So if a client skips a month and the next due date arrives, both show up as due.
// With includeUpcoming, the first cycle beyond the window is added as 'upcoming'.
function unpaidCycles({ amountDue, dueDate }, { includeUpcoming = false } = {}) {
  const out = [];
  if (!(amountDue > 0) || !dueDate) return out;
  let d = new Date(dueDate);
  for (let i = 0; i < 60; i++) {
    const n = daysUntil(d);
    if (n > REMIND_DAYS) {
      if (includeUpcoming) out.push({ dueDate: d, amount: amountDue, status: 'upcoming' });
      break;
    }
    out.push({ dueDate: d, amount: amountDue, status: n < 0 ? 'overdue' : 'due' });
    d = addMonths(d, 1);
  }
  return out;
}

module.exports = { REMIND_DAYS, startOfTodayUTC, addMonths, daysUntil, unpaidCycles };
