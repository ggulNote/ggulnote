import type { RawGazeObservation } from "@ggulnote/gaze-core";
import type { InteractionClock } from "@ggulnote/interaction-core";

import {
  validatePursuitCalibrationConfig,
  type PursuitCalibrationConfig,
} from "../config/pursuit-calibration-config";
import {
  DEFAULT_QUALITY_THRESHOLDS,
  makeError,
  makeResult,
  type AffineCalibrationModel,
  type AxisAlignedBounds,
  type CalibrationObservation,
  type CalibrationTarget,
  type CalibrationValidationMetrics,
  type GazeConfidenceRoiTemplate,
  type ResidualBias,
  type ResidualCovariance,
  type Result,
  type ViewportPoint,
  type ViewportRect,
} from "../domain/calibration-types";
import type {
  CalibrationTrajectory,
  PursuitDirectionVector,
  PursuitRawSample,
  PursuitSampleAcceptanceResult,
  PursuitSampleRejectionReason,
  PursuitTrajectoryRole,
  PursuitTrajectoryState,
  ValidationTrajectory,
} from "../domain/pursuit-types";
import { fitAffineCalibration } from "../core/affine-calibration";
import { estimateConfidenceRoiTemplate } from "../core/confidence-roi-estimator";
import {
  alignRawAndTargetWithLag,
  estimatePursuitLag,
  type AlignedPair,
  type PursuitLagEstimate,
} from "../core/pursuit-lag-estimator";
import { PursuitSampleCollector } from "../core/pursuit-sample-collector";
import { PursuitTargetHistory } from "../core/pursuit-target-history";
import {
  getPursuitTrajectoryState,
  PursuitTrajectoryError,
} from "../core/pursuit-trajectory";
import {
  analyzeResiduals,
  calculateResidualCovariance,
} from "../core/residual-analysis";

const TARGET_HISTORY_RETENTION_FLOOR_MS = 60_000;
const TRACKING_QUALITY_THRESHOLD = Number.EPSILON;
const QUALITY_COMPARISON_EPSILON = 1e-9;

export type PursuitCalibrationPhase =
  | "idle"
  | "preparing"
  | "initial-hold"
  | "direction-cue"
  | "settling"
  | "moving"
  | "segment-stop"
  | "fitting"
  | "validation-preparing"
  | "validation-direction-cue"
  | "validation-settling"
  | "validation-moving"
  | "validation-segment-stop"
  | "validating"
  | "completed"
  | "failed"
  | "cancelled";

export type PursuitCalibrationErrorCode =
  | "invalid-config"
  | "invalid-viewport"
  | "invalid-state-transition"
  | "insufficient-calibration-samples"
  | "lag-estimation-failed"
  | "insufficient-aligned-samples"
  | "affine-fitting-failed"
  | "insufficient-validation-samples"
  | "validation-failed"
  | "confidence-roi-failed"
  | "viewport-changed"
  | "disposed";

export type PursuitCalibrationError = Readonly<{
  readonly code: PursuitCalibrationErrorCode;
  readonly message: string;
}>;

export type PursuitTargetSnapshot = Readonly<{
  readonly role: PursuitTrajectoryRole;
  readonly segmentId: string;
  readonly segmentIndex: number;
  readonly segmentCount: number;
  readonly center: ViewportPoint;
  readonly bounds: AxisAlignedBounds;
  readonly movementProgress: number;
  readonly nextDirection: PursuitDirectionVector | null;
  readonly showTarget: boolean;
  readonly showDirectionCue: boolean;
  readonly shouldCollectSample: boolean;
}>;

export type PursuitCalibrationProfile = Readonly<{
  readonly id: string;
  readonly version: string;
  readonly mode: "smooth-pursuit";
  readonly createdAtMs: number;
  readonly viewportBasis: Readonly<{ readonly width: number; readonly height: number }>;
  readonly model: AffineCalibrationModel;
  readonly pursuit: Readonly<{
    readonly calibrationTrajectoryId: string;
    readonly validationTrajectoryId: string;
    readonly lagEstimate: PursuitLagEstimate;
    readonly targetDiameterPx: number;
    readonly calibrationSampleCount: number;
    readonly validationSampleCount: number;
  }>;
  readonly validation: CalibrationValidationMetrics;
  readonly residualDistribution: Readonly<{
    readonly bias: ResidualBias;
    readonly covariance: ResidualCovariance;
  }>;
  readonly roiTemplate: GazeConfidenceRoiTemplate;
  readonly quality: "valid" | "degraded";
}>;

