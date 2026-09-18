"use client";

import { useEffect } from "react";

/** Dev-only: react-grab lets you hover any element and Ctrl+C its component stack + source location for an agent. Renders nothing; never bundles into production. */
export function ReactGrabDev(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    // bare side-effect import, per the package docs - the module auto-inits with its default
    // hotkeys/toolbar; calling its exported init() manually builds a bare engine without them.
    void import("react-grab");
  }, []);
  return null;
}
