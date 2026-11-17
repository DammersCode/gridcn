import type { Metadata } from "next";
import { LandingBackground } from "@/components/landing/background";
import { FooterLinks, LandingPage } from "@/components/landing/landing-page";

const title = "gridcn: a React data grid you own";
const description =
  "A React data grid for the shadcn ecosystem with range selection, paste from Excel, a fill handle, undo, server data and virtualized rows. One command copies the source into your app.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", siteName: "gridcn", title, description },
  twitter: { card: "summary_large_image", title, description },
};

export default function HomePage() {
  return (
    <>
      <main id="main" className="relative flex flex-1 flex-col items-center">
        <LandingBackground />
        <LandingPage />
      </main>
      <FooterLinks />
    </>
  );
}
