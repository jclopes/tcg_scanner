import type { CardPrintFormat, Orientation } from "./types";

/**
 * Computes the rotation to apply to the raw flattened card image (straight
 * out of computePerspectiveTransform + warp, before any rotation) so it's
 * presented upright, per the plan's "Orientation handling" section.
 *
 * This relies on a precondition established elsewhere (the imperative
 * shell's on-screen guidance, not yet built, and not something this pure
 * function can verify from its two enum inputs): for a mismatched
 * camera/card combo, the guide always teaches the user to place the
 * physical card so its own top edge faces the **left** side of the
 * camera's view — never "whichever is closer" — so the raw flattened
 * crop's top edge deterministically ends up sitting on the left, not
 * ambiguously on the left-or-right depending on which way the user happened
 * to rotate the card. That's a documented UX contract this function is
 * entitled to assume holds, not a physical law it derives. Given that
 * precondition, this function's actual job is straightforward:
 * - Print format matches the camera-orientation category (portrait card +
 *   portrait camera, or landscape card + landscape camera) -> 0, no extra
 *   rotation beyond the perspective flatten.
 * - Mismatched -> the raw crop's top edge is on the left (per the
 *   precondition above); rotate it so that edge moves to the top instead
 *   (undo the left-ward placement, i.e. correct left -> top, not repeat
 *   top -> left). Always this one direction for both mismatch cases (never
 *   "whichever is closer").
 *
 * Rotation-direction convention: degrees are clockwise (matching Canvas 2D's
 * `ctx.rotate()` and CSS `transform: rotate()`, the rendering APIs this
 * value is expected to eventually feed — see plan's "no UI framework"
 * constraint, vanilla Canvas/DOM). Under that convention, a 90-degree
 * rotation cycles edges left -> top -> right -> bottom -> left; a
 * 270-degree rotation is the inverse cycle. The target here is left -> top,
 * i.e. 90 degrees — confirmed empirically (not just derived symbolically)
 * with an explicit pixel-array rotation in orientation.test.ts, since
 * left-vs-top direction is easy to get backwards (an earlier version of
 * this function had it inverted, caught during review — see
 * docs/plan/03-functional-core.md for the fuller history).
 *
 * A pure function of two 2-value enums: exhaustively tested with all 4
 * input combinations (see orientation.test.ts).
 */
export function computeOutputRotationDegrees(
  camera: Orientation,
  card: CardPrintFormat,
): 0 | 90 | 180 | 270 {
  return camera === card ? 0 : 90;
}
