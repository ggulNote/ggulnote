import {
  PURSUIT_SAMPLE_REJECTION_REASONS,
  type PursuitRawSample,
  type PursuitRawSampleWithBin,
  type PursuitSampleAcceptanceResult,
  type PursuitSampleRejectionReason,
  type PursuitSegmentCollectionStats,
  type PursuitSpatialBin,
  type PursuitTrajectoryRole,
  type PursuitTrajectoryState,
} from "../domain/pursuit-types";
import type {
  PursuitMotionConfig,
  PursuitSampleSelectionConfig,
} from "../config/pursuit-calibration-config";

type SegmentCollectorState = {
  acceptedSamples: PursuitRawSampleWithBin[];
  lastAcceptedTimestamp: number | null;
  spatialBinCounts: Map<string, number>;
  rejectionCounts: Map<PursuitSampleRejectionReason, number>;
};

type RoleCollectorState = {
  acceptedBySegment: Map<string, PursuitRawSampleWithBin[]>;
  segmentState: Map<string, SegmentCollectorState>;
  seenFrameIds: Set<number>;
  seenSequenceIds: Set<number>;
};

export type PursuitSampleCollectorInput = Readonly<{
  readonly sample: PursuitRawSample;
  readonly activeSegmentId: string;
  readonly expectedSessionId: string;
  readonly expectedRole: PursuitTrajectoryRole;
  readonly trajectoryState: PursuitTrajectoryState | null;
  readonly isCollecting: boolean;
  readonly motionConfig: PursuitMotionConfig;
  readonly trackingQualityThreshold: number;
  readonly collectionConfig: PursuitSampleSelectionConfig;
}>;

export class PursuitSampleCollector {
  private readonly collectorsByRole: Map<PursuitTrajectoryRole, RoleCollectorState>;

  public constructor() {
    this.collectorsByRole = new Map([
      ["calibration", this.createRoleState()],
      ["validation", this.createRoleState()],
    ]);
  }

  public reset(): void {
    this.collectorsByRole.set("calibration", this.createRoleState());
    this.collectorsByRole.set("validation", this.createRoleState());
  }

