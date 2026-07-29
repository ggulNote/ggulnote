import type {
  CalibrationTrajectory,
  ValidationTrajectory,
} from "./pursuit-types";

export const CALIBRATION_PURSUIT_TRAJECTORY: CalibrationTrajectory = {
  id: "pursuit-calibration-v1",
  role: "calibration",
  segments: [
    {
      id: "calibration-top-horizontal",
      role: "calibration",
      from: { x: 0, y: 0 },
      to: { x: 1, y: 0 },
    },
    {
      id: "calibration-right-vertical",
      role: "calibration",
      from: { x: 1, y: 0 },
      to: { x: 1, y: 1 },
    },
    {
      id: "calibration-bottom-horizontal",
      role: "calibration",
      from: { x: 1, y: 1 },
      to: { x: 0, y: 1 },
    },
    {
      id: "calibration-left-vertical",
      role: "calibration",
      from: { x: 0, y: 1 },
      to: { x: 0, y: 0 },
    },
    {
      id: "calibration-diagonal",
      role: "calibration",
      from: { x: 0, y: 0 },
      to: { x: 1, y: 1 },
    },
    {
      id: "calibration-return-to-center-left",
      role: "calibration",
      from: { x: 1, y: 1 },
      to: { x: 0, y: 0.5 },
    },
    {
      id: "calibration-center-horizontal",
      role: "calibration",
      from: { x: 0, y: 0.5 },
      to: { x: 1, y: 0.5 },
    },
  ],
};

export const VALIDATION_PURSUIT_TRAJECTORY: ValidationTrajectory = {
  id: "pursuit-validation-v1",
  role: "validation",
  segments: [
    {
      id: "validation-diagonal-down",
      role: "validation",
      from: { x: 0.1, y: 0.25 },
      to: { x: 0.9, y: 0.75 },
    },
    {
      id: "validation-lower-horizontal",
      role: "validation",
      from: { x: 0.9, y: 0.75 },
      to: { x: 0.1, y: 0.75 },
    },
    {
      id: "validation-diagonal-up",
      role: "validation",
      from: { x: 0.1, y: 0.75 },
      to: { x: 0.9, y: 0.25 },
    },
    {
      id: "validation-center-crossing-diagonal",
      role: "validation",
      from: { x: 0.9, y: 0.25 },
      to: { x: 0.5, y: 0.9 },
    },
    {
      id: "validation-center-vertical",
      role: "validation",
      from: { x: 0.5, y: 0.9 },
      to: { x: 0.5, y: 0.1 },
    },
  ],
};
