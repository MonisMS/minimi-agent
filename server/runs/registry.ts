export class RunAbortRegistry {
  private readonly controllers = new Map<string, AbortController>();

  register(runId: string): AbortController {
    const existing = this.controllers.get(runId);
    if (existing) return existing;
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    return controller;
  }

  get(runId: string): AbortController | undefined {
    return this.controllers.get(runId);
  }

  abort(runId: string): boolean {
    const controller = this.controllers.get(runId);
    if (!controller) return false;
    if (!controller.signal.aborted) controller.abort();
    return true;
  }

  unregister(runId: string): void {
    this.controllers.delete(runId);
  }

  abortAll(): void {
    for (const controller of this.controllers.values()) {
      if (!controller.signal.aborted) controller.abort();
    }
    this.controllers.clear();
  }

  get size(): number {
    return this.controllers.size;
  }
}
