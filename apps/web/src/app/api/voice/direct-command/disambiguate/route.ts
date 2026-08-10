import {
  parseDirectTargetDisambiguationInput,
} from "@/features/voice/domain";
import { createDirectCommandAiProviders } from "@/features/voice/server/direct-command-ai-server";
import {
  directAiRouteErrorResponse,
  readDirectAiRouteInput,
} from "@/features/voice/server/direct-ai-route-response";

export async function POST(request: Request): Promise<Response> {
  try {
    const input = parseDirectTargetDisambiguationInput(
      await readDirectAiRouteInput(request),
    );
    const { disambiguator } = createDirectCommandAiProviders();
    const result = await disambiguator.disambiguate(input, {
      signal: request.signal,
    });
    return Response.json({ result });
  } catch (error) {
    return directAiRouteErrorResponse(error);
  }
}
