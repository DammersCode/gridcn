import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/'>) {
  return <HomeLayout {...baseOptions()} slots={{ container: (props) => <div {...props} className="home-layout flex flex-1 flex-col [--fd-layout-width:64rem]" /> }}>{children}</HomeLayout>;
}
