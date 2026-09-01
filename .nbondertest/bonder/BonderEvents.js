'use client'

/**
 * Operation event bus for the Flip Chip Bonder.
 * Recipe / UI subscribe to machine events and react to real completions.
 */

export const BONDER_EVENTS = {
  LOADED: 'LOADED',
  PROCESS_START: 'PROCESS_START',
  STAGE_CHANGE: 'STAGE_CHANGE',
  PICK_STARTED: 'PICK_STARTED',
  PICK_SUCCESS: 'PICK_SUCCESS',
  PICK_FAILED: 'PICK_FAILED',
  TRANSFER_STARTED: 'TRANSFER_STARTED',
  FLIP_STARTED: 'FLIP_STARTED',
  FLIP_COMPLETE: 'FLIP_COMPLETE',
  FLUX_DIP_STARTED: 'FLUX_DIP_STARTED',
  FLUX_DIP_COMPLETE: 'FLUX_DIP_COMPLETE',
  ALIGNMENT_STARTED: 'ALIGNMENT_STARTED',
  ALIGNMENT_COMPLETE: 'ALIGNMENT_COMPLETE',
  BOND_STARTED: 'BOND_STARTED',
  BOND_COMPLETE: 'BOND_COMPLETE',
  RELEASE_COMPLETE: 'RELEASE_COMPLETE',
  PLACEMENT_VERIFIED: 'PLACEMENT_VERIFIED',
  PROCESS_COMPLETE: 'PROCESS_COMPLETE',
  PROCESS_ERROR: 'PROCESS_ERROR',
  RESET: 'RESET',
}

export class BonderEvents {
  constructor() {
    this.listeners = new Map()
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event).add(handler)
    return () => this.off(event, handler)
  }

  off(event, handler) {
    const set = this.listeners.get(event)
    if (set) set.delete(handler)
  }

  emit(event, payload = {}) {
    const set = this.listeners.get(event)
    if (!set) return
    set.forEach((h) => {
      try {
        h(payload)
      } catch (e) {
        console.error(`[BONDER EVENT] handler error for ${event}`, e)
      }
    })
  }

  clear() {
    this.listeners.clear()
  }
}
