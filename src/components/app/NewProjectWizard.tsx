import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const steps = [
  { key: "name", label: "What should we call this project?" },
  { key: "about", label: "What does the business do?" },
  { key: "audience", label: "Who are you trying to reach?" },
] as const;

export function NewProjectWizard() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [industry, setIndustry] = useState("");
  const [description, setDescription] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [goals, setGoals] = useState("");
  const [kpis, setKpis] = useState("");
  const [channels, setChannels] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const create = useMutation(api.projects.create);
  const navigate = useNavigate();

  const split = (s: string) =>
    s
      .split(/[,\n]/)
      .map((x) => x.trim())
      .filter(Boolean);

  const handleFinish = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      const id = await create({
        name: name.trim(),
        businessName: businessName.trim() || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
        industry: industry.trim() || undefined,
        description: description.trim() || undefined,
        competitors: split(competitors),
        goals: split(goals),
        kpis: split(kpis),
        channels: split(channels),
      });
      toast.success("Project created", {
        description: "Start in Understand — build your first persona.",
      });
      navigate(`/app/${id}/understand`);
    } catch (e) {
      toast.error("Could not create project", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-2 font-mono text-caption text-muted-foreground">
        {steps.map((s, i) => (
          <span key={s.key} className="flex items-center gap-2">
            <span
              className={
                i === step
                  ? "rounded-full border border-terminal-green/60 bg-terminal-green-soft px-2 py-0.5 text-terminal-green"
                  : "rounded-full border px-2 py-0.5"
              }
            >
              {i + 1}. {s.label.split(" ")[0].toLowerCase()}
            </span>
            {i < steps.length - 1 && <span>—</span>}
          </span>
        ))}
      </div>

      {step === 0 && (
        <div className="grid gap-4">
          <div>
            <h1 className="font-mono text-h1">New project</h1>
            <p className="mt-1 font-mono text-caption text-muted-foreground">
              A project is the container for personas, content, connections and
              every module you switch on.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="np-name">Project name</Label>
            <Input
              id="np-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Nord Coffee Roasters"
              autoFocus
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="np-biz">Business name</Label>
              <Input
                id="np-biz"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="np-url">Website</Label>
              <Input
                id="np-url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-4">
          <div>
            <h1 className="font-mono text-h1">About the business</h1>
            <p className="mt-1 font-mono text-caption text-muted-foreground">
              This context feeds personas, content and every insight later.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="np-desc">What does the business do?</Label>
            <Textarea
              id="np-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="One or two honest sentences."
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="np-ind">Industry</Label>
              <Input
                id="np-ind"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="e.g. DTC coffee"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="np-comp">Competitors</Label>
              <Input
                id="np-comp"
                value={competitors}
                onChange={(e) => setCompetitors(e.target.value)}
                placeholder="Comma separated"
              />
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-4">
          <div>
            <h1 className="font-mono text-h1">Goals &amp; measurement</h1>
            <p className="mt-1 font-mono text-caption text-muted-foreground">
              Channels and KPIs drive the Grow module's recommendations.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="np-goals">Goals</Label>
            <Input
              id="np-goals"
              value={goals}
              onChange={(e) => setGoals(e.target.value)}
              placeholder="e.g. Grow DTC revenue, launch subscriptions"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="np-kpis">KPIs</Label>
            <Input
              id="np-kpis"
              value={kpis}
              onChange={(e) => setKpis(e.target.value)}
              placeholder="e.g. ROAS, CAC, email revenue share"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="np-ch">Channels</Label>
            <Input
              id="np-ch"
              value={channels}
              onChange={(e) => setChannels(e.target.value)}
              placeholder="e.g. Google Ads, Meta, email, TikTok"
            />
          </div>
        </div>
      )}

      <div className="mt-8 flex items-center gap-3">
        {step > 0 && (
          <Button variant="ghost" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        {step < steps.length - 1 ? (
          <Button onClick={() => setStep(step + 1)} disabled={step === 0 && !name.trim()}>
            Continue <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button onClick={handleFinish} disabled={isSaving}>
            {isSaving && <Loader2 className="size-4 animate-spin" />}
            Create project
          </Button>
        )}
        <Badge variant="outline" className="ml-auto font-mono text-caption">
          all fields optional except name
        </Badge>
      </div>
    </div>
  );
}
