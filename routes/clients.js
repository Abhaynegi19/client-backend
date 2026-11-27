const router = require('express').Router();
const Client = require('../models/Client');
const Payment = require('../models/Payment');
const auth = require('../middleware/auth');
const { sendDueReminder } = require('../mailer');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Only these fields can be set from the request body (never owner)
const FIELDS = ['company', 'name', 'email', 'phone', 'amountDue', 'dueDate', 'notes'];
const pick = (body) => Object.fromEntries(FIELDS.filter((f) => f in body).map((f) => [f, body[f]]));

// ---- recurring billing helpers ----
const { REMIND_DAYS, startOfTodayUTC, addMonths, daysUntil, unpaidCycles } = require('../utils/cycles');
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const paidUp = (c) => c.paidUntil && c.paidUntil.toISOString().slice(0, 10) > todayStr();
const canAct = (c) => !paidUp(c) || daysUntil(c.dueDate) <= REMIND_DAYS;

router.use(auth);

router.get('/', wrap(async (req, res) => {
  res.json(await Client.find({ owner: req.userId }).sort({ createdAt: -1 }));
}));

// If no due date is given, it is set automatically (default: 30 days from registration)
const defaultDueDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + (Number(process.env.DEFAULT_DUE_DAYS) || 30));
  return d;
};

router.post('/', wrap(async (req, res) => {
  const data = pick(req.body);
  if (!data.dueDate) data.dueDate = defaultDueDate();
  res.status(201).json(await Client.create({ ...data, owner: req.userId }));
}));

router.put('/:id', wrap(async (req, res) => {
  const client = await Client.findOneAndUpdate({ _id: req.params.id, owner: req.userId }, pick(req.body), {
    new: true,
    runValidators: true,
  });
  if (!client) return res.status(404).json({ message: 'Client not found' });
  res.json(client);
}));

router.delete('/:id', wrap(async (req, res) => {
  const client = await Client.findOneAndDelete({ _id: req.params.id, owner: req.userId });
  if (!client) return res.status(404).json({ message: 'Client not found' });
  res.json({ message: 'Client deleted' });
}));

router.post('/:id/remind', wrap(async (req, res) => {
  const client = await Client.findOne({ _id: req.params.id, owner: req.userId });
  if (!client) return res.status(404).json({ message: 'Client not found' });
  if (!(client.amountDue > 0)) return res.status(400).json({ message: 'This client has no dues' });
  if (!canAct(client)) return res.status(400).json({ message: 'This client has already paid for the current period' });

  try {
    await sendDueReminder(client);
  } catch (e) {
    console.error(e);
    return res.status(502).json({ message: 'Email failed. Check your SMTP settings in .env' });
  }
  client.lastReminderAt = new Date();
  await client.save();
  res.json(client);
}));

router.get('/:id/payments', wrap(async (req, res) => {
  const client = await Client.findOne({ _id: req.params.id, owner: req.userId });
  if (!client) return res.status(404).json({ message: 'Client not found' });
  const payments = await Payment.find({ client: client._id, owner: req.userId }).sort({ paidAt: -1 });
  const tracked = payments.reduce((s, p) => s + p.amount, 0);
  // Money recorded as paid before payment history existed has no dated entries
  const gap = Math.round(((client.totalPaid || 0) - tracked) * 100) / 100;
  const untracked = gap > 0 ? gap : 0;
  res.json({
    payments: payments.map((p) => ({ id: p._id, amount: p.amount, paidAt: p.paidAt })),
    total: Math.round((tracked + untracked) * 100) / 100,
    untracked,
  });
}));

router.get('/:id/ledger', wrap(async (req, res) => {
  const client = await Client.findOne({ _id: req.params.id, owner: req.userId });
  if (!client) return res.status(404).json({ message: 'Client not found' });

  const payments = await Payment.find({ client: client._id, owner: req.userId });
  const paid = payments.map((p) => ({
    id: String(p._id),
    status: 'paid',
    legacy: !p.forDue, // recorded before billing cycles were tracked
    dueDate: p.forDue || p.paidAt,
    amount: p.amount,
    paidAt: p.paidAt,
  }));
  const unpaid = unpaidCycles(client, { includeUpcoming: true }).map((c) => ({ id: c.dueDate.toISOString(), ...c }));
  const cycles = [...unpaid, ...paid].sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate));

  const tracked = payments.reduce((s, p) => s + p.amount, 0);
  const gap = Math.round(((client.totalPaid || 0) - tracked) * 100) / 100;
  const untracked = gap > 0 ? gap : 0; // paid before payment history existed (no dates)
  const pending = unpaid.filter((c) => c.status !== 'upcoming');

  res.json({
    cycles,
    paidCount: payments.length,
    paidTotal: Math.round((tracked + untracked) * 100) / 100,
    untracked,
    pendingCount: pending.length,
    pendingTotal: pending.reduce((s, c) => s + c.amount, 0),
  });
}));

router.post('/:id/paid', wrap(async (req, res) => {
  const client = await Client.findOne({ _id: req.params.id, owner: req.userId });
  if (!client) return res.status(404).json({ message: 'Client not found' });
  if (!(client.amountDue > 0)) return res.status(400).json({ message: 'This client has no dues to mark as paid' });
  if (!canAct(client)) return res.status(400).json({ message: 'This client has already paid for the current period' });

  const amount = client.amountDue;
  const settled = client.dueDate || startOfTodayUTC(); // the oldest unpaid cycle is the one being paid
  const next = addMonths(settled, 1);                  // same amount, one month later

  client.lastPaymentAmount = amount;
  client.totalPaid = (client.totalPaid || 0) + amount;
  client.lastPaidAt = new Date();
  client.dueDate = next;
  client.paidUntil = next; // "Paid up" until that date, unless more cycles are already overdue
  await client.save();

  await Payment.create({
    owner: req.userId,
    client: client._id,
    clientName: client.company,
    amount,
    forDue: settled,
    paidAt: client.lastPaidAt,
  });
  res.json(client);
}));

module.exports = router;
