import { describe, it, expect } from "vitest";
import { MaverickMessageSchema } from "../src/messaging/types.js";
import type { MaverickMessage } from "../src/messaging/types.js";
import { MaverickMessageCodec } from "../src/messaging/codec.js";

const codec = new MaverickMessageCodec();

describe("maverick message schema", () => {
  it("parses a basic message", () => {
    const msg = MaverickMessageSchema.parse({
      text: "Hello world",
    });
    expect(msg.text).toBe("Hello world");
    expect(msg.replyTo).toEqual([]);
  });

  it("parses a reply message", () => {
    const msg = MaverickMessageSchema.parse({
      text: "Great point!",
      replyTo: ["msg-1"],
    });
    expect(msg.replyTo).toEqual(["msg-1"]);
  });

  it("parses a multi-parent reply", () => {
    const msg = MaverickMessageSchema.parse({
      text: "Agreed on both",
      replyTo: ["msg-1", "msg-2"],
    });
    expect(msg.replyTo).toEqual(["msg-1", "msg-2"]);
  });

  it("parses a message with quotes", () => {
    const msg = MaverickMessageSchema.parse({
      text: "This is interesting",
      replyTo: ["msg-1"],
      quotes: [
        { parentMessageId: "msg-1", quotedText: "Some original text" },
      ],
    });
    expect(msg.quotes).toHaveLength(1);
    expect(msg.quotes![0].quotedText).toBe("Some original text");
  });

  it("parses an edit", () => {
    const msg = MaverickMessageSchema.parse({
      text: "Updated text",
      editOf: "msg-1",
    });
    expect(msg.editOf).toBe("msg-1");
  });

  it("parses a delete", () => {
    const msg = MaverickMessageSchema.parse({
      text: "",
      deleteOf: "msg-1",
    });
    expect(msg.deleteOf).toBe("msg-1");
  });

  it("rejects missing text", () => {
    expect(() => MaverickMessageSchema.parse({})).toThrow();
  });
});

describe("maverick message codec", () => {
  it("round-trips a basic message", () => {
    const original: MaverickMessage = {
      text: "Hello world",
      replyTo: [],
    };
    const encoded = codec.encode(original);
    expect(encoded.type?.authorityId).toBe("community.maverick");
    expect(encoded.type?.typeId).toBe("message");

    const decoded = codec.decode(encoded);
    expect(decoded).toEqual(original);
  });

  it("round-trips a multi-parent reply with quotes", () => {
    const original: MaverickMessage = {
      text: "Agreed on both points",
      replyTo: ["msg-1", "msg-2"],
      quotes: [
        { parentMessageId: "msg-1", quotedText: "First point" },
        { parentMessageId: "msg-2", quotedText: "Second point" },
      ],
    };
    const encoded = codec.encode(original);
    const decoded = codec.decode(encoded);
    expect(decoded).toEqual(original);
  });

  it("round-trips an edit message", () => {
    const original: MaverickMessage = {
      text: "Corrected text",
      replyTo: [],
      editOf: "msg-original",
    };
    const encoded = codec.encode(original);
    const decoded = codec.decode(encoded);
    expect(decoded).toEqual(original);
  });

  it("round-trips a delete message", () => {
    const original: MaverickMessage = {
      text: "",
      replyTo: [],
      deleteOf: "msg-to-delete",
    };
    const encoded = codec.encode(original);
    const decoded = codec.decode(encoded);
    expect(decoded).toEqual(original);
  });

  it("generates fallback for regular message", () => {
    expect(
      codec.fallback({ text: "Hello", replyTo: [] }),
    ).toBe("Hello");
  });

  it("generates fallback for delete", () => {
    expect(
      codec.fallback({ text: "", replyTo: [], deleteOf: "msg-1" }),
    ).toBe("[Message deleted]");
  });

  it("generates fallback for edit", () => {
    expect(
      codec.fallback({ text: "New text", replyTo: [], editOf: "msg-1" }),
    ).toBe("[Edited] New text");
  });

  it("shouldPush returns true", () => {
    expect(codec.shouldPush({ text: "Hi", replyTo: [] })).toBe(true);
  });
});

describe("message schema bounds", () => {
  it("rejects oversized text", () => {
    const result = MaverickMessageSchema.safeParse({
      text: "x".repeat(100_001),
    });
    expect(result.success).toBe(false);
  });

  it("accepts max-length text", () => {
    const result = MaverickMessageSchema.safeParse({
      text: "x".repeat(100_000),
    });
    expect(result.success).toBe(true);
  });

  it("rejects too many replyTo entries", () => {
    const result = MaverickMessageSchema.safeParse({
      text: "hi",
      replyTo: Array.from({ length: 21 }, (_, i) => `msg-${i}`),
    });
    expect(result.success).toBe(false);
  });

  it("rejects too many quotes", () => {
    const result = MaverickMessageSchema.safeParse({
      text: "hi",
      quotes: Array.from({ length: 11 }, (_, i) => ({
        parentMessageId: `msg-${i}`,
        quotedText: "q",
      })),
    });
    expect(result.success).toBe(false);
  });
});
