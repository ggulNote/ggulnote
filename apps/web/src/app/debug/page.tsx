import Link from "next/link";
import { DebugDashboard } from "@/features/debug/components/debug-dashboard";
import { SceneCoreDebugPanel } from "@/features/debug/components/scene-core-debug-panel";

const moduleStatus = [
  { name: "Document Engine", status: "준비 중" as const },
  { name: "Editor Engine", status: "미구현" as const },
  { name: "Gaze Engine", status: "준비 중" as const },
  { name: "Voice Engine", status: "미구현" as const },
  { name: "Intent Engine", status: "미구현" as const },
];

export default function DebugPage() {
  return (
    <main className="mx-auto w-full max-w-7xl p-4 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-semibold text-slate-900">디버그 대시보드</h1>
        <div className="flex gap-2 text-sm">
          <Link
            href={{ pathname: "/debug/gaze" }}
            className="rounded-md border border-slate-300 px-3 py-2 text-slate-700 hover:bg-slate-100"
          >
            /debug/gaze로 이동
          </Link>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
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
      </div>

      <div className="mt-6">
        <SceneCoreDebugPanel />
      </div>
    </main>
  );
}
