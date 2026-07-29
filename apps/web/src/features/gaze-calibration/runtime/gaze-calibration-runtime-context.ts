import type { ViewportRect } from "../domain/calibration-types";
import type {
  ActiveCalibrationContextProvider,
  GazeTimelineCalibrationContext,
  GazeTimelineCalibrationProfile,
} from "../core/timeline-calibration-transformer";

type RuntimeListener = () => void;

export type GazeCalibrationRuntimeContext =
  ActiveCalibrationContextProvider
  & Readonly<{
    readonly getSnapshot: () => GazeTimelineCalibrationContext;
    readonly setProfile: (
      profile: GazeTimelineCalibrationProfile | null,
    ) => void;
    readonly setPdfViewportRect: (viewportRect: ViewportRect | null) => void;
    readonly subscribe: (listener: RuntimeListener) => () => void;
  }>;

/**
 * Page/feature-session scoped mutable boundary. The object identity is stable,
 * while every Timeline transform reads its current immutable snapshot.
 */
export function createGazeCalibrationRuntimeContext():
GazeCalibrationRuntimeContext {
  let snapshot: GazeTimelineCalibrationContext = {
    profile: null,
    pdfViewportRect: null,
  };
  const listeners = new Set<RuntimeListener>();

  const publish = (next: GazeTimelineCalibrationContext): void => {
    if (
      snapshot.profile === next.profile
      && areViewportRectsEqual(
        snapshot.pdfViewportRect,
        next.pdfViewportRect,
      )
    ) {
      return;
    }
    snapshot = next;
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    getCalibrationContext: () => snapshot,
    getSnapshot: () => snapshot,
    setProfile(profile) {
      publish({ ...snapshot, profile });
    },
    setPdfViewportRect(pdfViewportRect) {
      publish({ ...snapshot, pdfViewportRect });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function areViewportRectsEqual(
  left: ViewportRect | null,
  right: ViewportRect | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || right === null) {
    return false;
  }
  return left.left === right.left
    && left.top === right.top
    && left.width === right.width
    && left.height === right.height;
}
