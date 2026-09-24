import { cn } from "@/lib/utils"

/* Loading placeholder. Light mode sweeps a soft shimmer across the block;
 * dark mode keeps a gentle pulse (the shimmer highlight is tuned for light
 * paper). Both stop under prefers-reduced-motion and the block stays a
 * static muted shape. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "bg-accent rounded-md animate-mosaic-shimmer dark:bg-none dark:animate-pulse motion-reduce:animate-none motion-reduce:bg-none",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