  public collect(input: PursuitSampleCollectorInput): PursuitSampleAcceptanceResult {
    if (!input.isCollecting) {
      return this.reject(input.sample.role, input.sample.segmentId, "collector-inactive");
    }

    if (input.sample.sessionId !== input.expectedSessionId) {
      return this.reject(input.sample.role, input.sample.segmentId, "wrong-session");
    }

    if (input.sample.role !== input.expectedRole) {
      return this.reject(input.sample.role, input.sample.segmentId, "wrong-role");
    }

    if (!Number.isFinite(input.sample.timestampMs)) {
      return this.reject(input.sample.role, input.sample.segmentId, "invalid-vector");
    }

    if (input.trajectoryState === null) {
      return this.reject(input.sample.role, input.sample.segmentId, "outside-collection-window");
    }

    if (input.sample.segmentId !== input.trajectoryState.segmentId
      || input.sample.segmentId !== input.activeSegmentId) {
      return this.reject(input.sample.role, input.sample.segmentId, "wrong-segment");
    }

    if (input.trajectoryState.phase !== "moving") {
      return this.reject(input.sample.role, input.sample.segmentId, "outside-collection-window");
    }

    if (input.trajectoryState.movementStage === "warmup") {
      return this.reject(input.sample.role, input.sample.segmentId, "movement-warmup");
    }

    if (input.trajectoryState.movementStage === "cooldown") {
      return this.reject(input.sample.role, input.sample.segmentId, "movement-cooldown");
    }

    if (!isFiniteVector(input.sample.rawVector) || !isFiniteTargetSample(input.sample.targetCenter, input.sample.targetBounds)) {
      return this.reject(input.sample.role, input.sample.segmentId, "invalid-vector");
    }

    if (input.sample.smoothedVector !== undefined && !isFiniteVector(input.sample.smoothedVector)) {
      return this.reject(input.sample.role, input.sample.segmentId, "invalid-vector");
    }

    if (input.sample.trackingQuality !== undefined) {
      if (!Number.isFinite(input.sample.trackingQuality)) {
        return this.reject(input.sample.role, input.sample.segmentId, "invalid-vector");
      }

      if (input.sample.trackingQuality <= 0) {
        return this.reject(input.sample.role, input.sample.segmentId, "tracking-unavailable");
      }

      if (input.sample.trackingQuality < input.trackingQualityThreshold) {
        return this.reject(input.sample.role, input.sample.segmentId, "tracking-quality");
      }
    }

    const roleState = this.getRoleState(input.sample.role);
    const segmentState = this.getSegmentState(roleState, input.sample.segmentId);

    if (input.sample.frameId !== undefined) {
      if (!isNonNegativeInteger(input.sample.frameId)) {
        return this.reject(input.sample.role, input.sample.segmentId, "invalid-vector");
      }
      if (roleState.seenFrameIds.has(input.sample.frameId)) {
        return this.reject(input.sample.role, input.sample.segmentId, "duplicate-frame");
      }
    }

    if (input.sample.sequenceId !== undefined) {
      if (!isNonNegativeInteger(input.sample.sequenceId)) {
        return this.reject(input.sample.role, input.sample.segmentId, "invalid-vector");
      }
      if (roleState.seenSequenceIds.has(input.sample.sequenceId)) {
        return this.reject(input.sample.role, input.sample.segmentId, "duplicate-sequence");
      }
    }

    if (segmentState.lastAcceptedTimestamp !== null && input.sample.timestampMs < segmentState.lastAcceptedTimestamp) {
      return this.reject(input.sample.role, input.sample.segmentId, "late-sample");
    }

    if (!isPositiveFinite(input.motionConfig.samplingIntervalMs)) {
      return this.reject(input.sample.role, input.sample.segmentId, "invalid-vector");
    }

    if (segmentState.lastAcceptedTimestamp !== null
      && input.sample.timestampMs - segmentState.lastAcceptedTimestamp < input.motionConfig.samplingIntervalMs) {
      return this.reject(input.sample.role, input.sample.segmentId, "sampling-interval");
    }

    if (!isPositiveFinite(input.collectionConfig.spatialBinSizePx)
      || !isPositiveInteger(input.collectionConfig.maximumSamplesPerSpatialBin)) {
      return this.reject(input.sample.role, input.sample.segmentId, "invalid-vector");
    }

    const spatialBin = getSpatialBin(input.sample.targetCenter, input.collectionConfig.spatialBinSizePx);
    const binKey = toBinKey(spatialBin);
    const binCount = segmentState.spatialBinCounts.get(binKey) ?? 0;
    if (binCount >= input.collectionConfig.maximumSamplesPerSpatialBin) {
      return this.reject(input.sample.role, input.sample.segmentId, "spatial-bin-limit");
    }

    segmentState.lastAcceptedTimestamp = input.sample.timestampMs;
    segmentState.spatialBinCounts.set(binKey, binCount + 1);

    const acceptedSample: PursuitRawSampleWithBin = {
      ...input.sample,
      spatialBin,
    };

    segmentState.acceptedSamples.push(acceptedSample);
    roleState.acceptedBySegment.set(input.sample.segmentId, segmentState.acceptedSamples);

    if (input.sample.frameId !== undefined) {
      roleState.seenFrameIds.add(input.sample.frameId);
    }

    if (input.sample.sequenceId !== undefined) {
      roleState.seenSequenceIds.add(input.sample.sequenceId);
    }

    return { ok: true, sample: acceptedSample };
  }

  public getSamples(role: PursuitTrajectoryRole, segmentId: string): readonly PursuitRawSampleWithBin[] {
    const roleState = this.getRoleState(role);
    return roleState.acceptedBySegment.get(segmentId) ?? [];
  }

