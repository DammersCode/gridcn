import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import { Inter, Geist } from 'next/font/google';
import { cn } from "@/lib/utils";
import { ReactGrabDev } from "@/components/react-grab-dev";
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata } from "next";
import { Analytics } from '@vercel/analytics/next';

export const metadata: Metadata = {
  title: { default: "gridcn", template: "%s - gridcn" },
  description: "An editable, composable data grid for the shadcn/ui ecosystem.",
};

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({
  subsets: ['latin'],
});

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={cn(inter.className, "font-sans", geist.variable)} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <ReactGrabDev />
        <RootProvider>{children}</RootProvider>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
