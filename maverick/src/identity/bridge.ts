import { AtpAgent } from "@atproto/api";
import type { Client } from "@xmtp/node-sdk";

/**
 * Extract the PDS service endpoint from a DID document.
 * Looks for the #atproto_pds service entry.
 */
function getPdsEndpoint(didDoc: Record<string, unknown>): string | null {
  const services = didDoc.service;
  if (!Array.isArray(services)) return null;
  for (const svc of services) {
    if (
      typeof svc === "object" &&
      svc !== null &&
      "id" in svc &&
      "serviceEndpoint" in svc &&
      (svc.id === "#atproto_pds" || svc.id === `${didDoc.id}#atproto_pds`) &&
      typeof svc.serviceEndpoint === "string"
    ) {
      return svc.serviceEndpoint;
    }
  }
  return null;
}

export async function publishInboxRecord(
  agent: AtpAgent,
  xmtpClient: Client,
): Promise<void> {
  const did = agent.session!.did;

  // Sign the DID with XMTP installation key to prove ownership
  const signatureBytes = xmtpClient.signWithInstallationKey(did);
  const verificationSignature =
    Buffer.from(signatureBytes).toString("base64");

  // Publish to the user's PDS
  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: "org.xmtp.inbox",
    rkey: "self",
    record: {
      $type: "org.xmtp.inbox",
      id: xmtpClient.inboxId,
      verificationSignature,
      createdAt: new Date().toISOString(),
    },
  });
}

/**
 * Resolve a DID to its PDS service URL.
 *
 * Primary: use the authenticated agent's `resolveDid` ATProto endpoint.
 * Fallback: fetch the DID document from PLC directory (public, no auth).
 */
async function resolvePds(
  agent: AtpAgent,
  did: string,
): Promise<string | null> {
  // Try the ATProto API first (works when agent is authenticated)
  try {
    const identity = await agent.com.atproto.identity.resolveDid({ did });
    const url = getPdsEndpoint(
      identity.data.didDoc as Record<string, unknown>,
    );
    if (url) return url;
  } catch {
    // Agent may be unauthenticated — fall through to PLC directory
  }

  // Fallback: query PLC directory directly (public HTTP, no auth)
  if (did.startsWith("did:plc:")) {
    try {
      const res = await fetch(
        `https://plc.directory/${encodeURIComponent(did)}`,
      );
      if (res.ok) {
        const didDoc = (await res.json()) as Record<string, unknown>;
        return getPdsEndpoint(didDoc);
      }
    } catch {
      // Network error — give up on PDS resolution
    }
  }

  return null;
}

export async function getPublishedInboxRecord(
  agent: AtpAgent,
  did: string,
): Promise<{
  inboxId: string;
  verificationSignature: string;
  createdAt: string;
} | null> {
  // Resolve the target user's PDS so we can query it directly.
  // The bsky.social entryway may not proxy getRecord for custom collections
  // when the caller is authenticated on a different PDS.
  const pdsUrl = await resolvePds(agent, did);

  // Try target PDS first (unauthenticated), then caller's agent as fallback
  const agents: AtpAgent[] = [];
  if (pdsUrl) {
    agents.push(new AtpAgent({ service: pdsUrl }));
  }
  agents.push(agent);

  for (const a of agents) {
    try {
      const response = await a.com.atproto.repo.getRecord({
        repo: did,
        collection: "org.xmtp.inbox",
        rkey: "self",
      });
      const record = response.data.value as {
        id?: string;
        verificationSignature?: string;
        createdAt?: string;
      };
      if (!record.id || !record.verificationSignature) return null;
      return {
        inboxId: record.id,
        verificationSignature: record.verificationSignature,
        createdAt: record.createdAt ?? "",
      };
    } catch {
      // Try the next agent
    }
  }

  return null;
}
