import type { InteractionClock } from "@ggulnote/interaction-core";
import type { SessionTimeMs } from "@ggulnote/shared-types";

export type CapturedVideoFrame = {
  readonly frameId: number;
  readonly sourceCapturedAt: SessionTimeMs;
  readonly imageBitmap: ImageBitmap;
  readonly frameWidth: number;
  readonly frameHeight: number;
};

export type VideoFrameCaptureCallback = (frame: CapturedVideoFrame) => void;

export class FrameScheduler {
  private running = false;
  private frameIdSequence = 0;
  private frameRequestHandle: number | null = null;
  private videoFrameCallbackId: number | null = null;

  public constructor(
    private readonly video: HTMLVideoElement,
    private readonly clock: InteractionClock,
    private readonly onFrame: VideoFrameCaptureCallback,
  ) {}

  public start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.frameIdSequence = 0;
    this.scheduleNextFrame();
  }

  public stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    if (this.frameRequestHandle !== null) {
      cancelAnimationFrame(this.frameRequestHandle);
      this.frameRequestHandle = null;
    }

    if (this.videoFrameCallbackId !== null && "cancelVideoFrameCallback" in this.video) {
      this.video.cancelVideoFrameCallback(this.videoFrameCallbackId);
      this.videoFrameCallbackId = null;
    }
  }

  private scheduleNextFrame(): void {
    if (!this.running) {
      return;
    }

    if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
      this.scheduleWithVideoFrameCallback();
      return;
    }

    this.scheduleWithAnimationFrame();
  }

  private scheduleWithVideoFrameCallback(): void {
    const callback = async () => {
      await this.captureFrame();
      this.scheduleNextFrame();
    };

    if (!this.running) {
      return;
    }

    this.videoFrameCallbackId = this.video.requestVideoFrameCallback(() => {
      void callback();
    });
  }

  private scheduleWithAnimationFrame(): void {
    const handle = requestAnimationFrame(() => {
      void (async () => {
        await this.captureFrame();
        this.scheduleNextFrame();
      })();
    });

    this.frameRequestHandle = handle;
  }

  private async captureFrame(): Promise<void> {
    const frameId = this.frameIdSequence + 1;
    const sourceCapturedAt = this.clock.now();

    if (this.video.readyState < 2 || this.video.videoWidth === 0 || this.video.videoHeight === 0) {
      return;
    }

    const imageBitmap = await createImageBitmap(this.video);
    this.frameIdSequence = frameId;

    if (!this.running) {
      imageBitmap.close();
      return;
    }

    this.onFrame({
      frameId,
      sourceCapturedAt,
      imageBitmap,
      frameWidth: imageBitmap.width,
      frameHeight: imageBitmap.height,
    });
  }
}
