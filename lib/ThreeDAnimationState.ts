/**
 * ThreeDAnimationState.ts
 * 
 * Central animation state machine for the Flip-Chip TCB 3D simulation.
 * Tracks all mechanical positions, temperatures, forces, and component states.
 * 
 * This is the AUTHORITATIVE source for animation state.
 * All Three.js transforms must derive from this state.
 * The state is deterministic and scrub-able.
 */

import * as THREE from 'three';

// ═══════════════════════════════════════════════════════════════
// ENUMS & TYPES
// ═══════════════════════════════════════════════════════════════

export enum DieOwner {
  WAFER = 'wafer',
  PICK_ARM = 'pick',
  PEDESTAL = 'pedestal',
  BONDHEAD = 'bondhead',
  SUBSTRATE = 'substrate',
}

export enum Station {
  HOME = 'HOME',
  PEDESTAL = 'PEDESTAL',
  FLUX = 'FLUX',
  BOND_SITE = 'BOND_SITE',
}

export enum CoolingMode {
  OFF = 'OFF',
  AIR = 'AIR',
  N2_BLAST = 'N2_BLAST',
}

export interface AnimationStateSnapshot {
  // ─────────────────── PROCESS CONTROL ───────────────
  currentStep: number;           // 1-17
  stepProgress: number;          // 0-1, local to current step
  isPlaying: boolean;
  globalElapsedTime: number;     // total ms since play start

  // ─────────────────── SUBSTRATE & STAGE ───────────────
  substratePosition: THREE.Vector3;
  substrateVacuumOn: boolean;
  stageTemperature: number;      // °C

  // ─────────────────── WAFER SCAN ───────────────
  scanProgress: number;          // 0-1

  // ─────────────────── EJECTOR PINS ───────────────
  ejectorStroke: number;         // 0-0.8mm

  // ─────────────────── PICK ARM ───────────────
  pickArmX: number;              // horizontal position
  pickArmZ: number;              // vertical position (>0 = raised)
  pickArmVacuumOn: boolean;
  pickArmGripForce: number;      // Newtons

  // ─────────────────── DIE OWNERSHIP & POSITION ───────────────
  dieOwner: DieOwner;
  dieWorldPosition: THREE.Vector3;
  dieWorldRotation: THREE.Quaternion;
  dieLocalPosition?: THREE.Vector3;  // when attached to a parent

  // ─────────────────── PEDESTAL ───────────────
  pedestalRotation: number;      // degrees, 0-180
  pedestalVacuumOn: boolean;

  // ─────────────────── BONDHEAD ───────────────
  bondHeadX: number;             // horizontal X position
  bondHeadZ: number;             // vertical Z position (height)
  bondHeadTemperature: number;   // °C
  bondHeadForce: number;         // Newtons (0-45 typical)
  bondHeadVacuumOn: boolean;
  bondHeadCurrentStation: Station;

  // ─────────────────── FLUX DIP ───────────────
  fluxDipDepth: number;          // 0-5 µm (may be scaled for visualization)
  fluxPlateRotation: number;     // degrees

  // ─────────────────── OPTICS ───────────────
  opticsPosition: number;        // 0 = parked, 1 = inserted into gap
  opticsActive: boolean;
  alignmentErrorX: number;       // µm
  alignmentErrorY: number;       // µm
  alignmentErrorTheta: number;   // degrees
  opticsLocked: boolean;

  // ─────────────────── COOLING ───────────────
  coolingMode: CoolingMode;
  coolingIntensity: number;      // 0-1

  // ─────────────────── RELEASE & QC ───────────────
  releasePulseActive: boolean;
  qcPassed: boolean;
  qcStatus: string;              // 'PENDING' | 'PASS' | 'FAIL'

  // ─────────────────── INTERNAL STATE ───────────────
  lastUpdateTime?: number;       // for delta-time calculations
}

// ═══════════════════════════════════════════════════════════════
// ANIMATION STATE CLASS
// ═══════════════════════════════════════════════════════════════

export class ThreeDAnimationState {
  private state: AnimationStateSnapshot;
  private stepStartTime: number = 0;
  private processStartTime: number = 0;

