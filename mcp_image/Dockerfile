# Build from this repo (your fork), not the npm package @azure-devops/mcp.
#
# Context MUST be the repo root that contains package.json (NOT mcp_image/).
# From ejento repo root:
#   docker build --pull --rm -f azure-devops-mcp/mcp_image/Dockerfile -t ado-mcp-sse:local azure-devops-mcp
#
# Default: ADO_AUTH_MODE=ejento — HTTP Authorization: Bearer is forwarded into MCP tools/call
# (see ejento-supergateway + --authentication ejento). No ADO_MCP_AUTH_TOKEN on the Web App.
#
# Other: ADO_AUTH_MODE=envvar | header (static token / file).

FROM node:20-alpine AS mcp-build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine

RUN apk add --no-cache curl tini

WORKDIR /ado-mcp
COPY --from=mcp-build /src/package.json /src/package-lock.json ./
COPY --from=mcp-build /src/node_modules ./node_modules
COPY --from=mcp-build /src/dist ./dist

ENV ADO_ORG=""
# ejento (default) | envvar | header
ENV ADO_AUTH_MODE="ejento"

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]

# ejento-supergateway replaces upstream supergateway: merges inbound Bearer into params._meta.adoAccessToken.
CMD ["/bin/sh", "-c", "set -e; \
  if [ -z \"$ADO_ORG\" ]; then echo 'ERROR: ADO_ORG is required' >&2; exit 1; fi; \
  MODE=\"${ADO_AUTH_MODE:-ejento}\"; \
  if [ \"$MODE\" = 'envvar' ]; then \
    if [ -z \"$ADO_MCP_AUTH_TOKEN\" ]; then echo 'ERROR: ADO_MCP_AUTH_TOKEN is required for ADO_AUTH_MODE=envvar' >&2; exit 1; fi; \
    AUTH_ARGS='--authentication envvar'; \
  elif [ \"$MODE\" = 'header' ]; then \
    TP=\"${ADO_MCP_AUTH_TOKEN_PATH:-/run/ado-mcp/token}\"; \
    if [ ! -s \"$TP\" ]; then echo \"ERROR: ADO_AUTH_MODE=header requires a non-empty token file at $TP\" >&2; exit 1; fi; \
    AUTH_ARGS=\"--authentication header --token-path $TP\"; \
  else \
    AUTH_ARGS='--authentication ejento'; \
  fi; \
  exec node /ado-mcp/dist/ejento/cli.js \
    --stdio \"node /ado-mcp/dist/index.js $ADO_ORG $AUTH_ARGS\" \
    --port \"${PORT:-8080}\" \
    --ssePath /sse \
    --messagePath /message \
    --cors \
    --healthEndpoint /health"]
