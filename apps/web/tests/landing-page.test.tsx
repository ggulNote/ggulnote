import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LandingPageContent } from "@/features/home/components/landing-page-content";

afterEach(() => {
  cleanup();
});

describe("Landing page", () => {
  it("메인 페이지에서 서비스명과 한 줄 설명을 확인한다", () => {
    render(<LandingPageContent />);

    expect(screen.getByRole("heading", { name: "꿀노트" })).toBeInTheDocument();
    expect(screen.getByText("시선과 음성으로 사용하는 핸즈프리 필기 앱")).toBeInTheDocument();
  });

  it("에디터 링크가 노출된다", () => {
    render(<LandingPageContent />);

    expect(screen.getByRole("link", { name: /에디터 페이지 이동/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /디버그 페이지 이동/i })).toBeInTheDocument();
  });

  it("/editor와 /debug 경로로 이동 가능한 링크를 노출한다", () => {
    render(<LandingPageContent />);

    const links = screen.getAllByRole("link");
    const editor = links.find((link) => link.getAttribute("href") === "/editor");
    const debug = links.find((link) => link.getAttribute("href") === "/debug");

    expect(editor).toBeDefined();
    expect(debug).toBeDefined();
  });
});
