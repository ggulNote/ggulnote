import {
  type CalibrationTarget,
  type CalibrationTargetGenerationError,
  type CalibrationTargetGeneratorInput,
  type CalibrationTargetSet,
  type Result,
  type ViewportRect,
  DEFAULT_CALIBRATION_CONFIG,
  makeError,
  makeResult,
} from "./calibration-types";

type Axis = readonly number[];

const MIN_ROWS_COLUMNS = 1;
const MIN_EDGE_INSET_RATIO = 0;
const MAX_EDGE_INSET_RATIO = 0.5;

export const getDefaultGridTargetConfig = (): {
  readonly rows: number;
  readonly columns: number;
  readonly edgeInsetRatio: number;
} => ({
  rows: DEFAULT_CALIBRATION_CONFIG.gridRows,
  columns: DEFAULT_CALIBRATION_CONFIG.gridColumns,
  edgeInsetRatio: DEFAULT_CALIBRATION_CONFIG.edgeInsetRatio,
});

export function generateCalibrationTargets(
  input: CalibrationTargetGeneratorInput,
): Result<CalibrationTargetSet, CalibrationTargetGenerationError> {
  if (!isFiniteViewportRect(input.viewportRect)) {
    return makeError("input-invalid", "Invalid viewport rect for calibration target generation.");
  }

  const axisResult = resolveAxes(input.columns, input.rows, input.edgeInsetRatio);
  if (!axisResult.ok) {
    return axisResult;
  }

  const calibrationTargets: CalibrationTarget[] = [];
  for (let rowIndex = 0; rowIndex < input.rows; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < input.columns; columnIndex += 1) {
      calibrationTargets.push(
        createTarget(
          "calibration",
          `calibration-${rowIndex}-${columnIndex}`,
          calibrationTargets.length,
          {
            x: axisResult.value.xAxis[columnIndex] ?? 0.5,
            y: axisResult.value.yAxis[rowIndex] ?? 0.5,
          },
          input.viewportRect,
        ),
      );
    }
  }

  if (calibrationTargets.length !== input.rows * input.columns) {
    return makeError("sample-count", "Unable to generate all calibration targets.");
  }

  const validationTargets: CalibrationTarget[] = [];
  if (input.rows >= 2 && input.columns >= 2) {
    for (let rowIndex = 0; rowIndex < input.rows - 1; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < input.columns - 1; columnIndex += 1) {
        const validationPoint = {
          x: (axisResult.value.xAxis[columnIndex] + axisResult.value.xAxis[columnIndex + 1]) / 2,
          y: (axisResult.value.yAxis[rowIndex] + axisResult.value.yAxis[rowIndex + 1]) / 2,
        };

        validationTargets.push(
          createTarget(
            "validation",
            `validation-${rowIndex}-${columnIndex}`,
            validationTargets.length,
            validationPoint,
            input.viewportRect,
          ),
        );
      }
    }
  }

  return makeResult({
    calibrationTargets,
    validationTargets,
  });
}

export function regenerateViewportPoints(
  targets: readonly CalibrationTarget[],
  viewportRect: ViewportRect,
): readonly CalibrationTarget[] {
  return targets.map((target) => ({
    ...target,
    viewportPoint: {
      x: viewportRect.left + viewportRect.width * clamp01(target.normalizedPoint.x),
      y: viewportRect.top + viewportRect.height * clamp01(target.normalizedPoint.y),
    },
    normalizedPoint: {
      x: clamp01(target.normalizedPoint.x),
      y: clamp01(target.normalizedPoint.y),
    },
  }));
}

export function getTargetForIndex(
  targetSet: CalibrationTargetSet,
  isValidationPhase: boolean,
  index: number,
): CalibrationTarget | null {
  const list = isValidationPhase ? targetSet.validationTargets : targetSet.calibrationTargets;
  return list[index] ?? null;
}

function resolveAxes(
  columns: number,
  rows: number,
  edgeInsetRatio: number,
): Result<{ readonly xAxis: Axis; readonly yAxis: Axis }, "input-invalid"> {
  if (!Number.isInteger(columns) || columns < MIN_ROWS_COLUMNS) {
    return makeError("input-invalid", "columns must be a positive integer.");
  }

  if (!Number.isInteger(rows) || rows < MIN_ROWS_COLUMNS) {
    return makeError("input-invalid", "rows must be a positive integer.");
  }

  if (!Number.isFinite(edgeInsetRatio) || edgeInsetRatio < MIN_EDGE_INSET_RATIO || edgeInsetRatio >= MAX_EDGE_INSET_RATIO) {
    return makeError("input-invalid", "edgeInsetRatio must be in [0, 0.5).");
  }

  return makeResult({
    xAxis: buildAxis(columns, edgeInsetRatio),
    yAxis: buildAxis(rows, edgeInsetRatio),
  });
}

function buildAxis(count: number, edgeInsetRatio: number): Axis {
  if (count === 1) {
    return [0.5];
  }

  const span = Math.max(0, 1 - edgeInsetRatio * 2);
  const step = span / (count - 1);
  return Array.from({ length: count }, (_, index) => clamp01(edgeInsetRatio + step * index));
}

function createTarget(
  role: "calibration" | "validation",
  id: string,
  order: number,
  normalizedPoint: { readonly x: number; readonly y: number },
  viewportRect: ViewportRect,
): CalibrationTarget {
  const normalized = {
    x: clamp01(normalizedPoint.x),
    y: clamp01(normalizedPoint.y),
  };

  return {
    id,
    order,
    role,
    normalizedPoint: normalized,
    viewportPoint: {
      x: viewportRect.left + viewportRect.width * normalized.x,
      y: viewportRect.top + viewportRect.height * normalized.y,
    },
  };
}

function isFiniteViewportRect(viewportRect: ViewportRect): boolean {
  return Number.isFinite(viewportRect.left)
    && Number.isFinite(viewportRect.top)
    && Number.isFinite(viewportRect.width)
    && Number.isFinite(viewportRect.height)
    && viewportRect.width > 0
    && viewportRect.height > 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}
