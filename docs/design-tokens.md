# Design tokens

Extracted on 2026-10-27 from the live ITTEC 2026 website
(<https://itteconference.mbryanconsultinggroup.com/>): the homepage HTML, its theme stylesheet
(`assets/css/style-default.min.css`), the site-specific overrides (`assets/css/general.css` and the
inline `<style>` blocks) and a pixel sample of the two logos.

Implemented in `apps/web/src/app/globals.css` as CSS variables (`--brand-*`) that feed both the
Tailwind theme (`bg-brand-primary`, `text-brand-muted`, `shadow-card`, ...) and the shadcn/ui
semantic variables (`--primary`, `--ring`, ...).

## Colours

| Token                     | Hex       | Where it is used on the site                                                                        |
| ------------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| `--brand-primary`         | `#002A5E` | Navy. 134 uses in the theme: headings, links, menu text, hover overlay on buttons, footer tint, logo |
| `--brand-primary-strong`  | `#001D42` | Derived: hover/pressed state of navy controls                                                       |
| `--brand-secondary`       | `#8B1C1C` | Dark red. All `.lgx-btn` buttons ("Register Now"), menu hover, sub-heading accent, logo "ITTEC"     |
| `--brand-secondary-strong` | `#6F1616` | Derived: hover/pressed state of red CTA buttons                                                     |
| `--brand-accent`          | `#FFB703` | Amber background of the "Hybrid Conference" label in the hero                                       |
| `--brand-accent-deep`     | `#EFA506` | Theme amber (20 uses): countdown, highlights, hover accents                                          |
| `--brand-green`           | `#3A8C47` | Green of "2026" in the logo; 13 theme uses. Decorative only (see contrast)                          |
| `--brand-surface`         | `#F1F1F1` | `body` background                                                                                   |
| `--brand-surface-raised`  | `#FFFFFF` | Header, cards, inputs, social icon circles                                                          |
| `--brand-surface-tint`    | `#F4F7FB` | Mobile menu hover background                                                                        |
| `--brand-line`            | `#E3E8EF` | Header and menu borders                                                                             |
| `--brand-text`            | `#323333` | Body copy (`rgba(50, 51, 51, 0.8)` in the theme)                                                     |
| `--brand-muted`           | `#5B6672` | Secondary text; the site uses `#555` on form text                                                   |
| `--brand-success`         | `#2E7A3B` | Derived: logo green darkened until white text passes AA                                              |
| `--brand-warning`         | `#EFA506` | Theme amber as a warning surface; always paired with navy text                                      |
| `--brand-warning-text`    | `#7A4F00` | Derived: warning text on white                                                                      |
| `--brand-danger`          | `#B42318` | Derived: error red, deliberately distinct from the red CTA buttons                                   |
| `--brand-footer`          | `#061D3F` | Derived from the footer's `rgba(0, 42, 94, 0.84)` navy overlay on a dark photo                       |
| `--brand-footer-foreground` | `#D9DFE8` | Footer body text                                                                                    |
| `--brand-footer-muted`    | `#9FB0C8` | Footer copyright (`rgba(255, 255, 255, 0.5)` on the site, lifted for contrast)                        |

Logo pixel sample (opaque, non-grey pixels): ITTEC 2026 logo is 88.6% `#00295D`, 8.3% `#891C1B`,
2.8% `#3B8B47`, which matches the stylesheet's navy, red and green within two units per channel.
The M.Bryan logo is blue (`#000F70` to `#021F7F`) and green (`#0DC212`); those colours are not used
in the ITTEC theme and are not tokens.

### shadcn/ui mapping

| shadcn variable          | Value                        |
| ------------------------ | ---------------------------- |
| `--background` / `--card` | white                        |
| `--foreground`           | `--brand-text`               |
| `--primary`              | `--brand-primary`            |
| `--secondary` / `--accent` | `#E9EEF5` (navy tint, hover states) with navy text |
| `--muted`                | `--brand-surface`            |
| `--destructive`          | `--brand-danger`             |
| `--border`               | `--brand-line`               |
| `--input`                | `#7F8B9A` (3.46:1 against white, meets the 3:1 non-text minimum) |
| `--ring`                 | `--brand-primary`; `--brand-accent` inside `.on-dark` surfaces |

## Typography

| Token            | Value                                   | Where it is used on the site                                                    |
| ---------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| `--font-sans`    | Poppins 300/400/500/600/700/800         | Body copy and the large section headings (`.lgx-heading .heading`, weight 900) |
| `--font-display` | Oswald 400/500/600/700                  | Buttons, menu links, sub-headings, hero title, footer copyright, hybrid label    |
| `--font-heading` | Poppins                                 | h1-h4 in the app (navy, bold)                                                   |
| `text-display`   | 42px / 1.15 / 800                       | Hero title on phones (site: 42px at small widths, 68px to 110px on desktop)      |
| `text-h1`        | 32px / 1.2 / 700                        | Page titles                                                                     |
| `text-h2`        | 24px / 1.3 / 700                        | Section titles                                                                  |
| `text-h3`        | 20px / 1.4 / 600                        | Card and fieldset titles                                                        |
| `text-eyebrow`   | 14px, letter-spacing 0.14em, uppercase  | Hybrid label and section sub-headings (Oswald)                                  |

Fonts are loaded with `next/font/google` in `apps/web/src/app/layout.tsx` and exposed as
`--font-poppins` and `--font-oswald`.

## Radii

| Token         | Value | Where it is used on the site                              |
| ------------- | ----- | --------------------------------------------------------- |
| `--radius-xs` | 2px   | Hybrid label, buttons at rest (site uses 0)               |
| `--radius-sm` | 4px   | CTA buttons at rest, small chips                          |
| `--radius-md` | 8px   | Inputs, selects, tabs, badges (site: 6px and 8px)         |
| `--radius-lg` | 16px  | Cards, dialogs, panels (14 uses of 16px in the theme)     |
| `--radius-xl` | 24px  | Large feature panels                                      |
| full          | 50%   | Social icon circles, avatar, progress bar                 |

Site buttons animate from 0 to 16px radius on hover; the `cta` button variant reproduces this.

## Shadows

| Token              | Value                                | Where it is used on the site      |
| ------------------ | ------------------------------------ | --------------------------------- |
| `--shadow-card`    | `0 1px 15px 1px rgb(52 40 104 / 0.10)` | Cards, header (10 uses)           |
| `--shadow-elevated`| `0 13px 35px rgb(0 0 0 / 0.10)`        | Hovered cards, modals, sticky bar |
| `--shadow-button`  | `0 8px 6px -6px rgb(50 51 51 / 0.40)`  | `.lgx-btn` buttons                |
| `--shadow-icon`    | `0 2px 10px rgb(52 61 71 / 0.20)`      | Footer social icon circles        |

## Spacing

Tailwind's 4px scale is kept. Additions:

| Token                  | Value | Purpose                                            |
| ---------------------- | ----- | -------------------------------------------------- |
| `--spacing-gutter`     | 16px  | Page side padding on phones (`px-gutter`)          |
| `--spacing-tap`        | 44px  | Minimum tap target (`min-h-tap`, `size-tap`)       |
| `--spacing-action-bar` | 80px  | Space reserved above the sticky action bar          |

Site section padding is 42px to 100px on desktop; pages use `py-6` on phones and `py-10` from md.

## Contrast (WCAG 2.1 AA)

All pairs used by the components were checked with the relative-luminance formula
(script output on 2026-10-27).

| Pair                                       | Ratio   | Result                               |
| ------------------------------------------ | ------- | ------------------------------------ |
| white on `--brand-primary`                 | 14.07:1 | AA                                   |
| white on `--brand-secondary`               | 9.21:1  | AA                                   |
| navy on `--brand-accent` (hybrid label)    | 8.06:1  | AA                                   |
| **white on `--brand-accent`**              | 1.75:1  | **Fails**: never put white text on amber. Amber always carries navy text, as the site does |
| **white on `--brand-green` `#3A8C47`**     | 4.18:1  | **Fails** for body text (passes 3:1 for large text and icons). Adjusted to `--brand-success` `#2E7A3B` (5.30:1) for badges, alerts and text |
| `--brand-warning-text` on white            | 7.13:1  | AA                                   |
| warning text `#7A4F00` on amber            | 4.08:1  | Large text only; warning badges therefore use navy on amber (8.06:1) |
| white on `--brand-danger`                  | 6.57:1  | AA                                   |
| `--brand-text` on white / on surface       | 12.67:1 / 11.22:1 | AA                         |
| `--brand-muted` on white / on surface      | 5.85:1 / 5.18:1 | AA                           |
| `--brand-footer-foreground` on footer      | 12.48:1 | AA                                   |
| `--brand-footer-muted` on footer           | 7.58:1  | AA (site's 50% white was lifted to pass) |
| `--brand-accent` on footer (links, focus)  | 9.58:1  | AA                                   |
| `--input` border on white                  | 3.46:1  | Meets the 3:1 non-text minimum       |
| navy focus ring on white / surface         | 14.07:1 / 12.45:1 | Meets 3:1                  |

Focus: every interactive element shows a 3px ring (`--ring`) with a 2px offset; on dark surfaces
(`.on-dark`) the ring switches to amber. Tap targets: buttons, inputs, selects, tabs, radio and
checkbox hit areas and footer icons are all at least 44px.

## Assets

| File                                   | Source                                         | Notes                                                                |
| -------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| `apps/web/public/brand/ittec2026.png`  | `/assets/img/ittec2026.png`                    | 160x81 px. Small: looks soft above 160px wide and in the 512px PWA icon |
| `apps/web/public/brand/logo-white.png` | `/assets/img/logo-white.png`                   | 334x169 px, white on transparent (footer)                            |
| `apps/web/public/brand/mbryan-logo.png`| `/assets/img/sponsors/Sponsor%20Logo%20PNG.png` | 203x103 px, renamed; M.Bryan Consulting organiser logo              |
| `apps/web/public/icons/*.png`          | Generated from `ittec2026.png` with sharp       | 192, 512, 512 maskable (20% safe zone), 180 Apple touch, 32 favicon |

A vector or 1024px version of the ITTEC logo would improve the PWA icons and the header on
high-density screens.
