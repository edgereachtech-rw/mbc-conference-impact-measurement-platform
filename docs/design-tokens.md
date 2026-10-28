# Design tokens

Two identities share the platform and are kept separate on purpose:

- **ITTEC 2026 event identity** (navy, dark red, amber): used for the hero, the app shell, forms
  and emails. Verified on 2026-10-27 from the live conference website
  <https://itteconference.mbryanconsultinggroup.com/> (`assets/css/style-default.min.css`,
  `assets/css/general.css`, inline `<style>` blocks) and a pixel sample of the event logo.
- **M.Bryan corporate identity** (slate ink, emerald actions, Inter): used for the organiser band
  on the landing page and the corporate logo in the header. Verified on 2026-10-28 from the live
  corporate website <https://mbryanconsultinggroup.com/>: its HTML uses the Tailwind CSS default
  palette through utility classes (the page loads `cdn.tailwindcss.com` and configures only
  `fontFamily.sans = Inter`), so each colour below is the Tailwind v3 default value of the class
  the site uses. Inline hex values on the site: `theme-color #0f172a` (slate-900) and a video box
  background `#0b0b0b`.
- **Derived semantic colours** (success, warning, danger, hover shades, footer shades): not on
  either website; chosen for WCAG contrast and documented as derived.

All tokens live in `apps/web/src/app/globals.css` as CSS variables (`--brand-*`, `--corp-*`) and
are exposed to Tailwind (`bg-brand-primary`, `bg-corp-green`, ...) and to shadcn/ui's semantic
variables (`--primary`, `--ring`, ...). Components never hard-code hex values.

## A. ITTEC 2026 event identity (verified)

| Token                    | Hex       | Source and use on the conference site                                                                |
| ------------------------ | --------- | ---------------------------------------------------------------------------------------------------- |
| `--brand-primary`        | `#002A5E` | Navy. 134 uses in the theme: headings, links, menu text, button hover overlay, footer tint; logo text |
| `--brand-secondary`      | `#8B1C1C` | Dark red. All `.lgx-btn` buttons ("Register Now"), menu hover, sub-heading accent; logo "ITTEC"       |
| `--brand-accent`         | `#FFB703` | Amber background of the "Hybrid Conference" label in the hero (inline CSS)                           |
| `--brand-accent-deep`    | `#EFA506` | Theme amber (20 uses): countdown, highlights, hover accents                                           |
| `--brand-green`          | `#3A8C47` | Green of "2026" in the event logo; 13 theme uses. Decorative only (2.4:1 on white)                    |
| `--brand-surface`        | `#F1F1F1` | `body` background                                                                                    |
| `--brand-surface-raised` | `#FFFFFF` | Header, cards, inputs, social icon circles                                                           |
| `--brand-surface-tint`   | `#F4F7FB` | Mobile menu hover background                                                                         |
| `--brand-line`           | `#E3E8EF` | Header and menu borders                                                                              |
| `--brand-text`           | `#323333` | Body copy (`rgba(50, 51, 51, 0.8)` in the theme)                                                     |

Event logo pixel sample (opaque, non-grey pixels): 88.6% `#00295D`, 8.3% `#891C1B`, 2.8%
`#3B8B47`, matching the stylesheet navy, red and green within two units per channel.

## B. M.Bryan corporate identity (verified)

| Token                 | Hex       | Tailwind class on the corporate site and where it appears                                       |
| --------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `--corp-ink`          | `#0F172A` | `slate-900`: `theme-color`, dark buttons (`bg-slate-900`), headings (`text-slate-900`, 40 uses) |
| `--corp-ink-deep`     | `#020617` | `slate-950`: sticky header background (`bg-slate-950/90`)                                       |
| `--corp-text`         | `#475569` | `slate-600`: body text (41 uses)                                                                 |
| `--corp-muted`        | `#64748B` | `slate-500`: secondary text (13 uses)                                                            |
| `--corp-line`         | `#E2E8F0` | `slate-200`: card and section borders (77 uses)                                                  |
| `--corp-surface`      | `#F8FAFC` | `slate-50`: section backgrounds (22 uses)                                                        |
| `--corp-green-bright` | `#059669` | `emerald-600`: primary call-to-action buttons and green text on the site                         |
| `--corp-green`        | `#047857` | `emerald-700`: the site's button hover shade; used as our button base (see contrast)              |
| `--corp-green-text`   | `#065F46` | `emerald-800`: green text on light surfaces (site uses it twice; we use it for small text)       |
| `--corp-green-soft`   | `#ECFDF5` | `emerald-50`: tinted panels (32 uses)                                                            |
| `--corp-green-line`   | `#A7F3D0` | `emerald-200`: tinted borders                                                                    |
| `--font-corporate`    | Inter     | `fontFamily.sans` in the site's Tailwind config, weights 400 to 800 from Google Fonts            |

Corporate logo pixel sample (official asset, opaque non-grey pixels): deep blue `#052D78` /
`#041D7C` ("MBC" letters) and greens `#17AA2D` / `#18C21D` (tree and "C"). These logo colours are
**not** used as UI tokens: the bright green is 2.4:1 on white and the site itself does not use
them outside the logo.

