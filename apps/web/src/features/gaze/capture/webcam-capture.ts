export type WebcamErrorKind =
  | "unsupported"
  | "permission-denied"
  | "device-not-found"
  | "in-use"
  | "unknown";

export class WebcamCaptureError extends Error {
  public constructor(
    public readonly kind: WebcamErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "WebcamCaptureError";
  }
}

export type WebcamCaptureOptions = {
  readonly facingMode?: string;
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
};

export class WebcamCapture {
  private stream: MediaStream | null = null;

  public async open(): Promise<MediaStream> {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      throw new WebcamCaptureError("unsupported", "이 브라우저는 카메라 API를 지원하지 않습니다.");
    }

    const constraints: MediaStreamConstraints = {
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 },
      },
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      return this.stream;
    } catch (error: unknown) {
      const kind = classifyWebcamError(error);
      const message = error instanceof Error ? error.message : "카메라를 열 수 없습니다.";
      throw new WebcamCaptureError(kind, message);
    }
  }

  public close(): void {
    if (!this.stream) {
      return;
    }

    for (const track of this.stream.getTracks()) {
      track.stop();
    }

    this.stream = null;
  }

  public getStream(): MediaStream | null {
    return this.stream;
  }
}

function classifyWebcamError(error: unknown): WebcamErrorKind {
  if (!(error instanceof Error)) {
    return "unknown";
  }

  switch (error.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "permission-denied";
    case "NotFoundError":
    case "OverconstrainedError":
      return "device-not-found";
    case "NotReadableError":
    case "AbortError":
      return "in-use";
    default:
      return "unknown";
  }
}
