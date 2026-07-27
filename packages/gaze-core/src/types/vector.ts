/**
 * A framework-independent three-dimensional vector.
 *
 * The coordinate system is defined by the producer. Values in one operation
 * must use the same coordinate system and scale.
 */
export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
