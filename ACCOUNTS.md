# Accounts and services

Every outside service the site depends on, what it's for, and where its secrets live
(requirements OPS-8). **Names only. Never put a secret value in this file.**

All accounts currently belong to Brandon Petersen. They're meant to move to band-owned
accounts later. Nothing in the code hardcodes an account ID; it's all environment variables,
so a move means updating the variables listed here.

| Service | Used for | Account / project | Cost |
|---|---|---|---|
| GitHub | Source code, CI (`.github/workflows/ci.yml`) | `bpetersen1982-gif/The-Leftovers-Site` (public) | Free |
| Railway | Hosting: `web` service (Next.js) and `Postgres` | Project `the-leftovers-site`, environment `production` | Usage-based |
| Cloudflare: Registrar | Domain `theleftoversband.com` (auto-renew on; expires 2027-10-22) | Brandon's Cloudflare account | ~$10/yr |
| Cloudflare: DNS | All DNS records; apex and `www` point to Railway (DNS only, not proxied) | Same | Free |
| Cloudflare: Email Routing | Forwards `booking@`, `hello@`, `copyright@` (one destination each) | Same | Free |
| Cloudflare: R2 | Photos. `leftovers-media-private` (uploads, unapproved), `leftovers-media-public` (approved only, served at `media.theleftoversband.com`) | Same | Free under 10 GB |
| Cloudflare: Stream | Video (Wave 3c) | Same | $5/mo + usage |
| Resend | Outgoing email from `mail.theleftoversband.com` (DKIM/SPF in Cloudflare DNS) | Brandon's Resend account | Free tier |

Not set up yet: Sentry (OPS-5), uptime checks (OPS-6), billing alerts (OPS-7), DMCA designated agent (LEG-2).

## Where secrets live

Production values are only in **Railway → the-leftovers-site → web → Variables**. Local
development uses `.env` (never committed; see `.env.example`). Rotating a secret means
updating it in Railway, which redeploys automatically.

| Variable | Secret? | Comes from |
|---|---|---|
| `LEFTOVERS_DATABASE_URL` | Yes | Railway reference `${{Postgres.DATABASE_URL}}` |
| `BETTER_AUTH_SECRET` | Yes | Random (`openssl rand -base64 32`). Rotating it logs everyone out. |
| `RESEND_API_KEY` | Yes | Resend → API Keys |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Yes | Cloudflare → R2 → API tokens (scoped to the two buckets) |
| `CF_STREAM_API_TOKEN` | Yes | Cloudflare → API Tokens (Stream: Edit) |
| `VAPID_PRIVATE_KEY` | Yes | Generated with `web-push`. Changing it breaks existing phone alert subscriptions. |
| `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` | No | Pair of the private key; contact address |
| `R2_ACCOUNT_ID` | No | Cloudflare account ID |
| `R2_PRIVATE_BUCKET`, `R2_PUBLIC_BUCKET`, `R2_PUBLIC_URL` | No | Bucket names and public domain |
| `APP_URL`, `MAIL_FROM`, `MAIL_REPLY_TO`, `MAIL_TRANSPORT`, `LOG_LEVEL` | No | Site configuration |
| `NODE_ENV`, `LEFTOVERS_ENV` | No | Both `production`; together they switch on production checks |

## Infrastructure as Code

The `web` service's build, start, health check, and domains are defined in
`.railway/railway.ts` (`railway config plan` to preview, `railway config apply` to apply).
It doesn't manage variables or the Postgres service.
