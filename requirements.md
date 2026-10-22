# The Leftovers — Band Website Requirements

Status: Draft v0.6, ready for design handoff (functional requirements only; visual/page design owned separately)
Band: The Leftovers, Lincoln, NE. 90s/2000s rock & alternative cover band.
Stack: Next.js (App Router) + TypeScript (strict) + PostgreSQL, hosted on Railway
Domain: `theleftoversband.com` (registered at Cloudflare). Booking contact: `booking@theleftoversband.com` (forwarding set up per DOM-2).

Requirement IDs (e.g. `BOOK-3`) are stable so we can reference them while iterating.
Priority: **P0** = launch (needed before the bigger gigs), **P1** = shortly after, **P2** = later.
See §0 for the build order.

### Changes from v0.5
- Wizard takes a performance time range ("from 8:00 PM to 12:00 AM") plus sets (1–4; 4 sets ≈ 4–4.5 hrs) (§6.3).
- Quotes expire after **3 days**. Minimum notice **7 days** for instant quotes (§6.5).
- Travel check simplified: ZIP-based "roughly an hour from Lincoln," no external services (§6.5).
- Pending and Booked dates are blocked from the wizard and quote accept; prospects use a "Contact the band about this date" form instead (BOOK-26, BOOK-27).
- One-claim-per-date DB constraint covers both Pending and Booked (BOOK-16).
- Deposits reserved for later (§6.11).
- §6 subsections renumbered (6.1–6.11).

### Changes from v0.4
- Rate matrix: Admins set an optional rate per event type × day category; any blank cell = contact path (§6.4).
- Travel: free within ~60 miles of Lincoln; farther venues go to the contact path (§6.5).
- Rate visibility is an Admin decision: entering or clearing rates controls whether quotes are shown.
- Launch build order added (§0).
- Accounts start under Brandon's personal GitHub/Railway/etc., with a planned transfer (OPS-8).

### Changes from v0.3
- Roster confirmed.
- Booking rebuilt as a wizard with sets (1 set ≈ 1 hour), optional per-set pricing, instant quote, and accept/decline (with optional 250-char note). No price configured = "we'll contact you" path (§6).
- Date states finalized: member out-of-office = **Limited**, hold = **Pending**, Admin-confirmed = **Booked**.
- Members see requests, bookings, and requester contact info; financials remain Admin-only.
- Admins see declined quotes and abandoned wizards (§6.10).
- Free phone push notifications for Admins (§7).
- Takedown notices accepted by email only; no public takedown button or form (§13).

- Section numbers shifted (new §7 Notifications) and BOOK IDs renumbered; IDs are stable from this version on.

---

## 0. Build Order

The P0 list is large. Built in this order, the site is useful (and can take bookings) after Milestone 2, and each milestone ships on its own.

| Milestone | Scope | Unlocks |
|---|---|---|
| **M1 — Foundation** | Repo, CI, Railway + Postgres, Cloudflare DNS/CDN, auth (invite, magic link, roles), audit log, security headers, base layout, Home/About/Members/Contact pages, privacy + copyright pages | Band can log in; site is live |
| **M2 — Booking** | Availability calendar, out-of-office, wizard, rate matrix, travel check, quotes + accept/decline, private link, booking inbox, conflict view, confirm/override, email + Web Push notifications, Shows list | **Venues can book** |
| **M3 — Media** | R2 photo upload pipeline, approval queue, deletion flow, albums, Cloudflare Stream video, takedown action | Photos/video from this weekend go live |
| **M4 — Fans** | Fan Wall (text + photo), moderation and overrides, mailing list, song list, press/booking kit page | Fan engagement |
| **M5 — Polish** | SEO/structured data, OG images, accessibility pass, funnel summary, P1 items | Launch-quality polish |

Until M3 ships, a few hand-picked photos can be placed as static files so the site doesn't look empty.

---

## 1. Architecture & Cost

### 1.1 Shape

One Next.js app on Railway (public site + admin area), one Railway Postgres, Cloudflare for storage, video, and CDN. Background work (emails, image processing, webhook handling, hold expiry) runs via a Postgres-backed job queue (pg-boss) inside the app process. Split into a separate worker service only if load requires it.

### 1.2 Media storage

| Media | Where | Notes |
|---|---|---|
| Photos | Cloudflare R2 + Cloudflare CDN | No egress fees; 10 GB free |
| Video | Cloudflare Stream | Transcoding, adaptive HLS streaming, thumbnails, global CDN. No ads, no recommendations, no automated Content ID scanning |
| Database | Railway Postgres | Metadata only |

Media never lives on the Railway volume or in Postgres. All uploads go browser → R2/Stream via short-lived signed upload URLs, never through the app server.

**Alternative considered:** self-transcoding video with ffmpeg on Railway and storing HLS segments in R2. Cheaper storage, but transcoding a 2-hour set burns Railway CPU (cost), adds a lot of code to maintain, and is slower. Not recommended unless Stream costs become a problem.

### 1.3 Estimated monthly cost (unverified; confirm current pricing before committing)

| Service | Expected |
|---|---|
| Railway (app + Postgres), Hobby plan | ~$5–10 |
| Cloudflare R2 (photos) | $0 under 10 GB |
| Cloudflare Stream | ~$5 per 1,000 minutes stored + ~$1 per 1,000 minutes watched |
| Cloudflare DNS/CDN, Turnstile, Web Analytics | $0 |
| Resend (email), Sentry (errors) free tiers | $0 |
| Domains (2) | ~$25/year total |

