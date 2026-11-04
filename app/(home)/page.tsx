import type { Metadata } from "next";
import { LandingBackground } from "@/components/landing/background";
import { LandingPage } from "@/components/landing/landing-page";

export const metadata: Metadata = {
  openGraph: {
    type: "website",
    url: "/",
    siteName: "gridcn",
    title: "gridcn",
    description:
      "Spreadsheet power for React: range selection, spreadsheet clipboard, typed cell editors, server data and virtualized rendering, smooth at 100k rows.",
  },
};

export default function HomePage() {
  return (
    <div className="relative flex flex-1 flex-col items-center">
      <LandingBackground />
      <LandingPage />
    </div>
  );
}
