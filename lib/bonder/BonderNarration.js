'use client'

/**
 * Comprehensive state-driven narration for the Flip Chip Bonder simulation.
 * Narration is synchronized with actual process states and animations.
 */

export const BONDER_PROCESS_NARRATION = {
  // Process States
  IDLE: {
    text: 'Ready to begin the flip chip bonding process.',
  },

  // Wafer Loading Phase
  WAFER_LOADING: {
    text: 'The flip chip bonding process is starting. The robotic system will transfer the wafer to the bonding station and begin the chip placement sequence.',
  },

  // Wafer Transfer States
  R2FOUP: {
    text: 'The robot is moving to the input wafer rack and aligning its pickup head with the wafer.',
  },
  APPROACH: {
    text: 'The robot is approaching the wafer pickup position.',
  },
  INSERT: {
    text: 'The robot is inserting its pickup head into the wafer rack.',
  },
  CONTACT: {
    text: 'The robot is contacting the wafer surface.',
  },
  ATTACH: {
    text: 'The robot is lowering its pickup head and securely gripping the wafer.',
  },
  LIFT: {
    text: 'The wafer has been picked up. The robot is lifting it clear of the rack.',
  },
  BACKWARD_RETRACT: {
    text: 'The robot is retracting backward to create a safe clearance before transferring the wafer.',
  },
  TRAVEL: {
    text: 'The robot is transferring the wafer along a safe path above the bonding equipment.',
  },
  LOWER: {
    text: 'The robot is lowering the wafer onto the bonding pedestal.',
  },
  PLACE: {
    text: 'The wafer has been positioned and released onto the bonding pedestal.',
  },
  RETRACT: {
    text: 'The robot is retracting from the bonding area and preparing for chip placement.',
  },
  HOME: {
    text: 'The robot has returned to its home position.',
  },

  // Chip Placement States
  CHIP_PLACEMENT: {
    text: 'The chip placement sequence is beginning. Six chips will be placed on the board.',
  },

  // Individual Chip States (1-6)
  CHIP_PICK_APPROACH: {
    1: 'The robot is approaching the first chip and aligning its pickup head.',
    2: 'The robot is approaching the second chip and aligning its pickup head.',
    3: 'The robot is approaching the third chip and aligning its pickup head.',
    4: 'The robot is approaching the fourth chip and aligning its pickup head.',
    5: 'The robot is approaching the fifth chip and aligning its pickup head.',
    6: 'The robot is approaching the sixth chip and aligning its pickup head.',
  },
  CHIP_PICK_LOWER: {
    1: 'The robot is lowering to pick up the first chip.',
    2: 'The robot is lowering to pick up the second chip.',
    3: 'The robot is lowering to pick up the third chip.',
    4: 'The robot is lowering to pick up the fourth chip.',
    5: 'The robot is lowering to pick up the fifth chip.',
    6: 'The robot is lowering to pick up the sixth chip.',
  },
  CHIP_PICK_ATTACH: {
    1: 'The first chip is being picked up by the robotic gripper.',
    2: 'The second chip is being picked up by the robotic gripper.',
    3: 'The third chip is being picked up by the robotic gripper.',
    4: 'The fourth chip is being picked up by the robotic gripper.',
    5: 'The fifth chip is being picked up by the robotic gripper.',
    6: 'The sixth chip is being picked up by the robotic gripper.',
  },
  CHIP_PICK_LIFT: {
    1: 'The first chip has been picked up. The robot is lifting it.',
    2: 'The second chip has been picked up. The robot is lifting it.',
    3: 'The third chip has been picked up. The robot is lifting it.',
    4: 'The fourth chip has been picked up. The robot is lifting it.',
    5: 'The fifth chip has been picked up. The robot is lifting it.',
    6: 'The sixth chip has been picked up. The robot is lifting it.',
  },
  CHIP_FLUX_APPROACH: {
    1: 'The first chip is being transferred to the flux station for flux application.',
    2: 'The second chip is being transferred to the flux station for flux application.',
    3: 'The third chip is being transferred to the flux station for flux application.',
    4: 'The fourth chip is being transferred to the flux station for flux application.',
    5: 'The fifth chip is being transferred to the flux station for flux application.',
    6: 'The sixth chip is being transferred to the flux station for flux application.',
  },
  CHIP_FLUX_LOWER: {
    1: 'The first chip is being lowered into the flux.',
    2: 'The second chip is being lowered into the flux.',
    3: 'The third chip is being lowered into the flux.',
    4: 'The fourth chip is being lowered into the flux.',
    5: 'The fifth chip is being lowered into the flux.',
    6: 'The sixth chip is being lowered into the flux.',
  },
  CHIP_FLUX_DWELL: {
    1: 'The first chip is being dipped into flux.',
    2: 'The second chip is being dipped into flux.',
    3: 'The third chip is being dipped into flux.',
    4: 'The fourth chip is being dipped into flux.',
    5: 'The fifth chip is being dipped into flux.',
    6: 'The sixth chip is being dipped into flux.',
  },
  CHIP_FLUX_RETRACT: {
    1: 'The first chip has completed the flux dipping step.',
    2: 'The second chip has completed the flux dipping step.',
    3: 'The third chip has completed the flux dipping step.',
    4: 'The fourth chip has completed the flux dipping step.',
    5: 'The fifth chip has completed the flux dipping step.',
    6: 'The sixth chip has completed the flux dipping step.',
  },
  CHIP_PLACE_APPROACH: {
    1: 'The robot is moving the flux-coated first chip to its designated position on the board.',
    2: 'The robot is moving the flux-coated second chip to its designated position on the board.',
    3: 'The robot is moving the flux-coated third chip to its designated position on the board.',
    4: 'The robot is moving the flux-coated fourth chip to its designated position on the board.',
    5: 'The robot is moving the flux-coated fifth chip to its designated position on the board.',
    6: 'The robot is moving the flux-coated sixth chip to its designated position on the board.',
  },
  CHIP_PLACE_LOWER: {
    1: 'The robot is aligning the first chip with its designated board position.',
    2: 'The robot is aligning the second chip with its designated board position.',
    3: 'The robot is aligning the third chip with its designated board position.',
    4: 'The robot is aligning the fourth chip with its designated board position.',
    5: 'The robot is aligning the fifth chip with its designated board position.',
    6: 'The robot is aligning the sixth chip with its designated board position.',
  },
  CHIP_PLACE_RELEASE: {
    1: 'The first chip is being precisely aligned and placed onto the board.',
    2: 'The second chip is being precisely aligned and placed onto the board.',
    3: 'The third chip is being precisely aligned and placed onto the board.',
    4: 'The fourth chip is being precisely aligned and placed onto the board.',
    5: 'The fifth chip is being precisely aligned and placed onto the board.',
    6: 'The sixth chip is being precisely aligned and placed onto the board.',
  },
  CHIP_RETRACT: {
    1: 'Chip one of six has been successfully placed.',
    2: 'Chip two of six has been successfully placed.',
    3: 'Chip three of six has been successfully placed.',
    4: 'Chip four of six has been successfully placed.',
    5: 'Chip five of six has been successfully placed.',
    6: 'Chip six of six has been successfully placed.',
  },

  // Board Completion
  COMPLETE: {
    text: 'All six chips have now been placed on the board. The chip placement sequence is complete.',
  },

  // Board Transfer
  BOARD_COMPLETE: {
    text: 'The completed chip assembly is now ready for final transfer to the output wafer rack.',
  },

  // Output Transfer States
  OUTPUT_TRANSFER: {
    text: 'The completed board is ready to be transferred from the Flip Chip Bonder.',
  },
  PICK_APPROACH: {
    text: 'The robot is approaching the completed board for transfer to the output wafer rack.',
  },
  PICK_LOWER: {
    text: 'The robot is aligning its pickup head with the completed board.',
  },
  PICK_ATTACH: {
    text: 'The completed board has been securely picked up by the robot.',
  },
  PICK_LIFT: {
    text: 'The robot is lifting the completed board from the bonding station.',
  },
  TRAVEL_TO_RACK: {
    text: 'The robot is retracting backward with the completed board.',
  },
  RACK_APPROACH: {
    text: 'The completed board is being transferred to the second wafer rack along a safe travel path.',
  },
  RACK_LOWER: {
    text: 'The robot is approaching the front side of the output wafer rack.',
  },
  RACK_RELEASE: {
    text: 'The robot is lowering the completed board into the output wafer rack.',
  },
  RACK_RETRACT: {
    text: 'The completed board has been placed securely inside the output wafer rack.',
  },
  HOME_OUTPUT: {
    text: 'The robot is retracting from the output rack.',
  },

  // Final process completion
  PROCESS_COMPLETE: {
    text: 'The flip chip bonding process is complete. The finished board has been transferred and stored in the output wafer rack.',
  },

  // Two-robot process states
  R1_MOVE_TO_CHIP: {
    text: 'The first robotic arm is moving to the chip pickup position.',
  },
  R1_PICK: {
    text: 'The first robotic arm is lowering to pick up the chip.',
  },
  R1_MOVE_TO_FLIP: {
    text: 'The first robotic arm is moving the chip to the flip station.',
  },
  R1_FLIP: {
    text: 'The robotic arm is rotating the chip 180 degrees for face-down bonding.',
  },
  R1_MOVE_TO_HANDOFF: {
    text: 'The first robotic arm is moving to the handoff position.',
  },
  R1_HANDOFF_READY: {
    text: 'The first robotic arm is ready for chip handoff.',
  },
  R2_MOVE_TO_HANDOFF: {
    text: 'The second robotic arm is approaching the handoff position.',
  },
  R2_PICK: {
    text: 'The second robotic arm is picking up the chip from the handoff.',
  },
  R2_MOVE_TO_FLUX: {
    text: 'The second robotic arm is transferring the chip to the flux station.',
  },
  R2_FLUX_DIP: {
    text: 'The chip is being dipped into flux for solder preparation.',
  },
  R2_MOVE_TO_BOARD: {
    text: 'The second robotic arm is moving the chip to the board placement position.',
  },
  R2_PLACE: {
    text: 'The second robotic arm is placing the chip onto the board.',
  },
}

