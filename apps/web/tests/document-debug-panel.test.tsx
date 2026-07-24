import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentDebugPanel } from "../src/features/document/components/document-debug-panel";
import { getInitialDocumentSessionState } from "../src/features/document/model/document-state";

afterEach(cleanup);

describe("DocumentDebugPanel", () => {
  it("enables bounding-box-only mode without changing layer toggles", () => {
    const onSemanticDebugLayerChange = vi.fn();
    const semanticDebugLayer = {
      pdfTextLayer: false,
      rawTextItems: true,
      textItems: true,
      words: true,
      regionWords: true,
      unassignedWords: true,
      lines: true,
      layoutRegions: true,
      layoutBlocks: true,
      columns: true,
      sentences: true,
      sentenceFragments: true,
      paragraphs: true,
      paragraphFragments: true,
      readingOrder: true,
      regionRelations: true,
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
        pageTextDebug={null}
        selectedRawTextItem={null}
        semanticSource="-"
        onSemanticDebugLayerChange={onSemanticDebugLayerChange}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "바운딩 박스만 보기" }));
    expect(onSemanticDebugLayerChange).toHaveBeenCalledWith({ ...semanticDebugLayer, boxOnly: true });
  });

  it("offers separate PDF.js, raw and normalized Text Item layers", () => {
    render(
      <DocumentDebugPanel
        state={getInitialDocumentSessionState()}
        documentName="test.pdf"
        pointer={null}
        semanticDebugLayer={{
          pdfTextLayer: false,
          rawTextItems: false,
          textItems: false,
          words: false,
          regionWords: false,
          unassignedWords: false,
          lines: false,
          layoutRegions: false,
          layoutBlocks: false,
          columns: false,
          sentences: false,
          sentenceFragments: false,
          paragraphs: false,
          paragraphFragments: false,
          readingOrder: false,
          regionRelations: false,
          candidates: false,
          boxOnly: true,
        }}
        semanticCandidates={[]}
        pageTextDebug={null}
        selectedRawTextItem={null}
        semanticSource="-"
        onSemanticDebugLayerChange={() => undefined}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "PDF.js Text Layer" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Raw PDF.js Text Item" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Normalized Text Item" })).toBeInTheDocument();
  });
});