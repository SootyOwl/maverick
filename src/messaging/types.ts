import { z } from "zod/v4";

// Limits to prevent DoS via oversized payloads
const MAX_TEXT = 100_000; // 100 KB
const MAX_REPLY_TO = 20;
const MAX_QUOTES = 10;
const MAX_QUOTED_TEXT = 10_000;
const MAX_ID = 512;
const MAX_NAME = 200;

export const MaverickMessageSchema = z.object({
  text: z.string().max(MAX_TEXT),
  senderHandle: z.string().max(MAX_NAME).optional(),
  replyTo: z.array(z.string().max(MAX_ID)).max(MAX_REPLY_TO).default([]),
  quotes: z
    .array(
      z.object({
        parentMessageId: z.string().max(MAX_ID),
        quotedText: z.string().max(MAX_QUOTED_TEXT),
      }),
    )
    .max(MAX_QUOTES)
    .optional(),
  editOf: z.string().max(MAX_ID).optional(),
  deleteOf: z.string().max(MAX_ID).optional(),
});

export type MaverickMessage = z.infer<typeof MaverickMessageSchema>;
