import { describe, expect, it } from "vitest";
import { parseNoteDecision, type NoteDecision } from "../domain";
import { FakeNoteDecisionProvider } from "./note-decision-provider";

interface ParityFixture {
  readonly transcript: string;
  readonly decision: NoteDecision;
  readonly expectedTool?: string;
}

const FIXTURES: readonly ParityFixture[] = [
  {
    transcript: "가나다라 써 줘",
    decision: { status: "CALL", call: { stepId: "s1", toolId: "text.create", input: { text: "가나다라" } } },
    expectedTool: "text.create",
  },
  {
    transcript: "오른쪽 위에 가나다라 써 줘",
    decision: { status: "CALL", call: { stepId: "s1", toolId: "text.create", input: { text: "가나다라", destination: { kind: "PAGE_REGION", region: "TOP_RIGHT" } } } },
    expectedTool: "text.create",
  },
  {
    transcript: "안녕하세요 아래에 가나다라 써 줘",
    decision: { status: "CALL", call: { stepId: "s1", toolId: "text.create", input: { text: "가나다라", destination: { kind: "RELATIVE", relation: "BELOW", anchor: { content: { text: "안녕하세요" } } } } } },
    expectedTool: "text.create",
  },
  {
    transcript: "내가 쓴 안녕하세요 옆에 그래프 그려 줘",
    decision: { status: "CALL", call: { stepId: "s1", toolId: "graph.create", input: { destination: { kind: "RELATIVE", relation: "BESIDE", anchor: { source: "USER_CREATED", content: { text: "안녕하세요" } } } } } },
    expectedTool: "graph.create",
  },
  {
    transcript: "그래프 아래에 있는 수식을 지워 줘",
    decision: { status: "CALL", call: { stepId: "s1", toolId: "object.delete", input: { target: { kinds: ["formula"], spatial: [{ relation: "BELOW", reference: { kind: "ENTITY", selector: { kinds: ["graph"] } } }] } } } },
    expectedTool: "object.delete",
  },
  {
    transcript: "방금 만든 밑줄 아래에 중요하다고 써 줘",
    decision: { status: "CALL", call: { stepId: "s1", toolId: "text.create", input: { text: "중요", destination: { kind: "RELATIVE", relation: "BELOW", anchor: { kinds: ["annotation"], attributes: { annotationType: "underline" }, temporal: "RECENT" } } } } },
    expectedTool: "text.create",
  },
  {
    transcript: "Moreover부터 instance까지 밑줄 쳐 줘",
    decision: { status: "CALL", call: { stepId: "s1", toolId: "annotation.apply", input: { target: { source: "PDF_BASE", attributes: { startAnchor: "Moreover", endAnchor: "instance" } }, annotationType: "UNDERLINE" } } },
    expectedTool: "annotation.apply",
  },
  {
    transcript: "이거 지워 줘",
    decision: { status: "CALL", call: { stepId: "s1", toolId: "object.delete", input: { target: { context: "SELECTION" } } } },
    expectedTool: "object.delete",
  },
  {
    transcript: "지워 줘",
    decision: { status: "NEEDS_INPUT", missing: ["target"] },
  },
  {
    transcript: "없는 제목 아래에 써 줘",
    decision: { status: "CALL", call: { stepId: "s1", toolId: "text.create", input: { text: "메모", destination: { kind: "RELATIVE", relation: "BELOW", anchor: { content: { text: "없는 제목" } } } } } },
    expectedTool: "text.create",
  },
  {
    transcript: "PDF 문단을 지워 줘",
    decision: { status: "CALL", call: { stepId: "s1", toolId: "object.delete", input: { target: { kinds: ["paragraph"], source: "PDF_BASE" } } } },
    expectedTool: "object.delete",
  },
  {
    transcript: "그래프 그려 줘",
    decision: { status: "UNSUPPORTED", reasonCode: "TOOL_NOT_AVAILABLE" },
  },
];

describe("One Note Decision parity fixtures", () => {
  it.each(FIXTURES)("preserves declarative intent: $transcript", async (fixture) => {
    const parsed = parseNoteDecision(fixture.decision);
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toMatch(/objectId|candidateId|rangeId|partId|bounds|offset|"x"|"y"/u);
    if (fixture.expectedTool !== undefined && parsed.status === "CALL") {
      expect(parsed.call.toolId).toBe(fixture.expectedTool);
    }
    const provider = new FakeNoteDecisionProvider(parsed);
    await provider.decide({
      turn: { turnId: "turn-1", language: "ko-KR", rawFinalTranscript: fixture.transcript },
      frozenContext: { documentId: "doc-1", pageId: "page-1", sceneRevision: 7, sceneMode: "pdf" },
      availableTools: [],
    });
    expect(provider.callCount).toBe(1);
  });
});
