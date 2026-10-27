import { MailIcon, MapPinIcon } from 'lucide-react';

import { IttecLogoWhite } from '@/components/brand/logo';
import { SocialIcon } from '@/components/brand/social-icon';
import { event } from '@/config/event';

/** Dark footer matching the live site's navy footer: white logo, venue line, social links, copyright. */
export function SiteFooter() {
  const venueLine = `${event.venue.display} | ${event.dates.display}`;

  return (
    <footer className="on-dark mt-auto bg-footer text-footer-foreground">
      <div className="mx-auto max-w-6xl px-gutter py-10 md:px-6 md:py-12">
        <div className="grid gap-8 *:min-w-0 md:grid-cols-3 md:gap-6">
          <div className="space-y-3">
            <IttecLogoWhite />
            <p className="text-sm text-footer-muted">{event.fullName}</p>
            <p className="text-sm text-footer-muted">{event.theme}</p>
          </div>

          <div className="space-y-3">
            <h2 className="font-display text-eyebrow tracking-[0.14em] text-white uppercase">
              Venue
            </h2>
            <p className="text-sm leading-relaxed" data-testid="footer-venue">
              {venueLine}
            </p>
            <a
              href={event.venue.mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-tap items-center gap-2 text-sm font-medium text-brand-accent hover:underline"
            >
              <MapPinIcon className="size-4" aria-hidden="true" />
              View map location
            </a>
          </div>

          <div className="space-y-3">
            <h2 className="font-display text-eyebrow tracking-[0.14em] text-white uppercase">
              Stay connected
            </h2>
            <ul className="flex flex-wrap gap-3" aria-label="Social media">
              {event.social.map((link) => (
                <li key={link.network}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${event.organiser.name} on ${link.label} (opens in a new tab)`}
                    className="flex size-tap items-center justify-center rounded-full bg-white text-brand-primary shadow-icon transition-colors hover:bg-brand-accent"
                  >
                    <SocialIcon network={link.network} className="size-5" />
                  </a>
                </li>
              ))}
            </ul>
            <a
              href={`mailto:${event.contactEmail}`}
              className="inline-flex min-h-tap max-w-full items-center gap-2 text-sm font-medium break-all text-brand-accent hover:underline"
            >
              <MailIcon className="size-4 shrink-0" aria-hidden="true" />
              {event.contactEmail}
            </a>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-gutter py-5 text-center font-display text-xs tracking-[0.08em] text-footer-muted uppercase md:px-6">
          {event.copyright}
        </p>
      </div>
    </footer>
  );
}
