import { useRef } from "react";

/**
 * Guards a one-shot commit against StrictMode double-invoke and Enter-then-blur double-commit;
 * `tryCommit` returns false after the first call. `reset` re-arms it — used after an ASYNC
 * Standard Schema commit resolves with issues (editing stays open, see use-async-validate.ts):
 * without a reset, the guard would silently swallow every retry for the rest of that edit session.
 */
export function useCommitGuard() {
  const firedRef = useRef(false);
  return {
    tryCommit: () => {
      if (firedRef.current) return false;
      firedRef.current = true;
      return true;
    },
    reset: () => {
      firedRef.current = false;
    },
  };
}
