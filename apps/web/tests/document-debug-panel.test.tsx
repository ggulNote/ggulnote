import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentDebugPanel } from "../src/features/document/components/document-debug-panel";
import { getInitialDocumentSessionState } from "../src/features/document/model/document-state";

describe("DocumentDebugPanel", () => {
  it("enables bounding-box-only mode without changing layer toggles", () => {
    const onSemanticDebugLayerChange = vi.fn();
    const semanticDebugLayer = {
      textItems: true,
      words: true,
      lines: true,
      layoutRegions: true,
      layoutBlocks: true,
      columns: true,
      sentences: true,
      sentenceFragments: true,
      paragraphs: true,paragraphFragments: true,
      readingOrder: true,
      candidates: true,
      boxOnly: false,
    };

    render(
      <DocumentDebugPanel
        state={getInitialDocumentSessionState()}
        documentName="test.pdf"
        pointer={null}
        semanticDebugLayer={semanticDebugLayer}
        semanticCandidates={[]}
        onSemanticDebugLayerChange={onSemanticDebugLayerChange}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "바운딩 박스만 보기" }));

    expect(onSemanticDebugLayerChange).toHaveBeenCalledWith({
      ...semanticDebugLayer,
      boxOnly: true,
    });
  });
});
