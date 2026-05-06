import { injectBearerIntoJsonRpcMessage } from "../../src/ejento/injectBearerIntoRpc";

describe("injectBearerIntoJsonRpcMessage", () => {
  it("merges Bearer into tools/call params._meta.adoAccessToken", () => {
    const msg = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "tools/call" as const,
      params: { name: "core_list_projects", arguments: {} },
    };
    const extra = {
      requestInfo: {
        headers: { authorization: "Bearer my-oauth-token" },
      },
    };
    const out = injectBearerIntoJsonRpcMessage(msg, extra);
    expect(out).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "core_list_projects",
        arguments: {},
        _meta: { adoAccessToken: "my-oauth-token" },
      },
    });
  });

  it("leaves messages unchanged when no Authorization header", () => {
    const msg = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "tools/call" as const,
      params: { name: "x", arguments: {} },
    };
    expect(injectBearerIntoJsonRpcMessage(msg, {})).toEqual(msg);
  });
});