export type PursuitCalibrationSnapshot = Readonly<{
  readonly sessionId: string | null;
  readonly phase: PursuitCalibrationPhase;
  readonly role: PursuitTrajectoryRole | null;
  readonly currentTarget: PursuitTargetSnapshot | null;
  readonly progress: Readonly<{
    readonly completedSegments: number;
    readonly totalSegments: number;
    readonly overallRatio: number;
  }>;
  readonly collection: Readonly<{
    readonly calibrationAcceptedCount: number;
    readonly validationAcceptedCount: number;
    readonly rejectedCount: number;
    readonly rejectionCounts: Readonly<Record<string, number>>;
  }>;
  readonly lagEstimate: PursuitLagEstimate | null;
  readonly affineModelAvailable: boolean;
  readonly profile: PursuitCalibrationProfile | null;
  readonly error: PursuitCalibrationError | null;
  readonly timing: Readonly<{
    readonly sessionStartedAtMs: number | null;
    readonly phaseStartedAtMs: number | null;
  }>;
}>;

export type PursuitCalibrationControllerDependencies = Readonly<{
  readonly clock: InteractionClock;
  readonly config: PursuitCalibrationConfig;
  readonly viewportRect: ViewportRect;
  readonly calibrationTrajectory: CalibrationTrajectory;
  readonly validationTrajectory: ValidationTrajectory;
  readonly createSessionId: () => string;
  readonly createProfileId: () => string;
  readonly createVersion: () => string;
}>;

export type PursuitCalibrationStartResult = Result<
  PursuitCalibrationSnapshot,
  PursuitCalibrationErrorCode
>;
export type PursuitViewportUpdateResult = Result<
  ViewportRect,
  "invalid-viewport" | "viewport-changed" | "disposed"
>;

type SnapshotListener = (snapshot: PursuitCalibrationSnapshot) => void;

export class PursuitCalibrationController {
  private readonly listeners = new Set<SnapshotListener>();
  private readonly collector = new PursuitSampleCollector();
  private readonly calibrationHistory: PursuitTargetHistory;
  private readonly validationHistory: PursuitTargetHistory;
  private viewportRect: ViewportRect;
  private phase: PursuitCalibrationPhase = "idle";
  private role: PursuitTrajectoryRole | null = null;
  private sessionId: string | null = null;
  private sessionVersion: string | null = null;
  private sessionStartedAtMs: number | null = null;
  private phaseStartedAtMs: number | null = null;
  private trajectoryStartedAtMs: number | null = null;
  private currentTrajectoryState: PursuitTrajectoryState | null = null;
  private selectedLagEstimate: PursuitLagEstimate | null = null;
  private fittedModel: AffineCalibrationModel | null = null;
  private completedProfile: PursuitCalibrationProfile | null = null;
  private error: PursuitCalibrationError | null = null;
  private disposed = false;
  private generation = 0;
  private controllerRejectionCounts: Record<string, number> = {};

  public constructor(
    private readonly dependencies: PursuitCalibrationControllerDependencies,
  ) {
    this.viewportRect = { ...dependencies.viewportRect };
    const retentionMs = Math.max(
      TARGET_HISTORY_RETENTION_FLOOR_MS,
      dependencies.config.lagAlignment.maximumLagMs + TARGET_HISTORY_RETENTION_FLOOR_MS,
    );
    this.calibrationHistory = new PursuitTargetHistory({ keepSampleAgeMs: retentionMs });
    this.validationHistory = new PursuitTargetHistory({ keepSampleAgeMs: retentionMs });
  }

