/**
 * Shared playhead. Plain mutable values, read by the frame loop each frame;
 * pointer events may write many times per frame and only the last one counts.
 */
export const cursor = {
  seq: 0,
  scrubbing: false,
};
