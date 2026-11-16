import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import { Geist } from 'next/font/google';
import { cn } from "@/lib/utils";
import { ReactGrabDev } from "@/components/react-grab-dev";
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata } from "next";
import { Analytics } from '@vercel/analytics/next';

export const metadata: Metadata = {
  metadataBase: new URL("https://gridcn.vercel.app"),
  title: { default: "gridcn", template: "%s - gridcn" },
  description:
    "An editable React data grid for shadcn/ui: range selection, spreadsheet clipboard, typed cell editors, validation and virtualized rows. Tested at 100,000 rows.",
};

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <ReactGrabDev />
        <RootProvider search={{ preload: false }}>{children}</RootProvider>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
