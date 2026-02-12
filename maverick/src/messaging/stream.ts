import type { Conversation, DecodedMessage } from "@xmtp/node-sdk";

export async function streamMessages(
  group: Conversation,
  onMessage: (msg: DecodedMessage) => void,
): Promise<() => Promise<void>> {
  const stream = await group.stream({
    onValue: onMessage,
  });

  // Return a cleanup function that ends the stream
  return async () => {
    await stream.return();
  };
}

export async function streamAllMessages(
  client: { conversations: { streamAllMessages: (opts: unknown) => Promise<{ return: () => Promise<unknown> }> } },
  onMessage: (msg: DecodedMessage) => void,
): Promise<() => Promise<void>> {
  const stream = await client.conversations.streamAllMessages({
    onValue: onMessage,
  });

  return async () => {
    await stream.return();
  };
}
