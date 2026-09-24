import { SandpackLayout, SandpackPreview, SandpackProvider } from "@codesandbox/sandpack-react";
import { toSandpackSetup, type PreviewSource } from "./previewSetup";

/**
 * Live preview of the generated app (owner decision, 24 Sep 2026: in-browser
 * Sandpack first). The code is bundled and run inside Sandpack's iframe on
 * `*.codesandbox.io`, a separate registrable domain, so it never runs on
 * the dashboard origin and cannot read its cookies or storage (AGENTS.md
 * rule 9). Loaded lazily so the dashboard bundle does not carry Sandpack.
 */
export default function AppPreview({ source }: { source: PreviewSource }) {
  const setup = toSandpackSetup(source);
  return (
    <SandpackProvider
      key={source.version}
      template="react"
      files={setup.files}
      customSetup={{ entry: setup.entry, dependencies: setup.dependencies }}
      options={{ externalResources: setup.externalResources, recompileMode: "delayed", recompileDelay: 400 }}
    >
      <SandpackLayout className="!h-full !rounded-md">
        <SandpackPreview className="!h-full" showOpenInCodeSandbox={false} showRefreshButton />
      </SandpackLayout>
    </SandpackProvider>
  );
}
