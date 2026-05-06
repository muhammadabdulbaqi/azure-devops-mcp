#!/usr/bin/env node
// Ejento: stdio MCP → SSE with inbound Authorization → params._meta.adoAccessToken

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { stdioToSseEjento } from "./stdioToSseEjento.js";
import { corsOriginFromArgv } from "./corsOriginHelper.js";

function getLogger(logLevel: string) {
  const level = logLevel === "none" ? "none" : logLevel;
  return {
    info: (...args: unknown[]) => {
      if (level !== "none") console.error("[ejento-supergateway]", ...args);
    },
    error: (...args: unknown[]) => {
      console.error("[ejento-supergateway]", ...args);
    },
  };
}

async function main(): Promise<void> {
  const argv = yargs(hideBin(process.argv))
    .scriptName("ejento-supergateway")
    .option("stdio", {
      type: "string",
      demandOption: true,
      description: "Command to run the MCP server (stdio)",
    })
    .option("port", {
      type: "number",
      default: Number(process.env.PORT) || 8080,
    })
    .option("baseUrl", {
      type: "string",
      default: "",
    })
    .option("ssePath", { type: "string", default: "/sse" })
    .option("messagePath", { type: "string", default: "/message" })
    .option("outputTransport", {
      type: "string",
      choices: ["sse"] as const,
      default: "sse" as const,
      hidden: true,
    })
    .option("logLevel", {
      choices: ["debug", "info", "none"] as const,
      default: "info" as const,
    })
    .option("cors", {
      type: "array",
      description: 'CORS: omit for off, empty for "*", or list origins',
    })
    .option("healthEndpoint", {
      type: "array",
      default: [] as string[],
      description: "Paths returning ok (repeatable)",
    })
    .help()
    .parseSync();

  const logger = getLogger(argv.logLevel);

  logger.info("Starting ejento-supergateway (fork: inbound Bearer → MCP _meta)");
  logger.info(` - outputTransport: sse`);

  const extraHeaders: Record<string, string> = {};
  await stdioToSseEjento({
    stdioCmd: argv.stdio!,
    port: argv.port,
    baseUrl: argv.baseUrl,
    ssePath: argv.ssePath,
    messagePath: argv.messagePath,
    logger,
    corsOrigin: corsOriginFromArgv({ cors: argv.cors as (string | number)[] | undefined }),
    healthEndpoints: (argv.healthEndpoint as string[]) ?? [],
    responseHeaders: extraHeaders,
  });
}

main().catch((err) => {
  console.error("[ejento-supergateway] Fatal:", err);
  process.exit(1);
});
