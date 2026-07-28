import {
  type InteractionClock,
  type SessionTimeMs,
  toSessionTimeMs,
} from "@ggulnote/interaction-core";
import {
  CALIBRATION_MODEL_VERSION,
  DEFAULT_COLLECTION_CONFIG,
  DEFAULT_QUALITY_THRESHOLDS,
  DEFAULT_TIMING_CONFIG,
  type AffineCalibrationModel,
  type CalibrationCollectionConfig,
  type CalibrationError,
  type CalibrationErrorKind,
  type CalibrationObservation,
  type CalibrationPhase,
  type CalibrationRoiTemplate,
  type CalibrationSessionControllerState,
  type CalibrationTarget,
  type CalibrationTargetRole,
  type CalibrationTargetSet,
  type CalibrationTimingConfig,
  type CalibrationValidationMetrics,
  type CalibrationQualityThresholds,
  type CalibrationRawSample,
  type GazeCalibrationProfile,
  type SampleAcceptanceReason,
  type ValidationResidualSample,
  type ViewportRect,
} from "../domain/calibration-types";
import {
  generateCalibrationTargets,
  getDefaultGridTargetConfig,
  getTargetForIndex,
  regenerateViewportPoints,
} from "../domain/calibration-targets";
import {
  CalibrationSampleCollector,
  incrementRejectionCounter,
  isCollectingWindowActive,
  makeRejectionCounter,
} from "../core/calibration-sample-collector";
import { fitAffineCalibration } from "../core/affine-calibration";
import { analyzeResiduals, calculateResidualCovariance } from "../core/residual-analysis";
import { estimateRoiTemplate } from "../core/gaze-roi-estimator";
type ControllerListener = (state: CalibrationSessionControllerState) => void;
type ControllerMode = "idle" | "calibration" | "validation";
type ValidationWindowStep = "settling" | "collecting";

type ControllerConfig = Readonly<{
  readonly clock?: InteractionClock;
  readonly timingConfig?: Partial<CalibrationTimingConfig>;
  readonly collectionConfig?: Partial<CalibrationCollectionConfig>;
  readonly qualityThresholds?: Partial<CalibrationQualityThresholds>;
  readonly calibrationRows?: number;
  readonly calibrationColumns?: number;
  readonly calibrationEdgeInsetRatio?: number;
}>;

const SESSION_ID_START = 1;
const DEFAULT_PROGRESS = 0;
const MIN_PROGRESS = 0;
const MAX_PROGRESS = 1;

export class CalibrationSessionController {
  private readonly listeners = new Set<ControllerListener>();
  private readonly collector = new CalibrationSampleCollector();

  private readonly timingConfig: CalibrationTimingConfig;
  private readonly collectionConfig: CalibrationCollectionConfig;
  private readonly qualityThresholds: CalibrationQualityThresholds;
  private readonly calibrationRows: number;
  private readonly calibrationColumns: number;
  private readonly calibrationEdgeInsetRatio: number;

  private clock: InteractionClock | null = null;
  private mode: ControllerMode = "idle";
  private validationStep: ValidationWindowStep | null = null;

  private phase: CalibrationPhase = "idle";
  private phaseStartedAtMs: SessionTimeMs | null = null;

  private fittedModel: AffineCalibrationModel | null = null;
  private sessionId: number | null = null;
  private nextSessionId = SESSION_ID_START;
  private sessionStartedAtMs: SessionTimeMs | null = null;

  private targetSet: CalibrationTargetSet | null = null;
  private targetViewportRect: ViewportRect | null = null;
  private currentCalibrationTargetIndex = 0;
  private currentValidationTargetIndex = 0;

  private collectingWindowStartMs: SessionTimeMs | null = null;
  private collectingWindowEndMs: SessionTimeMs | null = null;

  private exclusionCounts: ReadonlyMap<SampleAcceptanceReason, number> = makeRejectionCounter();

  private activeProfileValue: GazeCalibrationProfile | null = null;
  private activeProfileQuality: "valid" | "degraded" | null = null;
  private validationMetrics: CalibrationValidationMetrics | null = null;
  private validationMetricsBeforeCorrection: CalibrationValidationMetrics | null = null;
  private roiTemplate: CalibrationRoiTemplate | null = null;
  private validationRoiCandidateSource: "validation-residuals" | "fallback" | null = null;
  private statusMessageText: string | null = null;
  private errorState: CalibrationError | null = null;

