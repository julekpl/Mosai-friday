/**
 * Skip link (MOSAI pack T1.8, AGENTS.md rule 16).
 *
 * Rendered as the first focusable element in a layout so a keyboard user can
 * jump straight past the header/sidebar to the page's `#main-content` region.
 * It is visually hidden until focused.
 */
export function SkipLink({ targetId = "main-content" }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:border focus:border-ring focus:bg-background focus:px-4 focus:py-2 focus:font-mono focus:text-small focus:text-foreground focus:shadow-pop focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      Skip to content
    </a>
  );
}
