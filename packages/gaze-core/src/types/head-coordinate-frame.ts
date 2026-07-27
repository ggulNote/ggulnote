import type { Vector3 } from "./vector";

export type Matrix3 = Readonly<[
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]>;

export interface HeadCoordinateFrame {
  readonly center: Vector3;
  readonly rotation: Matrix3;
  readonly faceScale: number;
}
