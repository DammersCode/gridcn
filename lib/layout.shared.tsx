import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { appName, appVersion, gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      // JSX supported
      title: (
        <span className="inline-flex items-center gap-2">
          <Logo className="size-[22px]" />
          {appName}
          <Badge variant="secondary">{appVersion}</Badge>
        </span>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    // ncdai/theme-toggle-effect-polygon needs the view-transition wrapper in ThemeToggle,
    // not fumadocs' stock ThemeSwitch.
    themeSwitch: {
      component: <ThemeToggle />,
    },
  };
}
