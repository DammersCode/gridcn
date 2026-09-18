// shadcn-ui/cn: zero-dep drop-in for clsx + tailwind-merge; ~13x faster than the classic
// clsx+tailwind-merge baseline on this repo's call shapes (scripts/bench-cn.mjs for the numbers).
export { cn } from "cn";
export type { ClassValue } from "cn";
