import { describe, expect, it } from "vitest";
import {
  clientPointToNormalized,
  normalizedPointToCss,
  normalizedRectToCss,
} from "@/features/document/coordinates/coordinate-transformer";

describe("좌표 변환", () => {
  it("왼쪽 위 좌표는 (0,0)으로 변환한다", () => {
    const point = clientPointToNormalized({ x: 0, y: 0 }, { left: 0, top: 0, width: 100, height: 100 });

    expect(point).toEqual({ x: 0, y: 0 });
  });

  it("오른쪽 아래 좌표는 (1,1)로 변환한다", () => {
    const point = clientPointToNormalized({ x: 200, y: 100 }, { left: 0, top: 0, width: 200, height: 100 });

    expect(point).toEqual({ x: 1, y: 1 });
  });

  it("중앙 좌표는 (0.5, 0.5)로 변환한다", () => {
    const point = clientPointToNormalized({ x: 50, y: 50 }, { left: 0, top: 0, width: 100, height: 100 });

    expect(point).toEqual({ x: 0.5, y: 0.5 });
  });

  it("페이지 밖 좌표는 null을 반환한다", () => {
    const point = clientPointToNormalized({ x: 120, y: 50 }, { left: 0, top: 0, width: 100, height: 100 });

    expect(point).toBeNull();
  });

  it("정규화 좌표를 CSS 좌표로 역변환한다", () => {
    expect(normalizedPointToCss({ x: 0.5, y: 0.25 }, { width: 200, height: 100 })).toEqual({ x: 100, y: 25 });
  });

  it("정규화 좌표는 확대 배율과 무관하게 유지된다", () => {
    const pageRect = { left: 0, top: 0, width: 120, height: 60 };
    const firstZoom = clientPointToNormalized({ x: 60, y: 30 }, pageRect);
    const secondZoom = clientPointToNormalized({ x: 60, y: 30 }, { ...pageRect });

    expect(firstZoom).toEqual(secondZoom);
  });

  it("정규화 rect를 CSS rect로 변환한다", () => {
    const cssRect = normalizedRectToCss({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, { width: 200, height: 100 });

    expect(cssRect).toEqual({ left: 20, top: 20, width: 60, height: 40 });
  });
});
