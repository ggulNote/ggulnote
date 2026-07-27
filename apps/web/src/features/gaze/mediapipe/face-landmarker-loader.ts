import { FilesetResolver, FaceLandmarker, type FaceLandmarkerOptions } from "@mediapipe/tasks-vision";

export interface FaceLandmarkerLoaderOptions {
  readonly modelUrl: string;
  readonly wasmRoot: string;
}

export async function createFaceLandmarker(options: FaceLandmarkerLoaderOptions): Promise<FaceLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(options.wasmRoot);

  const detectorOptions: FaceLandmarkerOptions = {
    baseOptions: {
      modelAssetPath: options.modelUrl,
    },
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  };

  return FaceLandmarker.createFromOptions(vision, detectorOptions);
}
