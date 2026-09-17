'use strict';

const nodemailer = require('nodemailer');
const config = require('./config');

const available = config.mailer.available;

const transporter = available
  ? nodemailer.createTransport({
      host: config.mailer.host,
      port: config.mailer.port,
      secure: config.mailer.port === 465,
      auth: { user: config.mailer.user, pass: config.mailer.pass },
    })
  : null;

// Never throws — a password-reset request must not fail (and must not reveal
// to the caller whether delivery actually worked, which would leak whether
// the email exists). Without SMTP configured, the code is logged instead so
// local development still works without real credentials.
async function sendMail({ to, subject, text, html }) {
  if (!transporter) {
    console.log(`[mail] SMTP not configured — would send to ${to}\n  subject: ${subject}\n  ${text}`);
    return;
  }
  try {
    await transporter.sendMail({ from: config.mailer.from, to, subject, text, html });
  } catch (err) {
    console.error('[mail] send failed', err);
  }
}

module.exports = { sendMail, available };