## C. Derived semantic colours (not from either website)

| Token                      | Hex       | Why it exists                                                                                   |
| -------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `--brand-primary-strong`   | `#001D42` | Hover/pressed shade of navy controls                                                            |
| `--brand-secondary-strong` | `#6F1616` | Hover/pressed shade of red CTA buttons                                                          |
| `--brand-muted`            | `#5B6672` | Secondary text; the conference site uses `#555` on form text, lifted slightly for the grey page |
| `--brand-success`          | `#2E7A3B` | Event-logo green darkened until white text passes AA (5.30:1)                                   |
| `--brand-warning`          | `#EFA506` | Theme amber as a warning surface, always with navy text                                         |
| `--brand-warning-text`     | `#7A4F00` | Warning text on white (7.13:1)                                                                   |
| `--brand-danger`           | `#B42318` | Error red, kept distinct from the red CTA buttons so "Delete" never looks like "Submit"          |
| `--brand-footer`           | `#061D3F` | Approximates the conference footer's `rgba(0, 42, 94, 0.84)` navy overlay over a dark photo     |
| `--brand-footer-foreground`| `#D9DFE8` | Footer body text                                                                                 |
| `--brand-footer-muted`     | `#9FB0C8` | Footer copyright (site uses 50% white, lifted to 7.58:1)                                         |

These need design-owner sign-off; nothing else in the palette is invented.

### shadcn/ui mapping

| shadcn variable            | Value                                                                |
| -------------------------- | -------------------------------------------------------------------- |
| `--background` / `--card`  | white                                                                |
| `--foreground`             | `--brand-text`                                                       |
| `--primary`                | `--brand-primary`                                                    |
| `--secondary` / `--accent` | `#E9EEF5` (navy tint, hover states) with navy text                   |
| `--muted`                  | `--brand-surface`                                                    |
| `--destructive`            | `--brand-danger`                                                     |
| `--border`                 | `--brand-line`                                                       |
| `--input`                  | `#7F8B9A` (3.46:1 against white, meets the 3:1 non-text minimum)     |
| `--ring`                   | `--brand-primary`; `--brand-accent` inside `.on-dark` surfaces       |

## Typography

| Token            | Value                                  | Where it is used                                                                      |
| ---------------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| `--font-sans`    | Poppins 300/400/500/600/700/800        | Body copy and headings (conference site: body and `.lgx-heading .heading`, weight 900) |
| `--font-display` | Oswald 400/500/600/700                 | Buttons, menu links, sub-headings, hero title, footer copyright, hybrid label          |
| `--font-heading` | Poppins                                | h1-h4 in the app (navy, bold)                                                         |
| `--font-corporate` | Inter 400/600/700                    | Organiser band only (corporate site font)                                             |
| `text-display`   | 42px / 1.15 / 800                      | Hero title on phones (site: 42px at small widths, 68px to 110px on desktop)           |
| `text-h1`        | 32px / 1.2 / 700                       | Page titles                                                                           |
| `text-h2`        | 24px / 1.3 / 700                       | Section titles                                                                        |
| `text-h3`        | 20px / 1.4 / 600                       | Card, fieldset and organiser-band titles                                              |
| `text-eyebrow`   | 14px, letter-spacing 0.14em, uppercase | Hybrid label and section sub-headings (Oswald)                                        |

Fonts are loaded with `next/font/google` in `apps/web/src/app/layout.tsx` and exposed as
`--font-poppins`, `--font-oswald` and `--font-inter`.

## Radii

| Token         | Value | Where it is used                                                   |
| ------------- | ----- | ------------------------------------------------------------------ |
| `--radius-xs` | 2px   | Hybrid label, buttons at rest (conference site uses 0)             |
| `--radius-sm` | 4px   | CTA buttons at rest, small chips                                   |
| `--radius-md` | 8px   | Inputs, selects, tabs, badges (conference site: 6px and 8px)       |
| `--radius-lg` | 16px  | Cards, dialogs, panels (14 uses of 16px in the conference theme)   |
| `--radius-xl` | 24px  | Large feature panels (the corporate site uses 24px to 26px panels) |
| full          | 50%   | Social icon circles, corporate pill button, progress bar           |

Conference buttons animate from 0 to 16px radius on hover; the `cta` button variant reproduces
this. The corporate site uses pill (`rounded-full`) and 16px (`rounded-2xl`) buttons; the
organiser band uses the pill.

## Shadows

| Token               | Value                                  | Where it is used on the conference site |
| ------------------- | -------------------------------------- | --------------------------------------- |
| `--shadow-card`     | `0 1px 15px 1px rgb(52 40 104 / 0.10)` | Cards, header (10 uses)                 |
| `--shadow-elevated` | `0 13px 35px rgb(0 0 0 / 0.10)`        | Hovered cards, modals, sticky bar       |
| `--shadow-button`   | `0 8px 6px -6px rgb(50 51 51 / 0.40)`  | `.lgx-btn` buttons                      |
| `--shadow-icon`     | `0 2px 10px rgb(52 61 71 / 0.20)`      | Footer social icon circles              |

