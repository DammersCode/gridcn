/** Domain barrel — row/column virtualization windows and scrolled-edge detection. */
export { useRowWindow, type RowWindow, type UseRowWindowOptions } from "./use-row-window";
export { getElementStore, useScrollSnapshot, useElementDimensions, useViewportElement, type ScrollSnapshot } from "./use-scroll-snapshot";
export { createVelocityEstimator, updateVelocityEstimate, VELOCITY_OVERSCAN_CAP_PX, type VelocityEstimator } from "./velocity-estimator";
export { useColumnWindow, type UseColumnWindowOptions } from "./use-column-window";
export { useScrolledEdges } from "./use-scrolled-edges";
export { usePinShadowEdges } from "./use-pin-shadow-edges";
export {
  applyInlineScrollDelta,
  directionSign,
  inlineAutoScrollStep,
  inlineDelta,
  inlineDistanceFromEnd,
  inlineDistanceFromStart,
  inlineEndEdge,
  inlineStartEdge,
  inlineStartX,
  isInlineStartHalf,
  normalizeScrollLeft,
  readResolvedDirection,
  visualArrowKey,
  type GridDirection,
} from "./direction";