  private disposed = false;
  private fittingInProgress = false;

  public constructor(config: ControllerConfig = {}) {
    const defaultGrid = getDefaultGridTargetConfig();

    this.timingConfig = {
      ...DEFAULT_TIMING_CONFIG,
      ...config.timingConfig,
    };

    this.collectionConfig = {
      ...DEFAULT_COLLECTION_CONFIG,
      ...config.collectionConfig,
    };

    this.qualityThresholds = {
      ...DEFAULT_QUALITY_THRESHOLDS,
      ...config.qualityThresholds,
    };

    this.calibrationRows = config.calibrationRows ?? defaultGrid.rows;
    this.calibrationColumns = config.calibrationColumns ?? defaultGrid.columns;
    this.calibrationEdgeInsetRatio = config.calibrationEdgeInsetRatio ?? defaultGrid.edgeInsetRatio;
    this.clock = config.clock ?? null;
  }

  public setClock(clock: InteractionClock): void {
    this.clock = clock;
  }

  public get state(): CalibrationSessionControllerState {
    return this.getSnapshot();
  }

  public get completedProfile(): GazeCalibrationProfile | null {
    return this.activeProfileValue;
  }

  public get failureReason(): CalibrationError | null {
    return this.errorState;
  }

  public subscribe(listener: ControllerListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());

