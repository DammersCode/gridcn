import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { GitHubStarsLive } from '@/components/github-stars-live';
import { gitConfig } from '@/lib/shared';

export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...baseOptions()}
      sidebar={{
        footer: (
          // fumadocs renders the footer inside a children array - React wants a key here.
          <div key="sidebar-footer" className="flex items-center justify-between px-2 py-1">
            <a href="/llms.txt" className="text-muted-foreground hover:text-foreground text-xs">
              llms.txt
            </a>
            <GitHubStarsLive repo={`${gitConfig.user}/${gitConfig.repo}`} />
          </div>
        ),
      }}
    >
      {children}
    </DocsLayout>
  );
}
