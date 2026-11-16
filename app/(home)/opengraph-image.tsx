import { ImageResponse } from "next/og";
import { generate as DefaultImage } from "fumadocs-ui/og";
import { Logo } from "@/components/logo";
import { appName } from "@/lib/shared";

export const alt = "gridcn: a React data grid you own";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <DefaultImage
        title="A React data grid you own"
        description="Spreadsheet-style editing: range selection, paste from Excel, a fill handle and undo. One shadcn command copies the source into your app."
        site={appName}
        icon={<Logo width={48} height={48} color="white" />}
        primaryColor="rgba(255,255,255,0.25)"
        primaryTextColor="rgb(255,255,255)"
      />
    ),
    size,
  );
}
