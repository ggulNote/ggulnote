import { parseNoteDecisionWarmupInput } from "@/features/voice/note-agent/domain";
import { createDirectCommandAiProviders } from "@/features/voice/server/direct-command-ai-server";
import {
  directAiRouteErrorResponse,
  readDirectAiRouteInput,
} from "@/features/voice/server/direct-ai-route-response";

export async function POST(request: Request): Promise<Response> {
  try {
    const input = parseNoteDecisionWarmupInput(
      await readDirectAiRouteInput(request),
    );
    const { noteDecision } = createDirectCommandAiProviders();
    let telemetry;
    await noteDecision.warmup(input, {
      signal: request.signal,
      onTelemetry: (value) => {
        telemetry = value;
      },
    });
    return Response.json(
      telemetry === undefined
        ? { result: true }
        : { result: true, telemetry },
    );
  } catch (error) {
    return directAiRouteErrorResponse(error);
  }
}