    return () => {
      this.listeners.delete(listener);
    };
  }

  public getSnapshot(): CalibrationSessionControllerState {
    const targetSet = this.targetSet;
    const calibrationTargetCount = targetSet?.calibrationTargets.length ?? 0;
    const validationTargetCount = targetSet?.validationTargets.length ?? 0;
    const activeTarget = this.getActiveTarget();
    const currentTargetSampleCount = activeTarget
      ? this.collector.getCollectedSampleCount(activeTarget.id)
      : 0;
    const now = this.now();

    return {
      phase: this.phase,
      sessionId: this.sessionId,
      isRunning: this.isRunning,
      statusMessage: this.statusMessageText,
      error: this.errorState,
      activeTarget,
      currentTargetRole: this.getCurrentTargetRole(),
      currentTargetIndex: this.getCurrentTargetIndex(),
      calibrationTargetCount,
      validationTargetCount,
      totalTargetCount: calibrationTargetCount + validationTargetCount,
      progress: this.getProgress(now ?? this.nowOrSessionStart()),
      collectedTargetSampleCount: this.collector.getCollectedSampleCountMap(),
      excludedSampleCountByReason: this.exclusionCounts,
      currentTargetSampleCount,
      sessionStartedAtMs: this.sessionStartedAtMs,
      phaseStartedAtMs: this.phaseStartedAtMs,
      collectingWindowStartMs: this.collectingWindowStartMs,
      collectingWindowEndMs: this.collectingWindowEndMs,
      activeProfile: this.activeProfileValue,
      activeProfileQuality: this.activeProfileQuality,
      roiTemplate: this.roiTemplate,
      validationMetrics: this.validationMetrics,
      validationMetricsBeforeCorrection: this.validationMetricsBeforeCorrection,
      validationRoiCandidateSource: this.validationRoiCandidateSource,
    };
  }

  public start(viewportRect: ViewportRect): void {
    if (this.disposed || this.isRunning) {
      return;
    }

    const now = this.now();
    if (now === null) {
      this.fail("validation-failed", "Interaction clock is not set for calibration controller.");
      return;
    }

    const generationResult = generateCalibrationTargets({
      viewportRect,
      rows: this.calibrationRows,
      columns: this.calibrationColumns,
      edgeInsetRatio: this.calibrationEdgeInsetRatio,
    });
    if (!generationResult.ok) {
      this.fail("validation-failed", generationResult.error.message);
      return;
    }

    this.targetSet = generationResult.value;
    this.targetViewportRect = viewportRect;
    this.sessionId = this.nextSessionId;
    this.nextSessionId += 1;
    this.sessionStartedAtMs = now;
    this.mode = "calibration";
    this.phase = "preparing";
    this.phaseStartedAtMs = now;
    this.validationStep = null;
    this.currentCalibrationTargetIndex = 0;
    this.currentValidationTargetIndex = 0;

    this.collectingWindowStartMs = null;
    this.collectingWindowEndMs = null;
    this.validationMetrics = null;
    this.validationMetricsBeforeCorrection = null;
    this.roiTemplate = null;
    this.validationRoiCandidateSource = null;
    this.fittedModel = null;
    this.activeProfileValue = null;
    this.activeProfileQuality = null;
    this.errorState = null;
    this.statusMessageText = "Calibration started.";
    this.fittingInProgress = false;

    this.collector.reset();
    this.exclusionCounts = makeRejectionCounter();
    this.publishState();
  }

  public cancel(): void {
    if (this.disposed || !this.isRunning) {
      return;
    }

    this.phase = "cancelled";
    this.mode = "idle";
    this.validationStep = null;
    this.fittedModel = null;
    this.phaseStartedAtMs = this.now();
    this.collectingWindowStartMs = null;
    this.collectingWindowEndMs = null;
    this.errorState = null;
    this.statusMessageText = "Calibration session cancelled.";
    this.publishState();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.mode = "idle";
    this.phase = "cancelled";
    this.validationStep = null;
    this.fittedModel = null;
    this.phaseStartedAtMs = this.now();
    this.collectingWindowStartMs = null;
    this.collectingWindowEndMs = null;
    this.listeners.clear();
  }

  public updateViewportRect(viewportRect: ViewportRect): void {
    if (this.disposed || this.targetSet === null) {
      return;
    }

    this.targetSet = {
      calibrationTargets: regenerateViewportPoints(this.targetSet.calibrationTargets, viewportRect),
      validationTargets: regenerateViewportPoints(this.targetSet.validationTargets, viewportRect),
    };
    this.targetViewportRect = viewportRect;
    this.publishState();
  }

  public tick(): void {
    if (this.disposed || !this.shouldAdvancePhase()) {
      return;
    }

    const now = this.now();
    if (now === null) {
      this.fail("validation-failed", "Interaction clock is not valid.");
      return;
    }

    switch (this.phase) {
      case "preparing":
        this.advancePreparing(now);
        break;
      case "settling":
        this.advanceSettling(now);
        break;
      case "collecting":
        this.advanceCollecting(now);
        break;
      case "transitioning":
        this.advanceTransition(now);
        break;
      case "validating":
        this.advanceValidating(now);
        break;
      case "fitting":
        this.performFitAndValidate();
        break;
      default:
        break;
    }
  }

  public handleRawGazeSample(sample: CalibrationRawSample): void {
    if (this.disposed || this.mode === "idle") {
      return;
    }

    if (this.sessionId === null) {
      return;
    }

    const target = this.getActiveTarget();
    const acceptance = this.collector.collect({
      rawSample: sample,
      activeTarget: target,
      sessionId: this.sessionId,
      windowStartMs: this.collectingWindowStartMs,
      windowEndMs: this.collectingWindowEndMs,
    });

    if (!acceptance.ok) {
      this.bumpRejection(acceptance.reason);
      return;
    }

    this.publishState();
  }

  public submitRawGazeSample(sample: CalibrationRawSample): void {
    this.handleRawGazeSample(sample);
  }

  private get isRunning(): boolean {
    return this.phase !== "idle" && this.phase !== "completed" && this.phase !== "failed" && this.phase !== "cancelled";
  }

  private shouldAdvancePhase(): boolean {
    return this.phase === "preparing"
      || this.phase === "settling"
      || this.phase === "collecting"
      || this.phase === "transitioning"
      || this.phase === "validating"
      || this.phase === "fitting";
  }

  private advancePreparing(now: SessionTimeMs): void {
    if (this.phaseStartedAtMs !== null
      && now - this.phaseStartedAtMs >= this.timingConfig.prepareDurationMs) {
      this.phase = this.mode === "validation" ? "validating" : "settling";
      this.phaseStartedAtMs = now;
      this.validationStep = this.mode === "validation" ? "settling" : null;
      this.statusMessageText = "Settling before collecting.";
      this.publishState();
    }
  }

  private advanceSettling(now: SessionTimeMs): void {
    if (this.phaseStartedAtMs === null) {
      this.phaseStartedAtMs = now;
      return;
    }

    if (this.phaseStartedAtMs !== null && now - this.phaseStartedAtMs < this.timingConfig.settleDurationMs) {
      return;
    }

    this.setCollectingWindow(now);
    this.phase = this.mode === "validation" ? "validating" : "collecting";
    this.validationStep = this.mode === "validation" ? "collecting" : null;
    this.statusMessageText = this.mode === "validation" ? "Collecting validation samples." : "Collecting calibration samples.";
    this.publishState();
  }

  private advanceCollecting(now: SessionTimeMs): void {
    if (isCollectingWindowActive(this.collectingWindowStartMs, this.collectingWindowEndMs, now)) {
      return;
    }

    this.finishTargetCollecting(now);
  }

  private advanceValidating(now: SessionTimeMs): void {
    if (this.validationStep === null) {
      this.validationStep = "settling";
      this.phaseStartedAtMs = now;
      return;
    }

    if (this.validationStep === "settling") {
      if (this.phaseStartedAtMs === null) {
        this.phaseStartedAtMs = now;
      }

      if (this.phaseStartedAtMs !== null && now - this.phaseStartedAtMs >= this.timingConfig.settleDurationMs) {
        this.setCollectingWindow(now);
        this.validationStep = "collecting";
        this.statusMessageText = "Collecting validation samples.";
        this.publishState();
      }

      return;
    }

    if (!isCollectingWindowActive(this.collectingWindowStartMs, this.collectingWindowEndMs, now)) {
      this.finishTargetCollecting(now);
    }
  }

  private advanceTransition(now: SessionTimeMs): void {
    if (this.phaseStartedAtMs !== null && now - this.phaseStartedAtMs < this.timingConfig.transitionDurationMs) {
      return;
    }

    if (!this.targetSet) {
      this.fail("validation-failed", "Target set is not available.");
      return;
    }

    if (this.mode === "calibration") {
      const nextCalibrationIndex = this.currentCalibrationTargetIndex + 1;
      if (nextCalibrationIndex < this.targetSet.calibrationTargets.length) {
        this.currentCalibrationTargetIndex = nextCalibrationIndex;
        this.phase = "preparing";
        this.phaseStartedAtMs = now;
        this.validationStep = null;
        this.collectingWindowStartMs = null;
        this.collectingWindowEndMs = null;
        this.statusMessageText = "Next calibration target.";
        this.publishState();
        return;
      }

      this.startFitting();
      return;
    }

    const nextValidationIndex = this.currentValidationTargetIndex + 1;
    if (nextValidationIndex < this.targetSet.validationTargets.length) {
      this.currentValidationTargetIndex = nextValidationIndex;
      this.phase = "validating";
      this.validationStep = "settling";
      this.phaseStartedAtMs = now;
      this.collectingWindowStartMs = null;
      this.collectingWindowEndMs = null;
      this.statusMessageText = "Next validation target.";
      this.publishState();
      return;
    }

    this.performValidationAndFinalize();
  }

  private startFitting(): void {
    this.phase = "fitting";
    this.mode = "idle";
    this.validationStep = null;
    this.fittedModel = null;
    this.fittingInProgress = false;
    this.phaseStartedAtMs = this.now();
    this.collectingWindowStartMs = null;
    this.collectingWindowEndMs = null;
    this.statusMessageText = "Fitting calibration model.";
    this.publishState();
  }

  private performFitAndValidate(): void {
    if (this.fittingInProgress) {
      return;
    }

    if (this.targetSet === null || this.targetViewportRect === null || this.sessionId === null || this.sessionStartedAtMs === null) {
      this.fail("validation-failed", "No target set or session was not initialized.");
      return;
    }

    const now = this.now();
    if (now === null) {
      this.fail("validation-failed", "Interaction clock is not set for calibration fitting.");
      return;
    }

    this.fittingInProgress = true;

    const calibrationObservations = this.buildRepresentativeObservations(this.targetSet.calibrationTargets, this.sessionId);
    if (calibrationObservations === null) {
      return;
    }

    const fitResult = fitAffineCalibration(calibrationObservations, {
      viewportBasis: {
        width: this.targetViewportRect.width,
        height: this.targetViewportRect.height,
      },
      createdAtMs: this.sessionStartedAtMs,
      version: CALIBRATION_MODEL_VERSION,
    });

    if (!fitResult.ok) {
      this.fail(fitResult.error.kind, fitResult.error.message);
      return;
    }

    this.fittedModel = fitResult.value;
    this.fittingInProgress = false;

    this.mode = "validation";
    this.validationStep = "settling";
    this.phase = "validating";
    this.phaseStartedAtMs = now;
    this.currentValidationTargetIndex = 0;
    this.collectingWindowStartMs = null;
    this.collectingWindowEndMs = null;
    this.statusMessageText = "Validation settling.";
    this.publishState();
  }

  private performValidationAndFinalize(): void {
    if (this.fittedModel === null || this.targetSet === null || this.targetViewportRect === null || this.sessionId === null || this.sessionStartedAtMs === null) {
      this.fail("validation-failed", "No model or calibration data available for validation.");
      return;
    }

    const now = this.now();
    if (now === null) {
      this.fail("validation-failed", "Interaction clock is not set.");
      return;
    }

    const validationObservations = this.buildRepresentativeObservations(this.targetSet.validationTargets, this.sessionId);
    if (validationObservations === null) {
      return;
    }

    if (validationObservations.length < this.qualityThresholds.minimumValidationSamples) {
      this.fail("sample-count", "Not enough validation observations.");
      return;
    }

    const residualResult = analyzeResiduals(validationObservations, this.fittedModel);
    if (!residualResult.ok) {
      this.fail("validation-failed", residualResult.error.message);
      return;
    }

    const roiResult = estimateRoiTemplate(residualResult.value.correctedResiduals, {
      viewportBasis: {
        width: this.targetViewportRect.width,
        height: this.targetViewportRect.height,
      },
      minimumSamples: this.qualityThresholds.minimumValidationSamples,
    });

    if (!roiResult.ok) {
      this.fail("roi-not-possible", "Failed to estimate ROI template.");
      return;
    }

    const quality = this.determineQuality(residualResult.value, roiResult.value.template.source);
    const profile: GazeCalibrationProfile = {
      id: `calibration-session-${this.sessionId}`,
      version: this.fittedModel.version,
      createdAtMs: now,
      pdfViewportBasis: {
        width: this.targetViewportRect.width,
        height: this.targetViewportRect.height,
      },
      model: {
        ...this.fittedModel,
        biasCorrection: residualResult.value.biasCorrection,
      },
      validation: residualResult.value.metricsAfterCorrection,
      quality,
      residualDistribution: {
        bias: residualResult.value.biasCorrection,
        covariance: calculateResidualCovariance(residualResult.value.correctedResiduals),
      },
      roiTemplate95: {
        radiusMajor: roiResult.value.template.radiusMajor,
        radiusMinor: roiResult.value.template.radiusMinor,
        rotationRad: roiResult.value.template.rotationRad,
        covariance: roiResult.value.template.covariance,
        source: roiResult.value.template.source,
      },
    };

    this.activeProfileValue = profile;
    this.activeProfileQuality = quality;
    this.validationMetrics = residualResult.value.metricsAfterCorrection;
    this.validationMetricsBeforeCorrection = residualResult.value.metricsBeforeCorrection;
    this.roiTemplate = roiResult.value.template;
    this.validationRoiCandidateSource = roiResult.value.template.source;
    this.phase = "completed";
    this.phaseStartedAtMs = now;
    this.mode = "idle";
    this.validationStep = null;
    this.fittedModel = null;
    this.fittingInProgress = false;
    this.errorState = null;
    this.statusMessageText = "Calibration completed.";
    this.publishState();
  }
  private finishTargetCollecting(now: SessionTimeMs): void {
    const activeTarget = this.getActiveTarget();
    if (activeTarget === null) {
      this.fail("validation-failed", "No active target when finishing sample collection.");
      return;
    }

    if (this.collector.getCollectedSampleCount(activeTarget.id) < this.collectionConfig.minimumSamplesPerTarget) {
      this.fail("sample-count", `Not enough samples for target ${activeTarget.id}.`);
      return;
    }

    this.phase = "transitioning";
    this.phaseStartedAtMs = now;
    this.validationStep = null;
    this.collectingWindowStartMs = null;
    this.collectingWindowEndMs = null;
    this.statusMessageText = this.mode === "validation"
      ? "Validation target collected."
      : "Calibration target collected.";
    this.publishState();
  }

  private buildRepresentativeObservations(
    targets: readonly CalibrationTarget[],
    sessionId: number,
  ): CalibrationObservation[] | null {
    const observations: CalibrationObservation[] = [];
    for (const target of targets) {
      const representative = this.collector.getRepresentativeObservation(
        target,
        this.collectionConfig.minimumSamplesPerTarget,
        this.collectionConfig.trimRatio,
        sessionId,
      );

      if (!representative.ok) {
        this.fail("sample-count", `Missing samples for target ${target.id}.`);
        return null;
      }

      observations.push(representative.value);
    }

    return observations;
  }

  private determineQuality(
    residualResult: {
      readonly metricsAfterCorrection: CalibrationValidationMetrics;
      readonly correctedResiduals: readonly ValidationResidualSample[];
    },
    roiSource: "validation-residuals" | "fallback",
  ): "valid" | "degraded" {
    if (residualResult.correctedResiduals.length < this.qualityThresholds.minimumValidationSamples) {
      return "degraded";
    }

    if (residualResult.metricsAfterCorrection.rmse.radial > this.qualityThresholds.maximumRmsePx) {
      return "degraded";
    }

    if (residualResult.metricsAfterCorrection.maxRadialError > this.qualityThresholds.maximumRadialErrorPx) {
      return "degraded";
    }

    if (roiSource === "fallback") {
      return "degraded";
    }

    return "valid";
  }

  private setCollectingWindow(startAt: SessionTimeMs): void {
    this.collectingWindowStartMs = startAt;
    this.collectingWindowEndMs = toSessionTimeMs(Number(startAt) + this.timingConfig.collectDurationMs);
  }

  private getActiveTarget(): CalibrationTarget | null {
    if (!this.targetSet) {
      return null;
    }

    if (this.mode === "validation") {
      return getTargetForIndex(this.targetSet, true, this.currentValidationTargetIndex);
    }

    if (this.mode === "calibration") {
      return getTargetForIndex(this.targetSet, false, this.currentCalibrationTargetIndex);
    }

    return null;
  }

  private getCurrentTargetRole(): CalibrationTargetRole | null {
    if (this.mode === "validation") {
      return "validation";
    }

    if (this.mode === "calibration") {
      return "calibration";
    }

    return null;
  }

  private getCurrentTargetIndex(): number {
    if (this.mode === "validation") {
      return this.currentValidationTargetIndex;
    }

    return this.currentCalibrationTargetIndex;
  }

  private getProgress(now: number): number {
    const calibrationTargetCount = this.targetSet?.calibrationTargets.length ?? 0;
    const validationTargetCount = this.targetSet?.validationTargets.length ?? 0;
    const totalTargetCount = calibrationTargetCount + validationTargetCount;

    if (totalTargetCount === 0) {
      return 0;
    }

    if (this.phase === "completed") {
      return 1;
    }

    let completedTargetCount = 0;
    if (this.mode === "validation") {
      completedTargetCount = calibrationTargetCount + this.currentValidationTargetIndex;
    } else if (this.mode === "calibration") {
      completedTargetCount = this.currentCalibrationTargetIndex;
    }

    if (this.phase === "collecting" || (this.phase === "validating" && this.validationStep === "collecting")) {
      const ratio = this.collectingWindowProgress(now);
      return clampProgress((completedTargetCount + ratio) / totalTargetCount);
    }

    if (this.phase === "transitioning") {
      return clampProgress((completedTargetCount + 1) / totalTargetCount);
    }

    if (this.phase === "fitting") {
      return this.targetViewportRect && validationTargetCount > 0
        ? calibrationTargetCount / totalTargetCount
        : 1;
    }

    return clampProgress(completedTargetCount / totalTargetCount);
  }

  private collectingWindowProgress(now: number): number {
    if (this.collectingWindowStartMs === null || this.collectingWindowEndMs === null) {
      return 0;
    }

    if (this.collectingWindowEndMs <= this.collectingWindowStartMs) {
      return 1;
    }

    return clampProgress((now - this.collectingWindowStartMs) / (this.collectingWindowEndMs - this.collectingWindowStartMs));
  }

  private now(): SessionTimeMs | null {
    if (!this.clock) {
      return null;
    }

    try {
      return this.clock.now();
    } catch {
      return null;
    }
  }

  private nowOrSessionStart(): SessionTimeMs {
    return this.now() ?? this.sessionStartedAtMs ?? toSessionTimeMs(0);
  }

  private bumpRejection(reason: SampleAcceptanceReason): void {
    this.exclusionCounts = incrementRejectionCounter(this.exclusionCounts, reason);
    this.publishState();
  }

  private fail(kind: CalibrationErrorKind, message: string): void {
    this.phase = "failed";
    this.mode = "idle";
    this.validationStep = null;
    this.fittedModel = null;
    this.fittingInProgress = false;
    this.errorState = {
      kind,
      message,
    };
    this.statusMessageText = message;
    this.phaseStartedAtMs = this.now();
    this.collectingWindowStartMs = null;
    this.collectingWindowEndMs = null;
    this.publishState();
  }

  private publishState(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PROGRESS;
  }

  return Math.max(MIN_PROGRESS, Math.min(MAX_PROGRESS, value));
}
