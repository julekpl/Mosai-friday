import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Loader2, Search, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type CatalogEntry = {
  modelId: string;
  name: string;
  contextLength?: number;
  promptUsdPerMillion?: number;
  completionUsdPerMillion?: number;
};

function usd(value: number | undefined): string {
  return value === undefined ? "—" : `$${value.toFixed(value < 1 ? 3 : 2)}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] : "Try again.";
}

/**
 * Operator view of the AI model allow-list: which OpenRouter models projects
 * may use and which one is the default. Prices come from OpenRouter's public
 * catalog at the time a model is added (per million tokens, USD).
 */
export function AiModelsTab() {
  const data = useQuery(api.aiModels.adminList, {});
  const upsert = useMutation(api.aiModels.adminUpsert);
  const setDefault = useMutation(api.aiModels.adminSetDefault);
  const remove = useMutation(api.aiModels.adminRemove);
  const browse = useAction(api.aiModels.adminCatalog);

  const [search, setSearch] = useState("");
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = async (key: string, task: () => Promise<unknown>, success: string) => {
    setBusyId(key);
    try {
      await task();
      toast.success(success);
    } catch (error) {
      toast.error("Couldn’t update models", { description: errorText(error) });
    } finally {
      setBusyId(null);
    }
  };

  const lookup = async () => {
    setBrowsing(true);
    try {
      setCatalog(await browse({ search: search.trim() || undefined }));
    } catch (error) {
      toast.error("Couldn’t load OpenRouter models", { description: errorText(error) });
    } finally {
      setBrowsing(false);
    }
  };

  const listed = new Set(data?.models.map((model) => model.modelId) ?? []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="px-4">
          <CardTitle className="font-mono text-h3">Models users can choose</CardTitle>
          <CardDescription className="font-mono text-caption">
            Every AI feature uses the project’s chosen model, or the default below. Disabled models are never used.
            {data && !data.models.some((model) => model.enabled)
              ? ` Nothing is enabled yet, so ${data.fallbackModelId} is used.`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          {data === undefined ? (
            <p className="flex items-center gap-2 font-mono text-caption text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
            </p>
          ) : data.models.length === 0 ? (
            <p className="font-mono text-caption text-muted-foreground">No models listed yet. Find one below and add it.</p>
          ) : (
            <ul className="divide-y">
              {data.models.map((model) => (
                <li key={model._id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-small font-medium">
                      {model.label}{" "}
                      {model.isDefault ? (
                        <Badge variant="outline" className="ml-1 font-mono text-caption text-terminal-green">
                          default
                        </Badge>
                      ) : null}
                    </p>
                    <p className="break-all font-mono text-caption text-muted-foreground">
                      {model.modelId} · in {usd(model.promptUsdPerMillion)} / out {usd(model.completionUsdPerMillion)} per 1M tokens
                      {model.contextLength ? ` · ${model.contextLength.toLocaleString()} context` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`enabled-${model._id}`} className="font-mono text-caption">
                      Enabled
                    </Label>
                    <Switch
                      id={`enabled-${model._id}`}
                      checked={model.enabled}
                      disabled={busyId !== null}
                      onCheckedChange={(enabled) =>
                        run(model._id, () =>
                          upsert({
                            modelId: model.modelId,
                            label: model.label,
                            description: model.description,
                            enabled,
                            contextLength: model.contextLength,
                            promptUsdPerMillion: model.promptUsdPerMillion,
                            completionUsdPerMillion: model.completionUsdPerMillion,
                          }), enabled ? "Model enabled" : "Model disabled")
                      }
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId !== null || model.isDefault || !model.enabled}
                    onClick={() => run(model._id, () => setDefault({ id: model._id as Id<"aiModels"> }), "Default updated")}
                  >
                    <Star className="size-3.5" aria-hidden="true" /> Make default
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${model.label}`}
                    disabled={busyId !== null || model.isDefault}
                    onClick={() => run(model._id, () => remove({ id: model._id as Id<"aiModels"> }), "Model removed")}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-4">
          <CardTitle className="font-mono text-h3">Add from OpenRouter</CardTitle>
          <CardDescription className="font-mono text-caption">
            Search OpenRouter’s public catalog (for example “claude”, “gpt”, “gemini”, “mistral”). Added models start enabled.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-4">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void lookup();
            }}
          >
            <Label htmlFor="model-search" className="sr-only">
              Search models
            </Label>
            <Input
              id="model-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search models"
              className="max-w-xs"
            />
            <Button type="submit" variant="outline" disabled={browsing}>
              {browsing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
              Search
            </Button>
          </form>
          {catalog !== null && catalog.length === 0 ? (
            <p className="font-mono text-caption text-muted-foreground" role="status">No models match.</p>
          ) : null}
          {catalog?.length ? (
            <ul className="max-h-96 divide-y overflow-y-auto rounded-md border" aria-label="OpenRouter models">
              {catalog.map((entry) => (
                <li key={entry.modelId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-small">{entry.name}</p>
                    <p className="break-all font-mono text-caption text-muted-foreground">
                      {entry.modelId} · in {usd(entry.promptUsdPerMillion)} / out {usd(entry.completionUsdPerMillion)} per 1M
                      {entry.contextLength ? ` · ${entry.contextLength.toLocaleString()} context` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={busyId !== null || listed.has(entry.modelId)}
                    onClick={() =>
                      run(entry.modelId, () =>
                        upsert({
                          modelId: entry.modelId,
                          label: entry.name.replace(/^[^:]+:\s*/, "").slice(0, 80) || entry.modelId,
                          enabled: true,
                          contextLength: entry.contextLength,
                          promptUsdPerMillion: entry.promptUsdPerMillion,
                          completionUsdPerMillion: entry.completionUsdPerMillion,
                        }), "Model added")
                    }
                  >
                    {listed.has(entry.modelId) ? "Added" : "Add"}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
