import { type ReactNode } from "react";

type DocumentErrorStateProps = {
  message: string;
  details?: ReactNode;
};

export function DocumentErrorState({ message, details }: DocumentErrorStateProps): React.ReactElement {
  return (
    <section
      className="rounded-lg border border-red-300 bg-red-50 p-6 text-red-800"
      role="alert"
      aria-live="polite"
    >
      <h2 className="text-xl font-semibold">문서 로딩 중 오류가 발생했습니다.</h2>
      <p className="mt-2 text-sm">{message}</p>
      {details ? <div className="mt-2 text-sm">{details}</div> : null}
    </section>
  );
}
