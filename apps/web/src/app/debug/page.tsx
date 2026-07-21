import { DebugDashboard } from "@/features/debug/components/debug-dashboard";

const moduleStatus = [
  { name: "Document Engine", status: "준비 중" as const },
  { name: "Editor Engine", status: "미구현" as const },
  { name: "Gaze Engine", status: "미구현" as const },
  { name: "Voice Engine", status: "미구현" as const },
  { name: "Intent Engine", status: "미구현" as const },
];

export default function DebugPage() {
  return (
    <DebugDashboard
      environment={process.env.NODE_ENV === "production" ? "production" : "development"}
      nextStatus="App Router 앱 상태"
      moduleStatus={moduleStatus}
      roadmap={[
        "PDF.js 기반 PDF 렌더링",
        "백지 문서 렌더링",
        "Canvas Editor Core",
        "Gaze Engine",
        "Voice Engine",
        "Intent Gateway",
      ]}
      payload={{
        documentKind: "none",
        documentStatus: "empty",
        documentName: "-",
        currentPage: "-",
        pageCount: "-",
        zoom: "100%",
        zoomMode: "custom",
        originalWidth: "-",
        originalHeight: "-",
        renderedWidth: "-",
        renderedHeight: "-",
        pointerX: "-",
        pointerY: "-",
        textItemCount: "0",
        pdfJsLoaded: "not loaded",
        pdfWorkerLoaded: "not loaded",
      }}
    />
  );
}
