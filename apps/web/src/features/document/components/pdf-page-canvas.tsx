type PdfPageCanvasProps = {
  canvasRef: (canvas: HTMLCanvasElement | null) => void;
};

export function PdfPageCanvas({ canvasRef }: PdfPageCanvasProps): React.ReactElement {
  return (
    <>
      <canvas
        ref={canvasRef}
        className="h-full w-full block bg-white"
        aria-label="PDF 페이지 캔버스"
        role="img"
      />
      <p className="sr-only">PDF 페이지 캔버스</p>
    </>
  );
}
