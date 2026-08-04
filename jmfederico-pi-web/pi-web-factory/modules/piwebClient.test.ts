/**
 * Unit-level tests for the pure helpers in piwebClient.ts that don't need a
 * live server. The end-to-end HTTP/WebSocket flow is covered separately in
 * piwebClient.integration.test.ts against the real pi-web instance.
 */

import { describe, expect, test } from "bun:test";
import { lastAssistantText, type SessionMessage } from "./piwebClient.ts";

describe("lastAssistantText", () => {
  test("returns undefined when there is no assistant message", () => {
    const messages: SessionMessage[] = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
    expect(lastAssistantText(messages)).toBeUndefined();
  });

  test("concatenates only text parts, skipping thinking parts, from the last assistant message", () => {
    const messages: SessionMessage[] = [
      { role: "user", content: [{ type: "text", text: "Reply with exactly the word: pong" }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "The user wants pong." },
          { type: "text", text: "pong" },
        ],
      },
    ];
    expect(lastAssistantText(messages)).toBe("pong");
  });

  test("picks the LAST assistant message when several are present (e.g. across turns)", () => {
    const messages: SessionMessage[] = [
      { role: "user", content: [{ type: "text", text: "first" }] },
      { role: "assistant", content: [{ type: "text", text: "first reply" }] },
      { role: "user", content: [{ type: "text", text: "second" }] },
      { role: "assistant", content: [{ type: "text", text: "second reply" }] },
    ];
    expect(lastAssistantText(messages)).toBe("second reply");
  });

  test("joins multiple text parts of one assistant message in order", () => {
    const messages: SessionMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "part one " },
          { type: "text", text: "part two" },
        ],
      },
    ];
    expect(lastAssistantText(messages)).toBe("part one part two");
  });
});
