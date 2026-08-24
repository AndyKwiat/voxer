/** Minimal typed event emitter. */
export class Emitter<Events extends Record<string, unknown[]>> {
  private listeners: { [K in keyof Events]?: Set<(...args: Events[K]) => void> } = {};

  on<K extends keyof Events>(event: K, fn: (...args: Events[K]) => void): () => void {
    (this.listeners[event] ??= new Set()).add(fn);
    return () => this.listeners[event]?.delete(fn);
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    this.listeners[event]?.forEach((fn) => fn(...args));
  }
}
