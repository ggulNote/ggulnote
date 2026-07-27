/** Landmark indices used by MediaPipe face mesh and JEO logic. */
export const LEFT_IRIS_CENTER_INDEX = 468;
export const RIGHT_IRIS_CENTER_INDEX = 473;

/**
 * Indices near the nose used by JEO for head orientation / scale estimation.
 *
 * From the Python reference `MonitorTracking.py`:
 * [4, 45, 275, 220, 440, 1, 5, 51, 281, 44, 274, 241,
 * 461, 125, 354, 218, 438, 195, 167, 393, 165, 391, 3, 248]
 */
export const NOSE_LANDMARK_INDICES = [
  4,
  45,
  275,
  220,
  440,
  1,
  5,
  51,
  281,
  44,
  274,
  241,
  461,
  125,
  354,
  218,
  438,
  195,
  167,
  393,
  165,
  391,
  3,
  248,
] as const;

/** JEO Python `base_radius` constant used during sphere init. */
export const JEO_BASE_EYE_SPHERE_RADIUS = 20;

/** Raw Gaze moving-average window size (Python `filter_length`). */
export const JEO_FILTER_LENGTH = 10;

/**
 * Default safety constants.
 */
export const MINIMUM_FACE_SCALE = 1e-9;
export const ORIENTATION_EPSILON = 1e-9;
export const REFERENCE_ORIENTATION_FLIP_EPSILON = 1e-9;

/** Smoothing reset threshold after long tracking loss (ms). */
export const STALE_TRACKING_RESET_MS = 500;

/** Age threshold for "latest frame used for eye geometry init" (ms). */
export const EYE_GEOMETRY_INIT_MAX_STALE_MS = 500;

/**
 * Backward-compatible alias for existing partial code references.
 */
export const JE0_BASE_EYE_SPHERE_RADIUS = JEO_BASE_EYE_SPHERE_RADIUS;
