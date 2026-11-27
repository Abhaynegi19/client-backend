const mongoose = require('mongoose');
const { unpaidCycles } = require('../utils/cycles');

const clientSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    company: { type: String, required: [true, 'Company name is required'], trim: true },
    name: { type: String, required: [true, 'Contact name is required'], trim: true },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Enter a valid email'],
    },
    phone: { type: String, required: [true, 'Phone number is required'], trim: true },
    amountDue: { type: Number, default: 0, min: [0, 'Amount cannot be negative'] },
    dueDate: { type: Date },
    notes: { type: String, trim: true },
    lastReminderAt: { type: Date },
    lastPaidAt: { type: Date },
    paidUntil: { type: Date }, // set when payment is received: client counts as paid until this date
    lastPaymentAmount: { type: Number },
    totalPaid: { type: Number, default: 0 },
  },
  { timestamps: true, id: false, toJSON: { virtuals: true } }
);

// Cycles that are overdue or due soon, e.g. [Nov 1 overdue, Dec 1 overdue]
clientSchema.virtual('pending').get(function () {
  return unpaidCycles(this);
});

module.exports = mongoose.model('Client', clientSchema);
