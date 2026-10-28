# Email setup and deliverability

Backlog E0-12 (SPF, DKIM, DMARC for the sending domain; magic-link delivery tested to Gmail,
Outlook and a corporate mailbox), E3-1 (invitations), E3-3 (magic-link sign-in) and T15
(deliverability).

The platform sends three kinds of email in Increment 1: invitations, sign-in links and the
delivery test. Reminders follow in E10. All of them go through one relay configured by
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM` (see `deploy/.env.example`).

## Sending identity

| Setting              | Recommended value                                                        |
| -------------------- | ------------------------------------------------------------------------ |
| Sending domain       | A dedicated subdomain of the organiser's domain, e.g. `mail.mbryanconsultinggroup.com`, so the platform's reputation never affects normal company mail |
| `MAIL_FROM`          | `ITTEC 2026 <conference@mail.mbryanconsultinggroup.com>` (display name + address on the sending domain) |
| `MAIL_CONTACT_EMAIL` | `conference@mbryanconsultinggroup.com`: Reply-To and the footer address delegates can actually write to |
| Envelope / bounce    | Set by the relay provider (its own bounce domain) and must be aligned with the sending domain for DMARC |

The reply address does not need to be on the sending subdomain, but the From address does.

## DNS records to add

Replace `mail.mbryanconsultinggroup.com` with the chosen sending domain and the provider values
with what the relay's dashboard shows. TTL 3600 is fine.

### 1. SPF (one TXT record on the sending domain)

```
mail.mbryanconsultinggroup.com.  TXT  "v=spf1 include:<provider-spf-include> -all"
```

Examples of the include: `include:sendgrid.net`, `include:_spf.brevo.com`,
`include:amazonses.com`, `include:spf.protection.outlook.com` (Microsoft 365 relay). Keep a single
SPF record per name and stay under 10 DNS lookups. `-all` is correct once the provider is the
only sender from that subdomain.

### 2. DKIM (CNAME or TXT records the provider generates)

The provider issues a selector (or two) and a public key. Typical shape:

```
s1._domainkey.mail.mbryanconsultinggroup.com.  CNAME  s1.domainkey.<provider>.
s2._domainkey.mail.mbryanconsultinggroup.com.  CNAME  s2.domainkey.<provider>.
```

or a TXT record `v=DKIM1; k=rsa; p=<public key>` for providers that do not use CNAMEs. Use a
2048-bit key. Click "verify" in the provider dashboard after the records propagate.

### 3. DMARC (TXT record on `_dmarc`)

Start in monitoring mode so nothing is blocked while SPF and DKIM are being verified:

```
_dmarc.mail.mbryanconsultinggroup.com.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@mbryanconsultinggroup.com; ruf=mailto:dmarc@mbryanconsultinggroup.com; fo=1; adkim=r; aspf=r"
```

After at least one week of aggregate reports showing 100% SPF/DKIM alignment for platform mail,
tighten the policy:

```
_dmarc.mail.mbryanconsultinggroup.com.  TXT  "v=DMARC1; p=quarantine; pct=100; rua=mailto:dmarc@mbryanconsultinggroup.com; adkim=r; aspf=r"
```

`p=reject` is the final step once quarantine has run clean for another week. If the organiser's
root domain has no DMARC record, add `_dmarc.mbryanconsultinggroup.com` with `p=none` and a
`rua` address too: receivers look there when the subdomain has no policy of its own.

### 4. Optional but recommended

- `MX` record on the sending subdomain pointing at the provider's inbound (or the organiser's
  mail server) so bounces to `conference@mail...` do not vanish; some receivers score domains
  without MX lower.
- `PTR`/reverse DNS is the provider's job; nothing to do on a shared relay.
- BIMI is not worth the effort for this volume.

## Configuring the SMTP relay provider

Any provider with SMTP submission works. Order of preference for this project: Brevo or
SendGrid (simple SMTP, EU data residency options, bounce webhooks), Amazon SES (cheapest, needs
production access request), or the organiser's Microsoft 365 tenant via an SMTP AUTH
connector (acceptable for 200 delegates, but limits are low and bounces are harder to collect).

1. Create a sender/domain in the provider, add the DNS records above, click verify.
2. Create an SMTP credential (API key) with send-only permission. Put it in `deploy/.env`:
   ```
   SMTP_HOST=smtp-relay.brevo.com   # provider value
   SMTP_PORT=587                    # STARTTLS; 465 for implicit TLS
   SMTP_USER=<login>
   SMTP_PASSWORD=<api key>
   MAIL_FROM="ITTEC 2026 <conference@mail.mbryanconsultinggroup.com>"
   MAIL_CONTACT_EMAIL=conference@mbryanconsultinggroup.com
   APP_URL=https://impact.example.com
   ```
   The API refuses to downgrade to plaintext on the relay (`requireTLS`).
3. Send the delivery test from the server and read the provider response:
   ```
   docker compose -f docker-compose.yml run --rm --no-deps api node dist/cli/mail-test.js you@example.com
   ```
4. Set a sending limit alert in the provider (200 delegates x a handful of emails is a few
   thousand a month; a spike means a bug or abuse).
5. Dedicated IP is not needed at this volume; a warmed shared pool from a reputable provider
   delivers better.

Local development uses Mailpit instead of a provider: `MAIL_TRANSPORT=mailpit`, inbox at
http://127.0.0.1:8025 (the Compose override starts it; `docker run -p 8025:8025 -p 1025:1025 axllent/mailpit:v1.32.0` works too).

## Bounce and complaint handling (plan for E3-1 / E10)

Invitation status must reflect bounces (E3-1: sent, bounced, accepted). The plan:

1. **Webhook endpoint** `POST /api/v1/webhooks/email/:provider` in the api, verified with the
   provider's signature or a secret in the URL, rate-limited, body size limited. Events handled:
   `bounce` (hard), `soft_bounce`, `spam_complaint`, `delivered`, `blocked`.
2. **Message tracking**: every send stores the provider message id against the invitation (or
   reminder) row, so a webhook event can be matched without searching by email address.
3. **Effects**:
   - hard bounce or complaint: mark the invitation `bounced` with `bounced_at`, add an
     `audit_log` row, stop all further automated mail to that delegate (a `mail_suppressed`
     flag on the delegate in E10), and surface the delegate in the admin "invitations" view
     for a manual email correction and resend;
   - soft bounce: retry once after 4 hours through the worker, then treat as hard;
   - delivered: set `sent_at` if not set, keep the provider id for support questions.
4. **Fallback without webhooks**: the worker polls the provider's events API hourly for the
   last 24 hours (Brevo and SendGrid expose this) so a misconfigured webhook never hides
   bounces.
5. **Inbound replies** to `MAIL_CONTACT_EMAIL` go to the organiser's normal mailbox; the
   platform does not parse replies.
6. **Logs** record message ids and event types only, never addresses or content.

## Manual deliverability checklist

Run before go-live (Increment 5 exit test) and again after any DNS or provider change. Use real
mailboxes you control; do not test with delegates.

| Step | Mailbox | What to check | Result |
| --- | --- | --- | --- |
| 1 | Gmail (personal) | Inbox, not Promotions/Spam. "Show original": SPF `PASS`, DKIM `PASS`, DMARC `PASS`, all on the sending domain | |
| 2 | Outlook.com / Hotmail | Inbox, not Junk. Headers show `spf=pass`, `dkim=pass`, `dmarc=pass` | |
| 3 | Corporate mailbox (Microsoft 365 or Google Workspace, ideally a Nigerian bank or ministry domain among the delegates' employers) | Inbox or quarantine? Ask the IT contact to whitelist the sending domain if quarantined | |
| 4 | iCloud (`@icloud.com`) | Inbox, not Junk; Apple Mail dark mode rendering | |
| 5 | All four | Logo visible, button renders red with white text and is tappable, link under the button is complete | |
| 6 | Phone (iOS Mail + Gmail app on Android, 360-390px wide) | Single column, no horizontal scrolling, text at least 16px, button at least 44px tall | |
| 7 | Dark mode on one phone | Text readable on the dark background, button still red/white, footer links visible (amber) | |
| 8 | Magic-link email | Link opens the app over HTTPS, works once, second click shows the "expired" message | |
| 9 | Invitation email | Reply goes to `MAIL_CONTACT_EMAIL`; "Sent by" footer names the organiser | |
| 10 | mail-tester.com (or Google Postmaster) | Score 9+/10; fix anything it flags | |
| 11 | Provider dashboard | Delivered 4/4, no bounces, no spam complaints | |

Record the date, the sending domain, the provider and the results in `docs/runbook.md` (E0-11).

## Template layer

Templates live in `apps/api/src/mail/templates/`. One layout (`renderLayout`) produces the HTML
and the plain-text part from the same content, so links are always in both. Branding (event
name, venue line, contact address, app URL) is passed in from the active event row and the mail
configuration; nothing event-specific is hard-coded. Unit tests check that every link is absolute,
that no placeholder leaks, that a plain-text part exists and that dark-mode CSS is present.

Rendering check: `pnpm --filter @mbc/api mail:test you@example.com --template invitation` with
`MAIL_TRANSPORT=mailpit`, then open http://127.0.0.1:8025. Screenshots of the three templates at
phone width in light and dark mode are in `docs/screenshots/email-*.png`.
