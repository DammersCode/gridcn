"use client";

import type { ComponentProps } from "react";

export function HomeContainer(props: ComponentProps<"div">) {
  return <div {...props} className="home-layout flex flex-1 flex-col [--fd-layout-width:64rem]" />;
}
