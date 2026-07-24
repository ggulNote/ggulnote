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
      lines: true,
      layoutRegions: true,
      layoutBlocks: true,
      columns: true,
      formFields: true,
      formMarkers: true,
      formLabels: true,
      formValues: true,
      tables: true,
      sentences: true,
      sentenceFragments: true,
      paragraphs: true,
      paragraphFragments: true,
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
        pageTextDebug={null}
        selectedRawTextItem={null}
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
          lines: false,
          layoutRegions: false,
          layoutBlocks: false,
          columns: false,
          formFields: false,
          formMarkers: false,
          formLabels: false,
          formValues: false,
          tables: false,
          sentences: false,
          sentenceFragments: false,
          paragraphs: false,
          paragraphFragments: false,
          readingOrder: false,
          candidates: false,
          boxOnly: true,
        }}
        semanticCandidates={[]}
        pageTextDebug={null}
        selectedRawTextItem={null}
        onSemanticDebugLayerChange={() => undefined}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "PDF.js Text Layer" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Raw PDF.js Text Item" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Normalized Text Item" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "FormFieldRow" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Table Region" })).toBeInTheDocument();
  });
});