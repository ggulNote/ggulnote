import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PursuitCalibrationSnapshot,
  PursuitTargetSnapshot,
} from "../application/pursuit-calibration-controller";
import { DEFAULT_PURSUIT_CALIBRATION_CONFIG } from "../config/pursuit-calibration-config";
import { PursuitTargetOverlay } from "./pursuit-target-overlay";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function createTarget(
  patch: Partial<PursuitTargetSnapshot> = {},
): PursuitTargetSnapshot {
  return {
    role: "calibration",
    segmentId: "segment-1",
    segmentIndex: 0,
    segmentCount: 2,
    center: { x: 200, y: 160 },
    bounds: {
      left: 172,
      top: 132,
      right: 228,
      bottom: 188,
    },
    movementProgress: 0.25,
    nextDirection: { x: 1, y: 0 },
    showTarget: true,
    showDirectionCue: true,
    shouldCollectSample: false,
    ...patch,
  };
}

function createSnapshot(
  patch: Partial<PursuitCalibrationSnapshot> = {},
): PursuitCalibrationSnapshot {
  return {
    sessionId: "session-1",
    phase: "direction-cue",
    role: "calibration",
    currentTarget: createTarget(),
    progress: {
      completedSegments: 0,
      totalSegments: 4,
      overallRatio: 0,
    },
    collection: {
      calibrationAcceptedCount: 0,
      validationAcceptedCount: 0,
      rejectedCount: 0,
      rejectionCounts: {},
    },
    lagEstimate: null,
    affineModelAvailable: false,
    profile: null,
    error: null,
    timing: {
      sessionStartedAtMs: 0,
      phaseStartedAtMs: 0,
    },
    ...patch,
  };
}

