import { describe, expect, it } from "vitest";
import { extractSpatialPhraseEvidence } from "./spatial-phrase-evidence";

describe("extractSpatialPhraseEvidence", () => {
  it.each([
    {
      transcript: "왼쪽 위에 가나다라라고 써 줘",
      content: "가나다라",
      expected: {
        kind: "EXPLICIT_REGION",
        horizontal: "LEFT",
        vertical: "TOP",
      },
    },
    {
      transcript: "오른쪽 아래쪽에 가나다라라고 써 줘",
      content: "가나다라",
      expected: {
        kind: "EXPLICIT_REGION",
        horizontal: "RIGHT",
        vertical: "BOTTOM",
      },
    },
    {
      transcript: "빈 공간에 가나다라라고 써 줘",
      content: "가나다라",
      expected: { kind: "AUTO_FREE_SPACE" },
    },
    {
      transcript: "현재 화면 오른쪽에 가나다라라고 써 줘",
      content: "가나다라",
      expected: {
        kind: "EXPLICIT_REGION",
        horizontal: "RIGHT",
        scope: "CURRENT_VIEW",
      },
    },
  ])("composes placement terms in '$transcript'", ({ transcript, content, expected }) => {
    expect(extractSpatialPhraseEvidence({
      transcript,
      content,
      hasFocus: false,
    })).toMatchObject(expected);
  });

  it.each([
    ["왼쪽 위라고 써 줘", "왼쪽 위"],
    ["빈 공간이라고 써 줘", "빈 공간"],
    ["오른쪽이라고 적어 줘", "오른쪽"],
  ])("does not reinterpret planner content in '%s'", (transcript, content) => {
    expect(extractSpatialPhraseEvidence({
      transcript,
      content,
      hasFocus: false,
    })).toEqual({ kind: "NONE", tokens: [] });
  });

  it("keeps an outer placement phrase when the content contains a spatial word", () => {
    expect(extractSpatialPhraseEvidence({
      transcript: "왼쪽 위에 '오른쪽'이라고 써 줘",
      content: "오른쪽",
      hasFocus: false,
    })).toMatchObject({
      kind: "EXPLICIT_REGION",
      horizontal: "LEFT",
      vertical: "TOP",
    });
  });

  it("distinguishes focused and deictic relative directions", () => {
    expect(extractSpatialPhraseEvidence({
      transcript: "위에 가나다라라고 써 줘",
      content: "가나다라",
      hasFocus: true,
    })).toMatchObject({ kind: "CONTEXTUAL_RELATIVE", relation: "ABOVE" });
    expect(extractSpatialPhraseEvidence({
      transcript: "그 위에 가나다라라고 써 줘",
      content: "가나다라",
      hasFocus: false,
    })).toMatchObject({
      kind: "CONTEXTUAL_RELATIVE",
      relation: "ABOVE",
      deictic: true,
    });
  });
});
