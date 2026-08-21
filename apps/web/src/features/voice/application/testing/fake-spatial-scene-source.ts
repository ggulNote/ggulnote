import type {
  FrozenSpatialSceneReference,
  SpatialSceneSource,
  SpatialSceneSourceResult,
} from "../spatial-scene-source";

export class FakeSpatialSceneSource implements SpatialSceneSource {
  public readonly requests: FrozenSpatialSceneReference[] = [];

  public constructor(private result: SpatialSceneSourceResult) {}

  public setResult(result: SpatialSceneSourceResult): void {
    this.result = result;
  }

  public getSnapshot(
    reference: FrozenSpatialSceneReference,
  ): SpatialSceneSourceResult {
    this.requests.push({ ...reference });
    return this.result;
  }
}
