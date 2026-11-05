import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '../utils/utils';
import { PanelBottom, PanelRight } from '../_shared/icons';

export type PageHeaderProps = {
  title: string;
  badge?: string;
  /** Right-aligned controls, before the assistant trigger. */
  actions?: ReactNode;
  /**
   * Where the assistant opens. One prop: the trigger's icon and its label follow `opensIn`. `panel` opens beside the page, `sheet` over it.
   */
  assistant?: { opensIn: 'panel' | 'sheet'; onOpen: () => void; label?: string };
  className?: string;
};

export function PageHeader({ title, badge, actions, assistant, className }: PageHeaderProps) {
  const Opener = assistant?.opensIn === 'sheet' ? PanelBottom : PanelRight;
  return (
    <header className={cn('flex min-h-11 min-w-0 items-center gap-2', className)}>
      <h1 className="truncate text-sm font-semibold">{title}</h1>
      {badge ? <Badge variant="secondary">{badge}</Badge> : null}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {actions}
        {assistant ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={assistant.label ?? (assistant.opensIn === 'sheet' ? 'Open assistant over the page' : 'Open assistant beside the page')}
            onClick={assistant.onOpen}
          >
            <Opener aria-hidden />
          </Button>
        ) : null}
      </div>
    </header>
  );
}
