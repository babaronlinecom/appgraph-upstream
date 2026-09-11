/**
 * Generic analyzer registry used by framework/integration/data/infra
 * registries. Registration is explicit and duplicate ids throw early.
 */
export interface RegisteredAnalyzer {
  id: string;
  version: string;
  label: string;
  capabilities?: Record<string, unknown>;
}

export class AnalyzerRegistry<T extends RegisteredAnalyzer> {
  private readonly items = new Map<string, T>();

  constructor(private readonly kind: string) {}

  register(item: T): void {
    if (this.items.has(item.id)) {
      throw new Error(`${this.kind} analyzer "${item.id}" is already registered`);
    }
    this.items.set(item.id, item);
  }

  list(): T[] {
    return [...this.items.values()];
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  get size(): number {
    return this.items.size;
  }
}