/**
 * Get narration text for a given state and optional chip index
 */
export function getBonderNarration(state, chipIndex = null) {
  const stateNarration = BONDER_PROCESS_NARRATION[state]

  if (!stateNarration) {
    return null
  }

  // If it's a chip-specific state with chip index
  if (chipIndex !== null && typeof stateNarration === 'object') {
    return stateNarration[chipIndex] || stateNarration[1] // Fallback to chip 1
  }

  // If it's a simple text state
  if (typeof stateNarration === 'string') {
    return stateNarration
  }

  // If it's an object with text property
  if (stateNarration.text) {
    return stateNarration.text
  }

  return null
}

/**
 * State-driven narration manager
 * Prevents duplicate narration and ensures narration matches actual process state
 */
export class BonderNarrationManager {
  constructor(narration) {
    this.narration = narration
    this.lastNarratedState = null
    this.lastNarratedChipIndex = null
  }

  /**
   * Speak narration for a state change (only if state has changed)
   */
  speakForState(state, chipIndex = null) {
    const stateKey = this._getStateKey(state, chipIndex)

    // Prevent duplicate narration for the same state
    if (stateKey === this.lastNarratedState) {
      return
    }

    const text = getBonderNarration(state, chipIndex)
    if (text && this.narration?.isEnabled) {
      this.narration.speak(text, 'normal')
      this.lastNarratedState = stateKey
      this.lastNarratedChipIndex = chipIndex
    }
  }

  /**
   * Get a unique key for state + chip index combination
   */
  _getStateKey(state, chipIndex) {
    if (chipIndex !== null) {
      return `${state}_CHIP_${chipIndex}`
    }
    return state
  }

  /**
   * Reset narration state
   */
  reset() {
    this.lastNarratedState = null
    this.lastNarratedChipIndex = null
    if (this.narration) {
      this.narration.reset()
    }
  }

  /**
   * Stop current narration
   */
  stop() {
    if (this.narration) {
      this.narration.stop()
    }
  }
}