  public start(): PursuitCalibrationStartResult {
    if (this.disposed) {
      return makeError("disposed", "The pursuit calibration controller is disposed.");
    }
    if (this.isRunningPhase(this.phase)) {
      return makeError(
        "invalid-state-transition",
        `Cannot start pursuit calibration while phase is "${this.phase}".`,
      );
    }
    const configResult = validatePursuitCalibrationConfig(this.dependencies.config);
    if (!configResult.ok) {
      this.fail("invalid-config", configResult.error.message);
      return makeError("invalid-config", configResult.error.message);
    }
    const viewportError = validateViewportRect(this.viewportRect);
    if (viewportError !== null) {
      this.fail("invalid-viewport", viewportError);
      return makeError("invalid-viewport", viewportError);
    }
    try {
      getPursuitTrajectoryState({
        trajectory: this.dependencies.calibrationTrajectory,
        viewportRect: this.viewportRect,
        config: this.dependencies.config,
        elapsedMs: 0,
      });
      getPursuitTrajectoryState({
        trajectory: this.dependencies.validationTrajectory,
        viewportRect: this.viewportRect,
        config: this.dependencies.config,
        elapsedMs: 0,
      });
    } catch (error: unknown) {
      const message = getErrorMessage(error, "Invalid pursuit trajectory.");
      const code = error instanceof PursuitTrajectoryError && error.kind === "viewport-invalid"
        ? "invalid-viewport"
        : "invalid-config";
      this.fail(code, message);
      return makeError(code, message);
    }

    let nextSessionId: string;
    let nextVersion: string;
    try {
      nextSessionId = this.dependencies.createSessionId();
      nextVersion = this.dependencies.createVersion();
    } catch (error: unknown) {
      const message = getErrorMessage(
        error,
        "Unable to create pursuit calibration session metadata.",
      );
      this.fail("invalid-config", message);
      return makeError("invalid-config", message);
    }
    if (nextSessionId.trim().length === 0 || nextVersion.trim().length === 0) {
      const message = "Session id and version must be non-empty strings.";
      this.fail("invalid-config", message);
      return makeError("invalid-config", message);
    }
    const now = this.readClock();
    if (now === null) {
      const message = "InteractionClock returned an invalid session time.";
      this.fail("invalid-config", message);
      return makeError("invalid-config", message);
    }

    this.generation += 1;
    this.collector.reset();
    this.calibrationHistory.reset();
    this.validationHistory.reset();
    this.controllerRejectionCounts = {};
    this.sessionId = nextSessionId;
    this.sessionVersion = nextVersion;
    this.sessionStartedAtMs = now;
    this.phaseStartedAtMs = now;
    this.trajectoryStartedAtMs = null;
    this.currentTrajectoryState = null;
    this.selectedLagEstimate = null;
    this.fittedModel = null;
    this.completedProfile = null;
    this.error = null;
    this.role = "calibration";
    this.phase = "preparing";
    this.publishSnapshot();
    return makeResult(this.getSnapshot());
  }

  public tick(): void {
    if (this.disposed || !this.isRunningPhase(this.phase)) {
      return;
    }
    const now = this.readClock();
    if (now === null) {
      this.fail("invalid-config", "InteractionClock returned an invalid session time.");
      return;
    }
    switch (this.phase) {
      case "preparing":
        this.trajectoryStartedAtMs = now;
        this.updateTrajectory(now, "calibration");
        break;
      case "fitting":
        this.finishCalibrationFitting(now);
        break;
      case "validation-preparing":
        if (this.trajectoryStartedAtMs === null) {
          this.trajectoryStartedAtMs = now;
        }
        this.updateTrajectory(now, "validation");
        break;
      case "validating":
        this.finishValidation(now);
        break;
      default:
        if (this.role !== null) {
          this.updateTrajectory(now, this.role);
        }
        break;
    }
    if (!this.disposed) {
      this.publishSnapshot();
    }
  }

