import type { ContentCodec } from "@xmtp/content-type-primitives";
import type { ContentTypeId, EncodedContent } from "@xmtp/content-type-primitives";
import { MaverickMessageSchema, type MaverickMessage } from "./types.js";

export const MaverickMessageContentType: ContentTypeId = {
  authorityId: "community.maverick",
  typeId: "message",
  versionMajor: 1,
  versionMinor: 0,
};

// Max encoded chat message size: 512 KB. Chat messages contain text + optional
// quote snippets. 512 KB is generous for any realistic message.
const MAX_MESSAGE_BYTES = 524_288;

export class MaverickMessageCodec implements ContentCodec<MaverickMessage> {
  get contentType(): ContentTypeId {
    return MaverickMessageContentType;
  }

  encode(content: MaverickMessage): EncodedContent {
    const json = JSON.stringify(content);
    const bytes = new TextEncoder().encode(json);
    return {
      type: MaverickMessageContentType,
      parameters: {},
      content: bytes,
    };
  }

  decode(encodedContent: EncodedContent): MaverickMessage {
    if (encodedContent.content.byteLength > MAX_MESSAGE_BYTES) {
      throw new Error(
        `Chat message too large: ${encodedContent.content.byteLength} bytes (max ${MAX_MESSAGE_BYTES})`,
      );
    }
    const json = new TextDecoder().decode(encodedContent.content);
    const parsed = JSON.parse(json);
    return MaverickMessageSchema.parse(parsed);
  }

  fallback(content: MaverickMessage): string {
    if (content.deleteOf) return "[Message deleted]";
    if (content.editOf) return `[Edited] ${content.text}`;
    return content.text;
  }

  shouldPush(): boolean {
    return true;
  }
}
