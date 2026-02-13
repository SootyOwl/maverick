import type { AtpAgent } from "@atproto/api";
import { Client } from "@xmtp/node-sdk";
import type { XmtpEnv } from "@xmtp/node-sdk";
import { getPublishedInboxRecord } from "./bridge.js";

export class HandleNotFoundError extends Error {
  constructor(handle: string) {
    super(`Bluesky handle "${handle}" not found. Check the spelling and try again.`);
    this.name = "HandleNotFoundError";
  }
}

export class NoInboxRecordError extends Error {
  constructor(handle: string) {
    super(
      `"${handle}" exists on Bluesky but has no XMTP inbox record. ` +
      `They need to sign into Maverick (or any XMTP-enabled app) at least once ` +
      `to publish their inbox. If they already have an XMTP account, ask them ` +
      `for their raw Inbox ID and enter it directly.`,
    );
    this.name = "NoInboxRecordError";
  }
}

export async function resolveHandleToInbox(
  agent: AtpAgent,
  handle: string,
): Promise<{ inboxId: string; did: string }> {
  // Resolve handle to DID
  let did: string;
  try {
    const resolved = await agent.resolveHandle({ handle });
    did = resolved.data.did;
  } catch {
    throw new HandleNotFoundError(handle);
  }

  // Look up org.xmtp.inbox record on their PDS
  const record = await getPublishedInboxRecord(agent, did);
  if (!record) {
    throw new NoInboxRecordError(handle);
  }

  return {
    inboxId: record.inboxId,
    did,
  };
}

export async function verifyInboxAssociation(
  inboxId: string,
  did: string,
  verificationSignature: string,
  xmtpEnv: XmtpEnv,
): Promise<boolean> {
  try {
    // Fetch the inbox state to get the installation public key
    const inboxStates = await Client.fetchInboxStates([inboxId], xmtpEnv);
    if (!inboxStates || inboxStates.length === 0) return false;

    const inboxState = inboxStates[0];
    const installations = inboxState.installations;
    if (!installations || installations.length === 0) return false;

    // Verify the signature against each installation's public key
    const signatureBytes = Buffer.from(verificationSignature, "base64");
    for (const installation of installations) {
      try {
        const isValid = Client.verifySignedWithPublicKey(
          did,
          new Uint8Array(signatureBytes),
          installation.bytes,
        );
        if (isValid) return true;
      } catch {
        // Try next installation
      }
    }
    return false;
  } catch {
    return false;
  }
}
