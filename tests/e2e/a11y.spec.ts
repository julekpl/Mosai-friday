import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Accessibility gate (MOSAI pack T1.5, rule 16).
 *
 * Runs axe on the two public entry points and fails on serious/critical
 * violations. A deliberately planted violation fails the build — that is the
 * gate this ticket has to prove.
 *
 * `KNOWN_VIOLATIONS` is a short, dated baseline of defects that already exist
 * on the tree and are owned by T1.8. It is not a blanket exemption: any rule
 * that is not listed fails, and each entry names the ticket that removes it.
 * Do not add an entry without a ticket.
 */
const KNOWN_VIOLATIONS: Record<string, string[]> = {
  // TODO(T1.8): the icon-only email submit button on the sign-in form has no
  // accessible name. T1.8 fixes the sign-in form and deletes this entry.
  "/auth": ["button-name"],
};

const PAGES = [
  { name: "landing", path: "/" },
  { name: "auth", path: "/auth" },
] as const;

for (const page of PAGES) {
  test(`${page.name} has no serious axe violations`, async ({ page: browserPage }) => {
    await browserPage.goto(page.path);

    const results = await new AxeBuilder({ page: browserPage }).analyze();
    const known = new Set(KNOWN_VIOLATIONS[page.path] ?? []);
    const serious = results.violations
      .filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      )
      .filter((violation) => !known.has(violation.id));

    expect(
      serious.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
      })),
    ).toEqual([]);
  });
}
