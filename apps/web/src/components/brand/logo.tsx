import Image from 'next/image';

import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
  priority?: boolean;
}

/**
 * M.Bryan Consulting Limited corporate logo: the official asset served by the corporate website
 * (https://mbryanconsultinggroup.com/assets/img/MBC.webp, also its favicon), 436x300, unmodified.
 * The platform's only logo since 2026-11-02, when the ITTEC 2026 event logo was removed: the
 * platform is built for reuse by future M.Bryan events, so nothing here is tied to one event.
 * Sized by height like the corporate site header (h-9 / h-10) so the oval mark keeps its shape.
 */
export function MbryanLogo({ className, priority = false }: LogoProps) {
  return (
    <Image
      src="/brand/mbryan-consulting.webp"
      alt="M.Bryan Consulting Limited"
      width={436}
      height={300}
      priority={priority}
      className={cn('h-9 w-auto md:h-10', className)}
    />
  );
}

/**
 * The same logo on a dark surface. The mark is dark green and navy on transparent, so it needs a
 * light panel behind it rather than a white-ink variant.
 */
export function MbryanLogoOnDark({ className, priority = false }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center rounded-md bg-white px-3 py-2', className)}>
      <MbryanLogo priority={priority} className="h-10 w-auto md:h-12" />
    </span>
  );
}
