// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { ejentoMcpContext, type EjentoRequestMeta } from "./ejentoMcpContext.js";

/**
 * For each tools/call, run the handler with AsyncLocalStorage carrying `request.params._meta`
 * so the authenticator can read `adoAccessToken` (injected by ejento-supergateway).
 */
export function wrapServerForEjentoInboundBearer(server: Server): void {
  type SetRH = Server["setRequestHandler"];
  const originalSetRequestHandler = server.setRequestHandler.bind(server) as SetRH;
  (server as { setRequestHandler: (schema: unknown, handler: unknown) => unknown }).setRequestHandler = (
    schema: unknown,
    handler: unknown,
  ) => {
    if (schema !== CallToolRequestSchema) {
      return originalSetRequestHandler(schema as Parameters<SetRH>[0], handler as Parameters<SetRH>[1]);
    }
    const h = handler as (request: unknown, extra: unknown) => Promise<unknown>;
    const wrapped = async (request: unknown, extra: unknown) => {
      const params = (request as { params?: { _meta?: EjentoRequestMeta } }).params;
      const meta: EjentoRequestMeta = { ...(params?._meta ?? {}) };
      return await ejentoMcpContext.run(meta, async () => await h(request, extra));
    };
    return originalSetRequestHandler(CallToolRequestSchema, wrapped as Parameters<SetRH>[1]);
  };
}
