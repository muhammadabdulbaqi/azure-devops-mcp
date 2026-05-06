// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// Derived from supergateway stdio→SSE (MIT, supercorp-ai/supergateway).
// Change: forward (message, extra) to the child and merge HTTP Authorization
// into tools/call params._meta.adoAccessToken (see injectBearerIntoRpc.ts).

import express from "express";
import bodyParser from "body-parser";
import cors, { type CorsOptions } from "cors";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { getVersion } from "./supergatewayVersion.js";
import { onSignals } from "./onSignals.js";
import { serializeCorsOrigin } from "./serializeCorsOrigin.js";
import { injectBearerIntoJsonRpcMessage } from "./injectBearerIntoRpc.js";

export type Logger = {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export interface StdioToSseEjentoArgs {
  stdioCmd: string;
  port: number;
  baseUrl: string;
  ssePath: string;
  messagePath: string;
  logger: Logger;
  corsOrigin: CorsOptions["origin"];
  healthEndpoints: string[];
  responseHeaders: Record<string, string>;
}

const setResponseHeaders = (res: express.Response, headers: Record<string, string>) => {
  Object.entries(headers).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
};

export async function stdioToSseEjento(args: StdioToSseEjentoArgs): Promise<void> {
  const { stdioCmd, port, baseUrl, ssePath, messagePath, logger, corsOrigin, healthEndpoints, responseHeaders } = args;

  logger.info(` - Headers (responses): ${Object.keys(responseHeaders).length ? JSON.stringify(responseHeaders) : "(none)"}`);
  logger.info(` - port: ${port}`);
  logger.info(` - stdio: ${stdioCmd}`);
  if (baseUrl) {
    logger.info(` - baseUrl: ${baseUrl}`);
  }
  logger.info(` - ssePath: ${ssePath}`);
  logger.info(` - messagePath: ${messagePath}`);
  logger.info(` - CORS: ${corsOrigin ? `enabled (${serializeCorsOrigin({ corsOrigin })})` : "disabled"}`);
  logger.info(` - Health endpoints: ${healthEndpoints.length ? healthEndpoints.join(", ") : "(none)"}`);
  logger.info(` - Ejento: inbound Authorization → params._meta.adoAccessToken on tools/call`);

  onSignals({ logger });

  const child: ChildProcessWithoutNullStreams = spawn(stdioCmd, { shell: true });
  child.on("exit", (code, signal) => {
    logger.error(`Child exited: code=${code}, signal=${signal}`);
    process.exit(code ?? 1);
  });

  const sessions: Record<string, { transport: SSEServerTransport; response: express.Response }> = {};

  const app = express();

  if (corsOrigin) {
    app.use(cors({ origin: corsOrigin }));
  }

  app.use((req, res, next) => {
    if (req.path === messagePath) return next();
    return bodyParser.json()(req, res, next);
  });

  for (const ep of healthEndpoints) {
    app.get(ep, (_req, res) => {
      setResponseHeaders(res, responseHeaders);
      res.send("ok");
    });
  }

  app.get(ssePath, async (req, res) => {
    logger.info(`New SSE connection from ${req.ip}`);

    setResponseHeaders(res, responseHeaders);

    // One MCP Server per SSE session — Protocol.connect() allows only one transport per Server instance.
    const server = new Server({ name: "ejento-supergateway", version: getVersion() }, { capabilities: {} });
    const sseTransport = new SSEServerTransport(`${baseUrl}${messagePath}`, res);
    await server.connect(sseTransport);

    const sessionId = sseTransport.sessionId;
    if (sessionId) {
      sessions[sessionId] = { transport: sseTransport, response: res };
    }

    sseTransport.onmessage = (msg: JSONRPCMessage, extra: unknown) => {
      const out = injectBearerIntoJsonRpcMessage(msg, extra);
      child.stdin.write(JSON.stringify(out) + "\n");
    };

    sseTransport.onclose = () => {
      logger.info(`SSE connection closed (session ${sessionId})`);
      delete sessions[sessionId];
    };

    sseTransport.onerror = (err: unknown) => {
      logger.error(`SSE error (session ${sessionId}):`, err);
      delete sessions[sessionId];
    };

    req.on("close", () => {
      logger.info(`Client disconnected (session ${sessionId})`);
      delete sessions[sessionId];
    });
  });

  app.post(messagePath, async (req, res) => {
    const sessionId = req.query.sessionId as string;

    setResponseHeaders(res, responseHeaders);

    if (!sessionId) {
      return res.status(400).send("Missing sessionId parameter");
    }

    const session = sessions[sessionId];
    if (session?.transport?.handlePostMessage) {
      logger.info(`POST to SSE transport (session ${sessionId})`);
      await session.transport.handlePostMessage(req, res);
    } else {
      res.status(503).send(`No active SSE connection for session ${sessionId}`);
    }
  });

  app.listen(port, () => {
    logger.info(`Listening on port ${port}`);
    logger.info(`SSE endpoint: http://localhost:${port}${ssePath}`);
    logger.info(`POST messages: http://localhost:${port}${messagePath}`);
  });

  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    lines.forEach((line) => {
      if (!line.trim()) return;
      try {
        const jsonMsg = JSON.parse(line) as JSONRPCMessage;
        logger.info("Child → SSE:", jsonMsg);
        for (const [sid, session] of Object.entries(sessions)) {
          try {
            session.transport.send(jsonMsg);
          } catch (err) {
            logger.error(`Failed to send to session ${sid}:`, err);
            delete sessions[sid];
          }
        }
      } catch {
        logger.error(`Child non-JSON: ${line}`);
      }
    });
  });

  child.stderr.on("data", (chunk: Buffer) => {
    logger.error(`Child stderr: ${chunk.toString("utf8")}`);
  });
}
