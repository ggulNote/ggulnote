import { A4_PORTRAIT_POINTS } from "../model/document-types";

type BlankPageProps = {
  width: number;
  height: number;
};

export function BlankPage({ width, height }: BlankPageProps): React.ReactElement {
  const stageWidth = Number.isFinite(width) && width > 0 ? width : A4_PORTRAIT_POINTS.width;
  const stageHeight = Number.isFinite(height) && height > 0 ? height : A4_PORTRAIT_POINTS.height;

  return (
    <div
      role="img"
      aria-label="백지 문서 페이지"
      className="grid h-full w-full place-items-center bg-white text-sm text-slate-400"
      style={{ width: `${stageWidth}px`, height: `${stageHeight}px` }}
    >
      Blank Page (A4)
    </div>
  );
}