Target: **~$15–20/month** at launch. Example: 3 hours of video stored (180 min) and 5,000 minutes watched/month stays at or near Stream's minimum charge.

---

## 2. People, Roles & Permissions

### 2.1 People (confirmed; seed data)

| Name | Role |
|---|---|
| Erik Delaney | Admin (bootstrap) |
| Brandon Petersen | Admin (bootstrap; site operator) |
| Jim Meyers | Admin (invited) |
| Jake Meyers | Band Member (invited) |
| Mike Douglas | Band Member (invited) |

**Bootstrap:** Erik and Brandon are created as the first Admins by a one-time CLI command run against the database (`pnpm admin:bootstrap --email … --name …`), which is idempotent and refuses to run if it would change an existing user's role. Everyone else is invited from the admin area (AUTH-1).

**Email addresses are never committed** (the repo is public). They're passed as command arguments at bootstrap time or entered in the invite screen, and live only in the database.

Roles are assigned per user and can be changed by an Admin later. Role and band membership are separate: a public "Members" page entry (bio, instrument, photo) is not tied to login permissions.

### 2.2 Roles

- **Admin**: full control. Final say on all content, deletions, and bookings. Sees all booking financials.
- **Band Member**: adds photos (pending Admin approval), moderates fan photos and text, deletes own pending photos, sets own out-of-office dates, sees booking requests/bookings and requester contact info (so they can follow up), but never financial details. Cannot add videos, confirm bookings, or permanently delete published content.
- **Fan / Venue (public)**: no account. Views the site, posts to the Fan Wall, joins the mailing list, submits booking requests.

### 2.3 Permission matrix

| Action | Admin | Member | Public |
|---|:-:|:-:|:-:|
| View public site | ✓ | ✓ | ✓ |
| Post to Fan Wall | ✓ | ✓ | ✓ |
| Submit booking request | — | — | ✓ |
| Upload photos | ✓ (auto-approved) | ✓ (pending Admin approval) | — |
| Delete own pending (never-public) photos | ✓ | ✓ | — |
| Upload videos | ✓ | ✗ | — |
| Edit captions / alt text / credits | ✓ | ✓ (own pending uploads) | — |
| Approve / reject member uploads | ✓ | ✗ | — |
| Approve / reject fan posts and fan photos | ✓ (final) | ✓ (Admin can override) | — |
| Override a member's moderation decision | ✓ | ✗ | — |
| Request deletion of published content | ✓ | ✓ | — |
| Approve deletion / permanently delete | ✓ | ✗ | — |
| Edit page content (bio, about, etc.) | ✓ | ✗ | — |
| Mark out-of-office dates | ✓ (any member) | ✓ (own only) | — |
| Mark band-wide unavailable dates | ✓ | ✗ | — |
| View booking requests and bookings (dates, venue, event type, sets, notes) | ✓ | ✓ (read-only) | — |
| View requester contact info (name, phone, email) | ✓ | ✓ | — |
| Add internal notes / log "contacted" on a request | ✓ | ✓ | — |
| View booking financials (rates, quotes, budget, fill-in fees, deposits) | ✓ | ✗ | — |
| Configure per-set pricing | ✓ | ✗ | — |
| View declined quotes and abandoned wizards | ✓ | ✗ | — |
| Respond / hold / confirm / decline / override bookings | ✓ | ✗ | — |
| Send decline emails to requesters | ✓ | ✗ | — |
| Manage shows and lineups | ✓ | ✗ | — |
| Process copyright takedowns | ✓ | ✗ | — |
| Invite / remove users, change roles | ✓ | ✗ | — |
| Manage merch (future) | ✓ | ✗ | — |

Financial fields are excluded from Member responses at the query/API level, not just hidden in the UI.

### 2.4 Auth requirements

| ID | Requirement | Priority |
|---|---|---|
| AUTH-1 | No public sign-up. Admins invite users by email; invite links single-use, expire in 72h. | P0 |
| AUTH-2 | Login via email magic link and passkeys. No passwords stored. | P0 |
| AUTH-3 | Permissions enforced server-side on every read and mutation; UI hiding is cosmetic only. | P0 |
| AUTH-4 | Secure sessions: HttpOnly, Secure, SameSite=Lax cookies; sessions revoked on role change or removal. | P0 |
| AUTH-5 | The system must always have at least one Admin; the last Admin cannot be demoted or removed. | P0 |
| AUTH-6 | Audit log of all approvals, rejections, overrides, deletions, role changes, and booking decisions (actor, action, target, before/after state, UTC timestamp). | P0 |

---

## 3. Moderation & Approval Workflow

### 3.1 Decision hierarchy

```
Member decision  → takes effect immediately, Admin can override
Admin decision   → final (only another Admin action can change it)
```

### 3.2 Requirements

| ID | Requirement | Priority |
|---|---|---|
| APR-1 | Content states: `pending → approved` or `pending → rejected`. Only `approved` is public. | P0 |
| APR-2 | Admin uploads are approved on upload. Member photo uploads enter `pending` and require an Admin. | P0 |
| APR-3 | Fan posts and fan photos enter `pending`; a Member or Admin can approve or reject. | P0 |
| APR-4 | Each decision records who made it and their role. Member decisions show in an Admin "Recent member decisions" view, where an Admin can override (approve a rejected item or reject an approved one). Overrides are logged with an optional reason. | P0 |
| APR-5 | Once an Admin has decided an item, Members can no longer change it. | P0 |
| APR-6 | Members can permanently delete their own photos while still `pending` (never public). Once approved, deletion follows APR-7. | P0 |
| APR-7 | Deleting published content takes two steps. A Member or Admin marks it `deletion requested`, which hides it from the public immediately. An Admin then permanently deletes it or restores it. | P0 |
| APR-8 | Permanent deletion removes the file from R2/Stream and the DB record; the audit log entry remains. | P0 |
| APR-9 | Moderation queue with counts per type, bulk approve/reject, optional rejection reason. | P0 |
| APR-10 | Notifications: daily digest of pending items (Members: fan content; Admins: everything). Booking notifications per §7. | P0 |
| APR-11 | Concurrent decisions are race-safe: if two people act on the same item at once, the first write wins and the second sees a "this item was already handled" message (optimistic concurrency via version column). | P0 |

