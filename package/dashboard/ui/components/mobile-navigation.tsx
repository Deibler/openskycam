import { BrandIndicator } from './brand-indicator';
import { BrandLogo } from './brand-logo';
import { Cpu, Activity, Check, Film, KeyRound, Keyboard, LogOut, Menu, Moon, RefreshCw, Sun } from 'lucide-react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

type View = 'recordings' | 'activity' | 'api' | 'models' | 'workshop';
type Props = {
  view: View;
  email?: string;
  cameras: string[];
  camera: string;
  theme: string;
  busy: boolean;
  refreshing: boolean;
  health: string;
  onView: (view: View) => void;
  onCamera: (camera: string) => void;
  onRefresh: () => void;
  onAppearance: () => void;
  onShortcuts: () => void;
};

export function MobileNavigation(p: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="mobile-menu-button" aria-label="Navigation menu">
          <Menu />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className="menu-content mobile-navigation-menu"
      >
        <DropdownMenuLabel className="mobile-menu-brand">
          <BrandLogo />
        </DropdownMenuLabel>
        <DropdownMenuGroup aria-label="Main navigation">
          <DropdownMenuItem
            aria-current={p.view === 'recordings' ? 'page' : undefined}
            onSelect={() => p.onView('recordings')}
          >
            <Film />
            Recordings{p.view === 'recordings' && <Check className="menu-current" />}
          </DropdownMenuItem>
          <DropdownMenuItem
            aria-current={p.view === 'activity' ? 'page' : undefined}
            onSelect={() => p.onView('activity')}
          >
            <Activity />
            Activity{p.view === 'activity' && <Check className="menu-current" />}
          </DropdownMenuItem>
          <DropdownMenuItem
            aria-current={p.view === 'models' ? 'page' : undefined}
            onSelect={() => p.onView('workshop')}
          >
            <Cpu />
            Workshop{p.view === 'models' && <Check className="menu-current" />}
          </DropdownMenuItem>
          <DropdownMenuItem aria-current={p.view === 'api' ? 'page' : undefined} onSelect={() => p.onView('api')}>
            <KeyRound />
            API access{p.view === 'api' && <Check className="menu-current" />}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {p.cameras.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Camera</DropdownMenuLabel>
            <DropdownMenuRadioGroup aria-label="Camera" value={p.camera} onValueChange={p.onCamera}>
              {p.cameras.map(camera => (
                <DropdownMenuRadioItem key={camera} value={camera}>
                  {camera.toUpperCase()}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={p.busy} onSelect={p.onRefresh}>
          {p.refreshing ? <BrandIndicator /> : <RefreshCw />}
          <span className="mobile-menu-refresh">
            {p.refreshing ? 'Refreshing…' : 'Refresh recordings'}
            <small>{p.health}</small>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={p.onAppearance}>
          {p.theme === 'dark' ? <Sun /> : <Moon />}
          {p.theme === 'dark' ? 'Light appearance' : 'Dark appearance'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={p.onShortcuts}>
          <Keyboard />
          Keyboard shortcuts
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{p.email ?? 'Signed in'}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href="/cdn-cgi/access/logout">
            <LogOut />
            Sign out
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
