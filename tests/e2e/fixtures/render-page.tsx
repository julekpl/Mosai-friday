import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { PageRenderer } from "@/components/cms/PageRenderer";
import type { PageDocument } from "@/lib/cms/blocks";

/**
 * Test-only fixture (MOSAI pack T1.7).
 *
 * The Vite dev server serves project files, so a Playwright spec can
 * `import("/tests/e2e/fixtures/render-page.tsx")` inside the page and mount the
 * *real* `PageRenderer` — the same component the app ships — against a crafted
 * page document. That is how R7 asserts on the actual render sink rather than a
 * copy of it.
 *
 * It deliberately uses `react-dom/client` (already in the app's bundle and
 * pre-bundled by Vite) rather than `react-dom/server`: importing a module Vite
 * has not pre-bundled makes the dev server optimize and full-reload, which broke
 * other specs running in parallel.
 *
 * Not a test file, so Playwright does not collect it.
 */
export async function mountPageDocument(
  doc: PageDocument,
  host: HTMLElement,
): Promise<void> {
  const root = createRoot(host);
  root.render(createElement(PageRenderer, { doc }));
  // Let React commit before the caller inspects the DOM.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
