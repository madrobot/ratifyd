import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TTLMap } from './TTLMap'

describe('TTLMap', () => {
  let map: TTLMap<string, string>

  beforeEach(() => {
    vi.useFakeTimers()
    map = new TTLMap()
  })

  afterEach(() => {
    map.destroy()
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // Basic set / get
  // -------------------------------------------------------------------------
  describe('set / get', () => {
    it('stores and retrieves a value', () => {
      map.set('key1', 'value1', 5000)
      expect(map.get('key1')).toBe('value1')
    })

    it('returns undefined for a missing key', () => {
      expect(map.get('nonexistent')).toBeUndefined()
    })

    it('stores values of any type', () => {
      const numMap = new TTLMap<string, number>()
      numMap.set('count', 42, 5000)
      expect(numMap.get('count')).toBe(42)
      numMap.destroy()
    })
  })

  // -------------------------------------------------------------------------
  // has()
  // -------------------------------------------------------------------------
  describe('has()', () => {
    it('returns true for a key that is present', () => {
      map.set('present', 'yes', 5000)
      expect(map.has('present')).toBe(true)
    })

    it('returns false for a key that is absent', () => {
      expect(map.has('absent')).toBe(false)
    })

    it('returns false after a key has been deleted', () => {
      map.set('key', 'val', 5000)
      map.delete('key')
      expect(map.has('key')).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // delete()
  // -------------------------------------------------------------------------
  describe('delete()', () => {
    it('removes a key so get() returns undefined', () => {
      map.set('key', 'value', 5000)
      map.delete('key')
      expect(map.get('key')).toBeUndefined()
    })

    it('does not throw when deleting a nonexistent key', () => {
      expect(() => map.delete('nonexistent')).not.toThrow()
    })

    it('cancels the TTL timer so the key does not reappear', () => {
      map.set('key', 'value', 1000)
      map.delete('key')
      vi.advanceTimersByTime(2000)
      expect(map.get('key')).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // TTL auto-expiry
  // -------------------------------------------------------------------------
  describe('TTL auto-expiry', () => {
    it('value is still present before TTL elapses', () => {
      map.set('key', 'value', 1000)
      vi.advanceTimersByTime(999)
      expect(map.get('key')).toBe('value')
    })

    it('value auto-expires after TTL elapses', () => {
      map.set('key', 'value', 1000)
      vi.advanceTimersByTime(1000)
      expect(map.get('key')).toBeUndefined()
    })

    it('has() returns false after TTL elapses', () => {
      map.set('key', 'value', 500)
      vi.advanceTimersByTime(500)
      expect(map.has('key')).toBe(false)
    })

    it('multiple keys expire independently', () => {
      map.set('short', 'a', 500)
      map.set('long', 'b', 2000)
      vi.advanceTimersByTime(500)
      expect(map.get('short')).toBeUndefined()
      expect(map.get('long')).toBe('b')
      vi.advanceTimersByTime(1500)
      expect(map.get('long')).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // set() resets TTL on existing key
  // -------------------------------------------------------------------------
  describe('set() resets TTL on overwrite', () => {
    it('value is still present past original TTL after TTL reset', () => {
      map.set('key', 'original', 1000)
      vi.advanceTimersByTime(800) // 800ms elapsed, TTL not yet expired
      map.set('key', 'updated', 1000) // reset: new TTL from this point
      vi.advanceTimersByTime(400) // 1200ms total — past original TTL, but only 400ms into new
      expect(map.get('key')).toBe('updated')
    })

    it('value expires after the new TTL following reset', () => {
      map.set('key', 'original', 1000)
      vi.advanceTimersByTime(800)
      map.set('key', 'updated', 1000)
      vi.advanceTimersByTime(1000) // new TTL fully elapsed
      expect(map.get('key')).toBeUndefined()
    })

    it('returns the updated value before new TTL expires', () => {
      map.set('key', 'first', 1000)
      map.set('key', 'second', 2000)
      vi.advanceTimersByTime(1500)
      expect(map.get('key')).toBe('second')
    })
  })

  // -------------------------------------------------------------------------
  // destroy()
  // -------------------------------------------------------------------------
  describe('destroy()', () => {
    it('clears all entries so get() returns undefined for all keys', () => {
      map.set('a', 'alpha', 5000)
      map.set('b', 'beta', 5000)
      map.set('c', 'gamma', 5000)
      map.destroy()
      expect(map.get('a')).toBeUndefined()
      expect(map.get('b')).toBeUndefined()
      expect(map.get('c')).toBeUndefined()
    })

    it('has() returns false for all keys after destroy()', () => {
      map.set('a', 'alpha', 5000)
      map.destroy()
      expect(map.has('a')).toBe(false)
    })

    it('is idempotent — calling destroy() multiple times does not throw', () => {
      map.set('a', 'alpha', 5000)
      expect(() => {
        map.destroy()
        map.destroy()
        map.destroy()
      }).not.toThrow()
    })

    it('timers are cancelled so entries do not re-appear after destroy()', () => {
      map.set('key', 'value', 1000)
      map.destroy()
      vi.advanceTimersByTime(2000)
      expect(map.get('key')).toBeUndefined()
    })
  })
})
