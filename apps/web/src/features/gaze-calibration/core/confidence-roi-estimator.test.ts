import { describe, expect, it } from "vitest";

import { DEFAULT_PURSUIT_CALIBRATION_CONFIG } from "../config/pursuit-calibration-config";
import {
  LEGACY_GAZE_ROI_COVERAGE_PROBABILITY,
  type GazeConfidenceRoiTemplate,
  type GazeResidual,
} from "../domain/calibration-types";
import {
  calculateChiSquareQuantile2D,
  calculateEmpiricalQuantile,
  createConfidenceRoiAtPoint,
  estimateConfidenceRoiTemplate,
  toLegacyGazeRoi95,
  type ConfidenceRoiTemplateConfig,
} from "./confidence-roi-estimator";

function makeRoiConfig(
  overrides: Partial<ConfidenceRoiTemplateConfig> = {},
): ConfidenceRoiTemplateConfig {
  return {
    ...DEFAULT_PURSUIT_CALIBRATION_CONFIG.roi,
    ...overrides,
  };
}

function estimate(
  residuals: readonly GazeResidual[],
  overrides: Partial<ConfidenceRoiTemplateConfig> = {},
) {
  return estimateConfidenceRoiTemplate(
    residuals,
    makeRoiConfig(overrides),
  );
}

function makeEllipseResiduals(
  pairCount: number,
  radiusX: number,
  radiusY: number,
  rotationRad = 0,
): readonly GazeResidual[] {
  const residuals: GazeResidual[] = [];
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);

  for (let index = 0; index < pairCount; index += 1) {
    const angle = index * Math.PI * 2 / pairCount;
    const radialScale = 0.3 + 0.1 * (index % 7);
    const x = radiusX * radialScale * Math.cos(angle);
    const y = radiusY * radialScale * Math.sin(angle);
    const rotatedX = x * cos - y * sin;
    const rotatedY = x * sin + y * cos;

    residuals.push(
      { x: rotatedX, y: rotatedY },
      { x: -rotatedX, y: -rotatedY },
    );
  }

  return residuals;
}

function makeTemplate(
  overrides: Partial<GazeConfidenceRoiTemplate> = {},
): GazeConfidenceRoiTemplate {
  return {
    coverageProbability: LEGACY_GAZE_ROI_COVERAGE_PROBABILITY,
    radiusMajor: 4,
    radiusMinor: 2,
    rotationRad: 0,
    covariance: { xx: 4, xy: 0, yy: 1 },
    scaleQuantile: 1,
    estimationMethod: "gaussian-chi-square",
    source: "validation-residuals",
    clampBoundsToViewport: true,
    metrics: {
      requestedCoverage: LEGACY_GAZE_ROI_COVERAGE_PROBABILITY,
      empiricalCoverage: 1,
      coveredResidualCount: 1,
      totalResidualCount: 1,
      roiAreaPx2: Math.PI * 8,
      scaleQuantile: 1,
      radiusMajor: 4,
      radiusMinor: 2,
      majorRadiusClamped: false,
      minorRadiusClamped: false,
    },
    ...overrides,
  };
}

describe("confidence ROI quantiles", () => {
  it.each([-0.1, 0, 1, 1.1])(
    "rejects empirical probability %s",
    (probability) => {
      expect(calculateEmpiricalQuantile([1, 2, 3], probability)).toMatchObject({
        ok: false,
        error: { kind: "invalid-probability" },
      });
    },
  );

  it("uses nearest rank for 0.90, 0.95, and 0.99", () => {
    const values = Array.from({ length: 20 }, (_, index) => index + 1);

    expect(calculateEmpiricalQuantile(values, 0.9)).toMatchObject({
      ok: true,
      value: { value: 18, index: 17 },
    });
    expect(calculateEmpiricalQuantile(values, 0.95)).toMatchObject({
      ok: true,
      value: { value: 19, index: 18 },
    });
    expect(calculateEmpiricalQuantile(values, 0.99)).toMatchObject({
      ok: true,
      value: { value: 20, index: 19 },
    });
  });

  it("rejects empty or entirely non-finite input", () => {
    expect(calculateEmpiricalQuantile([], 0.5)).toMatchObject({
      ok: false,
      error: { kind: "empty" },
    });
    expect(calculateEmpiricalQuantile([Number.NaN, Infinity], 0.5)).toMatchObject({
      ok: false,
      error: { kind: "empty" },
    });
  });

  it("excludes non-finite values before applying nearest rank", () => {
    expect(
      calculateEmpiricalQuantile([Infinity, 1, 2, Number.NaN, 3], 0.5),
    ).toMatchObject({
      ok: true,
      value: { value: 2, index: 1, sampleCount: 3 },
    });
  });

  it("handles a repeated-value array deterministically", () => {
    expect(calculateEmpiricalQuantile([4, 4, 4, 4], 0.3)).toMatchObject({
      ok: true,
      value: { value: 4, index: 1 },
    });
  });

  it("calculates increasing 2D chi-square quantiles", () => {
    const q90 = calculateChiSquareQuantile2D(0.9);
    const q95 = calculateChiSquareQuantile2D(0.95);
    const q99 = calculateChiSquareQuantile2D(0.99);

    expect(q90.ok).toBe(true);
    expect(q95.ok).toBe(true);
    expect(q99.ok).toBe(true);
    if (q90.ok && q95.ok && q99.ok) {
      expect(q90.value.quantile).toBeLessThan(q95.value.quantile);
      expect(q95.value.quantile).toBeLessThan(q99.value.quantile);
      expect(q95.value.quantile).toBeCloseTo(5.991, 3);
    }
  });

  it.each([-0.1, 0, 1, 1.1])(
    "rejects 2D chi-square probability %s",
    (probability) => {
      expect(calculateChiSquareQuantile2D(probability)).toMatchObject({
        ok: false,
        error: { kind: "invalid-coverage" },
      });
    },
  );

  it("rejects non-finite 2D chi-square probability", () => {
    expect(calculateChiSquareQuantile2D(Number.NaN)).toMatchObject({
      ok: false,
      error: { kind: "invalid-input" },
    });
  });
});

