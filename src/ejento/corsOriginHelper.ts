// Derived from supergateway (MIT, supercorp-ai/supergateway).

import type { CorsOptions } from "cors";

export const corsOriginFromArgv = (argv: { cors?: (string | number)[] }): CorsOptions["origin"] => {
  if (!argv.cors) {
    return false;
  }
  if (argv.cors.length === 0) {
    return "*";
  }
  const origins = argv.cors.map((item) => `${item}`);
  if (origins.includes("*")) return "*";
  return origins.map((origin) => {
    if (/^\/.*\/$/.test(origin)) {
      const pattern = origin.slice(1, -1);
      try {
        return new RegExp(pattern);
      } catch {
        return origin;
      }
    }
    return origin;
  });
};
