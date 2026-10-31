"use client";

import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { useDebouncedInput } from "@/registry/default/hooks/use-debounce";

/** An input that echoes its committed value once typing pauses; Enter and blur commit at once, Escape drops the text. */
export default function UseDebounceDemo(): ReactNode {
  const [committed, setCommitted] = useState("");
  const [commits, setCommits] = useState(0);
  const input = useDebouncedInput(committed, (next) => {
    setCommitted(next);
    setCommits((n) => n + 1);
  });

  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <Input {...input.inputProps} placeholder="Type, then pause" aria-label="Debounced input" />
      <p className="m-0 text-sm text-muted-foreground">
        Committed: <strong>{committed || "nothing yet"}</strong> ({commits} commits)
      </p>
    </div>
  );
}
