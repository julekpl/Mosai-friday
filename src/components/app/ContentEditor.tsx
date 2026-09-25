import { useCallback, useEffect, useId, useRef, useState } from "react";
import { EditorContent, Extension, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import * as Y from "yjs";
import {
  Bold,
  Check,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Loader2,
  MessageSquarePlus,
  Minimize2,
  Maximize2,
  Redo2,
  RefreshCw,
  Strikethrough,
  TextSelect,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { sanitizeHtml } from "@/lib/sanitize";
import { cn } from "@/lib/utils";

/* ── AI selection edits ───────────────────────────────────────────────── */

export type AiEditOp = "rewrite" | "shorten" | "expand" | "custom";

export type AiEditRequest = {
  op: AiEditOp;
  selectionText: string;
  /** "inline" = part of one paragraph; "blocks" = whole paragraphs/blocks. */
  scope: "inline" | "blocks";
  before: string;
  after: string;
  instruction?: string;
};

export type EditorCtx = {
  personaName?: string;
  journeyStage?: string;
  topicTitle?: string;
};

export type EditorToolbarApi = {
  editor: Editor;
  /** Replace the whole document with HTML. */
  replaceAll: (html: string) => void;
  /** Append HTML at the end of the document. */
  append: (html: string) => void;
  isEmpty: boolean;
};

const OP_LABEL: Record<AiEditOp, string> = {
  rewrite: "Rewrite",
  shorten: "Shorten",
  expand: "Expand",
  custom: "Apply note",
};

const OP_BUSY: Record<AiEditOp, string> = {
  rewrite: "Rewriting…",
  shorten: "Shortening…",
  expand: "Expanding…",
  custom: "Applying your note…",
};

const GUIDANCE_PRESETS = [
  "More formal",
  "Friendlier, more conversational",
  "Simpler words",
  "Add a concrete example",
  "Use facts from the sources",
  "Stronger call to action",
];

/* Keeps the range the AI menu acts on visibly marked while focus is in the
 * menu (the browser hides a native selection when the editor loses focus). */
const aiRangeKey = new PluginKey<DecorationSet>("aiRange");

const AiRangeHighlight = Extension.create({
  name: "aiRangeHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: aiRangeKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(aiRangeKey) as { from: number; to: number } | null | undefined;
            if (meta === null) return DecorationSet.empty;
            if (meta) {
              return DecorationSet.create(tr.doc, [
                Decoration.inline(meta.from, meta.to, { class: "ai-target" }),
              ]);
            }
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return aiRangeKey.getState(state);
          },
        },
      }),
    ];
  },
});

type Target = {
  from: number;
  to: number;
  text: string;
  scope: "inline" | "blocks";
  before: string;
  after: string;
  top: number;
  left: number;
};

type AiResult = { op: AiEditOp; html: string; instruction?: string };

/* ── Main component ───────────────────────────────────────────────────── */

export type ContentEditorProps = {
  doc: Y.Doc;
  initialHtml?: string;
  ctx: EditorCtx;
  onSave: (args: {
    snapshot: Uint8Array;
    bodyHtml: string;
    bodyText: string;
  }) => Promise<void>;
  onAiEdit: (args: AiEditRequest) => Promise<string>; // returns replacement HTML
  /** Extra controls at the end of the toolbar (e.g. the AI draft dialog). */
  renderToolbarEnd?: (api: EditorToolbarApi) => React.ReactNode;
  readOnly?: boolean;
};

