// ─────────────────────────────────────────────
// TCB Process Steps + Component Info
// 300mm Flip Chip Thermo-Compression Bonder
// 17 steps across 6 phases
// ─────────────────────────────────────────────

export interface TcbSpec {
  label: string;
  value: string;
}

export interface TcbComponentInfo {
  section: string;
  hardware: string;
  process: string;
  specs: TcbSpec[];
}

export interface TcbStepData {
  id: number;
  phase: string;
  phaseIndex: number;
  title: string;
  temp: number;
  tempLabel: string;
  componentInfo: TcbComponentInfo;
}

// ── Phase definitions ──
export const TCB_PHASES = [
  { index: 1, label: "PHASE 1 · WAFER PREP",    steps: [1, 2] },
  { index: 2, label: "PHASE 2 · PICK & FLIP",   steps: [3, 4, 5, 6, 7, 8] },
  { index: 3, label: "PHASE 3 · DIP FLUX",      steps: [9, 10] },
  { index: 4, label: "PHASE 4 · OPTICS ALIGN",  steps: [11, 12] },
  { index: 5, label: "PHASE 5 · TCB CYCLE",     steps: [13, 14, 15] },
  { index: 6, label: "PHASE 6 · RELEASE",        steps: [16, 17] },
] as const;

// ── Temperature badge color helper ──
export function getTempColor(temp: number): string {
  if (temp <= 80) return "#7C8A9A";   // grey — idle / ambient
  if (temp <= 150) return "#E8A33D";  // amber — warm
  if (temp >= 260) return "#FF4B4B";  // red — peak reflow
  if (temp <= 200) return "#4FA8FF";  // blue — cooling
  return "#E8A33D";
}

