import type { SessionTimeMs } from "@ggulnote/shared-types";
import type { Vector3 } from "./vector";

/**
 * Eye-sphere offset profile used during runtime gaze computation.
 */
export interface EyeGeometryProfile {
  readonly leftEyeLocalOffset: Vector3;
  readonly rightEyeLocalOffset: Vector3;

  readonly leftReferenceFaceScale: number;
  readonly rightReferenceFaceScale: number;

  readonly baseEyeSphereRadius: number;

  readonly initializedFromFrameId: number;
  readonly initializedAt: SessionTimeMs;
}
