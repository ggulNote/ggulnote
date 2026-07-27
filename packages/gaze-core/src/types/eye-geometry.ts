import type { Vector3 } from "./vector";

/**
 * Geometry needed to derive one eye direction in a consistent 3D space.
 *
 * This type only carries geometry. It does not implement the JEO vector
 * calculation.
 */
export interface EyeGeometry {
  readonly eyeballCenter: Vector3;
  readonly irisCenter: Vector3;
}

export interface EyeGeometryProfile {
  readonly leftEye: EyeGeometry | null;
  readonly rightEye: EyeGeometry | null;
}
