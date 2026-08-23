export type DirectTextModelContentPart =
  | {
      readonly type: "input_text";
      readonly text: string;
      readonly prompt_cache_breakpoint?: {
        readonly mode: "explicit";
      };
    }
  | {
      readonly type: "input_image";
      readonly image_url: string;
      readonly detail: "low" | "high";
    };

export interface DirectTextModelMessage {
  role: "developer" | "user";
  content: string | readonly DirectTextModelContentPart[];
}

export interface DirectTextModelRequest {
  instructions: string;
  input: readonly DirectTextModelMessage[];
  maxOutputTokens: number;
  promptCacheKey?: string;
  promptCacheOptions?: {
    readonly mode: "explicit";
  };
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
  readonly cacheWriteInputTokens?: number;
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
