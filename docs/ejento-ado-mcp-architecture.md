# Ejento + Azure DevOps MCP: Architecture (high level)

This document describes how **OAuth from Ejento authentication**, the **response service**, and the **containerized MCP** fit together, and what we changed in this fork to support **per-request bearer tokens**.

---

## 1. Roles of each system

| Piece | Responsibility |
|--------|----------------|
| **ejento_authentication** (`mcp_sso/devops.py`) | User completes Microsoft Entra OAuth for Azure DevOps. Stores **access / refresh tokens** (provider `devops`) and syncs connection info to Django. |
| **Django / product API** | Holds per-user MCP connection state and tokens for downstream services. |
| **ejento_response_service** | Loads user tokens (e.g. from `user-connections`), builds MCP tool config, and calls the **MCP HTTP URL** with **`Authorization: Bearer <DevOps access token>`** when OAuth is enabled for that tool. |
| **Azure Web App (this image)** | Runs **Ejento Supergateway** + **azure-devops-mcp**. Exposes **SSE** (`/sse`) and **message** (`/message`) so clients can use MCP over HTTP. |

OAuth tokens issued for the Azure DevOps resource are **Bearer** tokens for `dev.azure.com` APIs. They are **not** secrets baked into the Web App environment for the per-user flow.

---

## 2. Problem we solved

Upstream **Supergateway** accepts HTTP requests with `Authorization: Bearer`, but its stdio bridge forwarded only the JSON-RPC body to the MCP child—it did **not** pass the inbound bearer into the message the child sees.

Upstream **azure-devops-mcp** expected credentials from **environment** (`ADO_MCP_AUTH_TOKEN`) or a **file** (`header` auth), not from **each HTTP request**.

So the response service could send the right header, but the MCP process could not reliably use **that user’s** token for **that** call.

---

## 3. Target architecture

1. **OAuth** → tokens stored in Ejento + Django (unchanged in this repo).
2. **Response service** → continues to call the MCP base URL with **`Authorization: Bearer <token>`** (unchanged in this repo).
3. **Gateway (new)** → for each `tools/call`, copy the bearer from the HTTP `Authorization` header into **`params._meta.adoAccessToken`** on the JSON-RPC sent to the MCP child.
4. **MCP server (this fork)** → new auth mode **`ejento`**: read **`adoAccessToken`** from request context / **`_meta`** and use it for **Azure DevOps REST** calls via `azure-devops-node-api`.

No static `ADO_MCP_AUTH_TOKEN` is required on the Web App for that flow.

---

## 4. Code changes (high level)

### 4.1 Ejento Supergateway (replacement for stock Supergateway in this deployment)

- New **`ejento-supergateway`** CLI and **`stdioToSseEjento`** implementation.
- Forwards MCP traffic between **SSE/HTTP** and the **stdio** child.
- On each message to the child, merges **`Authorization: Bearer …`** into **`params._meta.adoAccessToken`** for **`tools/call`**.
- **One `Server` instance per SSE connection** so the MCP SDK’s `connect()` rules are satisfied when clients reconnect.

### 4.2 azure-devops-mcp

- **`authentication ejento`**: token comes from **`params._meta.adoAccessToken`** (via AsyncLocalStorage around `tools/call`).
- **`wrapServerForEjentoInboundBearer`**: installs that context for tool handlers.
- Existing modes (**`envvar`**, **`header`**, interactive, etc.) remain for local/dev or static credentials.

### 4.3 Container image

- **Multi-stage Dockerfile** builds this repo and runs **`ejento-supergateway`** + **`mcp-server-azuredevops`**.
- Default **`ADO_AUTH_MODE=ejento`**; **`PORT`** respected for Azure; **`ADO_ORG`** required.

### 4.4 Tests

- Unit tests for **injecting the bearer** into JSON-RPC **`_meta`**.

---

## 5. Operational notes

- **App settings (typical):** `ADO_ORG`, optional `ADO_AUTH_MODE=ejento`, `PORT` as required by the host.
- **Concurrent sessions** on a **single** container still share **one** MCP child on **stdio**; reconnects and a single active client are the sweet spot. Heavy multi-tenant concurrency may need scaling or session design later.

---

## 6. What we did *not* change here

- **`devops.py`** and other Ejento authentication routes.
- **ejento_response_service** MCP client configuration (it already sends bearer headers when configured).

Those layers were already aligned; the gap was **gateway + MCP server** wiring, which this fork addresses.
