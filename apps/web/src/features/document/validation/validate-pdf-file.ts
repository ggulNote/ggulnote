export const MAX_LOCAL_PDF_BYTES = 50 * 1024 * 1024;

type ValidationResult =
  | { ok: true; file: File }
  | { ok: false; message: string };

export function validatePdfFile(file?: File | null): ValidationResult {
  if (!file) {
    return { ok: false, message: "PDF 파일을 선택해 주세요." };
  }

  if (file.size === 0) {
    return { ok: false, message: "PDF 파일이 비어 있습니다." };
  }

  if (file.size > MAX_LOCAL_PDF_BYTES) {
    return { ok: false, message: "PDF 파일 크기는 50MB를 초과할 수 없습니다." };
  }

  const extension = file.name.toLowerCase().endsWith(".pdf");
  if (file.type !== "application/pdf" && file.type !== "application/x-pdf" && !extension) {
    return { ok: false, message: "PDF 파일(.pdf)만 선택할 수 있습니다." };
  }

  return { ok: true, file };
}
