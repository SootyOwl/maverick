import type { ContentCodec } from "@xmtp/content-type-primitives";
import type { ContentTypeId, EncodedContent } from "@xmtp/content-type-primitives";
import { MetaMessageSchema, type MetaMessage } from "./meta-types.js";

export const MetaMessageContentType: ContentTypeId = {
  authorityId: "community.maverick",
  typeId: "meta",
  versionMajor: 1,
  versionMinor: 0,
};

// Max encoded meta message size: 1 MB. Meta messages contain community config,
// channel lists, role lists, etc. — 1 MB is generous for any realistic community.
const MAX_META_BYTES = 1_048_576;

export class MetaMessageCodec implements ContentCodec<MetaMessage> {
  get contentType(): ContentTypeId {
    return MetaMessageContentType;
  }

  encode(content: MetaMessage): EncodedContent {
    const json = JSON.stringify(content);
    const bytes = new TextEncoder().encode(json);
    return {
      type: MetaMessageContentType,
      parameters: {},
      content: bytes,
    };
  }

  decode(encodedContent: EncodedContent): MetaMessage {
    if (encodedContent.content.byteLength > MAX_META_BYTES) {
      throw new Error(
        `Meta message too large: ${encodedContent.content.byteLength} bytes (max ${MAX_META_BYTES})`,
      );
    }
    const json = new TextDecoder().decode(encodedContent.content);
    const parsed = JSON.parse(json);
    return MetaMessageSchema.parse(parsed);
  }

  fallback(content: MetaMessage): string {
    switch (content.type) {
      case "community.config":
        return `[Community config: ${content.name}]`;
      case "channel.created":
        return `[Channel created: #${content.name}]`;
      case "channel.updated":
        return `[Channel updated: ${content.channelId}]`;
      case "channel.archived":
        return `[Channel archived: ${content.channelId}]`;
      case "community.role":
        return `[Role assigned: ${content.targetDid} → ${content.role}]`;
      case "community.announcement":
        return `[Announcement: ${content.title}]`;
      case "moderation.action":
        return `[Moderation: ${content.action}]`;
      case "community.snapshot":
        return `[State snapshot: ${content.config.name}]`;
    }
  }

  shouldPush(): boolean {
    return false;
  }
}
