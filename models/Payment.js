const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    clientName: { type: String, required: true }, // snapshot, so reports survive client deletion
    amount: { type: Number, required: true, min: 0 },
    forDue: { type: Date }, // the due date (billing cycle) this payment settled
    paidAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Payment', paymentSchema);
