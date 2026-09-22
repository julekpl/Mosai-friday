import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { BrainCircuit, Loader2, MessageSquare, Send, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PersonaSnapshot = {
  name: string;
  role?: string;
  goals?: string[];
  pains?: string[];
  objections?: string[];
  channels?: string[];
  evidence?: string;
};

/**
 * Chat with a persona (talk to the buyer) or with an AI marketing analyst
 * about the persona. Threads are stored per mode.
 */
export function PersonaChat({
  projectId,
  personaId,
  persona,
}: {
  projectId: Id<"projects">;
  personaId: Id<"personas">;
  persona: PersonaSnapshot;
}) {
  const [mode, setMode] = useState<"persona" | "analyst">("persona");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const chat = useAction(api.ai.personaChat);
  const append = useMutation(api.personaChat.append);
  const clear = useMutation(api.personaChat.clear);
  const history = useQuery(api.personaChat.list, { projectId, personaId });

  const thread = (history ?? []).filter((m) => m.mode === mode);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [thread.length, sending, mode]);

  const send = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setDraft("");
    setSending(true);
    try {
      const reply = await chat({
        mode,
        projectId,
        persona,
        history: thread.slice(-16).map((m) => ({ role: m.role, content: m.content })),
        message,
      });
      await append({
        projectId,
        personaId,
        mode,
        userMessage: message,
        assistantMessage: reply || "(no response)",
      });
    } catch (e) {
      toast.error("Chat failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-3">
      {/* Mode switch */}
      <div className="flex items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          <button
            className={cn(
              "flex items-center gap-1.5 rounded-sm px-2.5 py-1 font-mono text-caption ease-terminal",
              mode === "persona"
                ? "bg-terminal-green-soft text-terminal-green"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setMode("persona")}
          >
            <MessageSquare className="size-3.5" /> persona
          </button>
          <button
            className={cn(
              "flex items-center gap-1.5 rounded-sm px-2.5 py-1 font-mono text-caption ease-terminal",
              mode === "analyst"
                ? "bg-terminal-green-soft text-terminal-green"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setMode("analyst")}
          >
            <BrainCircuit className="size-3.5" /> analyst
          </button>
        </div>
        {thread.length > 0 && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Clear conversation"
            className="ml-auto text-destructive"
            onClick={async () => {
              try {
                await clear({ projectId, personaId, mode });
              } catch (e) {
                toast.error("Clear failed", {
                  description: e instanceof Error ? e.message : "Try again.",
                });
              }
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Thread */}
      <div
        ref={scrollRef}
        className="max-h-72 min-h-24 overflow-y-auto rounded-md border bg-card p-3"
      >
        {thread.length === 0 ? (
          <p className="py-6 text-center font-mono text-caption text-muted-foreground">
            {mode === "persona"
              ? `Say hi — you're talking to ${persona.name}, the buyer.`
              : "Ask the analyst anything about this persona — content angles, objections, channel fit."}
          </p>
        ) : (
          <div className="grid gap-2">
            {thread.map((m) => (
              <div
                key={m._id}
                className={cn(
                  "max-w-[85%] rounded-md px-3 py-2 font-mono text-caption whitespace-pre-wrap",
                  m.role === "user"
                    ? "ml-auto border bg-background"
                    : "border-terminal-green/30 bg-terminal-green-soft",
                )}
              >
                {m.content}
              </div>
            ))}
            {sending && (
              <div className="flex items-center gap-2 font-mono text-caption text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> thinking…
              </div>
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            mode === "persona"
              ? `Message ${persona.name}…`
              : "Ask the analyst…"
          }
          disabled={sending}
        />
        <Button type="submit" size="icon" disabled={sending || !draft.trim()}>
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
