'use client'

import { BONDER_STAGE_IDS, BONDER_STAGE_LABELS } from './BonderConfig'
import { BONDER_EVENTS } from './BonderEvents'

/**
 * BonderStateMachine — explicit, deterministic linear recipe with mandatory
 * ordering and guards. Every transition is explicit and validated. A stage may
 * only be marked complete when the corresponding operation has actually
 * finished (verified by the orchestrator).
 *
 * Allowed stage order (1..17). Invalid transitions throw / emit PROCESS_ERROR.
 */
const STAGE_ORDER = [
  BONDER_STAGE_IDS.INITIALIZE,
  BONDER_STAGE_IDS.MOVE_TO_PICK,
  BONDER_STAGE_IDS.PICK_CHIP,
  BONDER_STAGE_IDS.VERIFY_PICK,
  BONDER_STAGE_IDS.TRANSFER,
  BONDER_STAGE_IDS.FLIP,
  BONDER_STAGE_IDS.VERIFY_FLIP,
  BONDER_STAGE_IDS.FLUX_DIP,
  BONDER_STAGE_IDS.VERIFY_FLUX,
  BONDER_STAGE_IDS.MOVE_TO_ALIGNMENT,
  BONDER_STAGE_IDS.ALIGN,
  BONDER_STAGE_IDS.MOVE_TO_BOND,
  BONDER_STAGE_IDS.BOND,
  BONDER_STAGE_IDS.RELEASE,
  BONDER_STAGE_IDS.VERIFY_PLACEMENT,
  BONDER_STAGE_IDS.RETRACT,
  BONDER_STAGE_IDS.COMPLETE,
]

export class BonderStateMachine {
  constructor(events) {
    this.events = events
    this.currentStage = BONDER_STAGE_IDS.INITIALIZE
    this.completed = []
    this.status = 'idle' // idle | running | paused | error | complete
    this.error = null
    this.lastError = null
    this.phase = 'INITIALIZE'
    this.progressOverride = 0
  }

  getStatus() {
    return {
      stageId: this.currentStage,
      stageLabel: BONDER_STAGE_LABELS[this.currentStage],
      phase: this.phase,
      status: this.status,
      error: this.error,
      completed: [...this.completed],
      progress: this.progressOverride ?? (this.completed.length / STAGE_ORDER.length) * 100,
    }
  }

  /** Verify both guard conditions of the chip AND the stage ordering. */
  validateTransition(nextStage) {
    const curIdx = STAGE_ORDER.indexOf(this.currentStage)
    const nextIdx = STAGE_ORDER.indexOf(nextStage)
    if (curIdx + 1 !== nextIdx) {
      const msg = `INVALID STATE: cannot go ${BONDER_STAGE_LABELS[this.currentStage]} -> ${BONDER_STAGE_LABELS[nextStage]}`
      this.fail(msg)
      return false
    }
    return true
  }

  /** Marks the CURRENT stage as complete and moves to `nextStage` (must be next in order). */
  completeStage(nextStage, chipGuard) {
    if (chipGuard) {
      this.fail(chipGuard)
      return false
    }
    if (!this.validateTransition(nextStage)) return false

    this.completed.push(this.currentStage)
    this.currentStage = nextStage
    this.phase = BONDER_STAGE_LABELS[nextStage]
    this.events.emit(BONDER_EVENTS.STAGE_CHANGE, { stageId: nextStage, label: this.phase })
    if (nextStage === BONDER_STAGE_IDS.COMPLETE) {
      this.status = 'complete'
      this.events.emit(BONDER_EVENTS.PROCESS_COMPLETE, {})
    }
    return true
  }

  setRunning() {
    this.status = 'running'
    this.error = null
    this.phase = BONDER_STAGE_LABELS[this.currentStage]
    this.events.emit(BONDER_EVENTS.PROCESS_START, { stageId: this.currentStage })
  }

  pause() {
    if (this.status === 'running') this.status = 'paused'
  }

  resume() {
    if (this.status === 'paused') this.status = 'running'
  }

  fail(msg) {
    this.status = 'error'
    this.error = msg
    this.lastError = msg
    this.events.emit(BONDER_EVENTS.PROCESS_ERROR, { message: msg, stageId: this.currentStage })
    console.error(`[BONDER ERROR] ${msg}`)
  }

  reset() {
    this.currentStage = BONDER_STAGE_IDS.INITIALIZE
    this.completed = []
    this.status = 'idle'
    this.error = null
    this.phase = BONDER_STAGE_LABELS[this.currentStage]
    this.progressOverride = 0
    this.events.emit(BONDER_EVENTS.RESET, {})
  }
}