describe("PursuitTargetOverlay", () => {
  it("hides the target when showTarget is false", () => {
    render(
      <PursuitTargetOverlay
        config={DEFAULT_PURSUIT_CALIBRATION_CONFIG}
        snapshot={createSnapshot({
          currentTarget: createTarget({ showTarget: false }),
        })}
      />,
    );
    expect(screen.queryByTestId("pursuit-target")).not.toBeInTheDocument();
  });

  it("uses configured target diameter and border width", () => {
    render(
      <PursuitTargetOverlay
        config={DEFAULT_PURSUIT_CALIBRATION_CONFIG}
        snapshot={createSnapshot()}
      />,
    );
    const target = screen.getByTestId("pursuit-target");
    expect(target).toHaveStyle({
      width: `${DEFAULT_PURSUIT_CALIBRATION_CONFIG.target.diameterPx}px`,
      height: `${DEFAULT_PURSUIT_CALIBRATION_CONFIG.target.diameterPx}px`,
      borderWidth: `${DEFAULT_PURSUIT_CALIBRATION_CONFIG.target.borderWidthPx}px`,
    });
  });

  it("uses the configured center-dot diameter", () => {
    render(
      <PursuitTargetOverlay
        config={DEFAULT_PURSUIT_CALIBRATION_CONFIG}
        snapshot={createSnapshot()}
      />,
    );
    expect(screen.getByTestId("pursuit-target-center-dot")).toHaveStyle({
      width: `${DEFAULT_PURSUIT_CALIBRATION_CONFIG.target.centerDotDiameterPx}px`,
      height: `${DEFAULT_PURSUIT_CALIBRATION_CONFIG.target.centerDotDiameterPx}px`,
    });
  });

  it("places browser viewport coordinates without an offset", () => {
    render(
      <PursuitTargetOverlay
        config={DEFAULT_PURSUIT_CALIBRATION_CONFIG}
        snapshot={createSnapshot()}
      />,
    );
    expect(screen.getByTestId("pursuit-target")).toHaveStyle({
      transform: "translate3d(200px, 160px, 0) translate(-50%, -50%)",
    });
    expect(screen.getByTestId("pursuit-target-overlay")).toHaveStyle({
      position: "fixed",
    });
  });

  it("subtracts the viewport offset once in local coordinate mode", () => {
    render(
      <PursuitTargetOverlay
        config={DEFAULT_PURSUIT_CALIBRATION_CONFIG}
        coordinateSpace="viewport-local"
        snapshot={createSnapshot()}
        viewportRect={{ left: 40, top: 30, width: 800, height: 600 }}
      />,
    );
    expect(screen.getByTestId("pursuit-target")).toHaveStyle({
      transform: "translate3d(160px, 130px, 0) translate(-50%, -50%)",
    });
    expect(screen.getByTestId("pursuit-target-overlay")).toHaveStyle({
      position: "absolute",
    });
  });

  it("shows the direction arrow during a cue", () => {
    render(
      <PursuitTargetOverlay
        config={DEFAULT_PURSUIT_CALIBRATION_CONFIG}
        snapshot={createSnapshot()}
      />,
    );
    expect(screen.getByTestId("pursuit-direction-arrow")).toBeInTheDocument();
  });

  it("hides the direction arrow while moving", () => {
    render(
      <PursuitTargetOverlay
        config={DEFAULT_PURSUIT_CALIBRATION_CONFIG}
        snapshot={createSnapshot({
          phase: "moving",
          currentTarget: createTarget({ showDirectionCue: false }),
        })}
      />,
    );
    expect(screen.queryByTestId("pursuit-direction-arrow")).not.toBeInTheDocument();
  });

  it("hides the arrow without a next direction", () => {
    render(
      <PursuitTargetOverlay
        config={DEFAULT_PURSUIT_CALIBRATION_CONFIG}
        snapshot={createSnapshot({
          currentTarget: createTarget({ nextDirection: null }),
        })}
      />,
    );
    expect(screen.queryByTestId("pursuit-direction-arrow")).not.toBeInTheDocument();
  });

  it("hides the arrow for zero or invalid vectors", () => {
    const { rerender } = render(
      <PursuitTargetOverlay
        config={DEFAULT_PURSUIT_CALIBRATION_CONFIG}
        snapshot={createSnapshot({
          currentTarget: createTarget({ nextDirection: { x: 0, y: 0 } }),
        })}
      />,
    );
    expect(screen.queryByTestId("pursuit-direction-arrow")).not.toBeInTheDocument();
    rerender(
      <PursuitTargetOverlay
        config={DEFAULT_PURSUIT_CALIBRATION_CONFIG}
        snapshot={createSnapshot({
          currentTarget: createTarget({
            nextDirection: { x: Number.NaN, y: 1 },
          }),
        })}
      />,
    );
    expect(screen.queryByTestId("pursuit-direction-arrow")).not.toBeInTheDocument();
  });

  it("renders a right-facing direction angle", () => {
    render(
      <PursuitTargetOverlay
        config={DEFAULT_PURSUIT_CALIBRATION_CONFIG}
        snapshot={createSnapshot()}
      />,
    );
    expect(screen.getByTestId("pursuit-direction-arrow"))
      .toHaveAttribute("data-angle-rad", "0");
  });

  it("renders a downward direction angle", () => {
    render(
      <PursuitTargetOverlay
        config={DEFAULT_PURSUIT_CALIBRATION_CONFIG}
        snapshot={createSnapshot({
          currentTarget: createTarget({ nextDirection: { x: 0, y: 1 } }),
        })}
      />,
    );
    expect(Number(screen.getByTestId("pursuit-direction-arrow")
      .getAttribute("data-angle-rad"))).toBeCloseTo(Math.PI / 2);
  });

  it("renders a diagonal direction angle", () => {
    render(
      <PursuitTargetOverlay
        config={DEFAULT_PURSUIT_CALIBRATION_CONFIG}
        snapshot={createSnapshot({
          currentTarget: createTarget({ nextDirection: { x: 1, y: 1 } }),
        })}
      />,
    );
    expect(Number(screen.getByTestId("pursuit-direction-arrow")
      .getAttribute("data-angle-rad"))).toBeCloseTo(Math.PI / 4);
  });

  it("disables pointer events on the overlay, target, and arrow", () => {
    render(
      <PursuitTargetOverlay
        config={DEFAULT_PURSUIT_CALIBRATION_CONFIG}
        snapshot={createSnapshot()}
      />,
    );
    expect(screen.getByTestId("pursuit-target-overlay")).toHaveStyle({
      pointerEvents: "none",
    });
    expect(screen.getByTestId("pursuit-target")).toHaveStyle({
      pointerEvents: "none",
    });
    expect(screen.getByTestId("pursuit-direction-arrow")).toHaveStyle({
      pointerEvents: "none",
    });
  });

  it("clips the layer and preserves controller-provided bounds metadata", () => {
    render(
      <PursuitTargetOverlay
        config={DEFAULT_PURSUIT_CALIBRATION_CONFIG}
        snapshot={createSnapshot()}
      />,
    );
    expect(screen.getByTestId("pursuit-target-overlay")).toHaveStyle({
      overflow: "hidden",
    });
    expect(screen.getByTestId("pursuit-target")).toHaveAttribute(
      "data-bounds-left",
      "172",
    );
  });

  it("updates the transform when the snapshot center changes", () => {
    const { rerender } = render(
      <PursuitTargetOverlay
        config={DEFAULT_PURSUIT_CALIBRATION_CONFIG}
        snapshot={createSnapshot()}
      />,
    );
    rerender(
      <PursuitTargetOverlay
        config={DEFAULT_PURSUIT_CALIBRATION_CONFIG}
        snapshot={createSnapshot({
          currentTarget: createTarget({ center: { x: 320, y: 240 } }),
        })}
      />,
    );
    expect(screen.getByTestId("pursuit-target")).toHaveStyle({
      transform: "translate3d(320px, 240px, 0) translate(-50%, -50%)",
    });
  });

  it("does not create component timers", () => {
    vi.useFakeTimers();
    render(
      <PursuitTargetOverlay
        config={DEFAULT_PURSUIT_CALIBRATION_CONFIG}
        snapshot={createSnapshot()}
      />,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans rendered guidance on unmount", () => {
    const { unmount } = render(
      <PursuitTargetOverlay
        config={DEFAULT_PURSUIT_CALIBRATION_CONFIG}
        snapshot={createSnapshot()}
      />,
    );
    unmount();
    expect(screen.queryByTestId("pursuit-target")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
