export const MEDIAPIPE_TASKS_VISION_VERSION = "0.10.35";

export const MEDIAPIPE_DEFAULT_WASM_ROOT =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VISION_VERSION}/wasm`;

export const MEDIAPIPE_DEFAULT_FACE_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-assets/face_landmarker.task";

export function resolveMediapipeWasmRoot(): string {
  return process.env.NEXT_PUBLIC_MEDIAPIPE_WASM_ROOT ?? MEDIAPIPE_DEFAULT_WASM_ROOT;
}

export function resolveFaceLandmarkerModelUrl(): string {
  return (
    process.env.NEXT_PUBLIC_FACE_LANDMARKER_MODEL_URL ??
    MEDIAPIPE_DEFAULT_FACE_LANDMARKER_MODEL_URL
  );
}
