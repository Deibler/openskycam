import { useState, type ReactNode } from 'react';
import { Activity, ChevronRight, Film, KeyRound, Menu, Moon, Sun } from 'lucide-react';
import { BrandLogo } from '../../../components/brand-logo';
import { useBackToClose } from '../../../hooks/use-back-to-close';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import type { WorkshopPage } from '../models/workflowInferencemodel';

export function WorkshopShell({
  page,
  title,
  theme,
  onTheme,
  onNavigate,
  onExit,
  children,
}: {
  page: WorkshopPage;
  title: string;
  theme: string;
  onTheme: () => void;
  onNavigate: (page: WorkshopPage) => void;
  onExit: (view: 'recordings' | 'activity' | 'api') => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useBackToClose(open, () => {
    setOpen(false);
    return true;
  });
  // The editor, review and bucket pages need the whole width; the editor and review also scroll within themselves.
  const editing = page === 'editor' || page === 'review' || page === 'bucket',
    fixed = page === 'editor' || page === 'review';
  const active = ['workflow', 'editor', 'run', 'review'].includes(page)
    ? 'overview'
    : page === 'bucket'
      ? 'buckets'
      : page;
  function navigate(page: WorkshopPage) {
    setOpen(false);
    onNavigate(page);
  }
  const navigation = (
    <>
      <nav className="wk-nav" aria-label="Workshop navigation">
        <span className="wk-nav-label">Workshop</span>
        {(
          [
            ['overview', 'Overview'],
            ['buckets', 'Buckets'],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            variant="ghost"
            aria-current={active === key ? 'page' : undefined}
            onClick={() => navigate(key)}
          >
            {label}
          </Button>
        ))}
        <span className="wk-nav-label">Resources</span>
        {(
          [
            ['models', 'Model library'],
            ['runs', 'Runs'],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            variant="ghost"
            aria-current={active === key ? 'page' : undefined}
            onClick={() => navigate(key)}
          >
            {label}
          </Button>
        ))}
      </nav>
      <div className="wk-sidebar-footer">
        <Button variant="ghost" onClick={() => onExit('recordings')}>
          <Film />
          Recordings
        </Button>
        <Button variant="ghost" onClick={() => onExit('activity')}>
          <Activity />
          Activity
        </Button>
        <Button variant="ghost" onClick={() => onExit('api')}>
          <KeyRound />
          API access
        </Button>
        <Button variant="ghost" onClick={onTheme}>
          {theme === 'dark' ? <Sun /> : <Moon />}
          {theme === 'dark' ? 'Light appearance' : 'Dark appearance'}
        </Button>
      </div>
    </>
  );
  return (
    <div className="wk-shell" data-editing={editing || undefined} data-fixed={fixed || undefined}>
      <a href="#workshop-content" className="skip-link">
        Skip to content
      </a>
      {!editing && (
        <aside className="wk-sidebar">
          <a href="/" className="wk-brand" aria-label="openskycam recordings">
            <BrandLogo decorative />
          </a>
          {navigation}
        </aside>
      )}
      <div className="wk-main">
        <header className="wk-topbar">
          <Button
            className="wk-mobile-menu"
            variant="ghost"
            size="icon"
            aria-label="Open Workshop navigation"
            onClick={() => setOpen(true)}
          >
            <Menu />
          </Button>
          <a href="/" className="wk-topbar-brand" aria-label="openskycam recordings">
            <BrandLogo decorative />
          </a>
          <span className="wk-crumb">Workshop</span>
          <ChevronRight aria-hidden="true" />
          <span className="wk-current-title">{title}</span>
          {editing && (
            <Button
              className="wk-appearance"
              variant="ghost"
              size="icon"
              onClick={onTheme}
              aria-label={theme === 'dark' ? 'Light appearance' : 'Dark appearance'}
            >
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
          )}
        </header>
        <main id="workshop-content" className="wk-content" tabIndex={-1}>
          {children}
        </main>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent placement="right" className="wk-navigation-dialog">
          <DialogTitle>Menu</DialogTitle>
          <DialogDescription className="sr-only">Browse workflows, buckets, and models.</DialogDescription>
          {navigation}
        </DialogContent>
      </Dialog>
    </div>
  );
}
