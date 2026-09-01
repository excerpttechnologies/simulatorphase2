'use client'

/**
 * Per-step narration scripts for the Flip Chip Bonder simulation.
 * Full narration text for the Flip Chip Bonder process.
 * Every sentence is delivered exactly as written — nothing skipped or shortened.
 */

const BONDER_STEP_NARRATIONS = {
  // Stage 1 – Substrate Loading
  1: {
    starting: 'Stage one: Substrate Loading. The wafer substrate is positioned on the Ring Vacuum Pedestal. The vacuum system secures the substrate in place for precise die attachment.',
  },

  // Stage 2 – Wafer Fiducial Scan
  2: {
    starting: 'Stage two: Wafer Fiducial Scan. The vision system locates alignment marks on the wafer substrate to establish reference coordinates for die placement.',
  },

  // Stage 3 – Die Ejection
  3: {
    starting: 'Stage three: Die Ejection. Individual dies are ejected from the wafer tape frame and presented for pickup by the bond head tool.',
  },

  // Stage 4 – Pick & Lift
  4: {
    starting: 'Stage four: Pick and Lift. The pickup tool descends to the die location, activates vacuum to grip the die, and lifts it clear of the tape frame.',
  },

  // Stage 5 – Transfer to Pedestal
  5: {
    starting: 'Stage five: Transfer to Pedestal. The robot carries the die to the flip pedestal, positioning it for the 180-degree flip operation.',
  },

  // Stage 6 – 180° Flip
  6: {
    starting: 'Stage six: 180 Degree Flip. The die is rotated 180 degrees to orient the active side downward for face-down bonding to the substrate.',
  },

  // Stage 7 – Head → Pedestal
  7: {
    starting: 'Stage seven: Head to Pedestal. The bond head moves to the flip pedestal to receive the flipped die from the pickup tool.',
  },

  // Stage 8 – Head Picks Die
  8: {
    starting: 'Stage eight: Head Picks Die. The bond head tool picks up the flipped die from the pedestal, now holding it with the active side facing down.',
  },

  // Stage 9 – Move to Flux Plate
  9: {
    starting: 'Stage nine: Move to Flux Plate. The robot carries the die to the flux station where flux will be applied to improve solder joint formation.',
  },

  // Stage 10 – Dip, Dwell & Retract
  10: {
    starting: 'Stage ten: Dip, Dwell, and Retract. The die is dipped into the flux, held briefly to ensure proper coating, then retracted from the flux reservoir.',
  },

  // Stage 11 – Move to Bond Site
  11: {
    starting: 'Stage eleven: Move to Bond Site. The robot positions the fluxed die precisely over the target bond site on the wafer substrate.',
  },

  // Stage 12 – Dual-FOV Align
  12: {
    starting: 'Stage twelve: Dual Field of View Alignment. The vision system uses dual magnification to achieve precise alignment between the die and substrate alignment marks.',
  },

  // Stage 13 – Touchdown / Preheat
  13: {
    starting: 'Stage thirteen: Touchdown and Preheat. The die descends to make contact with the substrate. Gentle preheating begins to prepare the solder bumps for reflow.',
  },

  // Stage 14 – Peak Reflow Pulse
  14: {
    starting: 'Stage fourteen: Peak Reflow Pulse. Temperature is raised to peak reflow temperature, causing the solder bumps to melt and form metallurgical bonds with the substrate pads.',
  },

  // Stage 15 – Cool Down
  15: {
    starting: 'Stage fifteen: Cool Down. The assembly is cooled to solidify the solder joints and establish strong mechanical and electrical connections.',
  },

  // Stage 16 – Release & Retract
  16: {
    starting: 'Stage sixteen: Release and Retract. The bond head releases the die from vacuum and retracts, leaving the die securely bonded to the substrate.',
  },

  // Stage 17 – Index to Next Site
  17: {
    starting: 'Stage seventeen: Index to Next Site. The system indexes to the next bond site position to begin the next die attachment cycle.',
  },
};

/** Get narration for a bonder stage, with fallback */
function getBonderStepNarration(stageId) {
  return BONDER_STEP_NARRATIONS[stageId] ?? {
    starting: `Stage ${stageId} starting.`,
    completed: `Stage ${stageId} complete.`,
  };
}

// Export for both CommonJS and ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BONDER_STEP_NARRATIONS, getBonderStepNarration };
}
export { BONDER_STEP_NARRATIONS, getBonderStepNarration };
