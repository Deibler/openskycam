'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Popover as PopoverPrimitive, Dialog as DialogPrimitive } from 'radix-ui';
import { ArrowLeft, X } from 'lucide-react';
import { useLandscapeLayout } from '@/hooks/use-compact-layout';

const PanelContext = React.createContext(false);

function Popover({
  open,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const landscape = useLandscapeLayout();
  const [localOpen, setLocalOpen] = React.useState(defaultOpen);
  const Root = landscape ? DialogPrimitive.Root : PopoverPrimitive.Root;
  return (
    <PanelContext.Provider value={landscape}>
      <Root
        {...props}
        open={open ?? localOpen}
        onOpenChange={value => {
          setLocalOpen(value);
          onOpenChange?.(value);
        }}
      />
    </PanelContext.Provider>
  );
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  const panel = React.useContext(PanelContext);
  const Trigger = panel ? DialogPrimitive.Trigger : PopoverPrimitive.Trigger;
  return <Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  side,
  collisionPadding,
  panelBack,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & { panelBack?: () => void }) {
  const panel = React.useContext(PanelContext);
  const [viewport, setViewport] = React.useState<{ height: number; top: number } | null>(null);
  React.useEffect(() => {
    if (!panel || !window.visualViewport) return;
    const visual = window.visualViewport;
    const update = () => setViewport({ height: visual.height, top: visual.offsetTop });
    update();
    visual.addEventListener('resize', update);
    visual.addEventListener('scroll', update);
    return () => {
      visual.removeEventListener('resize', update);
      visual.removeEventListener('scroll', update);
    };
  }, [panel]);
  if (panel)
    return (
      <DialogPrimitive.Portal container={document.fullscreenElement ?? document.body}>
        <DialogPrimitive.Overlay className="landscape-panel-overlay" />
        <DialogPrimitive.Content
          {...props}
          aria-describedby={undefined}
          className={cn('landscape-panel', className)}
          data-slot="landscape-panel"
          style={
            {
              ...props.style,
              ...(viewport ? { '--panel-height': `${viewport.height}px`, '--panel-top': `${viewport.top}px` } : {}),
            } as React.CSSProperties
          }
        >
          <div className="landscape-panel-heading">
            {panelBack && (
              <button className="panel-back" type="button" aria-label="Back to player options" onClick={panelBack}>
                <ArrowLeft />
              </button>
            )}
            <DialogPrimitive.Title>{props['aria-label'] ?? 'Options'}</DialogPrimitive.Title>
            <DialogPrimitive.Close aria-label="Close panel">
              <X />
            </DialogPrimitive.Close>
          </div>
          <div className="landscape-panel-body">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  return (
    <PopoverPrimitive.Portal container={document.fullscreenElement ?? document.body}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        side={side}
        collisionPadding={collisionPadding}
        className={cn(
          'z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          className,
        )}
        {...props}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  const panel = React.useContext(PanelContext);
  if (panel) return null;
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="popover-header" className={cn('flex flex-col gap-1 text-sm', className)} {...props} />;
}

function PopoverTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <div data-slot="popover-title" className={cn('font-medium', className)} {...props} />;
}

function PopoverDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="popover-description" className={cn('text-muted-foreground', className)} {...props} />;
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverHeader, PopoverTitle, PopoverDescription };