  public getSegmentCollectionStats(
    role: PursuitTrajectoryRole,
    segmentId: string,
  ): PursuitSegmentCollectionStats | null {
    const roleState = this.getRoleState(role);
    const segmentState = roleState.segmentState.get(segmentId);
    if (segmentState === undefined) {
      return null;
    }

    const rejectionCounts: Record<string, number> = {};
    for (const reason of PURSUIT_SAMPLE_REJECTION_REASONS) {
      rejectionCounts[reason] = segmentState.rejectionCounts.get(reason) ?? 0;
    }

    return {
      segmentId,
      acceptedCount: segmentState.acceptedSamples.length,
      rejectedCount: sumCounts(segmentState.rejectionCounts),
      rejectionCounts,
      spatialBinCount: segmentState.spatialBinCounts.size,
    };
  }

  public getAllSegmentCollectionStats(role: PursuitTrajectoryRole): readonly PursuitSegmentCollectionStats[] {
    const roleState = this.getRoleState(role);

    const results: PursuitSegmentCollectionStats[] = [];
    for (const segmentId of roleState.segmentState.keys()) {
      const stats = this.getSegmentCollectionStats(role, segmentId);
      if (stats !== null) {
        results.push(stats);
      }
    }

    return results;
  }

  private createRoleState(): RoleCollectorState {
    return {
      acceptedBySegment: new Map<string, PursuitRawSampleWithBin[]>(),
      segmentState: new Map<string, SegmentCollectorState>(),
      seenFrameIds: new Set(),
      seenSequenceIds: new Set(),
    };
  }

  private getRoleState(role: PursuitTrajectoryRole): RoleCollectorState {
    const state = this.collectorsByRole.get(role);
    if (state === undefined) {
      throw new Error(`Unknown pursuit role: ${role}`);
    }

    return state;
  }

  private getSegmentState(state: RoleCollectorState, segmentId: string): SegmentCollectorState {
    const existing = state.segmentState.get(segmentId);
    if (existing !== undefined) {
      return existing;
    }

    const next: SegmentCollectorState = {
      acceptedSamples: [],
      lastAcceptedTimestamp: null,
      spatialBinCounts: new Map(),
      rejectionCounts: createEmptyReasonCounter(),
    };

    state.segmentState.set(segmentId, next);
    state.acceptedBySegment.set(segmentId, next.acceptedSamples);
    return next;
  }

  private reject(
    role: PursuitTrajectoryRole,
    segmentId: string,
    reason: PursuitSampleRejectionReason,
  ): PursuitSampleAcceptanceResult {
    const roleState = this.getRoleState(role);
    const segmentState = this.getSegmentState(roleState, segmentId);
    const current = segmentState.rejectionCounts.get(reason) ?? 0;
    segmentState.rejectionCounts.set(reason, current + 1);

    return { ok: false, reason };
  }
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isFiniteVector(vector: Readonly<{ x: number; y: number; z: number }>): boolean {
  return Number.isFinite(vector.x)
    && Number.isFinite(vector.y)
    && Number.isFinite(vector.z)
    && Number.isFinite(Math.hypot(vector.x, vector.y, vector.z));
}

function isFiniteTargetSample(
  targetCenter: Readonly<{ x: number; y: number }>,
  targetBounds: Readonly<{ left: number; right: number; top: number; bottom: number }>,
): boolean {
  return Number.isFinite(targetCenter.x)
    && Number.isFinite(targetCenter.y)
    && Number.isFinite(targetBounds.left)
    && Number.isFinite(targetBounds.right)
    && Number.isFinite(targetBounds.top)
    && Number.isFinite(targetBounds.bottom)
    && targetBounds.left <= targetBounds.right
    && targetBounds.top <= targetBounds.bottom;
}

function getSpatialBin(
  point: Readonly<{ x: number; y: number }>,
  spatialBinSizePx: number,
): PursuitSpatialBin {
  return {
    x: Math.floor(point.x / spatialBinSizePx),
    y: Math.floor(point.y / spatialBinSizePx),
  };
}

function toBinKey(bin: PursuitSpatialBin): string {
  return `${bin.x},${bin.y}`;
}

function createEmptyReasonCounter(): Map<PursuitSampleRejectionReason, number> {
  return new Map(
    PURSUIT_SAMPLE_REJECTION_REASONS.map((reason) => [reason, 0]),
  );
}

function sumCounts(map: Map<PursuitSampleRejectionReason, number>): number {
  let total = 0;
  for (const value of map.values()) {
    total += value;
  }

  return total;
}
