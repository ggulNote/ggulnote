import { parseNoteDecisionInput } from "@/features/voice/note-agent/domain";
import { createDirectCommandAiProviders } from "@/features/voice/server/direct-command-ai-server";
import {
  directAiRouteErrorResponse,
  readDirectAiRouteInput,
} from "@/features/voice/server/direct-ai-route-response";

export async function POST(request: Request): Promise<Response> {
  try {
    const input = parseNoteDecisionInput(await readDirectAiRouteInput(request));
    const { noteDecision } = createDirectCommandAiProviders();
    let telemetry;
    const result = await noteDecision.decide(input, {
      signal: request.signal,
      onTelemetry: (value) => {
        telemetry = value;
      },
    });
    return Response.json(telemetry === undefined ? { result } : { result, telemetry });
  } catch (error) {
    return directAiRouteErrorResponse(error);
  }
}
