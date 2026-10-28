"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/billing/submit-button";
import { Segmented } from "@/components/ui/segmented";
import { saveVoiceAction, type VoiceFormState } from "@/lib/actions/voice";
import type { SpiceLevel } from "@/lib/ai/schemas";
import { MAX_BANNED, MAX_NOTES, type VoicePrefs } from "@/lib/ai/voice";
import { cn } from "@/lib/utils";

type Emoji = NonNullable<VoicePrefs["emoji"]> | "";
type Casing = NonNullable<VoicePrefs["casing"]> | "";

const EMOJI: { value: Emoji; label: string }[] = [
  { value: "", label: "Like my posts" },
  { value: "none", label: "None" },
  { value: "some", label: "A little" },
  { value: "lots", label: "Lots" },
];
const CASING: { value: Casing; label: string }[] = [
  { value: "", label: "Like my posts" },
  { value: "normal", label: "Normal" },
  { value: "lowercase", label: "all lowercase" },
];
const TONE: { value: SpiceLevel; label: string }[] = [
  { value: "mild", label: "Mild" },
  { value: "bold", label: "Bold" },
  { value: "spicy", label: "Spicy" },
];

function Choice<T extends string>(props: {
  label: string;
  name: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  // An empty value can't be a radio key for the pill, so "like my posts" is "auto" on screen.
  const options = props.options.map((o) => ({ value: (o.value || "auto") as T | "auto", label: o.label }));
  return (
    <div>
      <span className="mb-1.5 block font-medium text-sm">{props.label}</span>
      <Segmented
        legend={props.label}
        variant="chips"
        options={options}
        value={(props.value || "auto") as T | "auto"}
        onChange={(next) => props.onChange((next === "auto" ? "" : next) as T)}
      />
      <input type="hidden" name={props.name} value={props.value} />
    </div>
  );
}

/** Settings → Voice: emoji, casing, words to never use, Studio's default tone, and free-form notes. */
export function VoiceForm({ prefs }: { prefs: VoicePrefs }) {
  const [state, action] = useActionState<VoiceFormState, FormData>(saveVoiceAction, null);
  const [emoji, setEmoji] = useState<Emoji>(prefs.emoji ?? "");
  const [casing, setCasing] = useState<Casing>(prefs.casing ?? "");
  const [spice, setSpice] = useState<SpiceLevel>(prefs.spice ?? "bold");
  return (
    <form action={action} aria-label="Voice settings" className="space-y-5">
      <Choice label="Emoji" name="emoji" options={EMOJI} value={emoji} onChange={setEmoji} />
      <Choice label="Casing" name="casing" options={CASING} value={casing} onChange={setCasing} />
      <Choice label="Studio's default tone" name="spice" options={TONE} value={spice} onChange={setSpice} />
      <label className="block">
        <span className="mb-1.5 block font-medium text-sm">Words to never use</span>
        <textarea
          name="bannedWords"
          rows={3}
          defaultValue={(prefs.bannedWords ?? []).join(", ")}
          placeholder="game-changer, hustle, delve"
          className="w-full rounded-xl border border-border-strong bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-subtle focus-visible:border-accent"
        />
        <span className="mt-1 block text-subtle text-xs">
          Separate them with commas or new lines, up to {MAX_BANNED}. Ideas that use one are left out.
        </span>
      </label>
      <label className="block">
        <span className="mb-1.5 block font-medium text-sm">Anything else Studio should follow</span>
        <textarea
          name="notes"
          rows={4}
          maxLength={MAX_NOTES}
          defaultValue={prefs.notes ?? ""}
          placeholder={
            'Call my product Tidy, never "my app".\nI write for indie hackers, not big companies.\nNo politics.'
          }
          className="w-full rounded-xl border border-border-strong bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-subtle focus-visible:border-accent"
        />
        <span className="mt-1 block text-subtle text-xs">
          Up to {MAX_NOTES} characters. Studio follows these as guidance, within its own rules: it won't invent numbers
          or copy other people's posts.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm">Save voice</SubmitButton>
        {state && (
          <p role="status" className={cn("text-sm", state.ok ? "text-muted" : "text-negative")}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
