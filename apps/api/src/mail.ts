import nodemailer from 'nodemailer';
import { one, run } from './db.js';

export type Mail = { to: string; subject: string; html: string; text: string };
/** Messages "sent" while the tests run; nothing leaves the machine. */
export const outbox: Mail[] = [];

export type Smtp = {
  host: string;
  port: number;
  /** true for implicit TLS (port 465); otherwise the connection upgrades with STARTTLS. */
  secure: boolean;
  user: string;
  pass: string;
  /** The sender customers see, e.g. `Dellvit <no-reply@example.com>`. */
  from: string;
};
/**
 * The SMTP details in use and where they came from: those saved in the admin panel, else the
 * SMTP_* environment variables.
 */
export async function smtpSettings(): Promise<(Smtp & { source: 'saved' | 'environment' }) | null> {
  const row = await one('SELECT value FROM settings WHERE key=?', 'smtp');
  const saved = row ? (JSON.parse(row.value) as Smtp) : null;
  if (saved?.host) return { ...saved, source: 'saved' };
  if (!process.env.SMTP_HOST) return null;
  const port = Number(process.env.SMTP_PORT) || 587;
  return {
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || '',
    source: 'environment',
  };
}
export async function saveSmtpSettings(s: Smtp) {
  await run(
    'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    'smtp',
    JSON.stringify(s),
  );
}
/** Whether an email can be delivered right now. */
export const mailReady = async () => process.env.NODE_ENV === 'test' || !!(await smtpSettings());

/** Delivers one message with the given details; throws the mail server's own error when it fails. */
export async function deliver(smtp: Smtp, mail: Mail) {
  if (process.env.NODE_ENV === 'test') {
    outbox.push(mail);
    return;
  }
  await nodemailer
    .createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    })
    .sendMail({ from: smtp.from || `Dellvit <${smtp.user}>`, ...mail });
}
/** Sends one message. Resolves false, without throwing, when it could not be delivered. */
export async function sendMail(mail: Mail) {
  if (process.env.NODE_ENV === 'test') {
    outbox.push(mail);
    return true;
  }
  const smtp = await smtpSettings();
  if (!smtp) {
    console.error('An email was not sent: no SMTP details are saved in Store settings.');
    return false;
  }
  try {
    await deliver(smtp, mail);
    return true;
  } catch (error) {
    console.error('An email could not be sent.', { code: (error as { code?: string }).code });
    return false;
  }
}

// The first WEB_ORIGIN entry is the public address used in email links.
const site = () =>
  (process.env.WEB_ORIGIN || 'http://localhost:3000').split(',')[0].trim().replace(/\/+$/, '');
const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const brand = '#d91e45';
const ink = '#1c1420';
const muted = '#6f6877';

