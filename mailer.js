const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);

const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function sendDueReminder(client) {
  // Early reminder: the due date is still ahead
  const upcoming = !!client.dueDate && client.dueDate.toISOString().slice(0, 10) > todayStr();
  const pending = client.pending || [];
  const owed = pending.length ? pending.reduce((sum, c) => sum + c.amount, 0) : client.amountDue;
  const months = pending.map((c) =>
    new Date(c.dueDate).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  );
  const sender = process.env.SENDER_NAME || 'Accounts Team';
  const due = client.dueDate
    ? new Date(client.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:520px;color:#14211f">
    <p>Hi ${client.name},</p>
    <p>${upcoming ? 'This is a friendly heads-up that a payment is coming due soon for' : 'This is a friendly reminder that a payment is pending for'} <b>${client.company}</b>.</p>
    <table style="border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:6px 16px 6px 0;color:#5b6b68">Amount due</td><td style="font-size:20px"><b>${inr(owed)}</b></td></tr>
      ${pending.length > 1 ? `<tr><td style="padding:6px 16px 6px 0;color:#5b6b68">Payments due</td><td>${months.join(', ')}</td></tr>` : ''}
      ${due ? `<tr><td style="padding:6px 16px 6px 0;color:#5b6b68">Due date</td><td>${due}</td></tr>` : ''}
    </table>
    <p>Please reply to this email once the payment is made, or if you have any questions.</p>
    <p>Thank you,<br/>${sender}</p>
  </div>`;

  return transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: client.email,
    subject: upcoming
      ? `Upcoming payment: ${inr(owed)} due ${due} from ${client.company}`
      : `Payment reminder: ${inr(owed)} due from ${client.company}`,
    html,
  });
}

module.exports = { sendDueReminder };
