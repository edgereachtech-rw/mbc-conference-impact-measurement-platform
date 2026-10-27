import { Badge } from '@/components/ui/badge';
import { participationModeLabel, type ParticipationMode } from '@/config/event';
import { cn } from '@/lib/utils';

interface ParticipationBadgeProps {
  mode: ParticipationMode;
  className?: string;
}

/** Physical / Virtual participation badge shown next to the delegate name. */
export function ParticipationBadge({ mode, className }: ParticipationBadgeProps) {
  return (
    <Badge
      variant={mode === 'physical' ? 'accent' : 'default'}
      className={cn('font-display tracking-wider uppercase', className)}
      data-mode={mode}
    >
      {participationModeLabel[mode]}
    </Badge>
  );
}