export function ContentEditor({
  doc,
  initialHtml,
  ctx,
  onSave,
  onAiEdit,
  renderToolbarEnd,
  readOnly,
}: ContentEditorProps) {
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  // Selection → AI menu
  const [selectionHint, setSelectionHint] = useState<Omit<Target, "top" | "left"> | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [guidance, setGuidance] = useState("");
  const [busyOp, setBusyOp] = useState<AiEditOp | null>(null);
  const [result, setResult] = useState<AiResult | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const menuId = useId();
  const guidanceId = useId();

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ link: false, undoRedo: false }),
        Highlight,
        Link.configure({ openOnClick: false }),
        Placeholder.configure({
          placeholder: "Start writing, or let AI draft from the topic, brief and sources…",
        }),
        CharacterCount,
        Collaboration.configure({ document: doc }),
        AiRangeHighlight,
      ],
      editable: !readOnly,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          "aria-label": "Content editor",
          "aria-multiline": "true",
          role: "textbox",
        },
      },
    },
    [],
  );

  // Seed initial content once (only when doc is empty and initialHtml given)
  const seeded = useRef(false);
  useEffect(() => {
    if (!editor || seeded.current || !initialHtml) return;
    seeded.current = true;
    if (editor.isEmpty) {
      editor.commands.setContent(initialHtml);
    }
  }, [editor, initialHtml]);

  const doSave = useCallback(
    async (silent = true) => {
      if (!editor) return;
      try {
        await onSave({
          snapshot: Y.encodeStateAsUpdate(doc),
          bodyHtml: editor.getHTML(),
          bodyText: editor.getText(),
        });
        setSavedAt(Date.now());
        setDirty(false);
        if (!silent) toast.success("Document saved");
      } catch (e) {
        setDirty(true);
        if (!silent)
          toast.error("Save failed", {
            description: e instanceof Error ? e.message : "Try again.",
          });
      }
    },
    [editor, doc, onSave],
  );

  // Debounced autosave on updates
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      setDirty(true);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void doSave(true), 1500);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [editor, doSave]);

  /** Snapshot the current editor selection as an AI target. */
  const readSelection = useCallback((): Omit<Target, "top" | "left"> | null => {
    if (!editor) return null;
    const { from, to, empty, $from, $to } = editor.state.selection;
    if (empty) return null;
    const text = editor.state.doc.textBetween(from, to, "\n\n", " ");
    if (!text.trim()) return null;
    const wholeBlock = $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size;
    const scope: Target["scope"] = $from.sameParent($to) && !wholeBlock ? "inline" : "blocks";
    const size = editor.state.doc.content.size;
    return {
      from,
      to,
      text,
      scope,
      before: editor.state.doc.textBetween(0, from, "\n", " ").slice(-1_500),
      after: editor.state.doc.textBetween(to, size, "\n", " ").slice(0, 800),
    };
  }, [editor]);

  const place = useCallback(
    (sel: Omit<Target, "top" | "left">): Target | null => {
      if (!editor || !surfaceRef.current) return null;
      const surface = surfaceRef.current.getBoundingClientRect();
      const end = editor.view.coordsAtPos(sel.to);
      const start = editor.view.coordsAtPos(sel.from);
      const maxLeft = Math.max(8, surface.width - 360);
      return {
        ...sel,
        top: end.bottom - surface.top + 8,
        left: Math.min(maxLeft, Math.max(8, Math.min(start.left, end.left) - surface.left)),
      };
    },
    [editor],
  );

  const setAiRange = useCallback(
    (range: { from: number; to: number } | null) => {
      if (!editor) return;
      editor.view.dispatch(editor.state.tr.setMeta(aiRangeKey, range));
    },
    [editor],
  );

  const closeMenu = useCallback(
    (refocus = false) => {
      setTarget(null);
      setResult(null);
      setGuidanceOpen(false);
      setAiRange(null);
      if (refocus) editor?.commands.focus();
    },
    [editor, setAiRange],
  );

  const openMenu = useCallback(
    (sel?: Omit<Target, "top" | "left"> | null) => {
      const current = sel ?? readSelection();
      if (!current) {
        toast.message("Select some text first", {
          description: "Highlight a sentence or paragraph, then choose Rewrite, Shorten or Expand.",
        });
        return;
      }
      const placed = place(current);
      if (!placed) return;
      setTarget(placed);
      setResult(null);
      setAiRange({ from: current.from, to: current.to });
    },
    [place, readSelection, setAiRange],
  );

  // Track the live selection: show a compact AI bar for any non-empty
  // selection; a pending AI result or open guidance keeps its own target.
  useEffect(() => {
    if (!editor) return;
    const onSelection = () => {
      const sel = readSelection();
      setSelectionHint(sel);
      if (busyOp || result || guidanceOpen) return;
      if (!sel) {
        setTarget(null);
        return;
      }
      const placed = place(sel);
      if (placed) setTarget(placed);
    };
    editor.on("selectionUpdate", onSelection);
    return () => {
      editor.off("selectionUpdate", onSelection);
    };
  }, [editor, readSelection, place, busyOp, result, guidanceOpen]);

  const runAi = useCallback(
    async (op: AiEditOp, instruction?: string) => {
      if (!editor || !target) return;
      const note = (instruction ?? guidance).trim();
      if (op === "custom" && !note) return;
      setAiRange({ from: target.from, to: target.to });
      setBusyOp(op);
      setResult(null);
      setAnnouncement(OP_BUSY[op]);
      try {
        const html = await onAiEdit({
          op,
          selectionText: target.text,
          scope: target.scope,
          before: target.before,
          after: target.after,
          instruction: note || undefined,
        });
        setResult({ op, html, instruction: note || undefined });
        setAnnouncement(`${OP_LABEL[op]} ready. Review it, then replace the selection or discard.`);
      } catch (e) {
        setAnnouncement("The AI edit failed.");
        toast.error("AI edit failed", {
          description: e instanceof Error ? e.message : "Try again.",
        });
      } finally {
        setBusyOp(null);
      }
    },
    [editor, target, guidance, onAiEdit, setAiRange],
  );

  const applyResult = useCallback(
    (mode: "replace" | "below") => {
      if (!editor || !target || !result) return;
      // Map the stored range through edits made since, and refuse to apply
      // if the selected text itself was changed meanwhile.
      const current = editor.state.doc.textBetween(target.from, Math.min(target.to, editor.state.doc.content.size), "\n\n", " ");
      if (current !== target.text) {
        toast.error("The selected text changed", {
          description: "Select it again and re-run the edit.",
        });
        closeMenu(true);
        return;
      }
      const chain = editor.chain().focus();
      if (mode === "replace") {
        chain.insertContentAt({ from: target.from, to: target.to }, result.html).run();
      } else {
        const $end = editor.state.doc.resolve(target.to);
        const afterBlock = $end.depth > 0 ? $end.after(1) : target.to;
        chain.insertContentAt(afterBlock, result.html.startsWith("<") ? result.html : `<p>${result.html}</p>`).run();
      }
      toast.success(mode === "replace" ? "Selection replaced" : "Inserted below");
      setAnnouncement(mode === "replace" ? "Selection replaced." : "Inserted below the selection.");
      closeMenu();
    },
    [editor, target, result, closeMenu],
  );

  // Escape closes the AI menu from anywhere.
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyOp) closeMenu(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, busyOp, closeMenu]);

  const replaceAll = useCallback(
    (html: string) => {
      editor?.chain().focus().clearContent().insertContent(html).run();
    },
    [editor],
  );
  const append = useCallback(
    (html: string) => {
      if (!editor) return;
      editor.chain().focus().insertContentAt(editor.state.doc.content.size, html).run();
    },
    [editor],
  );

  if (!editor) return null;

  const charCount = editor.storage.characterCount as {
    words(): number;
    characters(): number;
  };
  const selectedWords = selectionHint ? selectionHint.text.trim().split(/\s+/).length : 0;

  return (
    <div className="grid gap-3">
      {/* toolbar */}
      <div
        role="toolbar"
        aria-label="Formatting and AI"
        className="flex flex-wrap items-center gap-1 rounded-md border bg-card p-1.5 shadow-card"
      >
        <ToolbarBtn
          action={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="Bold"
        >
          <Bold className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          action={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="Italic"
        >
          <Italic className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          action={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive("strike")}
          title="Strikethrough"
        >
          <Strikethrough className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          action={() => editor.chain().focus().toggleHighlight().run()}
          active={editor.isActive("highlight")}
          title="Highlight"
        >
          <Highlighter className="size-3.5" />
        </ToolbarBtn>
        <Sep />
        <ToolbarBtn
          action={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive("heading", { level: 2 })}
          title="Heading 2"
        >
          <Heading2 className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          action={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive("heading", { level: 3 })}
          title="Heading 3"
        >
          <Heading3 className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          action={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="Bullet list"
        >
          <List className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          action={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          title="Numbered list"
        >
          <ListOrdered className="size-3.5" />
        </ToolbarBtn>
        <Sep />
        <ToolbarBtn action={() => editor.chain().focus().undo().run()} title="Undo">
          <Undo2 className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn action={() => editor.chain().focus().redo().run()} title="Redo">
          <Redo2 className="size-3.5" />
        </ToolbarBtn>
        <Sep />
        <ToolbarBtn
          action={() => {
            editor.chain().focus().selectParentNode().run();
            openMenu();
          }}
          title="Select the current paragraph for AI"
        >
          <TextSelect className="size-3.5" />
        </ToolbarBtn>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          className="h-7 font-mono text-caption"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => openMenu()}
          disabled={readOnly || busyOp !== null}
          aria-haspopup="dialog"
          aria-controls={target ? menuId : undefined}
        >
          <Wand2 className="size-3.5" /> AI edit selection
        </Button>

        <span className="ml-auto flex flex-wrap items-center gap-2">
          <span className="font-mono text-caption text-muted-foreground" aria-live="polite">
            {busyOp
              ? "ai working…"
              : dirty
                ? "saving…"
                : savedAt
                  ? `saved ${new Date(savedAt).toLocaleTimeString()}`
                  : "autosave on"}
          </span>
          {renderToolbarEnd?.({ editor, replaceAll, append, isEmpty: editor.isEmpty })}
        </span>
      </div>

      {/* editor surface; the AI menu is positioned inside it */}
      <div ref={surfaceRef} className="relative min-h-[420px] rounded-md border bg-card p-5 shadow-card">
        <EditorContent editor={editor} className="content-editor" />

        {target && !readOnly && (
          <div
            id={menuId}
            role="dialog"
            aria-label="AI edit for the selected text"
            className="absolute z-30 grid w-80 max-w-full gap-2 rounded-md border bg-popover p-2 text-popover-foreground shadow-pop"
            style={{ top: target.top, left: target.left }}
            onMouseDown={(e) => {
              // keep the editor selection while clicking menu buttons
              if (!(e.target instanceof HTMLTextAreaElement)) e.preventDefault();
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-caption text-muted-foreground">
                {target.text.trim().split(/\s+/).length} words selected
              </p>
              <Button
                size="icon-sm"
                variant="ghost"
                type="button"
                aria-label="Close AI menu"
                onClick={() => closeMenu(true)}
                disabled={busyOp !== null}
              >
                <X className="size-3.5" />
              </Button>
            </div>

            {busyOp ? (
              <p className="flex items-center gap-2 py-2 font-mono text-caption">
                <Loader2 className="size-3.5 animate-spin" /> {OP_BUSY[busyOp]}
              </p>
            ) : result ? (
              <div className="grid gap-2">
                <div
                  className="content-editor max-h-64 overflow-y-auto rounded-sm border bg-background px-3 py-2 text-small"
                  aria-label={`${OP_LABEL[result.op]} suggestion`}
                >
                  <div
                    className="tiptap"
                    // AI output is sanitized with the one allow-list sanitizer.
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(result.html) }}
                  />
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" type="button" className="h-7 font-mono text-caption" onClick={() => applyResult("replace")}>
                    <Check className="size-3.5" /> Replace
                  </Button>
                  <Button size="sm" variant="outline" type="button" className="h-7 font-mono text-caption" onClick={() => applyResult("below")}>
                    Insert below
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    className="h-7 font-mono text-caption"
                    onClick={() => void runAi(result.op, result.instruction)}
                  >
                    <RefreshCw className="size-3.5" /> Try again
                  </Button>
                  <Button size="sm" variant="ghost" type="button" className="h-7 font-mono text-caption" onClick={() => closeMenu(true)}>
                    Discard
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" type="button" className="h-7 font-mono text-caption" onClick={() => void runAi("rewrite")}>
                    <Wand2 className="size-3.5" /> Rewrite
                  </Button>
                  <Button size="sm" variant="outline" type="button" className="h-7 font-mono text-caption" onClick={() => void runAi("shorten")}>
                    <Minimize2 className="size-3.5" /> Shorten
                  </Button>
                  <Button size="sm" variant="outline" type="button" className="h-7 font-mono text-caption" onClick={() => void runAi("expand")}>
                    <Maximize2 className="size-3.5" /> Expand
                  </Button>
                  <Button
                    size="sm"
                    variant={guidanceOpen ? "secondary" : "ghost"}
                    type="button"
                    className="h-7 font-mono text-caption"
                    aria-expanded={guidanceOpen}
                    aria-controls={guidanceId}
                    onClick={() => {
                      setGuidanceOpen((open) => !open);
                      setAiRange({ from: target.from, to: target.to });
                    }}
                  >
                    <MessageSquarePlus className="size-3.5" /> Guide AI
                  </Button>
                </div>
                {guidanceOpen && (
                  <div id={guidanceId} className="grid gap-1.5">
                    <label htmlFor={`${guidanceId}-note`} className="font-mono text-caption text-muted-foreground">
                      Note for the AI (applies to Rewrite, Shorten, Expand, or on its own)
                    </label>
                    <Textarea
                      id={`${guidanceId}-note`}
                      value={guidance}
                      onChange={(e) => setGuidance(e.target.value)}
                      rows={3}
                      maxLength={1500}
                      placeholder="e.g. Mention the 10-year warranty, keep it under 40 words, address first-time buyers"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          void runAi("custom");
                        }
                      }}
                    />
                    <div className="flex flex-wrap gap-1" aria-label="Quick notes">
                      {GUIDANCE_PRESETS.map((preset) => (
                        <Button
                          key={preset}
                          size="sm"
                          variant="ghost"
                          type="button"
                          className="h-6 px-2 font-mono text-caption text-muted-foreground"
                          onClick={() => setGuidance((current) => (current.trim() ? `${current.trim()}; ${preset.toLowerCase()}` : preset))}
                        >
                          + {preset}
                        </Button>
                      ))}
                    </div>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        type="button"
                        className="h-7 font-mono text-caption"
                        disabled={!guidance.trim()}
                        onClick={() => void runAi("custom")}
                      >
                        Apply note
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">{announcement}</p>

      {/* footer meta */}
      <div className="flex flex-wrap items-center gap-2">
        {ctx.personaName && (
          <Badge variant="outline" className="font-mono text-caption">
            persona: {ctx.personaName}
          </Badge>
        )}
        {ctx.journeyStage && (
          <Badge variant="outline" className="font-mono text-caption">
            stage: {ctx.journeyStage}
          </Badge>
        )}
        {ctx.topicTitle && (
          <Badge variant="outline" className="font-mono text-caption">
            topic: {ctx.topicTitle}
          </Badge>
        )}
        <span className="ml-auto font-mono text-caption text-muted-foreground">
          {selectedWords ? `${selectedWords} selected · ` : ""}
          {charCount.words()} words · {charCount.characters()} chars
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 font-mono text-caption"
          onClick={() => void doSave(false)}
        >
          Save now
        </Button>
      </div>
    </div>
  );
}

/* ── toolbar bits ─────────────────────────────────────────────────────── */

function ToolbarBtn({
  action,
  active,
  title,
  children,
}: {
  action: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn("size-7", active && "bg-accent text-terminal-green")}
      onMouseDown={(e) => e.preventDefault()}
      onClick={action}
    >
      {children}
    </Button>
  );
}

function Sep() {
  return <div aria-hidden="true" className="mx-1 h-5 w-px bg-border" />;
}
