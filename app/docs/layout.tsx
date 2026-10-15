import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { GitHubStarsLive } from '@/components/github-stars-live';
import { ThemeToggle } from '@/components/theme-toggle';
import { gitConfig } from '@/lib/shared';

export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...baseOptions()}
      githubUrl={undefined}
      themeSwitch={{ enabled: false }}
      sidebar={{
        // githubUrl/themeSwitch are suppressed above so fumadocs' toolbar pill stays empty and
        // hidden; everything lives in this single footer row instead.
        footer: (
          // fumadocs renders the footer inside a children array - React wants a key here.
          <div key="sidebar-footer" className="flex items-center gap-2">
            <a
              href="/llms.txt"
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              llms.txt
            </a>
            <div className="ms-auto flex items-center gap-1.5">
              <ThemeToggle />
              <GitHubStarsLive repo={`${gitConfig.user}/${gitConfig.repo}`} />
            </div>
          </div>
        ),
      }}
    >
      {children}
    </DocsLayout>
  );
}
