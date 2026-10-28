import Image from 'next/image';

import { event } from '@/config/event';
import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
  priority?: boolean;
}

/** ITTEC 2026 logo (navy/red/green on transparent). Source file is 160x81, so keep it at 160px or narrower. */
export function IttecLogo({ className, priority = false }: LogoProps) {
  return (
    <Image
      src="/brand/ittec2026.png"
      alt={`${event.shortName}: ${event.fullName}`}
      width={160}
      height={81}
      priority={priority}
      className={cn('h-auto w-[104px] md:w-[130px]', className)}
    />
  );
}

/** White ITTEC logo for dark surfaces (footer). */
export function IttecLogoWhite({ className, priority = false }: LogoProps) {
  return (
    <Image
      src="/brand/logo-white.png"
      alt={`${event.shortName}: ${event.fullName}`}
      width={334}
      height={169}
      priority={priority}
      className={cn('h-auto w-[150px]', className)}
    />
  );
}

/**
 * M.Bryan Consulting Limited corporate logo: the official asset served by the corporate website
 * (https://mbryanconsultinggroup.com/assets/img/MBC.webp, also its favicon), 436x300, unmodified.
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
