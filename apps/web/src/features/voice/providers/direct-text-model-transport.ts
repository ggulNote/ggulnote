export interface DirectTextModelMessage {
  role: "user";
  content: string;
}

export interface DirectTextModelRequest {
  instructions: string;
  input: readonly DirectTextModelMessage[];
  maxOutputTokens: number;
}

export interface DirectTextModelTransportOptions {
  signal?: AbortSignal;
}

export interface DirectTextModelTransport {
  generate(
    request: DirectTextModelRequest,
    options?: DirectTextModelTransportOptions,
  ): Promise<string>;
}
