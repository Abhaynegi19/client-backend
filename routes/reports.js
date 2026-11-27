const router = require('express').Router();
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const auth = require('../middleware/auth');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
router.use(auth);

// Months are grouped in the viewer's time zone (sent by the browser)
const safeTz = (tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
};
const monthKey = (date, tz) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(date);
  return `${parts.find((p) => p.type === 'year').value}-${parts.find((p) => p.type === 'month').value}`;
};
const monthExpr = (tz) => ({ $dateToString: { format: '%Y-%m', date: '$paidAt', timezone: tz } });
const round = (n) => Math.round(n * 100) / 100;

// Overall + this month + totals per month
router.get('/summary', wrap(async (req, res) => {
  const tz = safeTz(req.query.tz || 'UTC');
  const owner = new mongoose.Types.ObjectId(req.userId);

  const rows = await Payment.aggregate([
    { $match: { owner } },
    { $group: { _id: monthExpr(tz), total: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $sort: { _id: -1 } },
  ]);
  const months = rows.map((r) => ({ month: r._id, total: round(r.total), count: r.count }));
  const current = monthKey(new Date(), tz);

  res.json({
    month: current,
    thisMonth: months.find((m) => m.month === current) || { month: current, total: 0, count: 0 },
    overall: { total: round(months.reduce((s, m) => s + m.total, 0)), count: months.reduce((s, m) => s + m.count, 0) },
    months,
  });
}));

// Report for one month (?month=YYYY-MM)
router.get('/monthly', wrap(async (req, res) => {
  const tz = safeTz(req.query.tz || 'UTC');
  const month = String(req.query.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ message: 'Month must look like 2026-11' });
  const owner = new mongoose.Types.ObjectId(req.userId);

  const payments = await Payment.aggregate([
    { $match: { owner } },
    { $addFields: { month: monthExpr(tz) } },
    { $match: { month } },
    { $sort: { paidAt: -1 } },
  ]);

  const byClient = {};
  for (const p of payments) {
    const key = String(p.client);
    byClient[key] ||= { client: p.client, clientName: p.clientName, total: 0, count: 0 };
    byClient[key].total += p.amount;
    byClient[key].count += 1;
  }

  res.json({
    month,
    total: round(payments.reduce((s, p) => s + p.amount, 0)),
    count: payments.length,
    byClient: Object.values(byClient).map((c) => ({ ...c, total: round(c.total) })).sort((a, b) => b.total - a.total),
    payments: payments.map((p) => ({ id: p._id, client: p.client, clientName: p.clientName, amount: p.amount, paidAt: p.paidAt })),
  });
}));

module.exports = router;
