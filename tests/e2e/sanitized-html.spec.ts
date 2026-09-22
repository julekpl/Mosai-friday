import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * R7 — stored HTML is sanitized (MOSAI pack T1.7 / T0.7).
 *
 * The block CMS stores rich text as an HTML string and renders it on the app's
 * own origin, so an unsanitized sink is stored XSS. R7 has three parts:
 *
 *   1. Behaviour — the shipped `src/lib/sanitize.ts` (the one function every
 *      render sink calls) is loaded into a real browser and the payloads are
 *      run through it. A control proves the payloads *do* execute in this
 *      browser when they are not sanitized, so a passing test is meaningful.
 *   2. The render sink — the *real* `PageRenderer` is mounted in the browser
 *      with a malicious `richText` block, so the assertion is about the actual
 *      component the CMS renders, not a copy of it.
 *   3. Wiring — every `dangerouslySetInnerHTML` sink in `src/` must be wrapped
 *      in `sanitizeHtml`, so a new unsanitized sink fails the build.
 */

const PAYLOADS: Array<{ name: string; html: string }> = [
  { name: "script tag", html: `<p>ok</p><script>window.__r7 = "script"</script>` },
  { name: "img onerror", html: `<img src="x" onerror='window.__r7 = "img"'>` },
  { name: "svg onload", html: `<svg onload='window.__r7 = "svg"'></svg>` },
  { name: "javascript: link", html: `<a href="javascript:window.__r7 = 'link'">go</a>` },
  { name: "iframe", html: `<iframe src="https://example.com/"></iframe>` },
  { name: "onclick handler", html: `<div onclick='window.__r7 = "div"'>x</div>` },
];

const FORBIDDEN = /<(?:script|iframe|svg)|on[a-z]+\s*=|javascript:/i;

test("control: the payloads really execute in this browser when unsanitized", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const img = document.createElement("img");
    img.setAttribute("src", "definitely-not-an-image");
    img.setAttribute("onerror", 'window.__r7 = "control"');
    document.body.appendChild(img);
  });
  // Wait for the handler to fire instead of sleeping a fixed amount: the
  // failed-image event is immediate on most hosts but can take seconds under
  // load, which made this control flaky without changing what it proves.
  const fired = await page
    .waitForFunction(
      () => (window as unknown as { __r7?: string }).__r7 === "control",
      undefined,
      { timeout: 10_000 },
    )
    .then(() => true)
    .catch(() => false);
  expect(fired).toBe(true);
});

test("the shipped sanitizer strips every payload", async ({ page }) => {
  await page.goto("/");

  for (const payload of PAYLOADS) {
    const result = await page.evaluate(async (html) => {
      const mod = (await import("/src/lib/sanitize.ts")) as {
        sanitizeHtml: (value: unknown) => string;
      };
      const clean = mod.sanitizeHtml(html);

      const host = document.createElement("div");
      host.id = "r7-host";
      host.innerHTML = clean;
      document.body.appendChild(host);
      await new Promise((resolve) => setTimeout(resolve, 300));

      const dangerousAttrs: string[] = [];
      host.querySelectorAll("*").forEach((el) => {
        for (const attr of Array.from(el.attributes)) {
          if (attr.name.startsWith("on") || attr.value.toLowerCase().includes("javascript:")) {
            dangerousAttrs.push(`${el.tagName}:${attr.name}`);
          }
        }
      });

      const executed = (window as unknown as { __r7?: string }).__r7 ?? null;
      host.remove();
      (window as unknown as { __r7?: unknown }).__r7 = undefined;

      return { clean, executed, dangerousAttrs };
    }, payload.html);

    expect(result.executed, `${payload.name} executed`).toBeNull();
    expect(result.dangerousAttrs, `${payload.name} kept a dangerous attribute`).toEqual([]);
    expect(result.clean, `${payload.name} was not stripped`).not.toMatch(FORBIDDEN);
  }
});

test("the real page renderer strips every payload", async ({ page }) => {
  await page.goto("/");

  for (const payload of PAYLOADS) {
    const result = await page.evaluate(async (html) => {
      const mod = (await import("/tests/e2e/fixtures/render-page.tsx")) as {
        mountPageDocument: (doc: unknown, host: HTMLElement) => Promise<void>;
      };
      const doc = {
        schemaVersion: 1,
        blocks: [
          { id: "b1", type: "richText", version: 1, props: { html } },
        ],
      };

      const host = document.createElement("div");
      host.id = "r7-render-host";
      document.body.appendChild(host);
      await mod.mountPageDocument(doc, host);
      await new Promise((resolve) => setTimeout(resolve, 300));

      const markup = host.innerHTML;
      const dangerousAttrs: string[] = [];
      host.querySelectorAll("*").forEach((el) => {
        for (const attr of Array.from(el.attributes)) {
          if (attr.name.startsWith("on") || attr.value.toLowerCase().includes("javascript:")) {
            dangerousAttrs.push(`${el.tagName}:${attr.name}`);
          }
        }
      });

      const executed = (window as unknown as { __r7?: string }).__r7 ?? null;
      host.remove();
      (window as unknown as { __r7?: unknown }).__r7 = undefined;

      return { markup, executed, dangerousAttrs };
    }, payload.html);

    expect(result.executed, `${payload.name} executed`).toBeNull();
    expect(result.dangerousAttrs, `${payload.name} kept a dangerous attribute`).toEqual([]);
    expect(result.markup, `${payload.name} was not stripped`).not.toMatch(FORBIDDEN);
  }
});

/* ── Every dangerouslySetInnerHTML sink must go through the sanitizer ───── */

const SINK_ALLOWLIST = new Set([
  // `chart.tsx` builds a <style> block from the developer-provided chart config
  // (CSS custom properties), never from user or AI rich text.
  "src/components/ui/chart.tsx",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "_generated") continue;
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

test("every dangerouslySetInnerHTML in src/ is wrapped in sanitizeHtml", () => {
  const root = process.cwd();
  const offenders: string[] = [];

  for (const file of walk(join(root, "src"))) {
    const rel = relative(root, file).replace(/\\/g, "/");
    const source = readFileSync(file, "utf8");
    // Only real JSX usages (`dangerouslySetInnerHTML={{ … }}`), never a mention
    // in a comment — `sanitize.ts`'s own docstring says the word.
    const usage = /dangerouslySetInnerHTML\s*=\s*\{\{/g;
    let match = usage.exec(source);
    while (match !== null) {
      const snippet = source.slice(match.index, match.index + 200);
      if (!snippet.includes("sanitizeHtml(") && !SINK_ALLOWLIST.has(rel)) {
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${rel}:${line}`);
      }
      match = usage.exec(source);
    }
  }

  expect(offenders).toEqual([]);
});
