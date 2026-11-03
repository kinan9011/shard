import { cn } from "@/lib/utils";

/**
 * The Shard mark in one tone, the opposite of the theme: black on a light theme, white on a dark one.
 * The asset is black; `dark:invert` flips it, and every color scheme follows the `dark` class on <html>.
 */
export function BrandMark({ className }: { className?: string }) {
  return <img src="./brand/mark-mono.svg" alt="" aria-hidden="true" className={cn("shrink-0 dark:invert", className)} />;
}
