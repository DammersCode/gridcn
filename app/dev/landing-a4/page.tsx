import { BgPlayground } from "../landing/_shared/bg-variants";
import { LandingContent } from "../landing/_shared/landing-content";
import { DraftShell } from "../landing/_shared/shell";

// DEV-ONLY: A2 iteration "proof". Delete when a draft is chosen.
export default function LandingA4() {
  return (
    <DraftShell name="A4 · proof">
      <BgPlayground initial={4} switcher={false}>
        <LandingContent variant="proof" />
      </BgPlayground>
    </DraftShell>
  );
}