---

## 4. Media

| ID | Requirement | Priority |
|---|---|---|
| MED-1 | Photo upload (JPEG, PNG, HEIC, WebP): drag-and-drop, multi-file, progress, works well on phones (post-show uploads). | P0 |
| MED-2 | Validate MIME type, extension, and file signature server-side; size limit (25 MB/photo); server-generated filenames. | P0 |
| MED-3 | Strip EXIF/GPS metadata; convert HEIC; generate responsive AVIF/WebP sizes and a blur placeholder. | P0 |
| MED-4 | Alt text required before approval. Photo credit field. Optional link to a Show. | P0 |
| MED-5 | Albums/galleries with ordering and cover photo. | P0 |
| MED-6 | Admin video upload direct to Cloudflare Stream (resumable uploads for large files; configurable size limit, default 5 GB). | P0 |
| MED-7 | Video status `uploading → processing → ready → failed`, driven by Stream webhooks (signature-verified, idempotent). | P0 |
| MED-8 | Video fields: title, description, poster frame selection, captions (VTT upload), optional link to a Show. | P0 |
| MED-9 | Videos never autoplay with sound; player loads lazily with poster image first. | P0 |
| MED-10 | Video downloads disabled in the player. (This deters casual copying but cannot fully prevent it.) | P0 |
| MED-11 | Storage/minutes usage indicator in admin, with a warning threshold. | P1 |
| MED-12 | Clip trimming: Admin can publish a highlight segment from a longer uploaded video. | P2 |

---

## 5. Fan Feedback

| ID | Requirement | Priority |
|---|---|---|
| FAN-1 | Public Fan Wall: display name, message, optional email (never shown publicly), optional "which show were you at?" selector. | P0 |
| FAN-2 | Fans can attach one photo per post (same pipeline as MED-2/3, 10 MB limit). | P0 |
| FAN-3 | All fan content is pre-moderated per §3. | P0 |
| FAN-4 | Spam protection: Cloudflare Turnstile, honeypot, rate limit per IP, 1,000-char limit, links disallowed. | P0 |
| FAN-5 | Fan text rendered as plain text only (no HTML/Markdown), escaped on output. | P0 |
| FAN-6 | Featured posts: Admins/Members can pin approved posts to the home page or a show page. | P1 |
| FAN-7 | "Message the band" private feedback option (not posted publicly). | P1 |
| FAN-8 | Mailing list signup with double opt-in, stored in our DB, CSV export. | P0 |
| FAN-9 | Social links managed in settings. | P0 |

Fan video uploads are out of scope: storage cost and moderation burden.

---

## 6. Booking & Availability

### 6.1 Booking model

"Book us" is a **request**. A booking is real only when an Admin confirms it (price, times, details). Only one gig per day; when several prospects want the same date, Admins decide.

```
Prospect picks a date on the calendar
  ├─ Available / Limited
  │     → booking wizard (§6.3)
  │         ├─ Quote eligible (§6.5): rate set for event type + day,
  │         │  venue within ~60 mi, date ≥ 7 days out
  │         │     → instant quote (valid 3 days)
  │         │     → Accept / Accept + note / Decline / Decline + note
  │         │         ├─ Accept  → date becomes Pending → Admins notified → Admin confirms → Booked
  │         │         └─ Decline → recorded, Admins notified (no date change)
  │         └─ Not quote eligible
  │               → "Someone from The Leftovers will contact you" → Admins notified
  │               → Admin/Member follows up → Admin quotes manually / holds / confirms / declines
  ├─ Pending / Booked
  │     → no wizard, no quote → "Contact the band about this date" form (BOOK-26)
  │     → Admins notified (CONFLICT)
  └─ Unavailable → no requests
Confirming over an existing Pending/Booked date requires an explicit Admin override (§6.8).
```

### 6.2 Date states

When multiple apply, the highest in this table wins.

