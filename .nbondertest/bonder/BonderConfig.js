'use client'

/**
 * Centralised configuration for the Flip Chip Bonder.
 * All values are in MODEL-LOCAL (GLB) coordinate space unless noted.
 * Durations are real seconds (scaled by the global speed factor at runtime).
 */

export const BONDER_STAGE_IDS = {
  INITIALIZE: 1,
  MOVE_TO_PICK: 2,
  PICK_CHIP: 3,
  VERIFY_PICK: 4,
  TRANSFER: 5,
  FLIP: 6,
  VERIFY_FLIP: 7,
  FLUX_DIP: 8,
  VERIFY_FLUX: 9,
  MOVE_TO_ALIGNMENT: 10,
  ALIGN: 11,
  MOVE_TO_BOND: 12,
  BOND: 13,
  RELEASE: 14,
  VERIFY_PLACEMENT: 15,
  RETRACT: 16,
  COMPLETE: 17,
}

export const BONDER_STAGE_LABELS = {
  1: 'INITIALIZE',
  2: 'MOVE TO PICK',
  3: 'PICK CHIP',
  4: 'VERIFY PICK',
  5: 'TRANSFER',
  6: 'FLIP',
  7: 'VERIFY FLIP',
  8: 'FLUX DIP',
  9: 'VERIFY FLUX',
  10: 'MOVE TO ALIGNMENT',
  11: 'ALIGN',
  12: 'MOVE TO BOND',
  13: 'BOND',
  14: 'RELEASE',
  15: 'VERIFY PLACEMENT',
  16: 'RETRACT',
  17: 'COMPLETE',
}

export const BONDER_CONFIG = {
  // ── Movement ──
  movement: {
    defaultDuration: 1.2,
    travelDuration: 1.5,
    liftDuration: 0.7,
    lowerDuration: 0.7,
    transferDuration: 1.8,
  },

  // ── Pickup ──
  pickup: {
    approachHeight: 0.35, // Y distance above chip at approach
    contactTolerance: 0.02,
    attachTolerance: 0.06,
    maxRetries: 2,
  },

  // ── Flip ──
  flip: {
    rotation: Math.PI, // 180°
    duration: 1.4,
  },

  // ── Flux ──
  flux: {
    approachHeight: 0.3,
    dipDepth: 0.12, // how far below flux surface the chip dips
    dipDuration: 0.9,
    dwellDuration: 0.6, // wait while submerged
    retractDuration: 0.7,
  },

  // ── Alignment ──
  alignment: {
    duration: 1.6,
    positionTolerance: 0.03,
    rotationTolerance: 0.05, // radians
  },

  // ── Bonding ──
  bonding: {
    approachHeight: 0.32,
    contactHeight: 0.147, // chip top y when resting on substrate
    descentDuration: 0.9,
    dwellDuration: 0.8, // apply+hold
    releaseDelay: 0.4,
  },

  // ── Handoff / robot B ──
  handoff: {
    duration: 1.6,
    approachHeight: 0.4,
  },

  // ── Chip tray ──
  tray: {
    startX: -1.3,
    endX: -0.9,
    startZ: 0.2,
    endZ: -0.2,
    chipTopY: 0.182, // y of chip top surface in model-local space
    columns: 5,
    rows: 5,
  },

  // ── WR target positions (model-local) ──
  positions: {
    // The SINGLE active chip starts at the first tray slot.
    chipRest: { x: -1.3, y: 0.182, z: 0.2 },
    // Bond substrate target (BondBase).
    bondTarget: { x: 1.1, y: 0.147, z: 0 },
    // Flux station (a logical location we place near the handoff zone).
    fluxTarget: { x: 0.25, y: 0.02, z: 0.0 },
    // Handoff point between robot A and robot B.
    handoff: { x: -0.05, y: 0.5, z: 0.0 },
    // Alignment station (coarse → fine) near the bond target.
    alignment: { x: 0.75, y: 0.5, z: 0.0 },
  },
}

export const BONDER_OBJECT_TAGS = {
  // Robot A (pickup / flip)
  p: 'SKING',
  // Robot B (bond head)
  b: 'COLRIGHT',
}

export const MAX_PICKUP_RETRIES = BONDER_CONFIG.pickup.maxRetries