  // Step duration configurations (in milliseconds)
  private readonly STEP_DURATIONS: Record<number, number> = {
    1: 2200,   // Substrate Loading
    2: 3000,   // Wafer Fiducial Scan
    3: 1500,   // Die Ejection
    4: 2000,   // Pick & Lift
    5: 1800,   // Transfer to Pedestal
    6: 1000,   // 180° Flip
    7: 1200,   // Head → Pedestal
    8: 1500,   // Head Picks Die
    9: 1800,   // Move to Flux Plate
    10: 1200,  // Dip, Dwell & Retract (200ms dwell included)
    11: 1500,  // Move to Bond Site
    12: 2000,  // Dual-FOV Alignment
    13: 1800,  // Touchdown / Preheat
    14: 2000,  // Peak Reflow Pulse
    15: 1500,  // Cool Down
    16: 1500,  // Release & Retract
    17: 2000,  // Index to Next Site
  };

  constructor() {
    this.state = this.createInitialState();
  }

  /**
   * Create the initial/reset state of the machine
   */
  private createInitialState(): AnimationStateSnapshot {
    return {
      currentStep: 1,
      stepProgress: 0,
      isPlaying: false,
      globalElapsedTime: 0,

      substratePosition: new THREE.Vector3(0, 0, 0),
      substrateVacuumOn: false,
      stageTemperature: 25,

      scanProgress: 0,

      ejectorStroke: 0,

      pickArmX: 0,
      pickArmZ: 0,
      pickArmVacuumOn: false,
      pickArmGripForce: 0,

      dieOwner: DieOwner.WAFER,
      dieWorldPosition: new THREE.Vector3(0, 0.01, 0),
      dieWorldRotation: new THREE.Quaternion(),

      pedestalRotation: 0,
      pedestalVacuumOn: false,

      bondHeadX: 0,
      bondHeadZ: 0,
      bondHeadTemperature: 25,
      bondHeadForce: 0,
      bondHeadVacuumOn: false,
      bondHeadCurrentStation: Station.HOME,

      fluxDipDepth: 0,
      fluxPlateRotation: 0,

      opticsPosition: 0,
      opticsActive: false,
      alignmentErrorX: 12,    // initial error µm
      alignmentErrorY: -8,
      alignmentErrorTheta: 0.12,
      opticsLocked: false,

      coolingMode: CoolingMode.OFF,
      coolingIntensity: 0,

      releasePulseActive: false,
      qcPassed: false,
      qcStatus: 'PENDING',
    };
  }

  /**
   * Get a snapshot of the current state
   */
  getState(): AnimationStateSnapshot {
    return { ...this.state };
  }

  /**
   * Update state based on current step and progress
   * Called once per frame during animation
   */
  updateState(stepIndex: number, stepProgress: number, deltaTime: number): void {
    // Clamp values
    stepProgress = Math.max(0, Math.min(1, stepProgress));

    // Update basic properties
    this.state.currentStep = stepIndex;
    this.state.stepProgress = stepProgress;
    this.state.lastUpdateTime = performance.now();

    // Apply step-specific animations
    this.animateStep(stepIndex, stepProgress, deltaTime);
  }

