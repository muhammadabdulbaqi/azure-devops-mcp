// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * Extra passed by MCP SDK SSE transport when handling POST /message.
 * @see @modelcontextprotocol/sdk/server/sse.js handlePostMessage
 */
export type SsePostExtra = {
  requestInfo?: {
    headers?: Record<string, string | string[] | undefined>;
  };
};

function getAuthorizationHeader(extra: SsePostExtra | undefined): string | undefined {
  const h = extra?.requestInfo?.headers;
  if (!h) return undefined;
  const raw = h["authorization"] ?? h["Authorization"];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/**
 * Copies `Authorization: Bearer <token>` from the HTTP POST into
 * `params._meta.adoAccessToken` on `tools/call` so the MCP server can read it per request.
 */
export function injectBearerIntoJsonRpcMessage(msg: JSONRPCMessage, extra: unknown): JSONRPCMessage {
  const auth = getAuthorizationHeader(extra as SsePostExtra);
  if (!auth || !auth.startsWith("Bearer ")) {
    return msg;
  }
  const token = auth.slice(7).trim();
  if (!token) {
    return msg;
  }

  if (!("method" in msg) || msg.method !== "tools/call") {
    return msg;
  }
  if (!msg.params || typeof msg.params !== "object") {
    return msg;
  }

  const params = msg.params as { _meta?: Record<string, unknown> };
  const nextMeta = { ...(params._meta ?? {}), adoAccessToken: token };
  return { ...msg, params: { ...params, _meta: nextMeta } } as JSONRPCMessage;
}
