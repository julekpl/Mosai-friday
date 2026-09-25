import { useId, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import type { GenerateContentResult } from "@/convex/ai";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type DraftOptions = {
  instructions?: string;
  length: "short" | "standard" | "long";
  tone?: string;
  citations: boolean;
};

const TONES = ["Brand voice (default)", "Expert and precise", "Warm and friendly", "Bold and direct", "Plain and simple"];

/**
 * "AI draft" button + options dialog. The caller runs the generation; this
 * component only collects what the writer wants and where the result goes.
 */
export function DraftDialog({
  contentType,
  includedSources,
  isEmpty,
  disabled,
  onGenerate,
  onApply,
}: {
  contentType: string;
  includedSources: number;
  isEmpty: boolean;
  disabled?: boolean;
  onGenerate: (options: DraftOptions) => Promise<GenerateContentResult>;
  onApply: (html: string, mode: "replace" | "append", result: GenerateContentResult) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [length, setLength] = useState<DraftOptions["length"]>("standard");
  const [tone, setTone] = useState(TONES[0]);
  const [customTone, setCustomTone] = useState("");
  const [citations, setCitations] = useState(contentType === "blog" || contentType === "landing_page");
  const [instructions, setInstructions] = useState("");
  const [mode, setMode] = useState<"replace" | "append">("replace");

  const run = async () => {
    setBusy(true);
    try {
      const result = await onGenerate({
        length,
        citations,
        instructions: instructions.trim() || undefined,
        tone: customTone.trim() || (tone === TONES[0] ? undefined : tone),
      });
      onApply(result.html, isEmpty ? "replace" : mode, result);
      setOpen(false);
    } catch (e) {
      toast.error("Draft failed", {
        description: e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        className="h-7 font-mono text-caption"
        onClick={() => setOpen(true)}
        disabled={disabled || busy}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
        AI draft
      </Button>
      <Dialog open={open} onOpenChange={(value) => !busy && setOpen(value)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-h3">Draft with AI</DialogTitle>
            <DialogDescription className="font-mono text-caption">
              Uses the topic, persona, journey stage, research findings and{" "}
              {includedSources === 0 ? "no sources (none are included yet)" : `${includedSources} included source${includedSources === 1 ? "" : "s"}`}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-length`}>Length</Label>
                <Select value={length} onValueChange={(value) => setLength(value as DraftOptions["length"])}>
                  <SelectTrigger id={`${id}-length`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="short">Short</SelectItem>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="long">Long and in-depth</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-tone`}>Tone</Label>
                <Select value={tone} onValueChange={setTone}>
                  <SelectTrigger id={`${id}-tone`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TONES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-custom-tone`}>Or describe the tone (optional)</Label>
              <Input id={`${id}-custom-tone`} value={customTone} onChange={(e) => setCustomTone(e.target.value)} maxLength={80} placeholder="e.g. like a trusted local craftsman" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-instructions`}>Instructions for this draft (optional)</Label>
              <Textarea
                id={`${id}-instructions`}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="e.g. Open with the customer story from the interview notes, compare the three options in a list, end with the free consultation offer"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id={`${id}-citations`} checked={citations} onCheckedChange={(checked) => setCitations(checked === true)} />
              <Label htmlFor={`${id}-citations`} className="font-normal">Cite sources inline ([S1]) and list them at the end</Label>
            </div>
            {!isEmpty && (
              <fieldset className="grid gap-1.5">
                <legend className="mb-1 text-small font-medium">The document already has text</legend>
                <RadioGroup
                  value={mode}
                  onValueChange={(value) => setMode(value === "append" ? "append" : "replace")}
                  className="gap-1.5"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id={`${id}-mode-replace`} value="replace" />
                    <Label htmlFor={`${id}-mode-replace`} className="font-normal">Replace it with the new draft (undo restores it)</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id={`${id}-mode-append`} value="append" />
                    <Label htmlFor={`${id}-mode-append`} className="font-normal">Add the draft below the current text</Label>
                  </div>
                </RadioGroup>
              </fieldset>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void run()} disabled={busy}>
                {busy ? <><Loader2 className="size-4 animate-spin" /> Writing…</> : <><Sparkles className="size-4" /> Generate draft</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