  /**
   * Process-specific animation for each of the 17 steps
   */
  private animateStep(step: number, progress: number, deltaTime: number): void {
    switch (step) {
      case 1: this.animateStep1(progress); break;  // Substrate Loading
      case 2: this.animateStep2(progress); break;  // Wafer Scan
      case 3: this.animateStep3(progress); break;  // Die Ejection
      case 4: this.animateStep4(progress); break;  // Pick & Lift
      case 5: this.animateStep5(progress); break;  // Transfer to Pedestal
      case 6: this.animateStep6(progress); break;  // 180° Flip
      case 7: this.animateStep7(progress); break;  // Head → Pedestal
      case 8: this.animateStep8(progress); break;  // Head Picks Die
      case 9: this.animateStep9(progress); break;  // Move to Flux
      case 10: this.animateStep10(progress); break; // Dip, Dwell & Retract
      case 11: this.animateStep11(progress); break; // Move to Bond Site
      case 12: this.animateStep12(progress); break; // Dual-FOV Alignment
      case 13: this.animateStep13(progress); break; // Touchdown
      case 14: this.animateStep14(progress); break; // Peak Reflow Pulse
      case 15: this.animateStep15(progress); break; // Cool Down
      case 16: this.animateStep16(progress); break; // Release & Retract
      case 17: this.animateStep17(progress); break; // Index to Next Site
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 1: WAFER PREP
  // ═══════════════════════════════════════════════════════════════

  private animateStep1(progress: number): void {
    // Substrate Loading
    // Substrate enters stage, vacuum engages, heats to 80°C
    
    this.state.substratePosition.y = this.easeInOutCubic(progress) * 0.02;
    this.state.substrateVacuumOn = progress > 0.3;
    this.state.stageTemperature = 25 + progress * (80 - 25);
  }

  private animateStep2(progress: number): void {
    // Wafer Fiducial Scan
    // Scan head/laser sweeps across wafer
    
    this.state.scanProgress = this.easeInOutQuad(progress);
    this.state.stageTemperature = 80; // maintain
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2: PICK & FLIP
  // ═══════════════════════════════════════════════════════════════

  private animateStep3(progress: number): void {
    // Die Ejection
    // Ejector pins rise 0.8mm
    
    this.state.ejectorStroke = this.easeInOutQuad(progress) * 0.8;
  }

  private animateStep4(progress: number): void {
    // Pick & Lift
    // Collet descends, engages vacuum, lifts die
    
    if (progress < 0.3) {
      // Collet descends
      this.state.pickArmZ = -this.easeInOutQuad(progress / 0.3) * 0.02;
    } else if (progress < 0.4) {
      // Vacuum engages
      this.state.pickArmVacuumOn = true;
      this.state.pickArmGripForce = (progress - 0.3) / 0.1 * 3.5;
      this.state.dieOwner = DieOwner.PICK_ARM;
    } else {
      // Lift
      this.state.pickArmZ = -0.02 + this.easeInOutQuad((progress - 0.4) / 0.6) * 0.022;
      this.state.pickArmVacuumOn = true;
      this.state.pickArmGripForce = 3.5;
    }
  }

  private animateStep5(progress: number): void {
    // Transfer to Pedestal
    // Pick arm moves horizontally
    
    const targetX = -0.3; // pedestal position
    this.state.pickArmX = this.easeInOutCubic(progress) * targetX;
  }

  private animateStep6(progress: number): void {
    // 180° Flip
    // Pedestal rotates with die
    
    this.state.pedestalRotation = this.easeInOutCubic(progress) * 180;
    this.state.pedestalVacuumOn = true;
  }

  private animateStep7(progress: number): void {
    // Head → Pedestal
    // Bonding head moves to pedestal
    
    const targetX = -0.3;
    this.state.bondHeadX = this.easeInOutCubic(progress) * targetX;
    this.state.bondHeadTemperature = 25 + progress * (150 - 25);
  }

  private animateStep8(progress: number): void {
    // Head Picks Die
    // Head descends, vacuum engages, lifts
    
    if (progress < 0.3) {
      // Descend
      this.state.bondHeadZ = -this.easeInOutQuad(progress / 0.3) * 0.025;
    } else if (progress < 0.4) {
      // Vacuum engages
      this.state.bondHeadVacuumOn = true;
      this.state.dieOwner = DieOwner.BONDHEAD;
      this.state.pedestalVacuumOn = false;
    } else {
      // Lift
      this.state.bondHeadZ = -0.025 + this.easeInOutQuad((progress - 0.4) / 0.6) * 0.025;
    }

    this.state.bondHeadTemperature = 150; // maintain
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3: DIP FLUX
  // ═══════════════════════════════════════════════════════════════

  private animateStep9(progress: number): void {
    // Move to Flux Plate
    const targetX = 0.3;
    this.state.bondHeadX = -0.3 + this.easeInOutCubic(progress) * (targetX + 0.3);
    this.state.bondHeadTemperature = 150;
  }

  private animateStep10(progress: number): void {
    // Dip, Dwell & Retract
    // 5µm dip, 200ms dwell, retract
    
    if (progress < 0.3) {
      // Descend into flux
      this.state.fluxDipDepth = this.easeInOutQuad(progress / 0.3) * 5;
      this.state.bondHeadZ = this.easeInOutQuad(progress / 0.3) * -0.005;
    } else if (progress < 0.6) {
      // Dwell
      this.state.fluxDipDepth = 5;
      this.state.bondHeadZ = -0.005;
    } else {
      // Retract
      const retractProg = (progress - 0.6) / 0.4;
      this.state.fluxDipDepth = 5 * (1 - this.easeInOutQuad(retractProg));
      this.state.bondHeadZ = -0.005 * (1 - this.easeInOutQuad(retractProg));
    }

    this.state.bondHeadTemperature = 150;
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 4: OPTICS ALIGN
  // ═══════════════════════════════════════════════════════════════

  private animateStep11(progress: number): void {
    // Move to Bond Site
    const targetX = -0.1;
    this.state.bondHeadX = 0.3 + this.easeInOutCubic(progress) * (targetX - 0.3);
    this.state.bondHeadTemperature = 150;
  }

  private animateStep12(progress: number): void {
    // Dual-FOV Alignment
    // Optics enter, align, then retract before touchdown
    
    if (progress < 0.2) {
      // Optics insert
      this.state.opticsPosition = this.easeInOutQuad(progress / 0.2);
      this.state.opticsActive = true;
    } else if (progress < 0.8) {
      // Alignment convergence
      const alignProg = (progress - 0.2) / 0.6;
      this.state.alignmentErrorX = 12 * (1 - this.easeInOutCubic(alignProg));
      this.state.alignmentErrorY = -8 * (1 - this.easeInOutCubic(alignProg));
      this.state.alignmentErrorTheta = 0.12 * (1 - this.easeInOutCubic(alignProg));
      this.state.opticsPosition = 1.0;
    } else {
      // Optics retract before touchdown
      this.state.opticsPosition = 1.0 - this.easeInOutQuad((progress - 0.8) / 0.2);
      if (progress > 0.9) {
        this.state.opticsActive = false;
        this.state.opticsLocked = true;
      }
    }

    this.state.bondHeadTemperature = 150;
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 5: TCB CYCLE
  // ═══════════════════════════════════════════════════════════════

  private animateStep13(progress: number): void {
    // Touchdown / Preheat
    // Head descends, force ramps to 45N
    
    this.state.bondHeadZ = -this.easeInOutQuad(progress) * 0.04;
    this.state.bondHeadForce = this.easeInOutQuad(progress) * 45;
    this.state.bondHeadTemperature = 150;
  }

  private animateStep14(progress: number): void {
    // Peak Reflow Pulse
    // Temperature rises to 260°C
    
    this.state.bondHeadTemperature = 150 + this.easeInOutQuad(progress) * (260 - 150);
    this.state.bondHeadForce = 45; // maintain
    this.state.bondHeadZ = -0.04; // maintain
  }

  private animateStep15(progress: number): void {
    // Cool Down
    // Temperature drops, cooling gas ON
    
    this.state.bondHeadTemperature = 260 - this.easeInOutQuad(progress) * (260 - 190);
    this.state.coolingMode = CoolingMode.N2_BLAST;
    this.state.coolingIntensity = this.easeInOutQuad(progress);
    this.state.bondHeadForce = 45; // maintain
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 6: RELEASE
  // ═══════════════════════════════════════════════════════════════

  private animateStep16(progress: number): void {
    // Release & Retract
    // Vacuum releases, head retracts
    
    if (progress < 0.1) {
      this.state.releasePulseActive = true;
      this.state.bondHeadVacuumOn = false;
      this.state.dieOwner = DieOwner.SUBSTRATE; // Die now owned by substrate
    }

    this.state.bondHeadZ = -0.04 + this.easeInOutCubic((progress - 0.1) / 0.9) * 0.04;
    this.state.bondHeadForce = 45 * (1 - this.easeInOutQuad(progress));
    this.state.bondHeadTemperature = 190 - progress * (190 - 120);
    this.state.coolingMode = CoolingMode.OFF;
    this.state.coolingIntensity = 1 - this.easeInOutQuad(progress);
  }

  private animateStep17(progress: number): void {
    // Index to Next Site & QC
    // Substrate stages, head goes HOME
    
    this.state.bondHeadX = -0.1 + this.easeInOutCubic(progress) * 0.1;
    this.state.bondHeadZ = 0;
    this.state.bondHeadVacuumOn = false;
    this.state.releasePulseActive = false;

    // QC check at end
    if (progress > 0.5) {
      this.state.qcStatus = 'PASS';
      this.state.qcPassed = true;
    }

    this.state.bondHeadTemperature = 120 - progress * (120 - 25);
  }

  // ═══════════════════════════════════════════════════════════════
  // EASING FUNCTIONS (industrial motion profiles)
  // ═══════════════════════════════════════════════════════════════

  private easeLinear(t: number): number {
    return t;
  }

  private easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * (t - 2)) * (2 * (t - 2)) + 1;
  }

  private easeOutQuad(t: number): number {
    return 1 - (1 - t) * (1 - t);
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.state = this.createInitialState();
    this.stepStartTime = 0;
    this.processStartTime = 0;
  }

  /**
   * Get step duration in milliseconds
   */
  getStepDuration(step: number): number {
    return this.STEP_DURATIONS[step] || 2000;
  }
}
