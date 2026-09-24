import { describe, expect, it } from "vitest";
import {
  APP_SOURCE_LIMITS,
  STARTER_FILES,
  detectDependencies,
  mergeFiles,
  normalizeAppPath,
  parseGeneration,
  selectEditContext,
} from "@/shared/appBuilder/source";
import { toSandpackSetup } from "@/components/build/app/previewSetup";
import { starterSuggestions } from "@/components/build/app/suggestions";

describe("app source protocol", () => {
  it("accepts only safe src paths the template does not own", () => {
    expect(normalizeAppPath("./src/App.jsx")).toBe("src/App.jsx");
    expect(normalizeAppPath("/src/components/Hero.jsx")).toBe("src/components/Hero.jsx");
    for (const bad of ["../src/App.jsx", "src/../../x.js", "package.json", "vite.config.js", "src/.env", "src/a.exe", "public/index.html", "src/a b.jsx", ""]) {
      expect(normalizeAppPath(bad), bad).toBeNull();
    }
  });

  it("parses files, packages and explanation; flags truncated and refused paths", () => {
    const parsed = parseGeneration(`<explanation>Done.</explanation>
<package>framer-motion</package>
<file path="src/App.jsx">
\`\`\`jsx
export default function App() { return null; }
\`\`\`
</file>
<file path="tailwind.config.js">module.exports = {}</file>
<file path="src/components/Cut.jsx">export default function Cut() { return (`);
    expect(parsed.files).toEqual([{ path: "src/App.jsx", content: "export default function App() { return null; }" }]);
    expect(parsed.truncated).toEqual(["src/components/Cut.jsx"]);
    expect(parsed.rejected).toEqual(["tailwind.config.js"]);
    expect(parsed.packages).toEqual(["framer-motion"]);
    expect(parsed.explanation).toBe("Done.");
  });

  it("detects bare imports as dependencies and pins known versions", () => {
    const deps = detectDependencies(
      [{ path: "src/App.jsx", content: `import { X } from "lucide-react";\nimport a from "./a.jsx";\nimport "@scope/pkg/style.css";\nconst m = await import("date-fns/format");` }],
      ["bad name!"],
    );
    expect(deps).toEqual([
      { name: "@scope/pkg", version: "latest" },
      { name: "date-fns", version: "4.1.0" },
      { name: "lucide-react", version: "0.460.0" },
      { name: "react", version: "18.3.1" },
      { name: "react-dom", version: "18.3.1" },
    ]);
  });

  it("enforces size limits when merging", () => {
    expect(() => mergeFiles(STARTER_FILES, [{ path: "src/big.js", content: "x".repeat(APP_SOURCE_LIMITS.maxFileBytes + 1) }])).toThrow(/larger than/);
    const many = Array.from({ length: APP_SOURCE_LIMITS.maxFiles }, (_, index) => ({ path: `src/f${index}.js`, content: "" }));
    expect(() => mergeFiles(STARTER_FILES, many)).toThrow(/at most/);
  });

  it("puts App.jsx and files named in the request first in edit context", () => {
    const files = [
      { path: "src/components/Footer.jsx", content: "footer" },
      { path: "src/components/Header.jsx", content: "header" },
      { path: "src/App.jsx", content: "app" },
    ];
    expect(selectEditContext(files, "make the header dark").map((file) => file.path).slice(0, 2)).toEqual([
      "src/App.jsx",
      "src/components/Header.jsx",
    ]);
  });
});

describe("app preview setup", () => {
  it("maps a snapshot to Sandpack files with Tailwind loaded only in the iframe", () => {
    const setup = toSandpackSetup({ version: 1, files: STARTER_FILES, dependencies: [{ name: "react", version: "18.3.1" }] });
    expect(setup.entry).toBe("/src/main.jsx");
    expect(Object.keys(setup.files)).toEqual(expect.arrayContaining(["/public/index.html", "/src/App.jsx", "/src/main.jsx"]));
    expect(setup.dependencies).toEqual({ react: "18.3.1" });
    expect(setup.externalResources).toEqual(["https://cdn.tailwindcss.com"]);
  });
});

describe("starter suggestions", () => {
  it("builds first prompts from the idea, personas and journeys", () => {
    const suggestions = starterSuggestions({
      idea: "Let customers book tastings",
      personas: [{ name: "Carla", role: "Coffee lover", goals: ["to find new beans"] }],
      journeys: [{ name: "First visit", stages: [{ stage: "Discover" }, { stage: "Book" }, { stage: "Visit" }] }],
    });
    expect(suggestions[0]).toBe("Build the first version: Let customers book tastings. Design it for Carla (Coffee lover), who wants to find new beans.");
    expect(suggestions[1]).toContain("Discover, Book, Visit");
    expect(suggestions).toHaveLength(3);
  });
});
