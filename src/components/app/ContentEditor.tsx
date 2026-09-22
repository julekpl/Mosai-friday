import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import * as Y from "yjs";
import {
  Bold,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Redo2,
  Sparkles,
  Strikethrough,
  Undo2,
  Wand2,
  Heading2,
  Heading3,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/* ── AI selection menu state ──────────────────────────────────────────── */

type AiOp = "expand" | "rewrite";

export type AiEditRequest = {
  op: AiOp;
  selectionText: string;
  surroundingText: string;
  instruction?: string;
};

export type EditorCtx = {
  personaName?: string;
  journeyStage?: string;
  topicTitle?: string;
};

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
  readOnly?: boolean;
};

export function ContentEditor({
  doc,
  initialHtml,
  ctx,
  onSave,
  onAiEdit,
  readOnly,
}: ContentEditorProps) {
  const [aiBusy, setAiBusy] = useState<AiOp | "draft" | null>(null);
  const [aiMenu, setAiMenu] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ link: false }),
        Highlight,
        Link.configure({ openOnClick: false }),
        Placeholder.configure({
          placeholder: "Start writing, or let AI draft from the topic brief…",
        }),
        CharacterCount,
        Collaboration.configure({ document: doc }),
      ],
      editable: !readOnly,
      immediatelyRender: false,
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

  const selRef = useRef<{ from: number; to: number } | null>(null);
  useEffect(() => {
    if (!editor) return;
    const onSelection = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty || to - from < 8) {
        setAiMenu(null);
        return;
      }
      const box = editor.view.coordsAtPos(from);
      selRef.current = { from, to };
      setAiMenu({
        x: Math.max(12, box.left),
        y: Math.max(12, box.top - 8),
        text: editor.state.doc.textBetween(from, to, "\n"),
      });
    };
    editor.on("selectionUpdate", onSelection);
    return () => {
      editor.off("selectionUpdate", onSelection);
    };
  }, [editor]);

  const runAi = useCallback(
    async (op: AiOp) => {
      if (!editor || !aiMenu) return;
      const sel = selRef.current;
      if (!sel) return;
      const before = editor.getText().slice(Math.max(0, sel.from - 600), sel.from);
      setAiBusy(op);
      setAiMenu(null);
      try {
        const html = await onAiEdit({
          op,
          selectionText: aiMenu.text,
          surroundingText: before,
        });
        editor
          .chain()
          .focus()
          .insertContentAt({ from: sel.from, to: sel.to }, html)
          .run();
        toast.success(op === "expand" ? "Expanded" : "Rewritten");
      } catch (e) {
        toast.error("AI edit failed", {
          description: e instanceof Error ? e.message : "Try again.",
        });
      } finally {
        setAiBusy(null);
      }
    },
    [editor, aiMenu, onAiEdit],
  );

  const runDraft = useCallback(async () => {
    if (!editor) return;
    setAiBusy("draft");
    try {
      const html = await onAiEdit({
        op: "expand",
        selectionText: "",
        surroundingText: `Write a full draft for this piece. Topic: ${ctx.topicTitle ?? "(no topic set)"}. ${ctx.personaName ? `Persona: ${ctx.personaName}.` : ""} ${ctx.journeyStage ? `Journey stage: ${ctx.journeyStage}.` : ""}`,
      });
      editor.chain().focus().clearContent().insertContent(html).run();
      toast.success("Draft generated");
    } catch (e) {
      toast.error("Draft failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setAiBusy(null);
    }
  }, [editor, onAiEdit, ctx]);

  if (!editor) return null;

  const charCount = editor.storage.characterCount as {
    words(): number;
    characters(): number;
  };

  return (
    <div className="grid gap-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-1 rounded-md border bg-card p-1.5 shadow-card">
        <ToolbarBtn
          editor={editor}
          action={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="Bold"
        >
          <Bold className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          editor={editor}
          action={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="Italic"
        >
          <Italic className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          editor={editor}
          action={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive("strike")}
          title="Strikethrough"
        >
          <Strikethrough className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          editor={editor}
          action={() => editor.chain().focus().toggleHighlight().run()}
          active={editor.isActive("highlight")}
          title="Highlight"
        >
          <Highlighter className="size-3.5" />
        </ToolbarBtn>
        <Sep />
        <ToolbarBtn
          editor={editor}
          action={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive("heading", { level: 2 })}
          title="Heading 2"
        >
          <Heading2 className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          editor={editor}
          action={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive("heading", { level: 3 })}
          title="Heading 3"
        >
          <Heading3 className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          editor={editor}
          action={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="Bullet list"
        >
          <List className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          editor={editor}
          action={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          title="Numbered list"
        >
          <ListOrdered className="size-3.5" />
        </ToolbarBtn>
        <Sep />
        <ToolbarBtn editor={editor} action={() => editor.chain().focus().undo().run()} title="Undo">
          <Undo2 className="size-3.5" />
        </ToolbarBtn>
        <ToolbarBtn editor={editor} action={() => editor.chain().focus().redo().run()} title="Redo">
          <Redo2 className="size-3.5" />
        </ToolbarBtn>

        <span className="ml-auto flex items-center gap-2">
          <span className="font-mono text-caption text-muted-foreground">
            {aiBusy
              ? "ai working…"
              : dirty
                ? "saving…"
                : savedAt
                  ? `saved ${new Date(savedAt).toLocaleTimeString()}`
                  : "autosave on"}
          </span>
          <Button
            size="sm"
            className="h-7 font-mono text-caption"
            onClick={() => void runDraft()}
            disabled={aiBusy !== null}
          >
            {aiBusy === "draft" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            AI draft
          </Button>
        </span>
      </div>

      {/* floating AI menu on selection */}
      {aiMenu && !aiBusy && (
        <div
          className="fixed z-50 flex gap-1 rounded-md border bg-popover p-1 shadow-pop"
          style={{ left: aiMenu.x, top: Math.max(8, aiMenu.y - 48) }}
        >
          <Button
            size="sm"
            variant="ghost"
            className="h-7 font-mono text-caption"
            onClick={() => void runAi("expand")}
            disabled={aiBusy !== null}
          >
            <Wand2 className="size-3.5" /> Expand
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 font-mono text-caption"
            onClick={() => void runAi("rewrite")}
            disabled={aiBusy !== null}
          >
            <Wand2 className="size-3.5" /> Rewrite
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 font-mono text-caption text-muted-foreground"
            onClick={() => setAiMenu(null)}
            aria-label="Dismiss"
          >
            ×
          </Button>
        </div>
      )}

      {aiBusy && aiBusy !== "draft" && (
        <div className="fixed z-50 rounded-md border bg-popover px-3 py-2 shadow-pop font-mono text-caption">
          <Loader2 className="mr-1.5 inline size-3 animate-spin" />
          {aiBusy === "expand" ? "expanding…" : "rewriting…"}
        </div>
      )}

      {/* editor surface */}
      <div className="rounded-md border bg-card p-5 shadow-card min-h-[420px]">
        <EditorContent editor={editor} className="content-editor" />
      </div>

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
  editor: Editor;
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
      className={cn("size-7", active && "bg-accent text-terminal-green")}
      onMouseDown={(e) => e.preventDefault()}
      onClick={action}
    >
      {children}
    </Button>
  );
}

function Sep() {
  return <div className="mx-1 h-5 w-px bg-border" />;
}
