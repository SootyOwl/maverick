import type { Conversation } from "@xmtp/node-sdk";
import {
  MaverickMessageCodec,
} from "./codec.js";
import type { MaverickMessage } from "./types.js";

const codec = new MaverickMessageCodec();

export async function sendMessage(
  group: Conversation,
  text: string,
  replyTo?: string[],
  quotes?: { parentMessageId: string; quotedText: string }[],
  senderHandle?: string,
): Promise<string> {
  const msg: MaverickMessage = {
    text,
    replyTo: replyTo ?? [],
    quotes,
    senderHandle,
  };

  const encoded = codec.encode(msg);
  return group.send(encoded);
}

export async function sendEdit(
  group: Conversation,
  originalMessageId: string,
  newText: string,
): Promise<string> {
  const msg: MaverickMessage = {
    text: newText,
    replyTo: [],
    editOf: originalMessageId,
  };

  const encoded = codec.encode(msg);
  return group.send(encoded);
}

export async function sendDelete(
  group: Conversation,
  messageId: string,
): Promise<string> {
  const msg: MaverickMessage = {
    text: "",
    replyTo: [],
    deleteOf: messageId,
  };

  const encoded = codec.encode(msg);
  return group.send(encoded);
}
