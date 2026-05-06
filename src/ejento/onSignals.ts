// Derived from supergateway (MIT, supercorp-ai/supergateway).

export interface OnSignalsOptions {
  logger: { info: (...args: unknown[]) => void };
  cleanup?: () => void;
}

export function onSignals(options: OnSignalsOptions): void {
  const { logger, cleanup } = options;

  const handleSignal = (signal: string) => {
    logger.info(`Caught ${signal}. Exiting...`);
    cleanup?.();
    process.exit(0);
  };

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGHUP", () => handleSignal("SIGHUP"));

  process.stdin.on("close", () => {
    logger.info("stdin closed. Exiting...");
    cleanup?.();
    process.exit(0);
  });
}