describe("empirical Mahalanobis confidence ROI", () => {
  it("estimates a near-circular ROI from corrected residuals", () => {
    const result = estimate(makeEllipseResiduals(42, 10, 10), {
      minimumResidualCount: 20,
      minimumRadiusPx: 0,
      maximumRadiusPx: 1_000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const { template } = result.value;
      expect(template.estimationMethod).toBe("empirical-mahalanobis");
      expect(template.source).toBe("validation-residuals");
      expect(template.radiusMajor / template.radiusMinor).toBeLessThan(1.2);
      expect(template.metrics.empiricalCoverage)
        .toBeGreaterThanOrEqual(template.metrics.requestedCoverage);
    }
  });

  it("estimates distinct axes for an elliptical distribution", () => {
    const result = estimate(makeEllipseResiduals(42, 16, 4), {
      minimumResidualCount: 20,
      minimumRadiusPx: 0,
      maximumRadiusPx: 1_000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.template.radiusMajor)
        .toBeGreaterThan(result.value.template.radiusMinor * 2);
    }
  });

  it("recovers a rotated residual distribution", () => {
    const rotationRad = 0.55;
    const result = estimate(
      makeEllipseResiduals(56, 18, 4, rotationRad),
      {
        minimumResidualCount: 20,
        minimumRadiusPx: 0,
        maximumRadiusPx: 1_000,
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.template.rotationRad).toBeCloseTo(rotationRad, 1);
    }
  });

  it("uses configured probability for scale and covered count", () => {
    const residuals = makeEllipseResiduals(50, 20, 7, 0.2);
    const result = estimate(residuals, {
      coverageProbability: 0.9,
      minimumResidualCount: 20,
      minimumRadiusPx: 0,
      maximumRadiusPx: 1_000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const { metrics, scaleQuantile } = result.value.template;
      expect(scaleQuantile).toBeGreaterThan(0);
      expect(metrics.totalResidualCount).toBe(residuals.length);
      expect(metrics.coveredResidualCount)
        .toBeGreaterThanOrEqual(Math.ceil(residuals.length * 0.9));
      expect(metrics.empiricalCoverage).toBeCloseTo(
        metrics.coveredResidualCount / metrics.totalResidualCount,
        12,
      );
    }
  });

  it("grows for 0.90, 0.95, and 0.99 coverage", () => {
    const residuals = makeEllipseResiduals(100, 20, 8, 0.4);
    const templates = [0.9, 0.95, 0.99].map((coverageProbability) => {
      const result = estimate(residuals, {
        coverageProbability,
        minimumResidualCount: 20,
        minimumRadiusPx: 0,
        maximumRadiusPx: 1_000,
      });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.value.template;
    });
    const [roi90, roi95, roi99] = templates;
    if (roi90 === undefined || roi95 === undefined || roi99 === undefined) {
      throw new Error("Expected three ROI estimates.");
    }

    expect(roi95.radiusMajor).toBeGreaterThan(roi90.radiusMajor);
    expect(roi99.radiusMajor).toBeGreaterThan(roi95.radiusMajor);
    expect(roi95.radiusMinor).toBeGreaterThan(roi90.radiusMinor);
    expect(roi99.radiusMinor).toBeGreaterThan(roi95.radiusMinor);
  });

  it("uses supplied origin-centered residuals without a second bias pass", () => {
    const residuals = [
      { x: -3, y: -1 },
      { x: 3, y: 1 },
      { x: -2, y: 2 },
      { x: 2, y: -2 },
      { x: -1, y: 0.5 },
      { x: 1, y: -0.5 },
    ];
    const result = estimate(residuals, {
      minimumResidualCount: residuals.length,
      minimumRadiusPx: 0,
      maximumRadiusPx: 1_000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.template.covariance.xx).toBeCloseTo(5.6);
      expect(result.value.template.covariance.yy).toBeCloseTo(2.1);
    }
  });

  it("bounds a distribution containing extreme residuals", () => {
    const residuals = [
      ...makeEllipseResiduals(40, 10, 4),
      { x: 20_000, y: -15_000 },
      { x: -20_000, y: 15_000 },
    ];
    const result = estimate(residuals, {
      minimumResidualCount: 20,
      maximumRadiusPx: 50,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.template.radiusMajor).toBeLessThanOrEqual(50);
      expect(result.value.template.radiusMinor).toBeLessThanOrEqual(50);
      expect(result.value.template.metrics.majorRadiusClamped).toBe(true);
    }
  });

  it("rejects non-finite validation residuals", () => {
    expect(
      estimate(
        [{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }],
        { minimumResidualCount: 2 },
      ),
    ).toMatchObject({
      ok: false,
      error: { kind: "invalid-input" },
    });
  });
});

describe("Gaussian chi-square confidence ROI", () => {
  it("grows for 0.90, 0.95, and 0.99 with one covariance", () => {
    const residuals = makeEllipseResiduals(60, 15, 5, 0.3);
    const templates = [0.9, 0.95, 0.99].map((coverageProbability) => {
      const result = estimate(residuals, {
        estimationMethod: "gaussian-chi-square",
        coverageProbability,
        minimumResidualCount: 20,
        minimumRadiusPx: 0,
        maximumRadiusPx: 1_000,
      });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      return result.value.template;
    });
    const [roi90, roi95, roi99] = templates;
    if (roi90 === undefined || roi95 === undefined || roi99 === undefined) {
      throw new Error("Expected three ROI estimates.");
    }

    expect(roi95.radiusMajor).toBeGreaterThan(roi90.radiusMajor);
    expect(roi99.radiusMajor).toBeGreaterThan(roi95.radiusMajor);
    expect(roi95.radiusMinor).toBeGreaterThan(roi90.radiusMinor);
    expect(roi99.radiusMinor).toBeGreaterThan(roi95.radiusMinor);
  });

  it.each([0, 1])(
    "returns a domain error for configured probability %s",
    (coverageProbability) => {
      expect(
        estimate(makeEllipseResiduals(10, 4, 2), {
          estimationMethod: "gaussian-chi-square",
          coverageProbability,
          minimumResidualCount: 4,
        }),
      ).toMatchObject({
        ok: false,
        error: { kind: "invalid-coverage" },
      });
    },
  );

  it("marks singular covariance as fallback", () => {
    const residuals = Array.from(
      { length: 10 },
      () => ({ x: 1, y: 1 }),
    );
    const result = estimate(residuals, {
      estimationMethod: "gaussian-chi-square",
      minimumResidualCount: 4,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.template.source).toBe("fallback");
      expect(result.value.template.fallbackReason).toBe("singular-covariance");
    }
  });
});

describe("confidence ROI radius clamp and metrics", () => {
  it("applies the minimum radius clamp to both axes", () => {
    const result = estimate(makeEllipseResiduals(20, 0.2, 0.1), {
      estimationMethod: "gaussian-chi-square",
      minimumResidualCount: 10,
      minimumRadiusPx: 5,
      maximumRadiusPx: 100,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const { template } = result.value;
      expect(template.radiusMajor).toBe(5);
      expect(template.radiusMinor).toBe(5);
      expect(template.metrics.majorRadiusClamped).toBe(true);
      expect(template.metrics.minorRadiusClamped).toBe(true);
    }
  });

  it("applies maximum clamp and measures the final ellipse", () => {
    const result = estimate(makeEllipseResiduals(40, 200, 80), {
      estimationMethod: "gaussian-chi-square",
      minimumResidualCount: 20,
      minimumRadiusPx: 0,
      maximumRadiusPx: 8,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const { metrics } = result.value.template;
      expect(metrics.radiusMajor).toBe(8);
      expect(metrics.radiusMinor).toBe(8);
      expect(metrics.majorRadiusClamped).toBe(true);
      expect(metrics.minorRadiusClamped).toBe(true);
      expect(metrics.roiAreaPx2).toBeCloseTo(Math.PI * 8 * 8);
      expect(metrics.empiricalCoverage).toBeLessThan(metrics.requestedCoverage);
    }
  });
});

describe("confidence ROI bounds", () => {
  const viewportRect = { left: 0, top: 0, width: 10, height: 10 };

  it("computes unrotated ellipse bounds", () => {
    const roi = createConfidenceRoiAtPoint({ x: 5, y: 5 }, makeTemplate());

    expect(roi.axisAlignedBounds).toEqual({
      left: 1,
      top: 3,
      right: 9,
      bottom: 7,
    });
  });

  it("computes rotated ellipse bounds", () => {
    const roi = createConfidenceRoiAtPoint(
      { x: 0, y: 0 },
      makeTemplate({ rotationRad: Math.PI / 4 }),
    );
    const halfExtent = Math.sqrt(10);

    expect(roi.axisAlignedBounds.left).toBeCloseTo(-halfExtent);
    expect(roi.axisAlignedBounds.top).toBeCloseTo(-halfExtent);
    expect(roi.axisAlignedBounds.right).toBeCloseTo(halfExtent);
    expect(roi.axisAlignedBounds.bottom).toBeCloseTo(halfExtent);
  });

  it("clamps only bounds when configured", () => {
    const roi = createConfidenceRoiAtPoint(
      { x: 1, y: 1 },
      makeTemplate({ clampBoundsToViewport: true }),
      viewportRect,
    );

    expect(roi.axisAlignedBounds.left).toBe(0);
    expect(roi.axisAlignedBounds.top).toBe(0);
    expect(roi.radiusMajor).toBe(4);
    expect(roi.radiusMinor).toBe(2);
  });

  it("does not clamp bounds when disabled", () => {
    const roi = createConfidenceRoiAtPoint(
      { x: 1, y: 1 },
      makeTemplate({ clampBoundsToViewport: false }),
      viewportRect,
    );

    expect(roi.axisAlignedBounds.left).toBe(-3);
    expect(roi.axisAlignedBounds.top).toBe(-1);
  });
});

describe("confidence ROI fallback", () => {
  it("uses explicit fallback for insufficient residuals", () => {
    const result = estimate([{ x: 0.2, y: 0.1 }], {
      minimumResidualCount: 5,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.template.source).toBe("fallback");
      expect(result.value.template.fallbackReason).toBe("insufficient-residuals");
    }
  });

  it("uses Gaussian fallback when empirical scale is degenerate", () => {
    const residuals = [
      ...Array.from({ length: 20 }, () => ({ x: 0, y: 0 })),
      { x: 4, y: 0 },
      { x: -4, y: 0 },
      { x: 0, y: 2 },
      { x: 0, y: -2 },
    ];
    const result = estimate(residuals, {
      coverageProbability: 0.5,
      minimumResidualCount: 4,
      minimumRadiusPx: 0,
      maximumRadiusPx: 100,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.template.estimationMethod).toBe("gaussian-chi-square");
      expect(result.value.template.source).toBe("fallback");
      expect(result.value.template.fallbackReason)
        .toBe("invalid-distance-distribution");
    }
  });

  it("does not mark a valid empirical estimate as fallback", () => {
    const result = estimate(makeEllipseResiduals(30, 10, 4), {
      minimumResidualCount: 10,
      minimumRadiusPx: 0,
      maximumRadiusPx: 1_000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.template.source).toBe("validation-residuals");
      expect(result.value.template.fallbackReason).toBeUndefined();
    }
  });
});

describe("legacy GazeRoi95 compatibility", () => {
  it("converts legacy coverage without changing geometry", () => {
    const roi = createConfidenceRoiAtPoint(
      { x: 10, y: 20 },
      makeTemplate(),
      undefined,
      "2.0.0",
    );
    const legacy = toLegacyGazeRoi95(roi);

    expect(legacy.ok).toBe(true);
    if (legacy.ok) {
      expect(legacy.value.confidence)
        .toBe(LEGACY_GAZE_ROI_COVERAGE_PROBABILITY);
      expect(legacy.value.center).toEqual(roi.center);
      expect(legacy.value.axisAlignedBounds).toEqual(roi.axisAlignedBounds);
      expect(legacy.value.calibrationVersion).toBe("2.0.0");
    }
  });

  it("rejects conversion for non-legacy coverage", () => {
    const baseTemplate = makeTemplate();
    const roi = createConfidenceRoiAtPoint(
      { x: 0, y: 0 },
      makeTemplate({
        coverageProbability: 0.9,
        metrics: {
          ...baseTemplate.metrics,
          requestedCoverage: 0.9,
        },
      }),
    );

    expect(toLegacyGazeRoi95(roi)).toMatchObject({
      ok: false,
      error: { kind: "unsupported-coverage" },
    });
  });
});
