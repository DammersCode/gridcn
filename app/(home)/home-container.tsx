"use client";

import type { ComponentProps } from "react";

export function HomeContainer(props: ComponentProps<"main">) {
  return <div {...(props as ComponentProps<"div">)} className="home-layout flex flex-1 flex-col [--fd-layout-width:64rem]" />;
}
