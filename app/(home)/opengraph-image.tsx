import { ImageResponse } from "next/og";
import { generate as DefaultImage } from "fumadocs-ui/og";
import { appName } from "@/lib/shared";

export const alt = "gridcn: a data grid you own";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <DefaultImage title={appName} description="A React data grid for the shadcn ecosystem. One command copies the source into your app." site={appName} />,
    size,
  );
}