| Internal state | Public sees | What the prospect can do |
|---|---|---|
| Band-wide unavailable (Admin marks band off) | **Unavailable** | Nothing |
| Confirmed booking | **Booked** | "Contact the band about this date" form only |
| Accepted quote awaiting Admin confirmation, or manual Admin hold | **Pending** | "Contact the band about this date" form only |
| One or more members out of office | **Limited availability** | Booking wizard; quote if eligible |
| Nothing scheduled (unanswered requests and unaccepted quotes don't change state) | **Available** | Booking wizard; quote if eligible |

Dates less than 7 days out keep their state but are never quote eligible (§6.5).

The public never sees venue names for private bookings, who is out of office, or how many requests exist. Booked dates show public Show details only if the Admin published it as a Show.

### 6.3 Booking wizard

**Steps** (each validated before continuing; progress indicator; works on mobile):

1. **When**: date (from calendar or typed); performance time **from** (e.g. 8:00 PM) **to** (e.g. 12:00 AM), 15-minute increments, end may cross midnight; number of sets (1–4, pre-suggested from the time range, adjustable); event type (bar/club, festival, wedding, graduation, private party, corporate, other).
2. **Who**: contact name, email, phone, organization/venue name, venue street address, city, state, ZIP (ZIP required). Notice shown: "We save this information so the band can follow up with you."
3. **Details**: expected attendance, indoor/outdoor, sound/backline provided (Y/N/partial), message (optional).
4. **Result**: the quote (if eligible) or the contact message.

| ID | Requirement | Priority |
|---|---|---|
| BOOK-1 | Public availability calendar, **18 months** ahead: month view plus accessible list view. | P0 |
| BOOK-2 | Selecting an Available or Limited date launches the wizard with the date pre-filled. A "Flexible / not sure yet" option skips the date and uses the contact path. | P0 |
| BOOK-3 | Admin pricing settings: rate matrix (§6.4), min sets (1), max sets (4), quote validity (**3 days**), minimum notice (**7 days**), travel radius (§6.5). | P0 |
| BOOK-4 | Quote = sets × the per-set rate for that event type and day category. Shown with the breakdown, "Travel included", and the disclaimer: "This is an estimate. Your date is confirmed only after the band confirms times and details." Expiry shown as a date and time. | P0 |
| BOOK-5 | Quote is a stored snapshot (event type, day category, rate, sets, total, created/expiry). Later rate changes never alter existing quotes. | P0 |
| BOOK-6 | Prospect responses: **Accept**, **Accept with note**, **Decline**, **Decline with note**. Note is plain text, max 250 characters with a live counter (short enough to forward as a text message). | P0 |
| BOOK-7 | Not quote eligible: no price, no accept/decline. Message: "Thanks! Someone from The Leftovers will contact you to discuss your event." Request status `awaiting contact`. The prospect is not told which condition applied. | P0 |
| BOOK-8 | Prospect receives a confirmation email with a reference number and a private link to view their request/quote and respond later. Link uses a random token (stored hashed), scoped to that request only, expires with the quote (or 30 days for non-quoted requests). Responses are idempotent; a second click doesn't create a second response. | P0 |
| BOOK-9 | Validation: Zod on client and server, unknown fields rejected; phone and email format; date within the 18-month window; end time after start time (crossing midnight allowed); sets 1–4; Turnstile before the quote is shown; honeypot; rate limit per IP and per email. | P0 |
| BOOK-10 | Admin can send a manual or revised quote (e.g. a contact-path request, a short-notice date, or a distant venue with travel added); prospect is emailed the private link to respond. Previous quote is marked superseded. | P0 |
| BOOK-11 | Song requests (e.g. wedding first dance) linked to the song list. | P1 |
| BOOK-26 | **"Contact the band about this date"** form for Pending/Booked dates (and as a general "talk to us" option): name, email, phone, organization, event type, message (max 1,000 chars). Creates a request flagged CONFLICT, status `awaiting contact`, notifies Admins. Same spam protection as BOOK-9. | P0 |
| BOOK-27 | **Accepting a quote is race-safe.** At the moment of Accept, the server re-checks the date inside a transaction. If the date became Pending, Booked, or Unavailable since the quote was shown, or the quote expired, the accept is refused and the prospect sees: "This date was just taken. Contact the band about it," with the BOOK-26 form pre-filled. Enforced by the one-claim-per-date DB constraint (BOOK-16), not just an app check. | P0 |
| BOOK-28 | Sets suggestion from the time range: roughly 1 set per hour including breaks (4 sets ≈ 4–4.5 hours). If the chosen sets don't fit the time range, show a gentle warning but allow submission; Admin sees both. | P0 |

### 6.4 Rate matrix

Admins fill in a grid of **event type × day category**. Each cell is an optional per-set price. Blank = "require a quote" (contact path).

| Event type | Sun–Thu | Fri–Sat | Holiday / special dates |
|---|---|---|---|
| Bar / club | $ or blank | $ or blank | $ or blank |
| Festival | … | … | … |
| Wedding | … | … | … |
| Graduation | … | … | … |
| Private party | … | … | … |
| Corporate | … | … | … |
| Other | blank (always contact path) | blank | blank |

| ID | Requirement | Priority |
|---|---|---|
| RATE-1 | Rate matrix editable by Admins only. Values validated as positive whole dollars (stored as integer cents) up to a sane maximum. Saving shows a summary of which combinations will now show public prices. | P0 |
| RATE-2 | Day category determined from the event date in `America/Chicago`. | P0 |
| RATE-3 | "Holiday / special dates" column applies to Admin-listed dates (e.g. Dec 31, July 4). Not listed = normal day category. | P1 |
| RATE-4 | "Clear all rates" action switches the whole site to contact-path only (e.g. while rethinking pricing). | P0 |
| RATE-5 | Rate changes are audit-logged (old/new value, Admin). Existing quotes are unaffected (BOOK-5). | P0 |

### 6.5 Quote eligibility (travel & notice)

A request gets an instant quote only if **all** are true; otherwise it goes to the contact path.

| ID | Requirement | Priority |
|---|---|---|
| ELIG-1 | A rate exists for the event type + day category (§6.4). | P0 |
| ELIG-2 | Venue ZIP code's center is within the **Admin-configured travel radius** (straight-line miles, haversine) of the **Admin-configured origin**, using the bundled Census ZCTA table `data/zcta/zcta-2025.csv` (33,791 ZIPs, ~0.9 MB, public domain; see `data/zcta/README.md`). No external service, no API key. | P0 |
| ELIG-2a | Travel settings (Admin only): **radius in miles** (whole number, 1–500, default 60) and **origin ZIP** (default 68508, Lincoln; validated against the ZIP table). Lincoln is the default because it's central to where members live, not because everyone lives there. Changes apply to new quotes only, are audit-logged, and the settings screen previews sample towns inside/outside the radius (e.g. "Columbus 57 mi: inside"). | P0 |
| ELIG-3 | ZIP not found in the table (PO-box-only, business, typo, non-US) = not eligible → contact path. | P0 |
| ELIG-4 | Event date is at least **7 days** from today (America/Chicago). Admin-configurable. | P0 |
| ELIG-5 | Date is Available or Limited at the time of quoting (and re-checked at accept, BOOK-27). | P0 |
| ELIG-6 | Approximate distance from Lincoln stored on the request and shown to Admins. | P0 |

The ZIP check is approximate by design: good enough to separate "Lincoln / Omaha area" from "Kearney / Kansas City," which is the real decision. Admins can always quote manually (BOOK-10).

### 6.6 Request lifecycle

```
in progress (wizard started, contact entered)
  └─ abandoned (no submission after 24h)
submitted
  ├─ quoted → accepted  → confirmed (Booked) | declined by band
  │         → declined  (by prospect)
  │         → expired   (no response within 3 days)
  │         → blocked   (date taken before accept, BOOK-27 → becomes awaiting contact)
  └─ awaiting contact → contacted → quoted / held / confirmed / declined by band
any → withdrawn (prospect cancels via private link)
confirmed → released (override §6.8) | cancelled
```

### 6.7 Admin & member handling

| ID | Requirement | Priority |
|---|---|---|
| BOOK-12 | Booking inbox for Admins and Members: filter by status, date, conflict flag. Contact info (name, phone, email, venue) visible with tap-to-call and tap-to-email. Members do not see rates, quotes, budgets, or fees. | P0 |
| BOOK-13 | Members and Admins can add internal notes and log "contacted" with a short summary, so the band doesn't double-call a prospect. | P0 |
| BOOK-14 | **Conflict view**: for any date, Admin sees all requests, quotes, holds, and bookings side by side (venue, event type, sets, quote, response, note, attendance, distance from Lincoln). | P0 |
| BOOK-15 | Only Admins confirm. Confirming sets final start time, sets, agreed price, load-in time, and notes, then marks the date Booked. | P0 |
| BOOK-16 | **One claim per date.** A `DateClaim` row (kind PENDING or BOOKED) is created when a quote is accepted, an Admin places a hold, or an Admin confirms. A unique DB constraint on the date guarantees two people can never both get Pending/Booked for the same day. Pending → Booked updates the same claim. Override per §6.8. | P0 |
| BOOK-17 | Accepted quotes waiting on confirmation trigger Admin reminders at 24h and 72h. Pending claims don't auto-expire (an Admin must confirm or release), but manual Admin holds expire after a configurable period (default 7 days) unless renewed. | P0 |
| BOOK-18 | Decline emails to prospects are sent by Admins only: templated, editable before sending, sent from the booking address. Never sent automatically. | P0 |
| BOOK-19 | Members set their own out-of-office dates (single day or range, optional private note); date shows Limited. Admins can mark band-wide unavailable dates. | P0 |
| BOOK-20 | Confirmed booking converts into a Show in one click (public or private listing). Weddings/private parties default to private. | P0 |
| BOOK-21 | Dates stored as calendar dates; times stored UTC with venue IANA timezone (default `America/Chicago`). | P0 |
| BOOK-22 | Downloadable tech rider and stage plot PDFs (Admin uploads). | P0 |
| BOOK-23 | Private calendar feed (.ics, secret tokenized URL, revocable) for each user's phone calendar. Members' feed excludes financials. | P1 |
| BOOK-24 | Requests archived after 12 months; prospect personal data purged after 24 months; abandoned wizards purged after 90 days. | P1 |
| BOOK-25 | Deposits: see §6.11. | P2 |

### 6.8 Override (bumping a Pending or Booked date)

| ID | Requirement | Priority |
|---|---|---|
| OVR-1 | Holding or confirming a request on a date that already has a Pending or Booked claim requires an explicit Admin "Override" action: the existing claim's request moves to `released` and the new request takes the claim. | P0 |
| OVR-2 | Override requires a reason, is logged, and notifies the other Admin. | P0 |
| OVR-3 | Releasing does not auto-email the original prospect. Admin is prompted to contact them personally, then marks it "prospect notified." | P0 |
| OVR-4 | Override is a single DB transaction: release old + claim new succeed or fail together. | P0 |
| OVR-5 | Rare second gig on the same day: Admin can add a second claim slot for that date with typed confirmation. Never available through the public site. | P1 |

### 6.9 Lineup & fill-ins

| ID | Requirement | Priority |
|---|---|---|
| LINE-1 | Each booking/show has a lineup: which band members are playing. Defaults to all members. | P1 |
| LINE-2 | Admin can add fill-in musicians (name, instrument, contact, optional fee) to a show. Fill-ins have no login. | P1 |
| LINE-3 | Confirming a date where a member is out of office prompts the Admin: "Mike is out of office. Add a fill-in?" | P1 |
| LINE-4 | Fill-in fees are Admin-only. | P1 |

### 6.10 Booking funnel visibility (Admin only)

| ID | Requirement | Priority |
|---|---|---|
| FUN-1 | Admins see every prospect who reached the quote step and **declined**, with their contact info, quote, and note, so they can follow up or adjust pricing. | P0 |
| FUN-2 | Admins see **abandoned** wizards (contact info entered but never submitted), with how far they got. Saved only after step 2, with the notice shown at that step. | P0 |
| FUN-3 | Expired quotes (no response) listed with contact info. | P0 |
| FUN-4 | Simple summary: requests, quotes shown, accepted, declined, blocked, abandoned, confirmed, per month. | P1 |

### 6.11 Deposits (reserved, not built day 1)

| ID | Requirement | Priority |
|---|---|---|
| DEP-1 | Booking status model leaves room for a `deposit requested → deposit paid` step between Pending and Booked, without restructuring existing data. Day 1, Admins confirm directly. | P0 |
| DEP-2 | `deposit:manage` permission (Admin only) and a `deposits` feature flag defined from day 1, off. | P0 |
| DEP-3 | Deposit amount: Admin-configurable fixed amount or percentage of the agreed price. | P2 |
| DEP-4 | Payment via Stripe Checkout link emailed to the prospect (shared Stripe integration with merch, §10). Card data never touches our servers. | P2 |
| DEP-5 | Deposit status driven by verified, idempotent Stripe webhooks. Paying the deposit moves the date from Pending to Booked automatically (if Admin enables auto-confirm). | P2 |
| DEP-6 | Refund/forfeit handled by Admin in Stripe; site records the outcome. Cancellation policy text configurable. | P2 |

Deposit tables (`Deposit`, `Payment`) are designed here but not migrated until built.

---

## 7. Notifications

Goal: Admins get a phone alert within a minute of booking activity, at no cost.

**Recommended: Web Push (built into the site, free).** The admin area is installable as a phone app (PWA). Each Admin taps "Enable notifications" once per device. Works on Android and on iPhone (iOS 16.4+), but on iPhone the site **must be added to the Home Screen first** (Share → Add to Home Screen). No third-party service or per-message cost.

| ID | Requirement | Priority |
|---|---|---|
| NOT-1 | Web Push notifications (VAPID, standard Push API) for Admins; per-device subscriptions that users can view and revoke. Expired subscriptions cleaned up automatically. | P0 |
| NOT-2 | Push events: new request, **conflict** request, **quote accepted** (highest priority), quote declined, accepted quote waiting > 24h, hold expiring, override performed. | P0 |
| NOT-3 | Lock-screen content contains no phone numbers, emails, or prices. Example: "Quote accepted: Sat Jun 12, 2027 · Wedding · 3 sets". Tapping opens the request (login required). | P0 |
| NOT-4 | Every push is also sent as email, which serves as the backup and the record. | P0 |
| NOT-5 | Per-user notification preferences (which events, push and/or email). Members can opt into booking notifications (without financial details). | P0 |
| NOT-6 | Setup guide page in admin with iPhone and Android steps, and a "Send test notification" button. | P0 |
| NOT-7 | Fallback option if Web Push proves unreliable for someone: ntfy (free, open-source push app) using a private topic with access token, same no-PII payload rules. | P1 |

Options considered:
- **SMS (Twilio etc.)**: not free. Per-message fees plus required carrier registration fees. Revisit only if push isn't working out.
- **Carrier email-to-text gateways** (e.g. number@vtext.com): free, but carriers are shutting these down (AT&T discontinued theirs in 2025) and delivery is unreliable. Not recommended.
- **Email VIP alerts**: free and zero setup (mark the booking address as VIP on the phone). Fine as a stopgap until push is set up.

---

## 8. Shows

| ID | Requirement | Priority |
|---|---|---|
| EVT-1 | Upcoming / past public shows: date, time, venue, city, ticket link, status (upcoming, sold out, cancelled). | P0 |
| EVT-2 | Schema.org `MusicEvent` structured data for Google event results. | P0 |
| EVT-3 | Past shows link to their galleries, videos, and approved fan posts. | P1 |
| EVT-4 | "Add to calendar" (.ics) per show. | P1 |

---

## 9. Site Content

| ID | Requirement | Priority |
|---|---|---|
| CNT-1 | Admin-editable: Home, About/Bio, Members, Shows, Media, Fan Wall, Book Us, Contact. | P0 |
| CNT-2 | Rich text editor storing structured content (not raw HTML); sanitized on render. | P0 |
| CNT-7 | Empty content renders a deliberate empty state (e.g. Members page lists names and instruments with "Bio coming soon"), never lorem ipsum. Admins see an "Add bio" shortcut on empty sections. Band member bios and blurbs don't exist yet and are editable from day 1. | P0 |
| CNT-8 | Design-ready layout: all colors, fonts, spacing, and radii defined as design tokens (CSS custom properties consumed by Tailwind) in one file; page sections are composable components. Incoming designs (images + HTML from the design track) restyle tokens and components without touching data, routing, or business logic. Wave 1 ships a clean, accessible, mobile-first layout with no decorative imagery. | P0 |
| CNT-3 | Press / Booking kit page: short and long bio, downloadable hi-res press photos and logo, video highlights, sample setlist/song list, rider, booking contact. | P0 |
| CNT-4 | Song list page (searchable list of covers the band plays, by artist and decade). Venues and wedding clients look for this. | P0 |
| CNT-5 | Draft preview before publishing page changes. | P1 |

---

## 10. Merch (reserved, not built day 1)

| ID | Requirement | Priority |
|---|---|---|
| MER-1 | Payments via Stripe Checkout (hosted); we never handle card data. | P2 |
| MER-2 | Data model: `Product` (hat, patch, t-shirt) → `ProductVariant` (size, color, SKU, price in integer cents, stock) → `ProductImage`; `Order` → `OrderItem`; order status driven by verified Stripe webhooks. | P2 |
| MER-3 | Atomic inventory decrements (no overselling during a post-show rush). | P2 |
| MER-4 | Fulfillment: ship and/or "pick up at show". | P2 |
| MER-5 | Route `/merch` and nav slot reserved, hidden behind a feature flag. | P0 |
| MER-6 | `merch:manage` permission (Admin only) defined in the permission system from day 1. | P0 |
| MER-7 | Print-on-demand (Printful, etc.) considered vs. holding inventory. | P2 |

Merch tables are designed here but not migrated until the feature is built.

---

## 11. Quality Bar (non-functional)

| ID | Requirement | Priority |
|---|---|---|
| PERF-1 | Core Web Vitals on mobile (p75): LCP < 2.5s, INP < 200ms, CLS < 0.1. | P0 |
| PERF-2 | Public pages statically generated / ISR, revalidated on publish or approval. Calendar availability revalidated on any booking, hold, or out-of-office change. | P0 |
| PERF-3 | Cloudflare in front of Railway for CDN and caching. | P0 |
| SEO-1 | Titles, descriptions, canonical URLs, sitemap, robots.txt; admin routes `noindex`. | P0 |
| SEO-2 | Open Graph images for shows, albums, and home (good link previews on social). | P0 |
| SEO-3 | Schema.org `MusicGroup` (with `sameAs` social links) and consistent descriptor: **"The Leftovers — Lincoln, NE 90s & 2000s Rock Cover Band"**. Targets local searches like "cover band Lincoln NE" and "wedding band Lincoln" rather than competing with the HBO series. | P0 |
| SEO-4 | Google Business Profile for the band (free; the strongest local-search signal). | P0 |
| A11Y-1 | WCAG 2.2 AA target; automated axe checks in CI; manual keyboard and screen-reader pass before launch. | P0 |
| A11Y-2 | Calendar fully usable by keyboard and screen reader; list view alternative. Date states not conveyed by color alone. | P0 |
| A11Y-3 | Captions on videos with speech. | P1 |
| SEC-1 | Security headers: CSP, HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors. | P0 |
| SEC-2 | CSRF protection on all mutations; parameterized DB access only (Prisma). | P0 |
| SEC-3 | Rate limiting on all public forms and login. | P0 |
| SEC-4 | Secrets only in Railway environment variables. | P0 |
| PRIV-1 | Privacy policy covering booking data, fan posts, mailing list. Cookieless analytics (Cloudflare Web Analytics), no cookie banner. | P0 |
| PRIV-2 | Fans/requesters can request data removal; Admins can fulfill it. | P0 |

---

## 12. Operations

| ID | Requirement | Priority |
|---|---|---|
| OPS-1 | Environments: production + Railway PR preview environments. | P0 |
| OPS-2 | CI (GitHub Actions): lint, typecheck, tests, migration check on every PR. | P0 |
| OPS-3 | Prisma Migrate for versioned migrations. | P0 |
| OPS-4 | Daily Postgres backups with a restore tested before launch. | P0 |
| OPS-5 | Structured JSON logs with request IDs; Sentry (free tier). | P0 |
| OPS-6 | Uptime check on home page and booking endpoint. | P0 |
| OPS-7 | Billing alerts on Railway and Cloudflare. | P0 |
| OPS-8 | Accounts (GitHub, Railway, Cloudflare, Resend, Sentry, registrar) start under Brandon's personal accounts. To keep the later transfer to band-owned accounts simple: all config in environment variables, no account IDs hardcoded, and an `ACCOUNTS.md` listing every service, what it's used for, and where its secrets live (names only, never values). Domain registered with auto-renew on. | P0 |

---

## 13. Copyright & Takedowns

Self-hosting avoids YouTube/Facebook's *automated* matching, but it does not remove copyright obligations. Venue performance licenses (ASCAP/BMI/SESAC) generally cover the live performance in the room, not recorded video posted online. Rights holders can still send takedown notices to us, Cloudflare, or Railway. This is not legal advice; it's the operational setup to handle a notice quickly and avoid losing hosting.

| ID | Requirement | Priority |
|---|---|---|
| LEG-1 | Public "Copyright" page listing an **email address only** for takedown notices (`copyright@theleftoversband.com`, forwarded per DOM-2) and what a valid notice must include. There is **no public takedown button or form**; nothing the public does can unpublish content. | P0 |
| LEG-2 | Register a DMCA designated agent with the U.S. Copyright Office (small fee) to qualify for safe harbor on fan-submitted content. | P0 |
| LEG-3 | Admin-only "Takedown" action, used after an Admin reviews an emailed notice and judges it legitimate: unpublishes the item, records the notice (sender, work claimed, date, Admin who acted), logged in the audit log. Restore only by Admin. | P0 |
| LEG-4 | Video strategy favors short highlight clips over full-song or full-set recordings to reduce exposure. | P0 |
| LEG-5 | Terms of use for fan submissions (fan grants the band permission to display; fan confirms they took the photo). | P0 |

---

## 14. Domain & Handles

**Primary domain: `theleftoversband.com`** — registered 2026-10-22 at Cloudflare Registrar (expires 2027-10-22, auto-renew on). Nameservers: Cloudflare. Owner: Brandon (personal Cloudflare account; transfer per OPS-8).

Optional later: `theleftoverslnk.com` as a short redirect (appeared available 2026-10-22; not registered).

Social handles: not yet checked (Erik or another member to own this). Suggested: `@theleftoverslnk` or `@theleftoversband`, the same on every platform.

| ID | Requirement | Priority |
|---|---|---|
| DOM-1 | `theleftoversband.com` is the canonical host; `www.theleftoversband.com` 301-redirects to it. HTTPS only (HSTS). | P0 |
| DOM-2 | Inbound mail for `booking@`, `copyright@`, and `hello@` handled by Cloudflare Email Routing (free), forwarding to Admin inboxes. No paid mailbox needed at launch. | P0 |
| DOM-3 | Outbound site email (magic links, booking confirmations, notifications) sent via Resend from a dedicated subdomain (e.g. `mail.theleftoversband.com`) with SPF, DKIM, and DMARC, so it doesn't conflict with Email Routing on the root domain. | P0 |
| DOM-4 | Replies to site emails go to `booking@theleftoversband.com` (Reply-To), which forwards to Admins. | P0 |

Also recommended before printing merch: a quick USPTO trademark search on "The Leftovers" for entertainment/music services. Other bands have used the name; a regional cover band is low risk, but it's worth knowing before you spend money on shirts.

---

## 15. Tech Stack

Versions pinned to latest stable at project start.

| Layer | Choice |
|---|---|
| Runtime | Node.js 24 LTS |
| Framework | Next.js (App Router), React 19+, TypeScript strict |
| Package manager | pnpm |
| DB / ORM | PostgreSQL 16+ (Railway) / Prisma 7 |
| Validation | Zod |
| Auth | Better Auth (magic link + passkeys, custom roles), to be verified |
| Photos / CDN | Cloudflare R2 + Cloudflare CDN |
| Video | Cloudflare Stream |
| Email | Resend |
| Spam | Cloudflare Turnstile |
| Phone alerts | Web Push (PWA, VAPID), ntfy fallback |
| Jobs | pg-boss (Postgres-backed) |
| Analytics | Cloudflare Web Analytics |
| Errors | Sentry |
| Payments (future) | Stripe Checkout |
| Tests | Vitest + Playwright |

---

## 16. Data Model (day 1)

- **Auth & people:** `User` (role ADMIN | MEMBER), `Session`, `Invite`, `BandMember` (public profile: name, instrument, bio, photo, optional userId), `PushSubscription` (userId, endpoint, keys, device label), `NotificationPreference`.
- **Media & moderation:** `MediaAsset` (type PHOTO | VIDEO, status, storage key or Stream UID, alt, credit, uploaderId, version), `Album`, `AlbumItem`, `ModerationDecision` (itemType, itemId, decision, actorId, actorRole, reason, overridesDecisionId), `DeletionRequest`, `TakedownNotice`, `FanPost` (status, displayName, email, showId, photoAssetId).
- **Booking:** `PricingSettings` (minSets 1, maxSets 4, quoteValidityHours 72, minNoticeDays 7, travelRadiusMiles 60, origin lat/lng), `RateRule` (eventType, dayCategory SUN_THU | FRI_SAT | SPECIAL, ratePerSetCents; unique on eventType + dayCategory; absent row = contact path), `SpecialDate` (date, label), `ZipLocation` (bundled reference table: zip, lat, lng), `BookingRequest` (kind WIZARD | DATE_CONTACT, status, date, startLocalTime, endLocalTime, sets, eventType, contact fields, venue address fields, distanceMiles, details, wizardStep, isConflict, accessTokenHash, version), `DateClaim` (date, slot default 1, kind PENDING | BOOKED, requestId; unique on date + slot), `Quote` (requestId, eventType, dayCategory, ratePerSetCents, sets, totalCents, expiresAt, supersededById, response ACCEPTED | DECLINED, responseNote ≤250, respondedAt), `BookingNote` (authorId, kind NOTE | CONTACTED, body), `Booking` (requestId, date, agreed price, final times, load-in, status CONFIRMED | RELEASED | CANCELLED), `Hold` (requestId, expiresAt; manual Admin holds), `AvailabilityBlock` (date range, scope MEMBER | BAND, memberId, private note), `LineupEntry` (P1), `FillIn` (P1).
- **Shows & content:** `Show`, `Venue`, `Song`, `Page`, `Subscriber`, `SiteSettings`, `FeatureFlag`.
- **System:** `AuditLog`, `WebhookEvent`.

All timestamps UTC. Money stored as integer cents.

---

## 17. Open Questions

Resolved: rate matrix (§6.4), day categories, travel (~1 hour / 60 mi ZIP check, §6.5), sets 1–4, quote validity 3 days, deposits later (§6.11), 7-day minimum notice, Pending dates blocked (BOOK-26/27), rate visibility, build order (§0), account ownership (OPS-8), brand assets (ChatGPT track).

Also resolved: "we'll contact you" message makes no response-time promise; "from–to" time is the prospect's requested performance time (rates don't vary by time of day); ZIP data pulled (`data/zcta/`).

No open questions block the build.

**Pending from you / band**
- Domains (Brandon), social handles (Erik or another member), booking/copyright mailboxes once the domain is set up, launch photos/video (this weekend).

---

## 18. Out of Scope (for now)

- YouTube or other third-party video hosting
- Fan accounts and fan video uploads
- Own cart/checkout (Stripe Checkout when merch ships)
- Automatic booking confirmation
- Contracts and e-signatures
- Live streaming, native apps
