import { describe, it, expect } from "vitest";
import { MetaMessageSchema } from "../src/community/meta-types.js";
import type {
  MetaMessage,
  CommunityConfig,
  ChannelCreated,
  RoleAssignment,
  ModerationAction,
} from "../src/community/meta-types.js";
import { MetaMessageCodec } from "../src/community/meta-codec.js";

const codec = new MetaMessageCodec();

describe("meta message schemas", () => {
  it("parses community.config", () => {
    const config: CommunityConfig = {
      type: "community.config",
      name: "Test Community",
      description: "A test",
      settings: {
        allowMemberInvites: true,
        defaultChannelPermissions: "open",
      },
    };
    const parsed = MetaMessageSchema.parse(config);
    expect(parsed.type).toBe("community.config");
    if (parsed.type === "community.config") {
      expect(parsed.name).toBe("Test Community");
      expect(parsed.settings.allowMemberInvites).toBe(true);
    }
  });

  it("parses channel.created", () => {
    const msg: ChannelCreated = {
      type: "channel.created",
      channelId: "ch-1",
      name: "general",
      xmtpGroupId: "grp-1",
      permissions: "open",
    };
    const parsed = MetaMessageSchema.parse(msg);
    expect(parsed.type).toBe("channel.created");
  });

  it("parses community.role", () => {
    const msg: RoleAssignment = {
      type: "community.role",
      targetDid: "did:plc:abc123",
      role: "admin",
    };
    const parsed = MetaMessageSchema.parse(msg);
    expect(parsed.type).toBe("community.role");
  });

  it("parses moderation.action", () => {
    const msg: ModerationAction = {
      type: "moderation.action",
      action: "ban",
      targetDid: "did:plc:badactor",
      reason: "spam",
    };
    const parsed = MetaMessageSchema.parse(msg);
    expect(parsed.type).toBe("moderation.action");
  });

  it("rejects invalid type", () => {
    expect(() =>
      MetaMessageSchema.parse({ type: "invalid.type", foo: "bar" }),
    ).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() =>
      MetaMessageSchema.parse({ type: "community.config" }),
    ).toThrow();
  });
});

describe("meta message codec", () => {
  it("round-trips community.config", () => {
    const original: MetaMessage = {
      type: "community.config",
      name: "Maverick HQ",
      description: "The main community",
      settings: {
        allowMemberInvites: false,
        defaultChannelPermissions: "moderated",
      },
    };
    const encoded = codec.encode(original);
    expect(encoded.type?.authorityId).toBe("community.maverick");
    expect(encoded.type?.typeId).toBe("meta");
    expect(encoded.content).toBeInstanceOf(Uint8Array);

    const decoded = codec.decode(encoded);
    expect(decoded).toEqual(original);
  });

  it("round-trips channel.created", () => {
    const original: MetaMessage = {
      type: "channel.created",
      channelId: "ch-123",
      name: "dev",
      description: "Development channel",
      xmtpGroupId: "xmtp-grp-456",
      category: "engineering",
      permissions: "open",
    };
    const encoded = codec.encode(original);
    const decoded = codec.decode(encoded);
    expect(decoded).toEqual(original);
  });

  it("round-trips channel.updated", () => {
    const original: MetaMessage = {
      type: "channel.updated",
      channelId: "ch-123",
      name: "development",
      permissions: "moderated",
    };
    const encoded = codec.encode(original);
    const decoded = codec.decode(encoded);
    expect(decoded).toEqual(original);
  });

  it("round-trips channel.archived", () => {
    const original: MetaMessage = {
      type: "channel.archived",
      channelId: "ch-123",
      reason: "No longer needed",
    };
    const encoded = codec.encode(original);
    const decoded = codec.decode(encoded);
    expect(decoded).toEqual(original);
  });

  it("round-trips community.announcement", () => {
    const original: MetaMessage = {
      type: "community.announcement",
      title: "Welcome!",
      body: "Welcome to Maverick",
      priority: "important",
    };
    const encoded = codec.encode(original);
    const decoded = codec.decode(encoded);
    expect(decoded).toEqual(original);
  });

  it("generates fallback text", () => {
    const config: MetaMessage = {
      type: "community.config",
      name: "Test",
      settings: {
        allowMemberInvites: true,
        defaultChannelPermissions: "open",
      },
    };
    expect(codec.fallback(config)).toBe("[Community config: Test]");

    const channel: MetaMessage = {
      type: "channel.created",
      channelId: "ch-1",
      name: "general",
      xmtpGroupId: "g-1",
      permissions: "open",
    };
    expect(codec.fallback(channel)).toBe("[Channel created: #general]");
  });

  it("shouldPush returns false", () => {
    expect(codec.shouldPush({} as MetaMessage)).toBe(false);
  });
});

describe("meta message schema bounds", () => {
  it("rejects oversized community name", () => {
    const result = MetaMessageSchema.safeParse({
      type: "community.config",
      name: "x".repeat(201),
      settings: { allowMemberInvites: true, defaultChannelPermissions: "open" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts max-length community name", () => {
    const result = MetaMessageSchema.safeParse({
      type: "community.config",
      name: "x".repeat(200),
      settings: { allowMemberInvites: true, defaultChannelPermissions: "open" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects oversized description", () => {
    const result = MetaMessageSchema.safeParse({
      type: "community.config",
      name: "ok",
      description: "x".repeat(5001),
      settings: { allowMemberInvites: true, defaultChannelPermissions: "open" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects oversized announcement body", () => {
    const result = MetaMessageSchema.safeParse({
      type: "community.announcement",
      title: "ok",
      body: "x".repeat(5001),
      priority: "normal",
    });
    expect(result.success).toBe(false);
  });
});
