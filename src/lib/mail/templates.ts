import type { OutgoingEmail } from "./mailer";

/**
 * Transactional email templates. Every dynamic value is HTML-escaped; URLs are
 * generated server-side from APP_URL, never taken from user input.
 */

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const COLORS = { ink: "#0B0B0B", cream: "#D8CFBD", red: "#A42626" } as const;

function layout(params: { heading: string; body: string; actionLabel: string; actionUrl: string; footer: string }): string {
  const url = escapeHtml(params.actionUrl);
  return `<!doctype html>
<html lang="en"><body style="margin:0;background:${COLORS.ink};color:${COLORS.cream};font-family:Georgia,'Courier New',serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" style="max-width:520px;" cellpadding="0" cellspacing="0">
<tr><td style="font-size:28px;font-weight:bold;letter-spacing:1px;padding-bottom:24px;">THE LEFTOVERS <span style="color:${COLORS.red};">&#9733;</span></td></tr>
<tr><td style="font-size:20px;padding-bottom:12px;">${escapeHtml(params.heading)}</td></tr>
<tr><td style="font-size:16px;line-height:1.5;padding-bottom:24px;">${params.body}</td></tr>
<tr><td style="padding-bottom:24px;"><a href="${url}" style="display:inline-block;background:${COLORS.red};color:${COLORS.cream};text-decoration:none;padding:12px 20px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">${escapeHtml(params.actionLabel)}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:${COLORS.cream};opacity:0.8;">If the button doesn't work, copy this link into your browser:<br><a href="${url}" style="color:${COLORS.cream};word-break:break-all;">${url}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.5;padding-top:24px;opacity:0.8;">${escapeHtml(params.footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

export function inviteEmail(params: {
  to: string;
  inviteeName: string;
  inviterName: string;
  roleLabel: string;
  url: string;
  expiresHours: number;
}): OutgoingEmail {
  const intro = `${params.inviterName} invited you to the band site for The Leftovers as ${params.roleLabel}.`;
  const footer = `This invite works once and expires in ${params.expiresHours} hours. If you weren't expecting it, ignore this email.`;
  return {
    to: params.to,
    subject: "You're invited to The Leftovers band site",
    text: `Hi ${params.inviteeName},\n\n${intro}\n\nAccept your invite:\n${params.url}\n\n${footer}\n`,
    html: layout({
      heading: `Hi ${params.inviteeName},`,
      body: escapeHtml(intro),
      actionLabel: "Accept invite",
      actionUrl: params.url,
      footer,
    }),
  };
}

export function magicLinkEmail(params: { to: string; name: string; url: string; expiresMinutes: number }): OutgoingEmail {
  const footer = `This link works once and expires in ${params.expiresMinutes} minutes. If you didn't ask to log in, ignore this email; nobody can get in without it.`;
  return {
    to: params.to,
    subject: "Your login link for The Leftovers",
    text: `Hi ${params.name},\n\nLog in to The Leftovers band site:\n${params.url}\n\n${footer}\n`,
    html: layout({
      heading: `Hi ${params.name},`,
      body: "Here's your login link for The Leftovers band site.",
      actionLabel: "Log in",
      actionUrl: params.url,
      footer,
    }),
  };
}
