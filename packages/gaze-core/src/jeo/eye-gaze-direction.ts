import { add, dot, multiplyScalar, normalize, subtract } from "../math/vector3";

export function computeEyeDirection(
  irisWorld: { x: number; y: number; z: number },
  eyeSphereWorld: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const delta = subtract(irisWorld, eyeSphereWorld);
  const direction = normalize(delta);
  if (!direction) {
    throw new RangeError("Cannot normalize zero-length eye direction vector.");
  }

  return direction;
}

export function combineDirections(
  leftDirection: { x: number; y: number; z: number },
  rightDirection: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const sum = add(leftDirection, rightDirection);
  const scaled = multiplyScalar(sum, 0.5);
  const combined = normalize(scaled);
  if (!combined) {
    throw new RangeError("Cannot combine eye directions.");
  }

  return combined;
}

export function isOpposingDirections(
  leftDirection: { x: number; y: number; z: number },
  rightDirection: { x: number; y: number; z: number },
): boolean {
  const similarity = dot(leftDirection, rightDirection);
  return Number.isFinite(similarity) && similarity < -0.97;
}
