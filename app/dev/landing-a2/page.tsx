import { BgPlayground } from "../landing/_shared/bg-variants";
import { LandingContent } from "../landing/_shared/landing-content";
import { DraftShell } from "../landing/_shared/shell";

// DEV-ONLY draft A2: draft A structure with the original page content restored, solid panels, ghost background (variant 4). Delete when a draft is chosen.
export default function LandingA2() {
  return (
    <DraftShell name="A2 · Stack, full content">
      <BgPlayground initial={4} switcher={false}>
        <LandingContent />
      </BgPlayground>
    </DraftShell>
  );
}
