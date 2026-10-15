// CI flag for browser-mode tests; vitest.config.ts injects it via define (no process in the page).
interface ImportMetaEnv {
  readonly CI: boolean
}
