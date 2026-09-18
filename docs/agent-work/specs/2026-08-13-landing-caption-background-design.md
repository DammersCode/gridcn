# Landing Preview Instructions

## Problem

The landing-page grid demo renders instructions twice: once inside the demo
above the grid and again in a styled pill below the preview. The duplicate text
adds visual weight, and making the entire preview opaque does not match the
other landing-page surfaces.

## Design

Remove the instruction paragraph embedded in `DataGridDemo`. Keep the existing
styled pill below the landing-page preview as the single instruction. Remove
the temporary opaque `bg-card` utility from the preview wrapper so the grid
returns to its original lightweight framing.

The demo component will contain only the grid and retain its public behavior.
No new component, CSS rule, or visual token is needed.

## Verification

Confirm the preview shows one instruction below the grid, with no empty gap
where the embedded paragraph was. Run lint on both changed components.
