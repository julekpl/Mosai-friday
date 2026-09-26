import type { PostingChannel } from "@/shared/starterKit";
import { MultiChoiceTiles } from "@/components/app/wizard/MultiChoiceTiles";
import { OtherNote } from "@/components/app/wizard/OtherNote";
import { CHANNEL_OPTIONS } from "@/components/app/wizard/questionOptions";
import { EXCLUSIVE_CHANNELS } from "@/components/app/wizard/selection";

/** Q4 "Where are you already active?" "Nowhere yet" is picked alone. */
export function ChannelsQuestion({
  value,
  onChange,
  otherNote,
  onOtherNoteChange,
}: {
  value: readonly PostingChannel[];
  onChange: (value: PostingChannel[]) => void;
  otherNote: string;
  onOtherNoteChange: (value: string) => void;
}) {
  return (
    <section className="grid gap-5 rounded-lg border bg-card p-4 shadow-card sm:p-7">
      <MultiChoiceTiles
        options={CHANNEL_OPTIONS}
        value={value}
        onChange={onChange}
        exclusive={EXCLUSIVE_CHANNELS}
        describedBy="q-channel-help"
        legend={
          <>
            <h1 id="q-channel-title" className="font-mono text-h1">Where are you already active?</h1>
            <p id="q-channel-help" className="mt-2 font-mono text-caption text-muted-foreground">
              Pick all you use. Your first drafts are written for these. Nothing is posted without you.
            </p>
          </>
        }
      >
        <OtherNote value={otherNote} onChange={onOtherNoteChange} placeholder="e.g. A local newsletter" />
      </MultiChoiceTiles>
    </section>
  );
}
