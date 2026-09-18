import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Check, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { StatusBadge } from "@/components/app/module-kit";

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "€0",
    blurb: "Understand + Create. See if the workflow fits.",
    modules: ["Understand", "Create"],
  },
  {
    id: "starter",
    name: "Starter",
    price: "€29/mo",
    blurb: "Everything to launch: build, customers, promote.",
    modules: ["Understand", "Create", "Build", "Customers", "Promote"],
  },
  {
    id: "growth",
    name: "Growth",
    price: "€79/mo",
    blurb: "Add commerce: sell products with feeds.",
    modules: ["Understand", "Create", "Build", "Customers", "Promote", "Sell"],
  },
  {
    id: "scale",
    name: "Scale",
    price: "€199/mo",
    blurb: "The full growth OS with insights and recommendations.",
    modules: [
      "Understand",
      "Create",
      "Build",
      "Customers",
      "Promote",
      "Sell",
      "Grow",
    ],
  },
] as const;

export default function Billing() {
  const { user } = useAuth();
  const billing = useQuery(api.billing.currentPlan);
  const changePlan = useMutation(api.billing.changePlan);
  const cancelPlan = useMutation(api.billing.cancelPlan);
  const deleteAccount = useMutation(api.billing.deleteAccount);
  const [busy, setBusy] = useState<string | null>(null);

  const currentPlan = billing?.plan ?? "free";

  const doChange = async (plan: string) => {
    setBusy(plan);
    try {
      await changePlan({ plan: plan as "free" | "starter" | "growth" | "scale" });
      toast.success(`Switched to ${plan}`);
    } catch (e) {
      toast.error("Plan change failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const doCancel = async () => {
    setBusy("cancel");
    try {
      await cancelPlan();
      toast.success("Subscription canceled — you're on Free");
    } catch (e) {
      toast.error("Cancel failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async (confirmText: string) => {
    if (confirmText !== "DELETE") {
      toast.error("Type DELETE to confirm account deletion.");
      return;
    }
    try {
      await deleteAccount();
      toast.success("Account deleted");
      window.location.href = "/";
    } catch (e) {
      toast.error("Deletion failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    }
  };

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md border bg-card shadow-card">
          <Sparkles className="size-5 text-terminal-green" />
        </span>
        <div className="min-w-0">
          <h1 className="font-mono text-h1">Plan &amp; billing</h1>
          <p className="font-mono text-caption text-muted-foreground">
            Modules are unlocked per plan — switch anytime, cancel anytime.
          </p>
        </div>
        {billing && (
          <Badge className="ml-auto" variant="outline">
            <span className="font-mono text-caption">current: </span>
            {billing.plan}
          </Badge>
        )}
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((p) => {
          const isCurrent = p.id === currentPlan;
          return (
            <Card
              key={p.id}
              className={cn(
                "gap-4 py-4",
                isCurrent && "border-terminal-green/60 shadow-pop",
              )}
            >
              <CardHeader className="px-4">
                <CardTitle className="flex items-center gap-2 font-mono text-h3">
                  {p.name}
                  {isCurrent && (
                    <Badge
                      variant="outline"
                      className="border-terminal-green/40 bg-terminal-green-soft font-mono text-caption text-terminal-green"
                    >
                      current
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="font-mono text-caption">
                  {p.blurb}
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4">
                <p className="font-mono text-metric">{p.price}</p>
                <ul className="mt-3 space-y-1">
                  {p.modules.map((m) => (
                    <li
                      key={m}
                      className="flex items-center gap-1.5 font-mono text-caption text-muted-foreground"
                    >
                      <Check className="size-3 text-terminal-green" /> {m}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-4 w-full"
                  size="sm"
                  variant={isCurrent ? "outline" : "default"}
                  disabled={isCurrent || busy === p.id}
                  onClick={() => doChange(p.id)}
                >
                  {busy === p.id && <Loader2 className="size-4 animate-spin" />}
                  {isCurrent ? "Active" : "Switch plan"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3 rounded-md border bg-card p-4 shadow-card">
        <div className="min-w-0">
          <p className="font-mono text-small font-medium">Cancel subscription</p>
          <p className="font-mono text-caption text-muted-foreground">
            Drops you to Free. Data is kept until you delete the account.
          </p>
        </div>
        <Button
          className="ml-auto"
          size="sm"
          variant="outline"
          disabled={currentPlan === "free" || busy === "cancel"}
          onClick={doCancel}
        >
          {busy === "cancel" && <Loader2 className="size-4 animate-spin" />}
          Cancel subscription
        </Button>
      </div>

      <div className="mt-4 rounded-md border border-terminal-red/30 bg-card p-4 shadow-card">
        <p className="font-mono text-small font-medium text-terminal-red">
          Delete account
        </p>
        <p className="mt-0.5 font-mono text-caption text-muted-foreground">
          Permanently removes your account and every project, persona, contact
          and artifact. Cannot be undone.
        </p>
        <div className="mt-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="destructive">
                Delete account…
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DeleteAccountBody onConfirm={doDelete} />
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}

function DeleteAccountBody({
  onConfirm,
}: {
  onConfirm: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-mono text-h3">
          Delete this account?
        </DialogTitle>
        <DialogDescription className="font-mono text-caption">
          This permanently removes all projects and data. Type DELETE to
          confirm.
        </DialogDescription>
      </DialogHeader>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="DELETE"
        aria-label="Type DELETE to confirm"
      />
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={() => setText("")}>
          Keep account
        </Button>
        <Button
          variant="destructive"
          disabled={busy || text !== "DELETE"}
          onClick={async () => {
            setBusy(true);
            await onConfirm(text);
            setBusy(false);
          }}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Permanently delete
        </Button>
      </DialogFooter>
    </>
  );
}
