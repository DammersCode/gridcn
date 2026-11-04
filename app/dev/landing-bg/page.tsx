import { BgPlayground } from "../landing/_shared/bg-variants";
import { LandingContent } from "../landing/_shared/landing-content";
import { DraftShell } from "../landing/_shared/shell";

// DEV-ONLY: ten background approaches over the A2 content, switched in place. Delete when one is chosen.
export default function LandingBackgrounds() {
  return (
    <DraftShell name="BG · ten approaches">
      <BgPlayground>
        <LandingContent />
      </BgPlayground>
    </DraftShell>
  );
}