  public pushRawGazeObservation(
    observation: RawGazeObservation,
  ): PursuitSampleAcceptanceResult {
    if (
      this.disposed
      || !this.isRunningPhase(this.phase)
      || this.sessionId === null
      || this.role === null
      || this.currentTrajectoryState === null
      || this.trajectoryStartedAtMs === null
    ) {
      return this.rejectWithoutCollector("collector-inactive");
    }
    const timestampMs = Number(observation.sourceCapturedAt);
    const elapsedMs = timestampMs - this.trajectoryStartedAtMs;
    if (!Number.isFinite(timestampMs) || elapsedMs < 0) {
      return this.rejectWithoutCollector("late-sample");
    }

    let sampleTrajectoryState: PursuitTrajectoryState;
    try {
      sampleTrajectoryState = getPursuitTrajectoryState({
        trajectory: this.getTrajectory(this.role),
        viewportRect: this.viewportRect,
        config: this.dependencies.config,
        elapsedMs,
      });
    } catch {
      return this.rejectWithoutCollector("invalid-vector");
    }
    this.recordTargetHistory(timestampMs, sampleTrajectoryState);
    const sample: PursuitRawSample = {
      sessionId: this.sessionId,
      segmentId: sampleTrajectoryState.segmentId,
      role: this.role,
      timestampMs,
      rawVector: observation.rawCombinedDirection,
      smoothedVector: observation.smoothedCombinedDirection,
      targetCenter: sampleTrajectoryState.targetCenter,
      targetBounds: sampleTrajectoryState.targetBounds,
      frameId: observation.frameId,
      sequenceId: observation.frameId,
      trackingQuality: getTrackingQuality(observation),
    };
    const result = this.collector.collect({
      sample,
      activeSegmentId: this.currentTrajectoryState.segmentId,
      expectedSessionId: this.sessionId,
      expectedRole: this.role,
      trajectoryState: this.currentTrajectoryState,
      isCollecting: true,
      motionConfig: this.dependencies.config.motion,
      trackingQualityThreshold: TRACKING_QUALITY_THRESHOLD,
      collectionConfig: this.dependencies.config.sampleSelection,
    });
    this.publishSnapshot();
    return result;
  }

  public cancel(): void {
    if (this.disposed || !this.isRunningPhase(this.phase)) {
      return;
    }
    this.generation += 1;
    this.setPhase("cancelled", this.readClock());
    this.role = null;
    this.currentTrajectoryState = null;
    this.trajectoryStartedAtMs = null;
    this.publishSnapshot();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.generation += 1;
    this.listeners.clear();
  }

  public updateViewportRect(viewportRect: ViewportRect): PursuitViewportUpdateResult {
    if (this.disposed) {
      return makeError("disposed", "The pursuit calibration controller is disposed.");
    }
    const viewportError = validateViewportRect(viewportRect);
    if (viewportError !== null) {
      if (this.isRunningPhase(this.phase)) {
        this.fail("invalid-viewport", viewportError);
      }
      return makeError("invalid-viewport", viewportError);
    }
    if (
      this.isRunningPhase(this.phase)
      && (viewportRect.width !== this.viewportRect.width
        || viewportRect.height !== this.viewportRect.height)
    ) {
      const message = "Viewport basis changed during pursuit calibration; restart is required.";
      this.fail("viewport-changed", message);
      return makeError("viewport-changed", message);
    }
    this.viewportRect = { ...viewportRect };
    const now = this.readClock();
    if (
      now !== null
      && this.role !== null
      && this.trajectoryStartedAtMs !== null
      && this.currentTrajectoryState !== null
    ) {
      this.refreshTrajectoryState(now, this.role);
    }
    this.publishSnapshot();
    return makeResult(this.viewportRect);
  }

