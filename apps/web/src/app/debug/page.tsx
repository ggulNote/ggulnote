import { DebugDashboard } from "@/features/debug/components/debug-dashboard";

const moduleStatus = [
  { name: "Document Engine", status: "미구현" as const },
  { name: "Editor Engine", status: "미구현" as const },
  { name: "Gaze Engine", status: "미구현" as const },
  { name: "Voice Engine", status: "미구현" as const },
  { name: "Intent Engine", status: "미구현" as const },
];

export default function DebugPage() {
  return (
    <DebugDashboard
      environment={process.env.NODE_ENV === "production" ? "production" : "development"}
      nextStatus="App Router 실행 중"
      roadmap={[
        "PDF Document Engine",
        "Canvas Editor Core",
        "Gaze Engine",
        "Voice Engine",
        "Intent Gateway",
      ]}
      moduleStatus={moduleStatus}
      payload={{
        page: "/debug",
        gazeCoordinate: "-",
        roi: "-",
        candidateCount: "0",
        actionPlan: "미정",
        canvasObjects: "0",
      }}
    />
  );
}
