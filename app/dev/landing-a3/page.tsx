import { BgPlayground } from "../landing/_shared/bg-variants";
import { LandingContent } from "../landing/_shared/landing-content";
import { DraftShell } from "../landing/_shared/shell";

// DEV-ONLY: A2 iteration "agents". Delete when a draft is chosen.
export default function LandingA3() {
  return (
    <DraftShell name="A3 · agents">
      <BgPlayground initial={4} switcher={false}>
        <LandingContent variant="agents" />
      </BgPlayground>
    </DraftShell>
  );
}
