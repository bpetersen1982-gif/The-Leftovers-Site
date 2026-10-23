# Design direction

Brand boards from the design track (ChatGPT), saved in `brand-boards/`. They are **reference only**: nothing in this folder is served by the site.

| File | Content |
|---|---|
| `01-brand-moodboard.png` | Logos (clean, sticker, patch), palette, typography, textures, nav/button samples |
| `02-brand-board.png` | Logo variations incl. "TL" monogram, palette, type, page layout thumbnails, social icons |
| `03-brand-board.png` | Logo set, fonts, full homepage mock (hero, latest release, upcoming shows), music/about/photos/contact panels |
| `04-brand-kit.png` | Brush-stroke wordmark, patch set, homepage + Music/Shows/About/Media/Contact page mocks |
| `05-website-moodboard.png` | Homepage hero mock, "site vibe" rules, mood images |

All five are 1536×1024 composites.

## Tokens adopted (Wave 1)

Defined once in `src/app/tokens.css`; every component reads from these.

| Token | Value | Source / note |
|---|---|---|
| `--color-ink` (black) | `#0B0B0B` | Boards 1, 2, 3, 5 agree |
| `--color-charcoal` | `#252525` | Boards 1, 2 (board 5 uses `#2A2A2A`) |
| `--color-cream` (dirty cream) | `#D8CFBD` | Boards 1, 2 (board 5 uses `#D8D2C4`) |
| `--color-red` (blood red) | `#B52B2B` | Boards 1, 2. Used **sparingly** per board 5 |
| `--color-olive` | `#686448` | Boards 1, 2 |

| `--color-red-ui` | `#A42626` | Slightly darkened blood red for buttons with cream text (accessibility, below) |
| `--color-red-text` | `#E46464` | Lighter red for red text/links on dark backgrounds (accessibility, below) |

Contrast (WCAG 2.2 formula, computed): cream on ink 12.73:1, cream on charcoal 9.91:1 — both pass AAA. The board's blood red fails AA for normal-size text in both directions: cream on `#B52B2B` is 4.06:1 and `#B52B2B` on ink is 3.14:1 (AA needs 4.5:1). So:

- Buttons use `#A42626` with cream text: 4.71:1 (passes AA). Visually indistinguishable on dark backgrounds.
- Red text and links (e.g. the active nav item, "See all dates →") use `#E46464`: 5.91:1 on ink, 4.60:1 on charcoal.
- `#B52B2B` stays for non-text decoration only (stars, brush strokes, rules), where the 3:1 non-text minimum applies and is met on ink.
- Olive on ink is 3.29:1: decoration and borders only, never text.

| Role | Font (Google Fonts, SIL OFL, self-hosted at build via `next/font`) |
|---|---|
| Logo / big headlines | Rock Salt |
| Section headers, buttons, nav | Oswald (boards also show Bebas Neue; Oswald chosen for its wider weight range) |
| Body text | Special Elite (typewriter) |

Board 5 "site vibe" rules adopted as layout principles: dark textured backgrounds, torn-paper/cream panels for featured content, high-contrast black-and-white photos, red accents used sparingly.

## Asset pack (`asset-pack/`)

The Kiro asset pack (43 crops from one 1536×1024 board) is stored unmodified in `asset-pack/`. Every crop is small: logos ~315×166, photos ~369×134 at most, textures ~150×91. Their own README calls them prototype assets.

### Used in Wave 1 (copied to `public/brand/`)

| Site file | From | Where it's used | Why it works at this size |
|---|---|---|---|
| `logo-wordmark.png` | `logos/logo-primary-extracted.png` (315×166, transparent) | Header logo, rendered ≤150 px wide | ≥2× pixel density at that size, so sharp on phones and retina screens |
| `logo-sticker.png` | `logos/logo-sticker-extracted.png` | Footer badge, ≤140 px wide | Same |
| `icon-star.png` | `logos/icon-star-extracted.png` (165×162) | Favicon / app icon source (resized to 32, 48, 180 px) | Downscaled only |
| `star-red.png` | `elements/star-red.png` | Small accent beside section headers (~24 px) | Downscaled only |
| `brushstroke-red.png` | `elements/brushstroke-red.png` | Underline under headings and active nav (~120 px) | Close to native size |
| `tape-light.png` | `elements/tape-strip-light.png` | "Taped-on" corner of cream content panels (~90 px) | Native size |
| `texture-grunge.jpg` | `textures/grunge-dark.jpg` | Page background, low opacity, blended and stretched | Blurry when stretched, which is fine at low opacity; it reads as grime |
| `texture-paper.jpg` | `textures/dirty-paper.jpg` | Cream panel background, low opacity over the cream token | Same |
| `hero-placeholder.jpg` | `photos/hero-desktop.jpg` (369×134) | Home hero background, **temporary**, heavily darkened and blurred behind the logo | Far too small to show sharply; used only as dim atmosphere. Replaced by a real band photo (Admin-editable hero, Wave 3) |

Decorative images get empty alt text. The hero is decorative atmosphere, not a band photo, so it carries no caption or credit.

### Not used, and why

- **Band photos** (`photos/band-*.jpg`). These are generated people, not The Leftovers, and 140–246 px wide. Showing them as the band on Members/About would misrepresent you to venues. Your real photos replace them.
- **UI buttons and navigation** (`ui/`). Buttons and nav are built in HTML/CSS so they're accessible, translatable, and sharp at any size, as the pack's README recommends.
- **Remaining textures and elements.** Available for later waves; nothing here blocks them.

### Still needed before launch

1. Primary logo as **SVG**, or PNG at 2000 px+ with a transparent background. Needed for social share cards (1200×630) and anything printed.
2. The "TL" monogram from board 2, square, for the favicon/app icon (the star is the stand-in).
3. A real hero photo, at least 2400 px wide.
