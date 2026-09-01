import { RecipeStep } from './types';

export const RECIPE_STEPS: RecipeStep[] = [
  {
    id: 1,
    phase: "PHASE 1 · WAFER PREP",
    title: "Substrate Loading",
    duration: 5000,
    parameters: [
      { name: "Substrate Vacuum Hold", target: "≥ 80 kPa", tolerance: "Min 75 kPa" },
      { name: "Stage Baseline Heating", target: "80 °C", tolerance: "± 2 °C" },
      { name: "Stage Thermal Dwell Time", target: "5.0 s", tolerance: "Allows thermal equalization" },
      { name: "Cleanroom Class", target: "ISO 5 (Class 100)", tolerance: "Max ISO 6" }
    ],
    description: "The target substrate (interposer, organic laminate, or PCB) is transferred by conveyor/robot into the bonding chamber onto the heated stage (anvil). A vacuum chuck clamps it flat to eliminate bow/warp that would cause coplanarity errors downstream. The stage holds a steady baseline temperature and a brief dwell so temperature settles uniformly before wafer mapping begins.",
    sideNote: "Substrate clamped to heated stage; vacuum engaged",
    topNote: "Substrate positioned on bond stage",
    commentary: "Substrate loaded onto heated stage. Vacuum chuck engaged at 80 kilopascals."
  },
  {
    id: 2,
    phase: "PHASE 1 · WAFER PREP",
    title: "Wafer Fiducial Scan",
    duration: 3000,
    parameters: [
      { name: "Scan Illumination", target: "Coaxial LED (dual wavelength)", tolerance: "Red/Blue" },
      { name: "Fiducial Recognition Accuracy", target: "≤ ± 1.0 µm", tolerance: "3σ" },
      { name: "Stage Scan Speed", target: "50 – 100 mm/s", tolerance: "Vision-gated" },
      { name: "Wafer Map Sync", target: "Ink-dot / e-map overlay", tolerance: "Bad-die exclusion" }
    ],
    description: "The Pattern Recognition System (PRS) optically scans the diced, bumped wafer on its dicing-tape frame to register the wafer's coordinate system against the tool's motion axes, reading die-level fiducials and cross-referencing the incoming wafer map to flag bad die so the pick sequence skips them, establishing the X-Y-theta offset table for every subsequent die.",
    sideNote: "PRS scans wafer coordinate system",
    topNote: "Wafer fiducial mapping in progress",
    commentary: "Pattern recognition system scanning wafer. Die coordinates registered to within 1 micron."
  },
  {
    id: 3,
    phase: "PHASE 2 · PICK & FLIP",
    title: "Die Ejection",
    duration: 800,
    parameters: [
      { name: "Ejector Pin Configuration", target: "4-pin center-lift array", tolerance: "Multi-pin" },
      { name: "Ejector Pin Stroke Height", target: "0.80 mm", tolerance: "Adjustable per die thickness" },
      { name: "Ejector Pin Speed", target: "15 mm/s", tolerance: "Controlled ramp" },
      { name: "Die Thickness Range Supported", target: "50 – 150 µm", tolerance: "Thin-die sensitive" }
    ],
    description: "An ejector module pushes fine pins against the underside of the dicing tape beneath the target die, deforming the tape upward to break the die-to-tape adhesive bond from below (minimizing shear/cracking risk vs. peeling from above). Pin height/speed are tuned to die thickness and tape adhesion for clean separation.",
    sideNote: "Ejector pins lift die from tape",
    topNote: "Die ejection at wafer station",
    commentary: "Ejector pins deforming tape. Die separating from dicing film."
  },
  {
    id: 4,
    phase: "PHASE 2 · PICK & FLIP",
    title: "Pick & Lift",
    duration: 1000,
    parameters: [
      { name: "Pick Force", target: "3.5 N", tolerance: "± 0.5 N" },
      { name: "Pick Head Vacuum", target: "-85 kPa", tolerance: "Min -75 kPa" },
      { name: "Vacuum Lift-off Delay", target: "50 ms", tolerance: "Confirms seal before lift" },
      { name: "Z-Lift Speed", target: "10 – 20 mm/s", tolerance: "Post-separation" }
    ],
    description: "A vacuum-collet pick-and-place arm descends onto the partially ejected die, engages vacuum, confirms seal integrity, then lifts. Controlled pick force avoids bump/surface damage; the lift-off delay synchronizes ejection and grip so the die releases cleanly on the first attempt.",
    sideNote: "Pick arm engages vacuum, lifts die",
    topNote: "Die under vacuum at pick station",
    commentary: "Pick collet descending. Vacuum engaged at negative 85 kilopascals. Die lifted."
  },
  {
    id: 5,
    phase: "PHASE 2 · PICK & FLIP",
    title: "Transfer & Handover to Pedestal",
    duration: 1500,
    parameters: [
      { name: "Handoff Z-Gap", target: "50 µm", tolerance: "± 2 µm" },
      { name: "Transfer Arm Travel Speed", target: "300 – 500 mm/s", tolerance: "Vibration-damped path" },
      { name: "Handoff Position Repeatability", target: "≤ ± 1 µm", tolerance: "Pedestal registration" },
      { name: "Vacuum Handoff Verification", target: "Dual-sensor cross-check", tolerance: "Pick/place vacuum sensors" }
    ],
    description: "The pick arm carries the die to the flipper module's pedestal within a tightly controlled Z-gap. A dual-vacuum handshake (pick vacuum releases only after pedestal vacuum confirms) prevents drops/misalignment, since tilt here propagates through flip and bond alignment.",
    sideNote: "Die transferred to pedestal",
    topNote: "Die in transit to flipper pedestal",
    commentary: "Transferring die to flipper pedestal. Dual vacuum handshake confirmed."
  },
  {
    id: 6,
    phase: "PHASE 2 · PICK & FLIP",
    title: "180° Flip",
    duration: 500,
    parameters: [
      { name: "Flipper Rotation Velocity", target: "720 °/s", tolerance: "High-speed rotary axis" },
      { name: "Post-Flip Settle Time", target: "20 – 50 ms", tolerance: "Vibration damping" },
      { name: "Post-Flip Position Accuracy", target: "≤ ± 2 µm", tolerance: "Verified by vision" },
      { name: "Rotation Axis Type", target: "Servo-driven rotary flipper", tolerance: "Vacuum-through spindle" }
    ],
    description: "The pedestal, holding the die by vacuum, rotates 180° to invert it from face-up to face-down (bump-side down, as required for bonding). Isolating this on a dedicated flipper module keeps rotational vibration away from the bonding head's fine alignment/thermal calibration.",
    sideNote: "Pedestal rotates 180° at 720°/s",
    topNote: "Flipper rotating die to bump-down",
    commentary: "Flipper pedestal rotating. Die inverted 180 degrees. Bump side now facing down."
  },
  {
    id: 7,
    phase: "PHASE 2 · PICK & FLIP",
    title: "Bonding Head Moves to Pedestal",
    duration: 1200,
    parameters: [
      { name: "Bond Head Travel Speed", target: "400 – 600 mm/s", tolerance: "Coarse XY motion" },
      { name: "Approach Deceleration Zone", target: "5 mm", tolerance: "Prevents overshoot" },
      { name: "Position Repeatability", target: "≤ ± 1 µm", tolerance: "Linear encoder feedback" }
    ],
    description: "The TCB head travels along its gantry to align directly above the flipped die on the pedestal, decelerating into a tightly controlled approach zone so it arrives centered without vibration that could disturb the die.",
    sideNote: "Bond head traveling to pedestal",
    topNote: "Bond head moving to flipper station",
    commentary: "Bond head traveling to pedestal at 500 millimeters per second. Decelerating to approach."
  },
  {
    id: 8,
    phase: "PHASE 2 · PICK & FLIP",
    title: "Bonding Head Picks Up Die",
    duration: 800,
    parameters: [
      { name: "Bond Head Pick Vacuum", target: "-85 kPa", tolerance: "Min -75 kPa" },
      { name: "Pickup Dwell / Verification Time", target: "50 – 100 ms", tolerance: "Vacuum seal confirmation" },
      { name: "Collet Flatness", target: "≤ 1 µm across die", tolerance: "Coplanarity-critical" }
    ],
    description: "The bonding head lowers onto the die, engages its own vacuum to take ownership from the pedestal, and dwells briefly to confirm seal integrity before the pedestal releases. Collet flatness directly sets bump coplanarity presented to the substrate.",
    sideNote: "Bond head picks die from pedestal",
    topNote: "Die transferred to bond head",
    commentary: "Bond head descending. Vacuum engaged. Die ownership transferred from pedestal."
  },
  {
    id: 9,
    phase: "PHASE 3 · DIP FLUX",
    title: "Move to Flux Plate",
    duration: 1500,
    parameters: [
      { name: "Travel Speed to Flux Station", target: "300 – 500 mm/s", tolerance: "Coarse motion" },
      { name: "Positioning Accuracy over Plate", target: "≤ ± 5 µm", tolerance: "Centers die over film" },
      { name: "Approach Height Above Plate", target: "1 – 2 mm", tolerance: "Pre-dip clearance" }
    ],
    description: "With the die held bump-side down, the head travels to the flux station and centers it over the rotating flux plate, which maintains a continuously refreshed ultra-thin flux film via a metering/screed blade.",
    sideNote: "Bond head traveling to flux station",
    topNote: "Die moving to flux dip station",
    commentary: "Traveling to flux station. Flux film thickness maintained at 7 microns."
  },
  {
    id: 10,
    phase: "PHASE 3 · DIP FLUX",
    title: "Dip, Dwell & Retract",
    duration: 1000,
    parameters: [
      { name: "Flux Type", target: "Water-soluble, low-residue TCB flux", tolerance: "Tacky dip flux" },
      { name: "Flux Film Thickness (Screed Depth)", target: "7 µm", tolerance: "± 1 µm" },
      { name: "Dip Depth into Flux", target: "5 µm", tolerance: "Controls bump coverage" },
      { name: "Dip Dwell Time", target: "200 ms", tolerance: "Ensures full wet-out" }
    ],
    description: "The head lowers the die a controlled depth into the flux film, dwells to fully wet every bump tip, then retracts at a controlled rate to avoid smearing. Too little flux risks poor wetting/voiding; too much risks bridging or contamination.",
    sideNote: "Die dipping into flux film",
    topNote: "Flux dip in progress",
    commentary: "Dipping bumps into flux. Dwell 200 milliseconds. All bump tips wetted."
  },
  {
    id: 11,
    phase: "PHASE 4 · OPTICS ALIGN",
    title: "Move to Bond Site",
    duration: 1500,
    parameters: [
      { name: "Travel Speed to Bond Site", target: "400 – 600 mm/s", tolerance: "Coarse motion" },
      { name: "Pre-Alignment Position Accuracy", target: "≤ ± 5 µm", tolerance: "Coarse placement above pads" },
      { name: "Standoff Height Above Substrate", target: "1 – 3 mm", tolerance: "Clearance for optics insertion" }
    ],
    description: "The head carries the fluxed die to the target bond site using substrate fiducial data, stopping at a standoff height that leaves clearance for the dual-FOV optics assembly to insert next.",
    sideNote: "Die traveling to bond site",
    topNote: "Moving to target bond location",
    commentary: "Traveling to bond site. Fiducial data loaded. Positioned above substrate."
  },
  {
    id: 12,
    phase: "PHASE 4 · OPTICS ALIGN",
    title: "Dual-FOV Optics Alignment",
    duration: 2000,
    parameters: [
      { name: "Alignment Target Precision", target: "≤ ± 1.5 µm", tolerance: "@ 3σ" },
      { name: "Optical Illumination", target: "Coaxial LED, dual wavelength", tolerance: "Red/Blue" },
      { name: "Camera Retract Clearance Gap", target: "> 10 mm", tolerance: "Before Z-descent" },
      { name: "Alignment Cycle Time", target: "150 – 300 ms", tolerance: "Split-field capture" }
    ],
    description: "A split-field dual-FOV optics assembly slides into the gap between die and substrate; the look-up camera images the die's bumps while the look-down camera images the substrate's pads/fiducials in one frame, computing X/Y/theta correction. It then retracts fully clear before the reflow heat pulse.",
    sideNote: "Dual-FOV optics aligning die to pads",
    topNote: "Alignment cameras active",
    commentary: "Dual field-of-view alignment in progress. Look-up and look-down cameras capturing. Correction computed to 1.5 microns."
  },
  {
    id: 13,
    phase: "PHASE 5 · TCB CYCLE",
    title: "Touchdown / Pre-Heat",
    sub: "A: Touchdown 120→160°C, 100ms · B: Pre-heat 160→220°C, force→45N, 300ms",
    duration: 2000,
    parameters: [
      { name: "Touchdown Temperature Ramp", target: "120 °C → 160 °C", tolerance: "Sub-phase A" },
      { name: "Touchdown Detection Force", target: "2.0 N", tolerance: "First-contact sensing" },
      { name: "Touchdown Duration", target: "100 ms", tolerance: "Sub-phase A" },
      { name: "Preheat Temperature Ramp", target: "160 °C → 220 °C", tolerance: "Sub-phase B, 300 ms" },
      { name: "Preheat Force Ramp", target: "up to 45.0 N", tolerance: "Sub-phase B" }
    ],
    description: "The head descends, decelerating to detect the small force rise signaling first contact, then ramps both temperature (toward 220 °C) and force (toward full bond load) together — staged contact before the aggressive peak-reflow heat, preventing bump crushing or tombstoning.",
    sideNote: "Touchdown detected, temp+force ramping",
    topNote: "Pre-heat phase active",
    commentary: "Touchdown detected at 2 newtons. Temperature ramping to 220 celsius. Force ramping to 45 newtons."
  },
  {
    id: 14,
    phase: "PHASE 5 · TCB CYCLE",
    title: "Peak Reflow Pulse",
    duration: 2500,
    parameters: [
      { name: "Peak Reflow Temperature", target: "285 °C", tolerance: "Ramped at 150 °C/s" },
      { name: "Peak Reflow Temperature Range (typ.)", target: "260 – 300 °C", tolerance: "Alloy-dependent" },
      { name: "Hold Force", target: "45.0 N", tolerance: "Dynamic Z control ± 0.5 µm" },
      { name: "Peak Reflow Duration", target: "1.5 s", tolerance: "Above solder liquidus" }
    ],
    description: "The pulse heater drives bond-line temperature up over 100 °C/s past the solder's melting point, reflowing the Sn-Ag caps. The head switches to dynamic Z (height) control to hold uniform bond-line thickness and prevent squeeze-out/bridging while IMC forms at each joint.",
    sideNote: "Peak reflow at 285°C, solder melting",
    topNote: "Reflow pulse active - 285°C",
    commentary: "Peak reflow pulse. Temperature 285 celsius. Solder liquidus exceeded. Intermetallic compound forming."
  },
  {
    id: 15,
    phase: "PHASE 5 · TCB CYCLE",
    title: "Cool Down",
    duration: 2000,
    parameters: [
      { name: "Cooling Ramp Rate", target: "100 °C/s", tolerance: "Active N₂ gas jet cooling" },
      { name: "Target Temperature Before Release", target: "< 180 °C", tolerance: "Below solder solidus" },
      { name: "Force Maintained During Cooling", target: "45.0 N", tolerance: "Prevents joint disturbance" },
      { name: "Cooldown Duration", target: "1.2 s", tolerance: "Rapid solidification" }
    ],
    description: "High-pressure N₂ gas jets quench the joint below solidus in ~1 second while force is held steady throughout — releasing early would allow void formation or joint movement before solidification.",
    sideNote: "N₂ cooling jets active, force held",
    topNote: "Cool-down in progress",
    commentary: "Nitrogen cooling jets active. Temperature dropping at 100 celsius per second. Force maintained at 45 newtons."
  },
  {
    id: 16,
    phase: "PHASE 6 · RELEASE",
    title: "Release & Retract",
    duration: 1000,
    parameters: [
      { name: "Vacuum Purge Pulse", target: "+10 kPa", tolerance: "50 ms positive N₂ pulse" },
      { name: "Initial Slow Lift", target: "1 mm @ 2 mm/s", tolerance: "Prevents joint shock" },
      { name: "Z-Axis Retraction Speed", target: "50 mm/s", tolerance: "After slow-lift zone" }
    ],
    description: "A brief positive N₂ pulse positively releases the die (rather than relying on vacuum decay). The head lifts in two stages — a short slow lift to confirm clean separation, then a fast retract to standby.",
    sideNote: "N₂ release pulse, slow lift, retract",
    topNote: "Die released, bond head retracting",
    commentary: "Vacuum released with nitrogen pulse. Slow lift initiated. Die bonded successfully."
  },
  {
    id: 17,
    phase: "PHASE 6 · RELEASE",
    title: "Index to Next Site",
    duration: 1500,
    parameters: [
      { name: "Stage Index Move Type", target: "High-speed XY servo stage", tolerance: "Linear-motor driven" },
      { name: "Index Positioning Accuracy", target: "≤ ± 1 µm", tolerance: "Repeatable site-to-site" },
      { name: "Typical Cycle Time per Die", target: "3 – 5 s", tolerance: "Full pick-to-bond loop" },
      { name: "Throughput (UPH, typical)", target: "1,500 – 3,500 UPH", tolerance: "Process/die-size dependent" }
    ],
    description: "The stage translates to bring the next bond site under the head, using the substrate's fiducial map to maintain accuracy panel-wide. Once complete (or the substrate is fully populated and unloaded) the loop returns to wafer mapping/die ejection.",
    sideNote: "Stage indexing to next bond site",
    topNote: "Indexing to next die location",
    commentary: "Stage indexing to next site. Positioning accuracy maintained within 1 micron. Ready for next die."
  }
];
