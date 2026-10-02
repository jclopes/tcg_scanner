import { describe, expect, it } from "vitest";
import { formatCsv } from "./csv";

describe("formatCsv", () => {
  it("writes the header then each row, CRLF-terminated", () => {
    expect(formatCsv(["set_id", "card_id"], [["PRM01", "005"], ["boxtoppersbeta", "β001"]])).toBe(
      "set_id,card_id\r\nPRM01,005\r\nboxtoppersbeta,β001\r\n",
    );
  });

  it("quotes fields with commas, quotes or line breaks, doubling inner quotes", () => {
    expect(formatCsv(["a"], [["x,y"], ['say "hi"'], ["two\nlines"]])).toBe(
      'a\r\n"x,y"\r\n"say ""hi"""\r\n"two\nlines"\r\n',
    );
  });
});
