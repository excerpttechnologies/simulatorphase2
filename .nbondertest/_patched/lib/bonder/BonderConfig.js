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
  SUBSTRATE_LOADING: 1,
  FIDUCIAL_SCAN: 2,
  DIE_EJECTION: 3,
  PICK_LIFT: 4,
  TRANSFER_PEDESTAL: 5,
  FLIP_180: 6,
  HEAD_TO_PEDESTAL: 7,
  HEAD_PICKS_DIE: 8,
  MOVE_TO_FLUX_PLATE: 9,
  DIP_DWELL_RETRACT: 10,
  MOVE_TO_BOND_SITE: 11,
  DUAL_FOV_ALIGN: 12,
  TOUCHDOWN_PREHEAT: 13,
  PEAK_REFLOW: 14,
  COOL_DOWN: 15,
  RELEASE_RETRACT: 16,
  INDEX_NEXT_SITE: 17,
}

export const BONDER_STAGE_LABELS = {
  1: 'SUBSTRATE LOADING',
  2: 'WAFER FIDUCIAL SCAN',
  3: 'DIE EJECTION',
  4: 'PICK & LIFT',
  5: 'TRANSFER TO PEDESTAL',
  6: '180° FLIP',
  7: 'HEAD → PEDESTAL',
  8: 'HEAD PICKS DIE',
  9: 'MOVE TO FLUX PLATE',
  10: 'DIP, DWELL & RETRACT',
  11: 'MOVE TO BOND SITE',
  12: 'DUAL-FOV ALIGN',
  13: 'TOUCHDOWN / PREHEAT',
  14: 'PEAK REFLOW PULSE',
  15: 'COOL DOWN',
  16: 'RELEASE & RETRACT',
  17: 'INDEX TO NEXT SITE',
}

export const BONDER_STAGES = [
  { id: 1, phase: 1, name: BONDER_STAGE_LABELS[1], temperature: 80 },
  { id: 2, phase: 1, name: BONDER_STAGE_LABELS[2], temperature: 80 },
  { id: 3, phase: 2, name: BONDER_STAGE_LABELS[3], temperature: 80 },
  { id: 4, phase: 2, name: BONDER_STAGE_LABELS[4], temperature: 80 },
  { id: 5, phase: 2, name: BONDER_STAGE_LABELS[5], temperature: 80 },
  { id: 6, phase: 2, name: BONDER_STAGE_LABELS[6], temperature: 80 },
  { id: 7, phase: 2, name: BONDER_STAGE_LABELS[7], temperature: 80 },
  { id: 8, phase: 2, name: BONDER_STAGE_LABELS[8], temperature: 150 },
  { id: 9, phase: 3, name: BONDER_STAGE_LABELS[9], temperature: 150 },
  { id: 10, phase: 3, name: BONDER_STAGE_LABELS[10], temperature: 150 },
  { id: 11, phase: 4, name: BONDER_STAGE_LABELS[11], temperature: 150 },
  { id: 12, phase: 4, name: BONDER_STAGE_LABELS[12], temperature: 150 },
  { id: 13, phase: 5, name: BONDER_STAGE_LABELS[13], temperature: 150 },
  { id: 14, phase: 5, name: BONDER_STAGE_LABELS[14], temperature: 260 },
  { id: 15, phase: 5, name: BONDER_STAGE_LABELS[15], temperature: 190 },
  { id: 16, phase: 6, name: BONDER_STAGE_LABELS[16], temperature: 120 },
  { id: 17, phase: 6, name: BONDER_STAGE_LABELS[17], temperature: 120 },
]

export const BONDER_STAGE_BY_ID = Object.fromEntries(BONDER_STAGES.map((stage) => [stage.id, stage]))

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
