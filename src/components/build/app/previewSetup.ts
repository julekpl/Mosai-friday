import type { AppDependency, AppFile } from "@/shared/appBuilder/source";

export type PreviewSource = { version: number; files: AppFile[]; dependencies: AppDependency[] };

/** Tailwind's browser build, loaded inside the preview iframe only. */
export const PREVIEW_TAILWIND = "https://cdn.tailwindcss.com";

const PREVIEW_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App preview</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

/** Maps a stored snapshot to Sandpack's file map and package list. */
export function toSandpackSetup(source: PreviewSource) {
  const files: Record<string, string> = { "/public/index.html": PREVIEW_HTML };
  for (const file of source.files) files[`/${file.path}`] = file.content;
  const dependencies: Record<string, string> = {};
  for (const dependency of source.dependencies) dependencies[dependency.name] = dependency.version;
  const entry = files["/src/main.jsx"] !== undefined ? "/src/main.jsx" : "/src/index.jsx";
  return { files, dependencies, entry, externalResources: [PREVIEW_TAILWIND] };
}
