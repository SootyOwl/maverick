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

// ─── Shared PDS record fetcher ───────────────────────────────────────────────

/**
 * Fetch a record from a user's PDS, trying the resolved PDS first and
 * falling back to the caller's agent.
 *
 * @param agent   - Authenticated AtpAgent (used for PDS resolution + fallback)
 * @param did     - Target user's DID
 * @param collection - ATProto collection name (e.g. "community.maverick.inbox")
 * @param extract - Function to extract the desired fields from the raw record
 *                  value. Return null to signal the record is invalid/incomplete.
 * @returns The extracted value, or null if the record doesn't exist or is invalid.
 */
export async function fetchPdsRecord<T>(
  agent: AtpAgent,
  did: string,
  collection: string,
  extract: (value: Record<string, unknown>) => T | null,
): Promise<T | null> {
  const pdsUrl = await resolvePds(agent, did);
  const agents: AtpAgent[] = [];
  if (pdsUrl) agents.push(new AtpAgent({ service: pdsUrl }));
  agents.push(agent);

  for (const a of agents) {
    try {
      const response = await a.com.atproto.repo.getRecord({
        repo: did,
        collection,
        rkey: "self",
      });
      const result = extract(response.data.value as Record<string, unknown>);
      if (result) return result;
    } catch {
      /* next agent */
    }
  }
  return null;
}

// ─── Maverick-specific PDS record (community.maverick.inbox) ─────────────────

/**
 * Publish a `community.maverick.inbox` record on the user's PDS.
 *
 * This is Maverick's own identity bridge record. It does NOT include a
 * verification signature because this record is only consumed by Maverick
 * clients, which trust the DID owner's PDS.
 */
export async function publishMaverickRecord(
  agent: AtpAgent,
  xmtpClient: Client,
): Promise<void> {
  const did = agent.session!.did;

  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: "community.maverick.inbox",
    rkey: "self",
    record: {
      $type: "community.maverick.inbox",
      inboxId: xmtpClient.inboxId,
      createdAt: new Date().toISOString(),
    },
  });
}

/**
 * Read a `community.maverick.inbox` record from a user's PDS.
 *
 * Returns `{ inboxId, createdAt }` or null if the record doesn't exist.
 */
export async function getMaverickRecord(
  agent: AtpAgent,
  did: string,
): Promise<{ inboxId: string; createdAt: string } | null> {
  return fetchPdsRecord(agent, did, "community.maverick.inbox", (value) => {
    const inboxId = value.inboxId;
    if (typeof inboxId !== "string" || !inboxId) return null;
    return {
      inboxId,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    };
  });
}

// ─── Legacy PDS record (org.xmtp.inbox) ─────────────────────────────────────

/**
 * Read an `org.xmtp.inbox` record from a user's PDS.
 *
 * This is the legacy record format. Other users may have published this
 * via bluesky-chat or other XMTP apps, so the resolver still needs it.
 */
export async function getLegacyInboxRecord(
  agent: AtpAgent,
  did: string,
): Promise<{
  inboxId: string;
  verificationSignature: string;
  createdAt: string;
} | null> {
  return fetchPdsRecord(agent, did, "org.xmtp.inbox", (value) => {
    const id = value.id;
    const verificationSignature = value.verificationSignature;
    if (
      typeof id !== "string" ||
      !id ||
      typeof verificationSignature !== "string" ||
      !verificationSignature
    ) {
      return null;
    }
    return {
      inboxId: id,
      verificationSignature,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    };
  });
}

// ─── Internal helpers ────────────────────────────────────────────────────────

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
