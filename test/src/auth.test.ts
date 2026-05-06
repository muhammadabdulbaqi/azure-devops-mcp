// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { createAuthenticator } from "../../src/auth";

describe("createAuthenticator", () => {
  describe("header authentication", () => {
    const tempDir = os.tmpdir();
    const tokenFile = path.join(tempDir, `ado-token-${Date.now()}.txt`);
    const tokenValue = "test-azure-devops-token";
    const envKey = "ADO_MCP_AUTH_TOKEN_PATH";
    let previousEnvValue: string | undefined;

    beforeAll(async () => {
      previousEnvValue = process.env[envKey];
      await fs.writeFile(tokenFile, `${tokenValue}\n`, "utf-8");
    });

    afterAll(async () => {
      await fs.rm(tokenFile, { force: true });
      if (previousEnvValue === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = previousEnvValue;
      }
    });

    it("reads the bearer token from the explicit file path", async () => {
      const authenticator = createAuthenticator("header", undefined, tokenFile);
      const token = await authenticator();
      expect(token).toBe(tokenValue);
    });

    it("reads the bearer token from ADO_MCP_AUTH_TOKEN_PATH when tokenPath is not provided", async () => {
      process.env[envKey] = tokenFile;
      const authenticator = createAuthenticator("header");
      const token = await authenticator();
      expect(token).toBe(tokenValue);
    });

    it("throws when the configured token file does not exist", async () => {
      const missingFile = path.join(tempDir, `ado-token-missing-${Date.now()}.txt`);
      const authenticator = createAuthenticator("header", undefined, missingFile);
      await expect(authenticator()).rejects.toThrow("Failed to read bearer token");
    });
  });
});
