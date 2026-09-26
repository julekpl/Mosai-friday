import { useRef, useState } from "react";
import { useAction } from "convex/react";
import { Check, Search } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { displayDomain } from "@/lib/url";
import { isLookupResting } from "@/lib/lookupErrors";
import { classifySource } from "@/components/app/wizard/classifySource";
import type { BusinessSearchState, BusinessSuggestion } from "@/components/app/wizard/types";

// LQ-1: shown at the platform SerpApi ceiling or the per-user daily cap.
// The server throws a `ConvexError` with `data.code === "lookup_resting"`
// (see `src/lib/lookupErrors.ts`) rather than a plain `Error`, because
// Convex redacts a plain error's message in production — matching on text
// would never fire once deployed. This copy is the wizard's own, not the
// server's, so it can change independently of the server message.
const CEILING_MESSAGE = "Business search is resting for now, type your details instead.";

/**
 * Q2 "What is it called?" (required) and one optional field for a website or
 * a Google listing name. A web address is read later by the server scan; a
 * name offers matching Google listings, and only a listing the owner picks
 * is used.
 */
export function NameQuestion({
  name,
  onNameChange,
  nameError,
  nameRef,
  source,
  onSourceChange,
  selectedBusiness,
  onSelectBusiness,
  onEnter,
  forClient = false,
}: {
  name: string;
  onNameChange: (value: string) => void;
  nameError: boolean;
  nameRef: React.RefObject<HTMLInputElement | null>;
  source: string;
  onSourceChange: (value: string) => void;
  selectedBusiness: BusinessSuggestion | null;
  onSelectBusiness: (value: BusinessSuggestion | null) => void;
  onEnter: () => void;
  /** U9: the answers describe an agency's client, so the words say so. */
  forClient?: boolean;
}) {
  const suggestGmb = useAction(api.scraping.suggestGoogleBusiness);
  const [suggestions, setSuggestions] = useState<BusinessSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searchState, setSearchState] = useState<BusinessSearchState>("idle");
  const cache = useRef(new Map<string, BusinessSuggestion[]>());
  const classified = classifySource(source);
  const listingQuery = classified.kind === "listing" ? classified.query : "";

  // LQ-1: search is explicit, never on typing — each search is a paid
  // SerpApi call. The owner presses the button; typing only ever updates
  // `source` and clears any stale results.
  const runSearch = () => {
    if (listingQuery.length < 3 || selectedBusiness) return;
    const cacheKey = listingQuery.toLowerCase();
    const cached = cache.current.get(cacheKey);
    if (cached) {
      setSuggestions(cached);
      setActiveIndex(-1);
      setSearchState(cached.length ? "results" : "empty");
      return;
    }
    setSearchState("loading");
    void suggestGmb({ query: listingQuery }).then((found) => {
      // Every search is a paid lookup: never repeat one the user already ran.
      cache.current.set(cacheKey, found);
      setSuggestions(found);
      setActiveIndex(-1);
      setSearchState(found.length ? "results" : "empty");
    }).catch((error) => {
      setSuggestions([]);
      setActiveIndex(-1);
      setSearchState(isLookupResting(error) ? "resting" : "error");
    });
  };

  const closeSuggestions = () => {
    setSuggestions([]);
    setActiveIndex(-1);
    setSearchState("idle");
  };
  const pick = (suggestion: BusinessSuggestion) => {
    onSelectBusiness(suggestion);
    onSourceChange(suggestion.title);
    closeSuggestions();
  };
  const enterMovesOn = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onEnter();
  };

  return (
    <section className="grid gap-5 rounded-lg border bg-card p-4 shadow-card sm:p-7" aria-labelledby="q-name-title">
      <h1 id="q-name-title" className="font-mono text-h1">{forClient ? "What is your client’s business called?" : "What is it called?"}</h1>

      <div className="grid gap-2">
        <Label htmlFor="np-name">{forClient ? "Client’s business name" : "Business name"}</Label>
        <Input
          id="np-name"
          ref={nameRef}
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          onKeyDown={enterMovesOn}
          placeholder="e.g. Northside Coffee"
          required
          aria-required="true"
          aria-invalid={nameError || undefined}
          aria-describedby={nameError ? "np-name-error" : undefined}
          autoComplete="organization"
          className="min-h-11 text-small"
        />
        {nameError && (
          <p id="np-name-error" role="alert" className="font-mono text-caption text-destructive">
            {forClient ? "Give your client’s business a name to continue." : "Give your business a name to continue."}
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="np-source">
          Where can we read about it? <span className="font-normal text-muted-foreground">(website or Google listing, optional)</span>
        </Label>
        <div className="flex gap-2">
          <Input
            id="np-source"
            value={source}
            onChange={(event) => {
              onSourceChange(event.target.value);
              onSelectBusiness(null);
              closeSuggestions();
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && suggestions.length) {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1));
              } else if (event.key === "ArrowUp" && suggestions.length) {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter" && activeIndex >= 0 && suggestions[activeIndex]) {
                event.preventDefault();
                pick(suggestions[activeIndex]);
              } else if (event.key === "Escape" && suggestions.length) {
                closeSuggestions();
              } else {
                enterMovesOn(event);
              }
            }}
            placeholder="yourbusiness.com or Northside Coffee, Bristol"
            className="min-h-11"
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={suggestions.length > 0}
            aria-controls="np-source-suggestions"
            aria-activedescendant={activeIndex >= 0 ? `np-source-suggestion-${activeIndex}` : undefined}
            aria-describedby="np-source-help np-source-status"
          />
          {classified.kind === "listing" && !selectedBusiness && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 shrink-0 gap-2"
              disabled={listingQuery.length < 3 || searchState === "loading"}
              aria-busy={searchState === "loading"}
              onClick={runSearch}
            >
              <Search className="size-4" aria-hidden="true" />
              {searchState === "loading" ? "Searching…" : "Search Google for my listing"}
            </Button>
          )}
        </div>
        <p id="np-source-help" className="font-mono text-caption text-muted-foreground">
          {forClient
            ? "We read your client’s public pages to learn their services, photos and style. Nothing is posted anywhere."
            : "We read public pages to learn your services, photos and style. Nothing is posted anywhere."}
        </p>
        <div id="np-source-status" role="status" aria-live="polite" className="font-mono text-caption text-muted-foreground">
          {classified.kind === "website" && `We’ll read ${displayDomain(classified.url)}.`}
          {classified.kind === "listing" && !selectedBusiness && searchState === "loading" && "Looking for matching Google listings…"}
          {classified.kind === "listing" && !selectedBusiness && searchState === "results" && (forClient ? "Pick your client’s business from the list so we use the right one." : "Pick your business from the list so we use the right one.")}
          {classified.kind === "listing" && !selectedBusiness && searchState === "empty" && "No matching listing found. Try adding your town, or leave this empty."}
          {classified.kind === "listing" && !selectedBusiness && searchState === "error" && "We couldn’t search Google listings just now. You can continue without it."}
          {classified.kind === "listing" && !selectedBusiness && searchState === "resting" && CEILING_MESSAGE}
        </div>
        {selectedBusiness && (
          <p className="flex items-start gap-2 rounded-md border border-terminal-green/30 bg-terminal-green-soft p-3 font-mono text-caption">
            <Check className="mt-0.5 size-4 shrink-0 text-terminal-green-ink" aria-hidden="true" />
            <span>We’ll use the Google listing for {selectedBusiness.title}{selectedBusiness.address ? `, ${selectedBusiness.address}` : ""}.</span>
          </p>
        )}
        {suggestions.length > 0 && (
          <div id="np-source-suggestions" role="listbox" aria-label="Matching Google listings" className="grid gap-1 rounded-md border bg-background p-1">
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.placeId}
                id={`np-source-suggestion-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(suggestion)}
                className={cn(
                  "min-h-11 w-full rounded-sm px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  index === activeIndex && "bg-muted",
                )}
              >
                <span className="block truncate font-mono text-caption font-semibold">{suggestion.title}</span>
                {suggestion.address && <span className="mt-0.5 block truncate font-mono text-caption text-muted-foreground">{suggestion.address}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
