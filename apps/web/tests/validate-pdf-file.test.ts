import { describe, expect, it } from "vitest";
import { validatePdfFile, MAX_LOCAL_PDF_BYTES } from "@/features/document/validation/validate-pdf-file";

describe("PDF 파일 유효성 검사", () => {
  it("PDF 파일을 허용한다", () => {
    const file = new File(["test"], "sample.pdf", { type: "application/pdf" });
    const result = validatePdfFile(file);

    expect(result.ok).toBe(true);
  });

  it("PDF가 아닌 파일을 거부한다", () => {
    const file = new File(["test"], "sample.txt", { type: "text/plain" });
    const result = validatePdfFile(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("PDF 파일");
    }
  });

  it("빈 파일을 거부한다", () => {
    const file = new File([""] , "sample.pdf", { type: "application/pdf" });
    const result = validatePdfFile(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("비어");
    }
  });

  it("50MB 초과 파일을 거부한다", () => {
    const bytes = new Uint8Array(MAX_LOCAL_PDF_BYTES + 1);
    const file = new File([bytes], "big.pdf", { type: "application/pdf" });
    const result = validatePdfFile(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("50MB");
    }
  });
});
