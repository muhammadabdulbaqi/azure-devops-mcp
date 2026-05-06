// Derived from supergateway (MIT, supercorp-ai/supergateway).

import type { CorsOptions } from "cors";

export const serializeCorsOrigin = ({ corsOrigin }: { corsOrigin: CorsOptions["origin"] }): string =>
  JSON.stringify(corsOrigin, (_key, value) => {
    if (value instanceof RegExp) {
      return value.toString();
    }
    return value;
  });
