/**
 * StateReconstructor.ts
 * 
 * Deterministically reconstructs animation state at any timeline position.
 * Enables scrubbing, step back, step forward, and pause/resume functionality.
 * 
 * CRITICAL: State must be reconstructible from (stepIndex, progress) alone.
 */

import * as THREE from 'three';
import { ThreeDAnimationState, AnimationStateSnapshot, DieOwner } from './ThreeDAnimationState';
import MachineCalibration from './MachineCalibration';

// ═══════════════════════════════════════════════════════════════
// STATE RECONSTRUCTOR
// ═══════════════════════════════════════════════════════════════

export class StateReconstructor {
  /**
   * Reconstruct complete animation state at any step and progress
   * 
   * @param stepIndex - 1-17 (current process step)
   * @param stepProgress - 0-1 (progress within current step)
   * @returns Complete animation state snapshot
   */
  static reconstructState(stepIndex: number, stepProgress: number): AnimationStateSnapshot {
    // Clamp step and progress
    stepIndex = Math.max(1, Math.min(17, stepIndex));
    stepProgress = Math.max(0, Math.min(1, stepProgress));

    // Determine what phases have been completed
    const completedSteps = stepIndex - 1;

    // Create state snapshot
    const state: AnimationStateSnapshot = {
      currentStep: stepIndex,
      stepProgress: stepProgress,
      isPlaying: false,
      globalElapsedTime: 0,

      substratePosition: new THREE.Vector3(0, 0, 0),
      substrateVacuumOn: stepIndex >= 1 && stepProgress > 0.3,
      stageTemperature: this.getStageTemperature(stepIndex, stepProgress),

      scanProgress: stepIndex === 2 ? stepProgress : stepIndex > 2 ? 1 : 0,

      ejectorStroke: stepIndex === 3 ? stepProgress * 0.8 : stepIndex > 3 ? 0 : 0,

      pickArmX: this.getPickArmX(stepIndex, stepProgress),
      pickArmZ: this.getPickArmZ(stepIndex, stepProgress),
      pickArmVacuumOn: this.isPickVacuumOn(stepIndex, stepProgress),
      pickArmGripForce: this.getPickGripForce(stepIndex, stepProgress),

      dieOwner: this.getDieOwner(stepIndex, stepProgress),
      dieWorldPosition: this.getDiePosition(stepIndex, stepProgress),
      dieWorldRotation: this.getDieRotation(stepIndex, stepProgress),

      pedestalRotation: this.getPedestalRotation(stepIndex, stepProgress),
      pedestalVacuumOn: stepIndex >= 5 && stepIndex <= 8,

      bondHeadX: this.getBondHeadX(stepIndex, stepProgress),
      bondHeadZ: this.getBondHeadZ(stepIndex, stepProgress),
      bondHeadTemperature: this.getBondHeadTemperature(stepIndex, stepProgress),
      bondHeadForce: this.getBondHeadForce(stepIndex, stepProgress),
      bondHeadVacuumOn: this.isBondHeadVacuumOn(stepIndex, stepProgress),
      bondHeadCurrentStation: this.getBondHeadStation(stepIndex),

      fluxDipDepth: this.getFluxDipDepth(stepIndex, stepProgress),
      fluxPlateRotation: this.getFluxPlateRotation(stepIndex, stepProgress),

      opticsPosition: this.getOpticsPosition(stepIndex, stepProgress),
      opticsActive: stepIndex === 12 && stepProgress > 0.2 && stepProgress < 0.8,
      alignmentErrorX: this.getAlignmentErrorX(stepIndex, stepProgress),
      alignmentErrorY: this.getAlignmentErrorY(stepIndex, stepProgress),
      alignmentErrorTheta: this.getAlignmentErrorTheta(stepIndex, stepProgress),
      opticsLocked: stepIndex > 12,

      coolingMode: this.getCoolingMode(stepIndex, stepProgress),
      coolingIntensity: this.getCoolingIntensity(stepIndex, stepProgress),

      releasePulseActive: stepIndex === 16 && stepProgress < 0.1,
      qcPassed: stepIndex > 17 || (stepIndex === 17 && stepProgress > 0.5),
      qcStatus: stepIndex > 17 ? 'PASS' : stepIndex === 17 && stepProgress > 0.5 ? 'PASS' : 'PENDING',
    };

    return state;
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * STAGE & TEMPERATURE HELPERS
   * ─────────────────────────────────────────────────────────────
   */

  private static getStageTemperature(step: number, progress: number): number {
    if (step === 1) {
      return 25 + progress * (80 - 25); // 25 → 80°C
    }
    if (step >= 2 && step <= 8) return 80; // Hold at 80°C
    if (step === 9 || step === 10) return 80; // Flux at 80°C (body temp)
    if (step >= 11) return 80;
    return 25;
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * PICK ARM HELPERS
   * ─────────────────────────────────────────────────────────────
   */

  private static getPickArmX(step: number, progress: number): number {
    if (step === 4) {
      return 0; // At wafer
    }
    if (step === 5) {
      return this.easeInOutCubic(progress) * -0.3; // Move to pedestal
    }
    if (step >= 6) return -0.3; // At pedestal (then retracted)
    return 0;
  }

  private static getPickArmZ(step: number, progress: number): number {
    if (step === 4) {
      if (progress < 0.3) {
        return -this.easeInOutQuad(progress / 0.3) * 0.02; // Descend
      } else if (progress < 0.4) {
        return -0.02; // Hold at contact
      } else {
        return -0.02 + this.easeInOutQuad((progress - 0.4) / 0.6) * 0.022; // Lift
      }
    }
    if (step >= 5) return 0.022; // Lifted position
    return 0;
  }

  private static isPickVacuumOn(step: number, progress: number): boolean {
    if (step === 4 && progress > 0.3) return true;
    if (step >= 5 && step <= 7) return true;
    return false;
  }

  private static getPickGripForce(step: number, progress: number): number {
    if (step === 4 && progress >= 0.3 && progress <= 0.4) {
      return ((progress - 0.3) / 0.1) * 3.5;
    }
    if (step > 4 && step <= 7) return 3.5;
    return 0;
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * DIE OWNERSHIP & POSITION
   * ─────────────────────────────────────────────────────────────
   */

  private static getDieOwner(step: number, progress: number): DieOwner {
    if (step <= 3) return DieOwner.WAFER;
    if (step >= 4 && step <= 7) return DieOwner.PICK_ARM;
    if (step >= 8 && step <= 15) return DieOwner.BONDHEAD;
    if (step >= 16) return DieOwner.SUBSTRATE;
    return DieOwner.WAFER;
  }

  private static getDiePosition(step: number, progress: number): THREE.Vector3 {
    const owner = this.getDieOwner(step, progress);

    // Die position depends on who owns it
    // These are world-space positions
    switch (owner) {
      case DieOwner.WAFER:
        return new THREE.Vector3(0, 0.01, 0); // On wafer stage

      case DieOwner.PICK_ARM:
        return new THREE.Vector3(
          this.getPickArmX(step, progress),
          0.06,
          this.getPickArmZ(step, progress)
        );

      case DieOwner.PEDESTAL:
        return new THREE.Vector3(-0.3, 0.01, 0);

      case DieOwner.BONDHEAD:
        return new THREE.Vector3(
          this.getBondHeadX(step, progress),
          0.06,
          this.getBondHeadZ(step, progress)
        );

      case DieOwner.SUBSTRATE:
        return new THREE.Vector3(-0.1, 0.006, 0);

      default:
        return new THREE.Vector3(0, 0, 0);
    }
  }

  private static getDieRotation(step: number, progress: number): THREE.Quaternion {
    const rotation = new THREE.Quaternion();

    // Die starts with bumps facing up
    // After pedestal flip (step 6), rotates 180° around X or Z axis

    if (step >= 6 && step <= 8) {
      // During flip and after: bumps face down
      // Rotate 180° around Z axis
      const flipRotation = this.getPedestalRotation(step, progress);
      rotation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(flipRotation));
    }

    return rotation;
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * PEDESTAL & FLIP
   * ─────────────────────────────────────────────────────────────
   */

  private static getPedestalRotation(step: number, progress: number): number {
    if (step === 6) {
      return this.easeInOutCubic(progress) * 180; // 0 → 180°
    }
    if (step >= 7) return 180; // Stays at 180°
    return 0;
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * BONDING HEAD
   * ─────────────────────────────────────────────────────────────
   */

  private static getBondHeadX(step: number, progress: number): number {
    const homeX = MachineCalibration.BONDHEAD.HOME_X;
    const pedestalX = MachineCalibration.BONDHEAD.PEDESTAL_X;
    const fluxX = MachineCalibration.BONDHEAD.FLUX_X;
    const bondX = MachineCalibration.BONDHEAD.BOND_X;

    if (step >= 1 && step <= 6) return homeX; // At home
    if (step === 7) {
      return homeX + this.easeInOutCubic(progress) * (pedestalX - homeX);
    }
    if (step === 8) return pedestalX;
    if (step === 9) {
      return pedestalX + this.easeInOutCubic(progress) * (fluxX - pedestalX);
    }
    if (step === 10) return fluxX;
    if (step === 11) {
      return fluxX + this.easeInOutCubic(progress) * (bondX - fluxX);
    }
    if (step >= 12) return bondX;
    return homeX;
  }

  private static getBondHeadZ(step: number, progress: number): number {
    const homeZ = MachineCalibration.BONDHEAD.HOME_Z;

    if (step >= 1 && step <= 12) return 0; // At home height
    if (step === 13) {
      return -this.easeInOutQuad(progress) * 0.04; // Descend to touch
    }
    if (step >= 14 && step <= 15) return -0.04; // Hold contact
    if (step === 16) {
      return -0.04 + this.easeInOutCubic((progress - 0.1) / 0.9) * 0.04; // Retract after release
    }
    if (step >= 17) return 0; // Return home
    return 0;
  }

  private static getBondHeadTemperature(step: number, progress: number): number {
    if (step <= 6) return 25; // Ambient
    if (step >= 7 && step <= 8) return 25 + progress * (150 - 25); // Heat to 150°C
    if (step >= 9 && step <= 12) return 150; // Hold at 150°C
    if (step === 13) return 150; // Hold at 150°C
    if (step === 14) {
      return 150 + this.easeInOutQuad(progress) * (260 - 150); // 150 → 260°C
    }
    if (step === 15) {
      return 260 - this.easeInOutQuad(progress) * (260 - 190); // 260 → 190°C
    }
    if (step === 16) {
      return 190 - progress * (190 - 120); // 190 → 120°C
    }
    if (step >= 17) {
      return 120 - progress * (120 - 25); // 120 → 25°C
    }
    return 25;
  }

  private static getBondHeadForce(step: number, progress: number): number {
    if (step <= 12) return 0;
    if (step === 13) {
      return this.easeInOutQuad(progress) * 45; // 0 → 45N
    }
    if (step >= 14 && step <= 15) return 45; // Hold 45N
    if (step === 16) {
      return 45 * (1 - this.easeInOutQuad(progress)); // 45 → 0N
    }
    return 0;
  }

  private static isBondHeadVacuumOn(step: number, progress: number): boolean {
    if (step >= 8 && step < 16) return true;
    if (step === 16 && progress < 0.1) return true;
    return false;
  }

  private static getBondHeadStation(step: number): 'HOME' | 'PEDESTAL' | 'FLUX' | 'BOND_SITE' {
    if (step <= 6) return 'HOME';
    if (step === 7 || step === 8) return 'PEDESTAL';
    if (step === 9 || step === 10) return 'FLUX';
    if (step >= 11) return 'BOND_SITE';
    return 'HOME';
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * FLUX & OPTICS
   * ─────────────────────────────────────────────────────────────
   */

  private static getFluxDipDepth(step: number, progress: number): number {
    if (step === 10) {
      if (progress < 0.3) {
        return this.easeInOutQuad(progress / 0.3) * 5;
      } else if (progress < 0.6) {
        return 5;
      } else {
        return 5 * (1 - this.easeInOutQuad((progress - 0.6) / 0.4));
      }
    }
    return 0;
  }

  private static getFluxPlateRotation(step: number, progress: number): number {
    if (step === 10) {
      return progress * 360; // Continuous rotation during dip
    }
    return 0;
  }

  private static getOpticsPosition(step: number, progress: number): number {
    if (step === 12) {
      if (progress < 0.2) {
        return this.easeInOutQuad(progress / 0.2); // Insert
      } else if (progress < 0.8) {
        return 1.0; // Hold inserted
      } else {
        return 1.0 - this.easeInOutQuad((progress - 0.8) / 0.2); // Retract
      }
    }
    return 0;
  }

  private static getAlignmentErrorX(step: number, progress: number): number {
    if (step === 12 && progress > 0.2 && progress < 0.8) {
      const alignProg = (progress - 0.2) / 0.6;
      return 12 * (1 - this.easeInOutCubic(alignProg));
    }
    if (step > 12) return 0;
    if (step === 12 && progress < 0.2) return 12;
    return 12;
  }

  private static getAlignmentErrorY(step: number, progress: number): number {
    if (step === 12 && progress > 0.2 && progress < 0.8) {
      const alignProg = (progress - 0.2) / 0.6;
      return -8 * (1 - this.easeInOutCubic(alignProg));
    }
    if (step > 12) return 0;
    if (step === 12 && progress < 0.2) return -8;
    return -8;
  }

  private static getAlignmentErrorTheta(step: number, progress: number): number {
    if (step === 12 && progress > 0.2 && progress < 0.8) {
      const alignProg = (progress - 0.2) / 0.6;
      return 0.12 * (1 - this.easeInOutCubic(alignProg));
    }
    if (step > 12) return 0;
    if (step === 12 && progress < 0.2) return 0.12;
    return 0.12;
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * COOLING & RELEASE
   * ─────────────────────────────────────────────────────────────
   */

  private static getCoolingMode(step: number, progress: number): 'OFF' | 'AIR' | 'N2_BLAST' {
    if (step === 15) return 'N2_BLAST';
    if (step === 16 && progress < 0.5) return 'N2_BLAST';
    return 'OFF';
  }

  private static getCoolingIntensity(step: number, progress: number): number {
    if (step === 15) return this.easeInOutQuad(progress);
    if (step === 16 && progress < 0.5) return 1 - this.easeInOutQuad(progress / 0.5);
    return 0;
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * EASING FUNCTIONS
   * ─────────────────────────────────────────────────────────────
   */

  private static easeLinear(t: number): number {
    return t;
  }

  private static easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  private static easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * (t - 2)) * (2 * (t - 2)) + 1;
  }
}

export default StateReconstructor;