/** The shared frame: brand header, a white card and a quiet footer. Tables keep old clients happy. */
function layout(p: { preheader: string; heading: string; body: string }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${p.heading}</title>
</head>
<body style="margin:0;padding:0;background:#f6f3f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${ink};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${p.preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3f7;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td style="background:${brand};background-image:linear-gradient(135deg,#bf1439,${brand} 55%,#f79a36);border-radius:20px 20px 0 0;padding:28px 32px;">
<a href="${site()}" style="color:#ffffff;text-decoration:none;font-size:24px;font-weight:800;letter-spacing:-0.4px;">Dellvit</a>
<div style="color:#ffffff;opacity:0.85;font-size:13px;margin-top:4px;">Your neighbourhood, delivered.</div>
</td></tr>
<tr><td style="background:#ffffff;border-radius:0 0 20px 20px;padding:32px;box-shadow:0 12px 32px rgba(28,20,32,0.08);">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:${ink};">${p.heading}</h1>
${p.body}
</td></tr>
<tr><td style="padding:20px 32px;text-align:center;color:${muted};font-size:12px;line-height:1.6;">
You are receiving this email because this address was used on Dellvit.<br>
<a href="${site()}" style="color:${muted};">${site().replace(/^https?:\/\//, '')}</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
const paragraph = (text: string) =>
  `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${ink};">${text}</p>`;
const note = (text: string) =>
  `<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:${muted};">${text}</p>`;
const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;"><tr><td style="background:${brand};border-radius:12px;"><a href="${href}" style="display:inline-block;padding:13px 26px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">${label}</a></td></tr></table>`;

/** The 6-digit code that proves a customer owns their email address. */
export function verificationEmail(p: { to: string; name: string; code: string; minutes: number }): Mail {
  const name = escape(p.name.split(' ')[0] || 'there');
  // One box, so a long press or a double click selects the whole code for copying. Email
  // cannot run a copy button; the button below opens the site with the code already filled in.
  const digits = `<td style="padding:14px 22px;border:1px dashed #e3b9c5;border-radius:14px;background:#fdf6f8;text-align:center;font-size:32px;font-weight:800;letter-spacing:8px;color:${ink};font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;">${p.code}</td>`;
  const link = `${site()}/verify?email=${encodeURIComponent(p.to)}&code=${p.code}`;
  return {
    to: p.to,
    // The code stays out of the subject and the preview line, where others could read it.
    subject: 'Verification Code',
    text: `Hi ${p.name.split(' ')[0] || 'there'},\n\nYour Dellvit verification code is ${p.code}. It expires in ${p.minutes} minutes.\n\nEnter it at ${site()}/verify, or open this link to fill it in for you: ${link}\n\nIf you did not sign up, you can ignore this email.`,
    html: layout({
      preheader: `Open this email for your Dellvit code. It expires in ${p.minutes} minutes.`,
      heading: 'Confirm your email',
      body:
        paragraph(`Hi ${name}, welcome to Dellvit. Enter this code to finish creating your account:`) +
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr>${digits}</tr></table>` +
        note('Tap and hold the code (or double-click it) to copy it.') +
        paragraph(`<br>The code expires in <strong>${p.minutes} minutes</strong> and can be used once.`) +
        button(link, 'Verify my email') +
        note('The button opens Dellvit with your code already filled in, so there is nothing to copy.') +
        note(
          'Never share this code. Dellvit staff will not ask for it. If you did not create an account, you can safely ignore this email.',
        ),
    }),
  };
}
/** The 6-digit code that lets a customer who forgot their password choose a new one. */
export function passwordResetEmail(p: { to: string; name: string; code: string; minutes: number }): Mail {
  const name = escape(p.name.split(' ')[0] || 'there');
  const digits = `<td style="padding:14px 22px;border:1px dashed #e3b9c5;border-radius:14px;background:#fdf6f8;text-align:center;font-size:32px;font-weight:800;letter-spacing:8px;color:${ink};font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;">${p.code}</td>`;
  const link = `${site()}/forgot-password?email=${encodeURIComponent(p.to)}&code=${p.code}`;
  return {
    to: p.to,
    // The code stays out of the subject and the preview line, where others could read it.
    subject: 'Password Reset Code',
    text: `Hi ${p.name.split(' ')[0] || 'there'},\n\nYour Dellvit password reset code is ${p.code}. It expires in ${p.minutes} minutes.\n\nEnter it at ${site()}/forgot-password, or open this link to fill it in for you: ${link}\n\nIf you did not ask to reset your password, you can ignore this email. Your password stays the same.`,
    html: layout({
      preheader: `Open this email for your Dellvit reset code. It expires in ${p.minutes} minutes.`,
      heading: 'Reset your password',
      body:
        paragraph(`Hi ${name}, we received a request to reset the password for your Dellvit account. Enter this code to choose a new one:`) +
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr>${digits}</tr></table>` +
        note('Tap and hold the code (or double-click it) to copy it.') +
        paragraph(`<br>The code expires in <strong>${p.minutes} minutes</strong> and can be used once.`) +
        button(link, 'Reset my password') +
        note(
          'Never share this code. Dellvit staff will not ask for it. If you did not ask for this, ignore this email: your password stays the same.',
        ),
    }),
  };
}
/** Sent after the password changes through "Forgot password", so a stranger's reset does not go unseen. */
export function passwordChangedEmail(p: { to: string; name: string }): Mail {
  const name = escape(p.name.split(' ')[0] || 'there');
  return {
    to: p.to,
    subject: 'Your Dellvit password was changed',
    text: `Hi ${p.name.split(' ')[0] || 'there'},\n\nThe password for your Dellvit account was just changed, and every device was signed out.\n\nIf this was not you, reset your password now at ${site()}/forgot-password and contact us from ${site()}/contact.`,
    html: layout({
      preheader: 'The password for your Dellvit account was just changed.',
      heading: 'Your password was changed',
      body:
        paragraph(
          `Hi ${name}, the password for your Dellvit account was just changed. For your safety, every device that was signed in has been signed out.`,
        ) +
        paragraph('If you made this change, there is nothing else to do.') +
        button(`${site()}/forgot-password`, 'This was not me') +
        note('If you did not change your password, reset it again right away and contact us from the Contact page.'),
    }),
  };
}
/** What the administrator receives from the "Send test email" button. */
export function testEmail(to: string): Mail {
  return {
    to,
    subject: 'Dellvit email is working',
    text: 'This is a test email from your Dellvit store. Your SMTP settings are working, so customers will receive their verification codes.',
    html: layout({
      preheader: 'Your SMTP settings are working.',
      heading: 'Email is working',
      body:
        paragraph(
          'This is a test email from your Dellvit store. Your SMTP settings are working, so customers will receive their verification codes.',
        ) + note('You can change these details any time in Store settings.'),
    }),
  };
}
/** Sent once the email is verified. */
export function welcomeEmail(p: { to: string; name: string }): Mail {
  const name = escape(p.name.split(' ')[0] || 'there');
  return {
    to: p.to,
    subject: 'Welcome to Dellvit',
    text: `Hi ${p.name.split(' ')[0] || 'there'},\n\nYour email is verified and your Dellvit account is ready. Start ordering at ${site()}.`,
    html: layout({
      preheader: 'Your email is verified and your account is ready.',
      heading: `You're all set, ${name}`,
      body:
        paragraph(
          'Your email is verified and your account is ready. Order from outlets near you, track your rider live, and confirm each handover with a one-time code.',
        ) +
        button(`${site()}/search`, 'Start ordering') +
        note('Questions about an order? Reply from the Contact page and our team will help.'),
    }),
  };
}
