export const shutdownController = new AbortController();

export function isShuttingDown(): boolean {
  return shutdownController.signal.aborted;
}

export function getShutdownSignal(): AbortSignal {
  return shutdownController.signal;
}

export function triggerShutdown(): void {
  if (!shutdownController.signal.aborted) {
    shutdownController.abort();
  }
}
