/**
 * Per-step narration scripts.
 * Full narration text for the PR Coater Developer Track simulation.
 * Every sentence is delivered exactly as written — nothing skipped or shortened.
 */

export interface StepNarration {
  starting: string;     // played when wafer arrives at this step
  completed?: string;   // optional: played when step finishes (before next starts)
}

export const STEP_NARRATIONS: Record<string, StepNarration> = {
  // Step 01 – FOUP Input
  foup: {
    starting:
      'Process initiated. Wafers are loaded into the system from the Front Opening Unified Pod, or FOUP. The automated track handler is preparing to transfer the first wafer into the process chamber.',
  },

  // Step 02 – Dehydration Bake 150°C
  dehy: {
    starting:
      'Step two: Dehydration Bake. The wafer is heated on a hot plate at 150 degrees Celsius to drive off any residual surface moisture. Eliminating moisture is critical to ensure proper photoresist adhesion and to maximize wafer yield.',
  },

  // Step 03 – HMDS Vapor Prime
  hmds: {
    starting:
      'Step three: HMDS Vapor Priming. Performed in-situ within the prep chamber, HMDS vapor is introduced to deposit a thin primer layer. This chemically modifies the surface to significantly improve photoresist adhesion.',
  },

  // Step 04 – Chill Plate #1 – 22°C
  chill1: {
    starting:
      'Step four: Chill Plate cooling. Before the photoresist can be applied, the wafer is moved to a chill plate and cooled down to an ambient temperature of 22 degrees Celsius to ensure process stability and uniformity.',
  },

  // Step 05 – PR Coat (COT)
  prcoat: {
    starting:
      'Step five: Photoresist Coating. The wafer is secured onto a high-speed spindle via a vacuum chuck. Liquid photoresist is dispensed, and centrifugal force spins it into a uniform, thin layer. Coating thickness is precisely controlled by spin speed and resist viscosity. Faster spin gives a thinner film. Higher viscosity gives a thicker film. Simultaneously, a chemical Edge Bead Removal uses solvent nozzles to clean excess photoresist from the wafer edges.',
  },

  // Step 06 – Post-Apply Bake (Soft Bake)
  pab: {
    starting:
      'Step six: Post-Apply Bake, also known as Soft Bake. The wafer is heated on a single-wafer hot plate to 90 to 120 degrees Celsius to drive out solvents and transition the photoresist from a liquid to a solid state. Hot plate is the most common method for all baking processes. It can heat and dry PR from the bottom up, ensuring uniform drying and preventing surface crusting.',
  },

  // Step 07 – Chill Plate #2 – 22°C
  chill2: {
    starting:
      'Step seven: Second Chill Plate cooling. The soft-baked wafer is brought back down to an ambient 22 degrees Celsius on a chill plate, stabilizing the solid photoresist layer before it transitions to the scanner interface.',
  },

  // Step 08 – Interface to Scanner  (id: "iface_out" in ALL_STEPS = wafer going OUT to scanner)
  iface_out: {
    starting:
      'Step eight: Scanner Interface transfer. The internal track robotics are now transferring the stabilized wafer out of the Coater-Developer track and into the integrated lithography scanner exposure system.',
  },

  // Step 09 – Scanner 193nm Exposure
  scanner: {
    starting:
      'Step nine: Alignment and Exposure. Inside the scanner, the circuit pattern on the reticle is aligned with pre-existing pattern on the mask and the wafer and the pattern is then transferred from the reticle mask to the photoresist on the wafer using a 193 nanometer Argon Fluoride Deep Ultra-Violet light source. This alters the chemical structure of the photoresist in the exposed regions.',
  },

  // Step 10 – Scanner to Interface  (id: "iface_in" in ALL_STEPS = wafer coming IN from scanner)
  iface_in: {
    starting:
      'Step ten: Scanner Interface return. Having completed the exposure process, the wafer is transferred back across the interface into the Developer track for automated post-processing.',
  },

  // Step 11 – Post-Exposure Bake – 110 to 120°C
  peb: {
    starting:
      'Step eleven: Post-Exposure Bake. The wafer is baked at 110 to 120 degrees Celsius. This crucial step activates chemical amplification within the Deep UV photoresist and smoothens out standing wave interference patterns to sharpen line edges. For the same type of PR, a Post Exposure Bake requires a higher baking temperature than a soft bake.',
  },

  // Step 12 – Developer Module (DEV)
  develop: {
    starting:
      'Step twelve: Developer Module. A weak base developer, TMAH, is dispensed to form a puddle covering the entire wafer. The developer selectively dissolves and removes the exposed positive photoresist, unmasking the desired circuit pattern. Following the development puddle time, fresh developer is sprayed while the wafer begins to spin, flushing away dissolved resist. Pure DI water is then introduced to thoroughly rinse the wafer and halt the chemical development process.',
  },

  // Step 13 – DI Water Rinse
  rinse: {
    starting:
      'Step thirteen: Deionized Water Rinse. Fresh deionized water rinse is an additional optional step used for defect control. Pure DI water thoroughly rinses the wafer and further reduces particle count.',
  },

  // Step 14 – Spin Dry + Nitrogen Purge
  spindry: {
    starting:
      'Step fourteen: Spin Dry and Nitrogen Purge. The wafer is spun at high speed to clear away fluid via centrifugal force, combined with a nitrogen gas purge to ensure a completely dry, particle-free surface.',
  },

  // Step 15 – Chill Plate #3 – 22°C
  chill3: {
    starting:
      'Step fifteen: Third Chill Plate cooling. The developed wafer is transferred to a final chill plate, returning it to 22 degrees Celsius to prepare it for the final baking phase.',
  },

  // Step 16 – Hard Bake – 130°C
  hardbake: {
    starting:
      'Step sixteen: Final Hard Bake. The wafer undergoes a final hot plate bake at 130 degrees Celsius. This drives out any remaining traces of solvent, improves resist adhesion, and structurally strengthens the photoresist pattern to withstand downstream plasma etching and ion implantation. Process is now complete and the wafer returns to the FOUP.',
  },
};

/** Get narration for a step, with fallback */
export function getStepNarration(stepId: string): StepNarration {
  return STEP_NARRATIONS[stepId] ?? {
    starting: `${stepId} step starting.`,
    completed: `${stepId} complete.`,
  };
}
