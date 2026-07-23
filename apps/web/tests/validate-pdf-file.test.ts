import { describe, expect, it } from "vitest";
import { validatePdfFile, MAX_LOCAL_PDF_BYTES } from "@/features/document/validation/validate-pdf-file";

describe("PDF ���� ��ȿ�� �˻�", () => {
  it("PDF ������ ����Ѵ�", () => {
    const file = new File(["test"], "sample.pdf", { type: "application/pdf" });
    const result = validatePdfFile(file);

    expect(result.ok).toBe(true);
  });

  it("PDF�� �ƴ� ������ �ź��Ѵ�", () => {
    const file = new File(["test"], "sample.txt", { type: "text/plain" });
    const result = validatePdfFile(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("PDF 파일");
    }
  });

  it("�� ������ �ź��Ѵ�", () => {
    const file = new File([""] , "sample.pdf", { type: "application/pdf" });
    const result = validatePdfFile(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("비어");
    }
  });

  it("50MB �ʰ� ������ �ź��Ѵ�", () => {
    const bytes = new Uint8Array(MAX_LOCAL_PDF_BYTES + 1);
    const file = new File([bytes], "big.pdf", { type: "application/pdf" });
    const result = validatePdfFile(file);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("50MB");
    }
  });
});
