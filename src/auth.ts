// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AzureCliCredential, ChainedTokenCredential, DefaultAzureCredential, TokenCredential } from "@azure/identity";
import { promises as fs } from "fs";
import { AccountInfo, AuthenticationResult, PublicClientApplication } from "@azure/msal-node";
import open from "open";
import { logger } from "./logger.js";
import { ejentoMcpContext } from "./ejento/ejentoMcpContext.js";

const scopes = ["499b84ac-1321-427f-aa17-267ca6975798/.default"];

class OAuthAuthenticator {
  static clientId = "0d50963b-7bb9-4fe7-94c7-a99af00b5136";
  static defaultAuthority = "https://login.microsoftonline.com/common";
  static zeroTenantId = "00000000-0000-0000-0000-000000000000";

  private accountId: AccountInfo | null;
  private publicClientApp: PublicClientApplication;

  constructor(tenantId?: string) {
    this.accountId = null;

    let authority = OAuthAuthenticator.defaultAuthority;
    if (tenantId && tenantId !== OAuthAuthenticator.zeroTenantId) {
      authority = `https://login.microsoftonline.com/${tenantId}`;
      logger.debug(`OAuthAuthenticator: Using tenant-specific authority for tenantId='${tenantId}'`);
    } else {
      logger.debug(`OAuthAuthenticator: Using default common authority`);
    }

    this.publicClientApp = new PublicClientApplication({
      auth: {
        clientId: OAuthAuthenticator.clientId,
        authority,
      },
    });
    logger.debug(`OAuthAuthenticator: Initialized with clientId='${OAuthAuthenticator.clientId}'`);
  }

  public async getToken(): Promise<string> {
    let authResult: AuthenticationResult | null = null;
    if (this.accountId) {
      logger.debug(`OAuthAuthenticator: Attempting silent token acquisition for cached account`);
      try {
        authResult = await this.publicClientApp.acquireTokenSilent({
          scopes,
          account: this.accountId,
        });
        logger.debug(`OAuthAuthenticator: Successfully acquired token silently`);
      } catch (error) {
        logger.debug(`OAuthAuthenticator: Silent token acquisition failed: ${error instanceof Error ? error.message : String(error)}`);
        authResult = null;
      }
    } else {
      logger.debug(`OAuthAuthenticator: No cached account available, interactive auth required`);
    }
    if (!authResult) {
      logger.debug(`OAuthAuthenticator: Starting interactive token acquisition`);
      authResult = await this.publicClientApp.acquireTokenInteractive({
        scopes,
        openBrowser: async (url) => {
          logger.debug(`OAuthAuthenticator: Opening browser for authentication`);
          open(url);
        },
      });
      this.accountId = authResult.account;
      logger.debug(`OAuthAuthenticator: Successfully acquired token interactively, account cached`);
    }

    if (!authResult.accessToken) {
      logger.error(`OAuthAuthenticator: Authentication result contains no access token`);
      throw new Error("Failed to obtain Azure DevOps OAuth token.");
    }
    logger.debug(`OAuthAuthenticator: Token obtained successfully`);
    return authResult.accessToken;
  }
}

function createAuthenticator(type: string, tenantId?: string, tokenPath?: string): () => Promise<string> {
  logger.debug(`Creating authenticator of type '${type}' with tenantId='${tenantId ?? "undefined"}' and tokenPath='${tokenPath ?? "undefined"}'`);
  switch (type) {
    case "envvar":
      logger.debug(`Authenticator: Using environment variable authentication (ADO_MCP_AUTH_TOKEN)`);
      // Read token from fixed environment variable
      return async () => {
        logger.debug(`${type}: Reading token from ADO_MCP_AUTH_TOKEN environment variable`);
        const token = process.env["ADO_MCP_AUTH_TOKEN"];
        if (!token) {
          logger.error(`${type}: ADO_MCP_AUTH_TOKEN environment variable is not set or empty`);
          throw new Error("Environment variable 'ADO_MCP_AUTH_TOKEN' is not set or empty. Please set it with a valid Azure DevOps Personal Access Token.");
        }
        logger.debug(`${type}: Successfully retrieved token from environment variable`);
        return token;
      };

    case "azcli":
    case "env":
      if (type !== "env") {
        logger.debug(`${type}: Setting AZURE_TOKEN_CREDENTIALS to 'dev' for development credential chain`);
        process.env.AZURE_TOKEN_CREDENTIALS = "dev";
      }
      let credential: TokenCredential = new DefaultAzureCredential(); // CodeQL [SM05138] resolved by explicitly setting AZURE_TOKEN_CREDENTIALS
      if (tenantId) {
        // Use Azure CLI credential if tenantId is provided for multi-tenant scenarios
        const azureCliCredential = new AzureCliCredential({ tenantId });
        credential = new ChainedTokenCredential(azureCliCredential, credential);
      }
      return async () => {
        const result = await credential.getToken(scopes);
        if (!result) {
          logger.error(`${type}: Failed to obtain token - credential.getToken returned null/undefined`);
          throw new Error("Failed to obtain Azure DevOps token. Ensure you have Azure CLI logged or use interactive type of authentication.");
        }
        logger.debug(`${type}: Successfully obtained Azure DevOps token`);
        return result.token;
      };

    case "ejento":
      logger.debug(`Authenticator: Using per-request bearer from params._meta.adoAccessToken (Ejento gateway + OAuth)`);
      return async () => {
        const meta = ejentoMcpContext.getStore();
        const token = meta?.adoAccessToken;
        if (typeof token === "string" && token.length > 0) {
          logger.debug(`ejento: Using adoAccessToken from request _meta (length ${token.length})`);
          return token;
        }
        logger.error(`ejento: Missing params._meta.adoAccessToken — ensure ejento-supergateway forwards Authorization: Bearer`);
        throw new Error(
          "Ejento authentication requires params._meta.adoAccessToken (forward Authorization: Bearer via ejento-supergateway), or use envvar/header for static tokens.",
        );
      };

    case "header":
      logger.debug(`Authenticator: Using file-backed header token authentication`);
      const resolvedTokenPath = tokenPath || process.env["ADO_MCP_AUTH_TOKEN_PATH"];
      if (!resolvedTokenPath) {
        logger.error(`header: Token path is not provided and ADO_MCP_AUTH_TOKEN_PATH environment variable is not set`);
        throw new Error("authentication='header' requires either --token-path option or ADO_MCP_AUTH_TOKEN_PATH environment variable to be set.");
      }
      return async () => {
        logger.debug(`header: Reading token from file path: ${resolvedTokenPath}`);
        try {
          const token = await fs.readFile(resolvedTokenPath, "utf-8");
          const trimmedToken = token.trim();
          if (!trimmedToken) {
            logger.error(`header: Token file is empty or contains only whitespace`);
            throw new Error(`Token file at '${resolvedTokenPath}' is empty or contains only whitespace.`);
          }
          logger.debug(`header: Successfully read token from file, length: ${trimmedToken.length}`);
          return trimmedToken;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error(`header: Failed to read token file from ${resolvedTokenPath}: ${errorMsg}`);
          throw new Error(`Failed to read bearer token from '${resolvedTokenPath}': ${errorMsg}`);
        }
      };

    default:
      logger.debug(`Authenticator: Using OAuth interactive authentication (default)`);
      const authenticator = new OAuthAuthenticator(tenantId);
      return () => {
        return authenticator.getToken();
      };
  }
}
export { createAuthenticator };
