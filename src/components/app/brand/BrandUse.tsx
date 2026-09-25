import { useId } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { Palette } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { BRAND_USES, brandApplies, type BrandUse } from "@/convex/lib/brandProfile";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { BRAND_USE_COPY } from "./brandUseCopy";

/** Brand tab: switch the brand on or off per area. Saves immediately. */
export function BrandUseSettings({ project }: { project: Doc<"projects"> }) {
  const uid = useId();
  const setUse = useMutation(api.projects.setBrandUse);
  return (
    <ul className="grid gap-2">
      {BRAND_USES.map((use) => {
        const on = brandApplies(project.brandUse, use);
        const id = `${uid}-${use}`;
        return (
          <li key={use} className="flex items-start justify-between gap-3 rounded-md border bg-card p-3">
            <div className="grid min-w-0 gap-0.5">
              <Label htmlFor={id} className="font-mono text-small">
                {BRAND_USE_COPY[use].name} <span className="font-normal text-muted-foreground">· {BRAND_USE_COPY[use].module}</span>
              </Label>
              <p id={`${id}-help`} className="font-mono text-caption text-muted-foreground">{BRAND_USE_COPY[use].detail}</p>
            </div>
            <Switch
              id={id}
              aria-describedby={`${id}-help`}
              checked={on}
              onCheckedChange={(checked) =>
                void setUse({ id: project._id, use, enabled: checked }).then(
                  () => toast.success(`${BRAND_USE_COPY[use].name}: brand ${checked ? "on" : "off"}`),
                  () => toast.error("Couldn’t change this setting"),
                )
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Module header chip: whether AI in this module writes with the brand, and a
 * link to change it. Honest about "no brand yet" and "off here".
 */
export function BrandUseChip({ projectId, use }: { projectId: Id<"projects">; use: BrandUse }) {
  const project = useQuery(api.projects.get, { id: projectId });
  if (!project) return null;
  const brand = project.brandProfile;
  const on = brandApplies(project.brandUse, use);
  const label = !brand ? "No brand yet" : on ? "Brand on" : "Brand off here";
  return (
    <Link
      to={`/app/${projectId}?edit=brand`}
      title={!brand ? "Set up your brand so AI writes in your voice" : on ? "AI here writes in your brand voice. Change in Edit project → Brand." : "AI here ignores your brand. Change in Edit project → Brand."}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-caption transition-colors hover:text-foreground",
        brand && on ? "border-terminal-green/40 bg-terminal-green-soft text-terminal-green-ink" : "text-muted-foreground",
      )}
    >
      <Palette className="size-3.5" aria-hidden="true" />
      {label}
    </Link>
  );
}
