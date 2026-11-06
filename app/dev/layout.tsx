import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function DevLayout({ children }: { children: ReactNode }) {
  // The perf scripts set one of these flags to reach the bench pages on a production build.
  if (process.env.NODE_ENV === "production" && process.env["GRIDCN_DEV_PAGES"] !== "1" && !process.env["GRIDCN_DEV_ROUTES"]) notFound();
  return children;
}
