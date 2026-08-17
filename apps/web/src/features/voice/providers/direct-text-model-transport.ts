export interface DirectTextModelMessage {
  role: "user";
  content: string;
}

export interface DirectTextModelRequest {
  instructions: string;
  input: readonly DirectTextModelMessage[];
  maxOutputTokens: number;
  responseFormat?: {
    readonly type: "json_schema";
    readonly name: string;
    readonly schema: Readonly<Record<string, unknown>>;
    readonly strict: true;
  };
}

export interface DirectTextModelTelemetry {
  readonly openaiTtfbMs: number;
  readonly openaiBodyReadMs: number;
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
}

export interface DirectTextModelTransportOptions {
  signal?: AbortSignal;
  onTelemetry?: (telemetry: DirectTextModelTelemetry) => void;
}

export interface DirectTextModelTransport {
  generate(
    request: DirectTextModelRequest,
    options?: DirectTextModelTransportOptions,
  ): Promise<string>;
}
