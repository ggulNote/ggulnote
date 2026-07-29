import { describe, expect, it } from "vitest";

import {
  DEFAULT_PURSUIT_CALIBRATION_CONFIG,
  type PursuitCalibrationConfig,
  validatePursuitCalibrationConfig,
} from "./pursuit-calibration-config";

describe("PursuitCalibrationConfig", () => {
  it("accepts the default config", () => {
    expect(validatePursuitCalibrationConfig(DEFAULT_PURSUIT_CALIBRATION_CONFIG)).toEqual({
      ok: true,
      value: DEFAULT_PURSUIT_CALIBRATION_CONFIG,
    });
  });

  it("accepts a configurable coverage probability", () => {
    const config: PursuitCalibrationConfig = {
      ...DEFAULT_PURSUIT_CALIBRATION_CONFIG,
      roi: {
        ...DEFAULT_PURSUIT_CALIBRATION_CONFIG.roi,
        coverageProbability: 0.9,
      },
    };

    const result = validatePursuitCalibrationConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.roi.coverageProbability).toBe(0.9);
    }
  });

  it.each([0, 1])("rejects invalid coverage probability %s", (coverageProbability) => {
    const result = validatePursuitCalibrationConfig({
      ...DEFAULT_PURSUIT_CALIBRATION_CONFIG,
      roi: {
        ...DEFAULT_PURSUIT_CALIBRATION_CONFIG.roi,
        coverageProbability,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "roi-invalid" },
    });
  });

  it("rejects invalid target dimensions", () => {
    const invalidDiameter = validatePursuitCalibrationConfig({
      ...DEFAULT_PURSUIT_CALIBRATION_CONFIG,
      target: {
        ...DEFAULT_PURSUIT_CALIBRATION_CONFIG.target,
        diameterPx: 0,
      },
    });
    const invalidCenterDot = validatePursuitCalibrationConfig({
      ...DEFAULT_PURSUIT_CALIBRATION_CONFIG,
      target: {
        ...DEFAULT_PURSUIT_CALIBRATION_CONFIG.target,
        centerDotDiameterPx: DEFAULT_PURSUIT_CALIBRATION_CONFIG.target.diameterPx,
      },
    });

    expect(invalidDiameter).toMatchObject({
      ok: false,
      error: { kind: "target-invalid" },
    });
    expect(invalidCenterDot).toMatchObject({
      ok: false,
      error: { kind: "target-invalid" },
    });
  });

  it("rejects an inverted lag range", () => {
    const result = validatePursuitCalibrationConfig({
      ...DEFAULT_PURSUIT_CALIBRATION_CONFIG,
      lagAlignment: {
        ...DEFAULT_PURSUIT_CALIBRATION_CONFIG.lagAlignment,
        minimumLagMs: 301,
        maximumLagMs: 300,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "lag-invalid" },
    });
  });

  it("rejects inverted ROI radius bounds", () => {
    const result = validatePursuitCalibrationConfig({
      ...DEFAULT_PURSUIT_CALIBRATION_CONFIG,
      roi: {
        ...DEFAULT_PURSUIT_CALIBRATION_CONFIG.roi,
        minimumRadiusPx: 181,
        maximumRadiusPx: 180,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "roi-invalid" },
    });
  });
});
