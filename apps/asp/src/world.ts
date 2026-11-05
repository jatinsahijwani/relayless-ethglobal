// The real World ID client. Secrets stay on this server: the browser only ever receives a signed rp_context.
import { signRequest } from "@worldcoin/idkit-core/signing";
import type { RpContext, WorldClient } from "./asp.js";

export interface WorldConfig {
  rpId: string;
  signingKey: string;
  action: string;
  environment: string;
}

export function realWorld(c: WorldConfig, http: typeof fetch = fetch): WorldClient {
  return {
    rpContext(): RpContext {
      const s = signRequest({ signingKeyHex: c.signingKey, action: c.action });
      return { rp_id: c.rpId, nonce: s.nonce, created_at: s.createdAt, expires_at: s.expiresAt, signature: s.sig };
    },
    async verify(result) {
      const res = await http(`https://developer.world.org/api/v4/verify/${c.rpId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...result, environment: c.environment }),
      });
      if (!res.ok) return false;
      const body = await res.json();
      return body.success === true && body.environment === c.environment;
    },
  };
}
