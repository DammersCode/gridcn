import { useEffect, useState } from "react";

export const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export const RUNNERS: Record<PackageManager, string> = {
  pnpm: "pnpm dlx",
  npm: "npx",
  yarn: "yarn dlx",
  bun: "bun x",
};

const STORAGE_KEY = "gridcn-pm";
// module-scope pub/sub so every InstallCommand/ManualInstall on the page switches together (diceui behavior).
const listeners = new Set<(pm: PackageManager) => void>();

function readStoredManager(): PackageManager {
  if (typeof window === "undefined") return "pnpm";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return PACKAGE_MANAGERS.includes(stored as PackageManager) ? (stored as PackageManager) : "pnpm";
}

/** Persisted, cross-instance package-manager choice shared by every CLI/Manual tab on the page. */
export function usePackageManager(): [PackageManager, (pm: PackageManager) => void] {
  const [manager, setManager] = useState<PackageManager>("pnpm");

  useEffect(() => {
    setManager(readStoredManager());
    const listener = (pm: PackageManager) => setManager(pm);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const update = (pm: PackageManager) => {
    window.localStorage.setItem(STORAGE_KEY, pm);
    listeners.forEach((listener) => listener(pm));
  };
  return [manager, update];
}
