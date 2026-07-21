import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[220px] w-full max-w-5xl flex-col items-start justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold text-slate-900">페이지를 찾을 수 없습니다.</h1>
      <p className="text-slate-600">요청한 경로가 존재하지 않거나 이동되었을 수 있습니다.</p>
      <Link href="/" className="underline">
        홈으로 돌아가기
      </Link>
    </main>
  );
}