  public subscribe(listener: SnapshotListener): () => void {
    if (this.disposed) {
      return () => undefined;
    }
    this.listeners.add(listener);
    this.notifyListener(listener, this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getSnapshot(): PursuitCalibrationSnapshot {
    return {
      sessionId: this.sessionId,
      phase: this.phase,
      role: this.role,
      currentTarget: this.getCurrentTargetSnapshot(),
      progress: this.getProgressSnapshot(),
      collection: this.getCollectionSnapshot(),
      lagEstimate: this.selectedLagEstimate,
      affineModelAvailable: this.fittedModel !== null || this.completedProfile !== null,
      profile: this.completedProfile,
      error: this.error,
      timing: {
        sessionStartedAtMs: this.sessionStartedAtMs,
        phaseStartedAtMs: this.phaseStartedAtMs,
      },
    };
  }

  private updateTrajectory(now: number, role: PursuitTrajectoryRole): void {
    const state = this.refreshTrajectoryState(now, role);
    if (state === null) {
      return;
    }
    this.recordTargetHistory(now, state);
    if (state.isComplete) {
      this.currentTrajectoryState = state;
      this.trajectoryStartedAtMs = null;
      this.setPhase(role === "calibration" ? "fitting" : "validating", now);
      return;
    }
    this.setPhase(mapTrajectoryPhase(state.phase, role), now);
  }

  private refreshTrajectoryState(
    now: number,
    role: PursuitTrajectoryRole,
  ): PursuitTrajectoryState | null {
    if (this.trajectoryStartedAtMs === null) {
      return null;
    }
    try {
      const state = getPursuitTrajectoryState({
        trajectory: this.getTrajectory(role),
        viewportRect: this.viewportRect,
        config: this.dependencies.config,
        elapsedMs: Math.max(0, now - this.trajectoryStartedAtMs),
      });
      this.currentTrajectoryState = state;
      return state;
    } catch (error: unknown) {
      const message = getErrorMessage(error, "Unable to calculate pursuit target state.");
      const code = error instanceof PursuitTrajectoryError && error.kind === "viewport-invalid"
        ? "invalid-viewport"
        : "invalid-config";
      this.fail(code, message);
      return null;
    }
  }

  private finishCalibrationFitting(now: number): void {
    const generation = this.generation;
    const samples = this.getRoleSamples("calibration");
    if (samples.length < this.dependencies.config.sampleSelection.minimumCalibrationSamples) {
      this.fail("insufficient-calibration-samples", "Not enough accepted calibration samples.");
      return;
    }
    const lagResult = estimatePursuitLag({
      rawSamples: samples,
      targetHistory: this.calibrationHistory,
      lagConfig: this.dependencies.config.lagAlignment,
    });
    if (!lagResult.ok) {
      this.fail("lag-estimation-failed", lagResult.error.message);
      return;
    }
    const aligned = alignRawAndTargetWithLag(
      samples,
      this.calibrationHistory.getTargetCenterAtTimestamp.bind(this.calibrationHistory),
      lagResult.value.lagMs,
    );
    if (aligned.length < this.dependencies.config.sampleSelection.minimumCalibrationSamples) {
      this.fail("insufficient-aligned-samples", "Not enough lag-aligned calibration samples.");
      return;
    }
    const version = this.sessionVersion;
    if (version === null) {
      this.fail("invalid-state-transition", "Calibration version is unavailable.");
      return;
    }
    const fitResult = fitAffineCalibration(
      toCalibrationObservations(aligned, generation, "calibration"),
      {
        viewportBasis: { width: this.viewportRect.width, height: this.viewportRect.height },
        createdAtMs: now,
        version,
      },
    );
    if (!fitResult.ok) {
      this.fail("affine-fitting-failed", fitResult.error.message);
      return;
    }
    if (generation !== this.generation || this.disposed) {
      return;
    }
    this.selectedLagEstimate = lagResult.value;
    this.fittedModel = fitResult.value;
    this.role = "validation";
    this.currentTrajectoryState = null;
    this.trajectoryStartedAtMs = null;
    this.setPhase("validation-preparing", now);
  }

  private finishValidation(now: number): void {
    const generation = this.generation;
    const model = this.fittedModel;
    const lagEstimate = this.selectedLagEstimate;
    const version = this.sessionVersion;
    if (model === null || lagEstimate === null || version === null) {
      this.fail(
        "invalid-state-transition",
        "Validation started without an affine model, lag estimate, or version.",
      );
      return;
    }
    const samples = this.getRoleSamples("validation");
    if (samples.length < this.dependencies.config.sampleSelection.minimumValidationSamples) {
      this.fail("insufficient-validation-samples", "Not enough accepted validation samples.");
      return;
    }
    const aligned = alignRawAndTargetWithLag(
      samples,
      this.validationHistory.getTargetCenterAtTimestamp.bind(this.validationHistory),
      lagEstimate.lagMs,
    );
    if (aligned.length < this.dependencies.config.sampleSelection.minimumValidationSamples) {
      this.fail("insufficient-aligned-samples", "Not enough lag-aligned validation samples.");
      return;
    }
    const residualResult = analyzeResiduals(
      toCalibrationObservations(aligned, generation, "validation"),
      model,
    );
    if (!residualResult.ok) {
      this.fail("validation-failed", residualResult.error.message);
      return;
    }
    const correctedResiduals = residualResult.value.correctedResiduals.map(
      (sample) => sample.residual,
    );
    const roiResult = estimateConfidenceRoiTemplate(
      correctedResiduals,
      this.dependencies.config.roi,
    );
    if (!roiResult.ok) {
      this.fail("confidence-roi-failed", roiResult.error.message);
      return;
    }

    let profileId: string;
    try {
      profileId = this.dependencies.createProfileId();
    } catch (error: unknown) {
      this.fail(
        "validation-failed",
        getErrorMessage(error, "Unable to create calibration profile id."),
      );
      return;
    }
    if (profileId.trim().length === 0) {
      this.fail("validation-failed", "Calibration profile id must be non-empty.");
      return;
    }
    if (generation !== this.generation || this.disposed) {
      return;
    }

    const modelWithBias: AffineCalibrationModel = {
      ...model,
      biasCorrection: residualResult.value.biasCorrection,
    };
    const covariance = calculateResidualCovariance(residualResult.value.correctedResiduals);
    const quality = determineQuality(
      lagEstimate,
      residualResult.value.metricsAfterCorrection,
      roiResult.value.template,
      this.dependencies.config,
    );
    this.completedProfile = {
      id: profileId,
      version,
      mode: "smooth-pursuit",
      createdAtMs: now,
      viewportBasis: { width: this.viewportRect.width, height: this.viewportRect.height },
      model: modelWithBias,
      pursuit: {
        calibrationTrajectoryId: this.dependencies.calibrationTrajectory.id,
        validationTrajectoryId: this.dependencies.validationTrajectory.id,
        lagEstimate,
        targetDiameterPx: this.dependencies.config.target.diameterPx,
        calibrationSampleCount: this.getRoleSamples("calibration").length,
        validationSampleCount: samples.length,
      },
      validation: residualResult.value.metricsAfterCorrection,
      residualDistribution: { bias: residualResult.value.biasCorrection, covariance },
      roiTemplate: roiResult.value.template,
      quality,
    };
    this.fittedModel = modelWithBias;
    this.role = null;
    this.currentTrajectoryState = null;
    this.trajectoryStartedAtMs = null;
    this.error = null;
    this.setPhase("completed", now);
  }

  private getTrajectory(role: "calibration"): CalibrationTrajectory;
  private getTrajectory(role: "validation"): ValidationTrajectory;
  private getTrajectory(role: PursuitTrajectoryRole): CalibrationTrajectory | ValidationTrajectory;
  private getTrajectory(role: PursuitTrajectoryRole): CalibrationTrajectory | ValidationTrajectory {
    return role === "calibration"
      ? this.dependencies.calibrationTrajectory
      : this.dependencies.validationTrajectory;
  }

  private getHistory(role: PursuitTrajectoryRole): PursuitTargetHistory {
    return role === "calibration" ? this.calibrationHistory : this.validationHistory;
  }

  private recordTargetHistory(timestampMs: number, state: PursuitTrajectoryState): void {
    this.getHistory(state.role).addSample({
      timestampMs,
      segmentId: state.segmentId,
      role: state.role,
      targetCenter: state.targetCenter,
    });
  }

  private getRoleSamples(role: PursuitTrajectoryRole): readonly PursuitRawSample[] {
    const samples: PursuitRawSample[] = [];
    for (const segment of this.getTrajectory(role).segments) {
      samples.push(...this.collector.getSamples(role, segment.id));
    }
    return samples;
  }

  private getCurrentTargetSnapshot(): PursuitTargetSnapshot | null {
    const state = this.currentTrajectoryState;
    if (
      state === null
      || this.phase === "fitting"
      || this.phase === "validating"
      || this.phase === "completed"
      || this.phase === "failed"
      || this.phase === "cancelled"
    ) {
      return null;
    }
    return {
      role: state.role,
      segmentId: state.segmentId,
      segmentIndex: state.segmentIndex,
      segmentCount: this.getTrajectory(state.role).segments.length,
      center: { ...state.targetCenter },
      bounds: { ...state.targetBounds },
      movementProgress: state.segmentProgress,
      nextDirection: state.nextDirection === null ? null : { ...state.nextDirection },
      showTarget: true,
      showDirectionCue: state.phase === "direction-cue",
      shouldCollectSample: state.isSampleEligible,
    };
  }

  private getProgressSnapshot(): PursuitCalibrationSnapshot["progress"] {
    const calibrationCount = this.dependencies.calibrationTrajectory.segments.length;
    const validationCount = this.dependencies.validationTrajectory.segments.length;
    const totalSegments = calibrationCount + validationCount;
    if (this.phase === "completed") {
      return { completedSegments: totalSegments, totalSegments, overallRatio: 1 };
    }

    let completedSegments = 0;
    let fractionalSegment = 0;
    const state = this.currentTrajectoryState;
    if (this.role === "validation" || this.phase === "validating" || this.phase === "fitting") {
      completedSegments = calibrationCount;
    }
    if (state !== null) {
      const roleOffset = state.role === "validation" ? calibrationCount : 0;
      const currentCompleted = state.phase === "moving" || state.phase === "initial-hold"
        ? state.segmentIndex
        : state.segmentIndex + 1;
      completedSegments = Math.max(completedSegments, roleOffset + currentCompleted);
      fractionalSegment = state.phase === "moving" ? state.segmentProgress : 0;
    }
    const overallRatio = totalSegments === 0
      ? 0
      : clamp((completedSegments + fractionalSegment) / totalSegments, 0, 1);
    return {
      completedSegments: Math.min(completedSegments, totalSegments),
      totalSegments,
      overallRatio,
    };
  }

  private getCollectionSnapshot(): PursuitCalibrationSnapshot["collection"] {
    const rejectionCounts: Record<string, number> = { ...this.controllerRejectionCounts };
    let calibrationAcceptedCount = 0;
    let validationAcceptedCount = 0;
    for (const role of ["calibration", "validation"] as const) {
      for (const segment of this.getTrajectory(role).segments) {
        const stats = this.collector.getSegmentCollectionStats(role, segment.id);
        if (stats === null) {
          continue;
        }
        if (role === "calibration") {
          calibrationAcceptedCount += stats.acceptedCount;
        } else {
          validationAcceptedCount += stats.acceptedCount;
        }
        for (const [reason, count] of Object.entries(stats.rejectionCounts)) {
          rejectionCounts[reason] = (rejectionCounts[reason] ?? 0) + count;
        }
      }
    }
    const rejectedCount = Object.values(rejectionCounts).reduce(
      (sum, count) => sum + count,
      0,
    );
    return {
      calibrationAcceptedCount,
      validationAcceptedCount,
      rejectedCount,
      rejectionCounts,
    };
  }

  private rejectWithoutCollector(
    reason: PursuitSampleRejectionReason,
  ): PursuitSampleAcceptanceResult {
    if (!this.disposed) {
      this.controllerRejectionCounts[reason] =
        (this.controllerRejectionCounts[reason] ?? 0) + 1;
      this.publishSnapshot();
    }
    return { ok: false, reason };
  }

  private setPhase(phase: PursuitCalibrationPhase, now: number | null): void {
    if (this.phase === phase) {
      return;
    }
    this.phase = phase;
    this.phaseStartedAtMs = now;
  }

  private fail(code: PursuitCalibrationErrorCode, message: string): void {
    if (this.disposed) {
      return;
    }
    this.generation += 1;
    this.error = { code, message };
    this.role = null;
    this.currentTrajectoryState = null;
    this.trajectoryStartedAtMs = null;
    this.setPhase("failed", this.readClock());
    this.publishSnapshot();
  }

  private readClock(): number | null {
    try {
      const now = Number(this.dependencies.clock.now());
      return Number.isFinite(now) && now >= 0 ? now : null;
    } catch {
      return null;
    }
  }

  private isRunningPhase(phase: PursuitCalibrationPhase): boolean {
    return phase !== "idle"
      && phase !== "completed"
      && phase !== "failed"
      && phase !== "cancelled";
  }

  private publishSnapshot(): void {
    if (this.disposed) {
      return;
    }
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      this.notifyListener(listener, snapshot);
    }
  }

  private notifyListener(
    listener: SnapshotListener,
    snapshot: PursuitCalibrationSnapshot,
  ): void {
    try {
      listener(snapshot);
    } catch {
      // Listener failures are isolated from the controller lifecycle.
    }
  }
}

function mapTrajectoryPhase(
  phase: PursuitTrajectoryState["phase"],
  role: PursuitTrajectoryRole,
): PursuitCalibrationPhase {
  if (role === "validation") {
    switch (phase) {
      case "direction-cue":
        return "validation-direction-cue";
      case "settling":
        return "validation-settling";
      case "moving":
        return "validation-moving";
      case "segment-stop":
      case "endpoint-hold":
        return "validation-segment-stop";
      case "initial-hold":
      case "completed":
        return "validation-preparing";
    }
  }
  switch (phase) {
    case "initial-hold":
      return "initial-hold";
    case "direction-cue":
      return "direction-cue";
    case "settling":
      return "settling";
    case "moving":
      return "moving";
    case "segment-stop":
    case "endpoint-hold":
      return "segment-stop";
    case "completed":
      return "fitting";
  }
}

function toCalibrationObservations(
  pairs: readonly AlignedPair[],
  generation: number,
  role: PursuitTrajectoryRole,
): readonly CalibrationObservation[] {
  return pairs.map((pair, index) => {
    const targetId = `${role}-aligned-${index}`;
    const target: CalibrationTarget = {
      id: targetId,
      order: index,
      role,
      normalizedPoint: { x: 0, y: 0 },
      viewportPoint: { x: pair.targetX, y: pair.targetY },
    };
    return {
      target,
      sample: {
        targetId,
        sessionId: generation,
        timestampMs: pair.timestampMs,
        rawVector: { x: pair.rawX, y: pair.rawY, z: 0 },
      },
    };
  });
}

function determineQuality(
  lagEstimate: PursuitLagEstimate,
  metrics: CalibrationValidationMetrics,
  roiTemplate: GazeConfidenceRoiTemplate,
  config: PursuitCalibrationConfig,
): "valid" | "degraded" {
  if (
    lagEstimate.source === "fallback"
    || lagEstimate.combinedScore < config.lagAlignment.minimumCorrelation
    || metrics.rmse.radial > DEFAULT_QUALITY_THRESHOLDS.maximumRmsePx
    || metrics.maxRadialError > DEFAULT_QUALITY_THRESHOLDS.maximumRadialErrorPx
    || roiTemplate.source === "fallback"
    || roiTemplate.metrics.majorRadiusClamped
    || roiTemplate.metrics.minorRadiusClamped
    || roiTemplate.metrics.empiricalCoverage + QUALITY_COMPARISON_EPSILON
      < roiTemplate.metrics.requestedCoverage
  ) {
    return "degraded";
  }
  return "valid";
}

function getTrackingQuality(observation: RawGazeObservation): number {
  if (
    !observation.quality.faceDetected
    || !observation.quality.leftEyeReady
    || !observation.quality.rightEyeReady
  ) {
    return 0;
  }
  return observation.quality.trackingConfidence ?? 1;
}

function validateViewportRect(viewportRect: ViewportRect): string | null {
  if (
    !Number.isFinite(viewportRect.left)
    || !Number.isFinite(viewportRect.top)
    || !Number.isFinite(viewportRect.width)
    || !Number.isFinite(viewportRect.height)
    || viewportRect.width <= 0
    || viewportRect.height <= 0
  ) {
    return "Viewport rect must contain finite coordinates and positive dimensions.";
  }
  return null;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
