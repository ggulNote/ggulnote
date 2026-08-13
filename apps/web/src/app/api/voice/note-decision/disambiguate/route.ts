import { parseNoteDisambiguationInput } from "@/features/voice/note-agent/domain";
import { createDirectCommandAiProviders } from "@/features/voice/server/direct-command-ai-server";
import {
  directAiRouteErrorResponse,
  readDirectAiRouteInput,
} from "@/features/voice/server/direct-ai-route-response";

export async function POST(request: Request): Promise<Response> {
  try {
    const input = parseNoteDisambiguationInput(await readDirectAiRouteInput(request));
    const { noteDecision } = createDirectCommandAiProviders();
    const result = await noteDecision.disambiguate(input, { signal: request.signal });
    return Response.json({ result });
  } catch (error) {
    return directAiRouteErrorResponse(error);
  }
}