// ── All 17 steps ──
export const TCB_STEPS: TcbStepData[] = [
  // ── PHASE 1 · WAFER PREP ──
  {
    id: 1,
    phase: "PHASE 1 · WAFER PREP",
    phaseIndex: 1,
    title: "Substrate Loading",
    temp: 80,
    tempLabel: "80°C",
    componentInfo: {
      section: "MAIN PROCESS TRACK",
      hardware: "Heated stage with ring vacuum chuck and −85 kPa vacuum line.",
      process: "Substrate glides onto the heated stage; vacuum engages to hold it flat.",
      specs: [
        { label: "Target Temp", value: "80°C" },
        { label: "Vacuum", value: "−85 kPa" },
        { label: "Time", value: "2.2s" },
      ],
    },
  },
  {
    id: 2,
    phase: "PHASE 1 · WAFER PREP",
    phaseIndex: 1,
    title: "Wafer Fiducial Scan",
    temp: 80,
    tempLabel: "80°C",
    componentInfo: {
      section: "MAIN PROCESS TRACK",
      hardware: "PRS (Pattern Recognition System) laser line scan camera.",
      process: "Scans the 300mm wafer surface to register fiducial marks and build a good-die map.",
      specs: [
        { label: "Target Temp", value: "80°C" },
        { label: "Scan Width", value: "300mm" },
        { label: "Speed", value: "Full sweep" },
      ],
    },
  },

  // ── PHASE 2 · PICK & FLIP ──
  {
    id: 3,
    phase: "PHASE 2 · PICK & FLIP",
    phaseIndex: 2,
    title: "Die Ejection",
    temp: 80,
    tempLabel: "80°C",
    componentInfo: {
      section: "PICK & FLIP MODULE",
      hardware: "4-pin ejector array beneath the dicing tape frame.",
      process: "Ejector pins rise 0.8mm at 15mm/s to break tape adhesion under the target die.",
      specs: [
        { label: "Target Temp", value: "80°C" },
        { label: "Stroke", value: "0.8mm" },
        { label: "Speed", value: "15mm/s" },
      ],
    },
  },
  {
    id: 4,
    phase: "PHASE 2 · PICK & FLIP",
    phaseIndex: 2,
    title: "Pick & Lift",
    temp: 80,
    tempLabel: "80°C",
    componentInfo: {
      section: "PICK & FLIP MODULE",
      hardware: "Pick & place collet arm with vacuum gripper.",
      process: "Collet lowers, engages −85 kPa vacuum, applies 3.5N pick force, lifts die clear of tape.",
      specs: [
        { label: "Target Temp", value: "80°C" },
        { label: "Vacuum", value: "−85 kPa" },
        { label: "Pick Force", value: "3.5N" },
        { label: "Lift", value: "+2.0mm" },
      ],
    },
  },
  {
    id: 5,
    phase: "PHASE 2 · PICK & FLIP",
    phaseIndex: 2,
    title: "Transfer to Pedestal",
    temp: 80,
    tempLabel: "80°C",
    componentInfo: {
      section: "PICK & FLIP MODULE",
      hardware: "Pick & place arm — horizontal linear drive.",
      process: "Arm carries die sideways from wafer station and centers it over the Ring Vacuum Pedestal axis.",
      specs: [
        { label: "Target Temp", value: "80°C" },
        { label: "Travel", value: "Wafer → Pedestal" },
        { label: "Bumps", value: "Facing up" },
      ],
    },
  },
  {
    id: 6,
    phase: "PHASE 2 · PICK & FLIP",
    phaseIndex: 2,
    title: "180° Flip",
    temp: 80,
    tempLabel: "80°C",
    componentInfo: {
      section: "PICK & FLIP MODULE",
      hardware: "Ring Vacuum Pedestal — rotary drive at 720°/s.",
      process: "Pedestal rotates 180°, inverting the die so Cu pillar / Sn-Ag bump caps face downward.",
      specs: [
        { label: "Target Temp", value: "80°C" },
        { label: "Rotation", value: "180°" },
        { label: "Speed", value: "720°/s" },
      ],
    },
  },
  {
    id: 7,
    phase: "PHASE 2 · PICK & FLIP",
    phaseIndex: 2,
    title: "Head → Pedestal",
    temp: 80,
    tempLabel: "80°C",
    componentInfo: {
      section: "PICK & FLIP MODULE",
      hardware: "TCB bonding head — linear X-axis drive.",
      process: "Bonding head travels left from its home position to align directly over the flipped pedestal.",
      specs: [
        { label: "Target Temp", value: "80°C" },
        { label: "Travel", value: "Home → Pedestal axis" },
      ],
    },
  },
  {
    id: 8,
    phase: "PHASE 2 · PICK & FLIP",
    phaseIndex: 2,
    title: "Head Picks Die",
    temp: 150,
    tempLabel: "150°C",
    componentInfo: {
      section: "PICK & FLIP MODULE",
      hardware: "TCB bonding head with internal heater and vacuum chuck.",
      process: "Head descends onto the flipped die, engages vacuum, heats to 150°C, lifts die away from pedestal.",
      specs: [
        { label: "Target Temp", value: "150°C" },
        { label: "Gap", value: "50µm → contact" },
        { label: "Pedestal Vac", value: "OFF on pickup" },
      ],
    },
  },

  // ── PHASE 3 · DIP FLUX ──
  {
    id: 9,
    phase: "PHASE 3 · DIP FLUX",
    phaseIndex: 3,
    title: "Move to Flux Plate",
    temp: 150,
    tempLabel: "150°C",
    componentInfo: {
      section: "DIP FLUX MODULE",
      hardware: "TCB bonding head — X-axis traverse to flux station.",
      process: "Head lifts clear of pedestal and travels right to position die over the rotating flux film plate.",
      specs: [
        { label: "Target Temp", value: "150°C" },
        { label: "Travel", value: "Pedestal → Flux plate" },
      ],
    },
  },
  {
    id: 10,
    phase: "PHASE 3 · DIP FLUX",
    phaseIndex: 3,
    title: "Dip, Dwell & Retract",
    temp: 150,
    tempLabel: "150°C",
    componentInfo: {
      section: "DIP FLUX MODULE",
      hardware: "Rotating flux film plate (7µm film thickness).",
      process: "Bumps dip 5µm into flux film, dwell 200ms, retract — thin wetting layer forms on bump tips.",
      specs: [
        { label: "Target Temp", value: "150°C" },
        { label: "Dip Depth", value: "5µm" },
        { label: "Film", value: "7µm" },
        { label: "Dwell", value: "200ms" },
      ],
    },
  },

  // ── PHASE 4 · OPTICS ALIGN ──
  {
    id: 11,
    phase: "PHASE 4 · OPTICS ALIGN",
    phaseIndex: 4,
    title: "Move to Bond Site",
    temp: 150,
    tempLabel: "150°C",
    componentInfo: {
      section: "OPTICS ALIGN MODULE",
      hardware: "TCB bonding head — X-axis traverse to substrate station.",
      process: "Head positions directly above the target substrate pad site for alignment.",
      specs: [
        { label: "Target Temp", value: "150°C" },
        { label: "Target", value: "Bond site #14" },
      ],
    },
  },
  {
    id: 12,
    phase: "PHASE 4 · OPTICS ALIGN",
    phaseIndex: 4,
    title: "Dual-FOV Align",
    temp: 150,
    tempLabel: "150°C",
    componentInfo: {
      section: "OPTICS ALIGN MODULE",
      hardware: "Split-field dual FOV optics arm — look-up (cyan) and look-down (magenta) beams.",
      process: "Optics arm slides into the die/substrate gap; dual beams fire for sub-micron ΔX/ΔY/Δθ registration.",
      specs: [
        { label: "Target Temp", value: "150°C" },
        { label: "Clearance", value: ">10mm" },
        { label: "Accuracy", value: "ΔX:+0.2µm ΔY:−0.1µm Δθ:0.01°" },
      ],
    },
  },

  // ── PHASE 5 · TCB CYCLE ──
  {
    id: 13,
    phase: "PHASE 5 · TCB CYCLE",
    phaseIndex: 5,
    title: "Touchdown / Preheat",
    temp: 150,
    tempLabel: "150°C",
    componentInfo: {
      section: "TCB CYCLE MODULE",
      hardware: "TCB bonding head — Z-axis descent with force sense.",
      process: "Optics arm retracts; head descends to touchdown, senses 2N contact, ramps force to 45N at 150°C.",
      specs: [
        { label: "Target Temp", value: "150°C" },
        { label: "Touch Force", value: "2.0N" },
        { label: "Bond Force", value: "45.0N" },
        { label: "Z-Position", value: "Touchdown → held" },
      ],
    },
  },
  {
    id: 14,
    phase: "PHASE 5 · TCB CYCLE",
    phaseIndex: 5,
    title: "Peak Reflow Pulse",
    temp: 260,
    tempLabel: "260°C",
    componentInfo: {
      section: "TCB CYCLE MODULE",
      hardware: "TCB bonding head internal resistance heater.",
      process: "Temperature ramps 100–200°C/s, crosses 217°C solder melt point — bump tip liquefies, IMC bond forms.",
      specs: [
        { label: "Target Temp", value: "260°C" },
        { label: "Ramp", value: "100–200°C/s" },
        { label: "Solder Melt", value: "217°C" },
        { label: "Force", value: "45N held" },
      ],
    },
  },
  {
    id: 15,
    phase: "PHASE 5 · TCB CYCLE",
    phaseIndex: 5,
    title: "Cool Down",
    temp: 190,
    tempLabel: "190°C",
    componentInfo: {
      section: "TCB CYCLE MODULE",
      hardware: "TCB bonding head — internal cooling channel + N₂ gas blast nozzles.",
      process: "Heater cuts out; cooling air quenches joint below 217°C solidification point, locking IMC bond solid.",
      specs: [
        { label: "Target Temp", value: "190°C" },
        { label: "Cooling", value: "Air blast + N₂" },
        { label: "Force", value: "45N held" },
        { label: "Joint", value: "Solidified" },
      ],
    },
  },

  // ── PHASE 6 · RELEASE ──
  {
    id: 16,
    phase: "PHASE 6 · RELEASE",
    phaseIndex: 6,
    title: "Release & Retract",
    temp: 120,
    tempLabel: "120°C",
    componentInfo: {
      section: "RELEASE MODULE",
      hardware: "TCB bonding head — positive pressure vacuum release + Z retract drive.",
      process: "+10 kPa purge pulse releases die instantly; head retracts at 50mm/s — bond stays on substrate.",
      specs: [
        { label: "Target Temp", value: "120°C" },
        { label: "Release Pulse", value: "+10 kPa" },
        { label: "Retract Speed", value: "50mm/s" },
        { label: "Force", value: "→ 0N" },
      ],
    },
  },
  {
    id: 17,
    phase: "PHASE 6 · RELEASE",
    phaseIndex: 6,
    title: "Index to Next Site",
    temp: 120,
    tempLabel: "120°C",
    componentInfo: {
      section: "RELEASE MODULE",
      hardware: "Substrate stage X/Y drive + bonding head home drive.",
      process: "Stage indexes to next die site; bonding head returns home; QC gate inspects completed bond.",
      specs: [
        { label: "Target Temp", value: "120°C" },
        { label: "QC", value: "BLT 15µm · 0% Bridging · Voiding <5%" },
        { label: "Status", value: "PASS" },
      ],
    },
  },
];
