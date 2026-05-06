// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per tools/call request metadata forwarded by Ejento Supergateway
 * (`params._meta`, including `adoAccessToken` from HTTP Authorization).
 */
export type EjentoRequestMeta = Record<string, unknown> & { adoAccessToken?: string };

export const ejentoMcpContext = new AsyncLocalStorage<EjentoRequestMeta>();
