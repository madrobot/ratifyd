export class TTLMap<K, V> {
  #map = new Map<K, [V, ReturnType<typeof setTimeout>]>()

  set(key: K, value: V, ttlMs: number): void {
    this.delete(key) // cancel existing timer if key is being overwritten
    this.#map.set(key, [value, setTimeout(() => this.#map.delete(key), ttlMs)])
  }

  get(key: K): V | undefined {
    return this.#map.get(key)?.[0]
  }

  has(key: K): boolean {
    return this.#map.has(key)
  }

  delete(key: K): void {
    const entry = this.#map.get(key)
    if (entry) clearTimeout(entry[1])
    this.#map.delete(key)
  }

  destroy(): void {
    for (const [, timer] of this.#map.values()) clearTimeout(timer)
    this.#map.clear()
  }
}
