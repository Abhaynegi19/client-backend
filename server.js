require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is missing. Add it to server/.env (see .env.example)');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/reports', require('./routes/reports'));

app.use((err, req, res, next) => {
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map((e) => e.message).join(', ');
    return res.status(400).json({ message });
  }
  if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid id' });
  console.error(err);
  res.status(500).json({ message: 'Something went wrong on the server' });
});

// One-time, safe to repeat: create a history entry for each client's last payment
// that was recorded before payment history existed.
async function backfillPayments() {
  const Client = require('./models/Client');
  const Payment = require('./models/Payment');
  const clients = await Client.find({ lastPaidAt: { $exists: true }, lastPaymentAmount: { $gt: 0 } });
  for (const c of clients) {
    if (await Payment.exists({ client: c._id })) continue;
    await Payment.create({ owner: c.owner, client: c._id, clientName: c.company, amount: c.lastPaymentAmount, paidAt: c.lastPaidAt });
  }
}

const PORT = process.env.PORT || 5000;
mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    await backfillPayments();
    app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
  })
  .catch((e) => {
    console.error('MongoDB connection failed:', e.message);
    process.exit(1);
  });
