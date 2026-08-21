/**
 * One Multimodal Decision owns target selection. The former second-pass
 * disambiguation endpoint remains only as an explicit no-call compatibility
 * response for stale clients.
 */
export function POST(): Response {
  return Response.json(
    {
      error: {
        code: "ONE_DECISION_REQUIRED",
        message: "Target disambiguation must be included in the initial Note Decision.",
      },
    },
    { status: 410 },
  );
}
