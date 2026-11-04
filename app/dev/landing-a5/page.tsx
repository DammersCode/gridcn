import { BgPlayground } from "../landing/_shared/bg-variants";
import { LandingContent } from "../landing/_shared/landing-content";
import { DraftShell } from "../landing/_shared/shell";

// DEV-ONLY: A2 iteration "dense". Delete when a draft is chosen.
export default function LandingA5() {
  return (
    <DraftShell name="A5 · dense">
      <BgPlayground initial={4} switcher={false}>
        <LandingContent variant="dense" />
      </BgPlayground>
    </DraftShell>
  );
}