## Spacing

Tailwind's 4px scale is kept. Additions:

| Token                  | Value | Purpose                                      |
| ---------------------- | ----- | -------------------------------------------- |
| `--spacing-gutter`     | 16px  | Page side padding on phones (`px-gutter`)    |
| `--spacing-tap`        | 44px  | Minimum tap target (`min-h-tap`, `size-tap`) |
| `--spacing-action-bar` | 80px  | Space reserved above the sticky action bar   |

## Contrast (WCAG 2.1 AA)

Computed with the relative-luminance formula for every pair the components use.

| Pair                                                | Ratio             | Result                                                                                       |
| --------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------- |
| white on `--brand-primary`                          | 14.07:1           | AA                                                                                           |
| white on `--brand-secondary`                        | 9.21:1            | AA                                                                                           |
| navy on `--brand-accent` (hybrid label)             | 8.06:1            | AA                                                                                           |
| **white on `--brand-accent`**                       | 1.75:1            | **Fails**: amber always carries navy text, as the conference site does                       |
| **white on `--brand-green` `#3A8C47`**              | 4.18:1            | **Fails** for body text; adjusted to `--brand-success` (5.30:1) for badges, alerts and text  |
| `--brand-warning-text` on white                     | 7.13:1            | AA                                                                                           |
| white on `--brand-danger`                           | 6.57:1            | AA                                                                                           |
| `--brand-text` on white / on surface                | 12.67:1 / 11.22:1 | AA                                                                                           |
| `--brand-muted` on white / on surface               | 5.85:1 / 5.18:1   | AA                                                                                           |
| `--brand-footer-foreground` on footer               | 12.48:1           | AA                                                                                           |
| `--brand-footer-muted` on footer                    | 7.58:1            | AA                                                                                           |
| `--brand-accent` on footer (links, focus)           | 9.58:1            | AA                                                                                           |
| `--input` border on white                           | 3.46:1            | Meets the 3:1 non-text minimum                                                               |
| `--corp-ink` on white / on `--corp-surface`         | 17.85:1 / 17.0:1  | AA                                                                                           |
| `--corp-text` on white / on `--corp-surface`        | 7.58:1 / 7.24:1   | AA                                                                                           |
| white on `--corp-green` `#047857` (our button)      | 5.48:1            | AA                                                                                           |
| **white on `--corp-green-bright` `#059669`**        | 3.77:1            | **Fails** for normal text: the corporate site uses it as its button colour; we use emerald-700 instead and keep `#059669` for large text or decoration only |
| **`--corp-green-bright` as small text on white**    | 3.77:1            | **Fails**: the corporate site uses `text-emerald-600` for small text; we use `--corp-green-text` (7.68:1) |
| `--corp-green-text` on white / on `--corp-green-soft` | 7.68:1 / 7.29:1 | AA                                                                                           |
| `--corp-green` focus ring on white                  | 5.48:1            | Meets 3:1                                                                                    |
| **corporate logo green `#18C21D` on white**         | 2.39:1            | **Fails**: never used as text                                                                |

Focus: every interactive element shows a 3px ring (`--ring`) with a 2px offset; on dark surfaces
(`.on-dark`) the ring switches to amber; the organiser band's button uses an emerald-700 outline.
Tap targets: buttons, inputs, selects, tabs, radio and checkbox hit areas, footer icons and both
logo links are at least 44px.

## Assets

| File                                           | Source                                                                | Notes                                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `apps/web/public/brand/ittec2026.png`          | `https://itteconference.mbryanconsultinggroup.com/assets/img/ittec2026.png` | 160x81 px, unmodified. Small: soft above 160px wide and in the 512px PWA icon           |
| `apps/web/public/brand/logo-white.png`         | `https://itteconference.mbryanconsultinggroup.com/assets/img/logo-white.png` | 334x169 px, white event logo for dark surfaces (footer)                                 |
| `apps/web/public/brand/mbryan-consulting.webp` | `https://mbryanconsultinggroup.com/assets/img/MBC.webp` (header logo and favicon of the corporate site, alt "M.Bryan Consulting Limited") | 436x300 px, unmodified. Replaces the 203x103 copy previously taken from the conference site's sponsors folder |
| `apps/web/public/icons/*.png`                  | Generated from `ittec2026.png` with sharp                             | 192, 512, 512 maskable (20% safe zone), 180 Apple touch, 32 favicon                       |

## Unverified or open

- The corporate site exposes no brand guideline or named palette; the tokens above are the
  Tailwind defaults it visibly uses. If M.Bryan has official Pantone/hex values, replace section B.
- The corporate logo's own blue and green are not published as colour values; the pixel sample
  above is indicative only.
- A vector or 1024px version of the ITTEC logo would improve the PWA icons and the header on
  high-density screens.
