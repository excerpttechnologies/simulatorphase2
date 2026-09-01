/**
 * MotionController.ts
 * 
 * Applies animation state to Three.js transforms.
 * Updates all mechanical component positions and rotations based on animation state.
 * This is the bridge between ThreeDAnimationState and the actual 3D scene.
 */

import * as THREE from 'three';
import { ThreeDAnimationState, AnimationStateSnapshot, DieOwner, Station } from './ThreeDAnimationState';
import { ModelRegistry } from './BlenderModelLoader';
import MachineCalibration from './MachineCalibration';

// ═══════════════════════════════════════════════════════════════
// MOTION CONTROLLER
// ═══════════════════════════════════════════════════════════════

export class MotionController {
  private state: ThreeDAnimationState;
  private registry: ModelRegistry;
  private currentSnapshot: AnimationStateSnapshot;

  constructor(state: ThreeDAnimationState, registry: ModelRegistry) {
    this.state = state;
    this.registry = registry;
    this.currentSnapshot = state.getState();
  }

  /**
   * Apply current animation state to all Three.js objects
   * Called once per frame
   */
  updateScene(): void {
    this.currentSnapshot = this.state.getState();

    // Update all mechanical components
    this.updateSubstrate();
    this.updateWaferStage();
    this.updatePickArm();
    this.updateEjectorPins();
    this.updatePedestal();
    this.updateBondingHead();
    this.updateFluxPlate();
    this.updateOptics();
    this.updateDie();

    // Update materials for thermal feedback
    this.updateThermalMaterials();
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * SUBSTRATE & STAGE
   * ─────────────────────────────────────────────────────────────
   */

  private updateSubstrate(): void {
    if (!this.registry.substrate) return;

    // Position substrate on stage
    const stagePos = MachineCalibration.STATIONS.WAFER_STAGE;
    this.registry.substrate.position.set(stagePos.x, stagePos.y + 0.01, stagePos.z);

    // Optional: Show vacuum indicator
    if (this.currentSnapshot.substrateVacuumOn) {
      // Could add visual feedback like a color change or glow
    }
  }

  private updateWaferStage(): void {
    if (!this.registry.waferStage) return;

    // Stage position (usually fixed)
    const stagePos = MachineCalibration.STATIONS.WAFER_STAGE;
    this.registry.waferStage.position.set(stagePos.x, stagePos.y, stagePos.z);

    // Update stage temperature (could affect material/emissive)
    // Temperature range: 25-80°C in PHASE 1
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * PICK ARM
   * ─────────────────────────────────────────────────────────────
   */

  private updatePickArm(): void {
    if (!this.registry.pickArm) return;

    const arm = this.registry.pickArm;

    // X position (horizontal motion)
    arm.position.x = this.currentSnapshot.pickArmX;

    // Z position (vertical motion)
    arm.position.z = this.currentSnapshot.pickArmZ;

    // Optional: Update collet position based on vacuum
    if (this.registry.pickCollet) {
      // Collet opens/closes based on vacuum state
      // This could be represented by scaling or rotation
    }
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * EJECTOR PINS
   * ─────────────────────────────────────────────────────────────
   */

  private updateEjectorPins(): void {
    if (!this.registry.ejectorPins) return;

    // Ejector pins move vertically
    const maxStroke = MachineCalibration.EJECTOR.MAX_STROKE;
    const normalizedStroke = this.currentSnapshot.ejectorStroke / maxStroke;

    // Move pins up by stroke amount
    this.registry.ejectorPins.position.y = normalizedStroke * 0.008; // 0.8mm in 3D units

    // Could also rotate pins slightly for visual feedback
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * PEDESTAL (with 180° flip rotation)
   * ─────────────────────────────────────────────────────────────
   */

  private updatePedestal(): void {
    if (!this.registry.pedestalRotaryBase) return;

    const pedestal = this.registry.pedestalRotaryBase;
    const center = MachineCalibration.PEDESTAL.CENTER;

    // Position at center
    pedestal.position.set(center.x, center.y, center.z);

    // Rotation around Z axis (assuming pedestal rotates around vertical axis)
    const rotationRadians = THREE.MathUtils.degToRad(this.currentSnapshot.pedestalRotation);
    pedestal.rotation.z = rotationRadians;

    // Optional: visual vacuum indicator
    if (this.currentSnapshot.pedestalVacuumOn) {
      // Could add glow or color change
    }
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * BONDING HEAD
   * ─────────────────────────────────────────────────────────────
   */

  private updateBondingHead(): void {
    if (!this.registry.bondingHead) return;

    const head = this.registry.bondingHead;
    const bondHeadHome = MachineCalibration.BONDHEAD.HOME_Z;

    // X position (horizontal motion: HOME → PEDESTAL → FLUX → BOND)
    head.position.x = this.currentSnapshot.bondHeadX;

    // Z position (vertical motion: raised to contact)
    head.position.z = bondHeadHome + this.currentSnapshot.bondHeadZ;

    // Temperature affects material (emissive, color)
    // Will be handled in updateThermalMaterials()

    // Force visualization (could scale nozzle slightly or add pressure indicator)
    if (this.registry.bondHeadNozzle) {
      const forceRatio = this.currentSnapshot.bondHeadForce / MachineCalibration.BONDHEAD.MAX_FORCE;
      // Could apply subtle scale or opacity change
    }
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * FLUX PLATE (with rotation during dip)
   * ─────────────────────────────────────────────────────────────
   */

  private updateFluxPlate(): void {
    if (!this.registry.fluxPlatePivot) return;

    const fluxPivot = this.registry.fluxPlatePivot;
    const center = MachineCalibration.FLUX.CENTER;

    // Position at flux station
    fluxPivot.position.set(center.x, center.y, center.z);

    // Rotation during dip
    const rotationRadians = THREE.MathUtils.degToRad(this.currentSnapshot.fluxPlateRotation);
    fluxPivot.rotation.z = rotationRadians;

    // Optional: Update flux film visual (dip depth)
    if (this.registry.fluxFilm) {
      // The dip depth could be represented by color or opacity
      const dipNormalized = this.currentSnapshot.fluxDipDepth / MachineCalibration.FLUX.DIP_DEPTH;
      // Could tint or highlight the film surface
    }
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * OPTICS SYSTEM
   * ─────────────────────────────────────────────────────────────
   */

  private updateOptics(): void {
    if (!this.registry.opticsArm) return;

    const opticsArm = this.registry.opticsArm;
    const parkPos = MachineCalibration.OPTICS.PARK_POSITION;
    const insertedPos = MachineCalibration.OPTICS.INSERTED_POSITION;

    // Linear motion: parked to inserted
    const currentPos = parkPos + this.currentSnapshot.opticsPosition * (insertedPos - parkPos);
    opticsArm.position.y = currentPos * 0.3; // Scale to 3D units

    // Optional: Draw alignment beams when active
    if (this.currentSnapshot.opticsActive) {
      this.drawAlignmentBeams();
    } else {
      this.clearAlignmentBeams();
    }

    // Update alignment error display
    console.log('[OPTICS] Alignment errors:', {
      ΔX: this.currentSnapshot.alignmentErrorX.toFixed(2),
      ΔY: this.currentSnapshot.alignmentErrorY.toFixed(2),
      Δθ: this.currentSnapshot.alignmentErrorTheta.toFixed(4),
      locked: this.currentSnapshot.opticsLocked,
    });
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * DIE POSITIONING
   * ─────────────────────────────────────────────────────────────
   */

  private updateDie(): void {
    if (!this.registry.activeDie) return;

    const die = this.registry.activeDie;
    const snapshot = this.currentSnapshot;

    // Update die visibility (should always be visible)
    die.visible = true;

    // Die world position comes from state
    die.position.copy(snapshot.dieWorldPosition);
    die.quaternion.copy(snapshot.dieWorldRotation);

    // Log die state for debugging (can be disabled in production)
    // console.log('[DIE] Owner:', snapshot.dieOwner, 'Position:', die.position);
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * THERMAL VISUALIZATION
   * ─────────────────────────────────────────────────────────────
   */

  private updateThermalMaterials(): void {
    if (!this.registry.bondHeadHeater) return;

    const heater = this.registry.bondHeadHeater;
    const temp = this.currentSnapshot.bondHeadTemperature;

    // Get or create material for heater
    if (heater.material instanceof THREE.Material) {
      const material = heater.material as THREE.MeshStandardMaterial;

      // Temperature color mapping
      let emissiveColor: THREE.Color;
      let emissiveIntensity = 0;

      if (temp <= 80) {
        emissiveColor = new THREE.Color('#2b2d31'); // Dark grey
        emissiveIntensity = 0;
      } else if (temp <= 150) {
        emissiveColor = new THREE.Color('#E8A33D'); // Amber
        emissiveIntensity = temp / 150 * 0.4;
      } else if (temp < 260) {
        // Interpolate from amber → orange → red
        const ratio = (temp - 150) / (260 - 150);
        emissiveColor = new THREE.Color().setHSL(0.08 - ratio * 0.08, 1, 0.4 + ratio * 0.1);
        emissiveIntensity = 0.4 + ratio * 0.6;
      } else {
        emissiveColor = new THREE.Color('#FF4B4B'); // Red
        emissiveIntensity = 1.0;
      }

      material.emissive = emissiveColor;
      material.emissiveIntensity = emissiveIntensity;
    }
  }

  /**
   * ─────────────────────────────────────────────────────────────
   * DEBUG HELPERS
   * ─────────────────────────────────────────────────────────────
   */

  private alignmentBeamsGroup: THREE.Group | null = null;

  private drawAlignmentBeams(): void {
    // This would draw the cyan (look-up) and magenta (look-down) optical beams
    // For now, just create a group to hold them

    if (!this.alignmentBeamsGroup) {
      this.alignmentBeamsGroup = new THREE.Group();
      this.alignmentBeamsGroup.name = 'AlignmentBeams';
      if (this.registry.bondingHead) {
        this.registry.bondingHead.add(this.alignmentBeamsGroup);
      }
    }

    // Draw beams based on alignment errors
    // This is a visual aid showing the alignment process
  }

  private clearAlignmentBeams(): void {
    if (this.alignmentBeamsGroup) {
      this.alignmentBeamsGroup.clear();
    }
  }

  /**
   * Log current state for debugging
   */
  logState(): void {
    console.log('[MOTION STATE]', {
      step: this.currentSnapshot.currentStep,
      progress: this.currentSnapshot.stepProgress.toFixed(3),
      pickArmX: this.currentSnapshot.pickArmX.toFixed(3),
      pickArmZ: this.currentSnapshot.pickArmZ.toFixed(3),
      pedestalRot: this.currentSnapshot.pedestalRotation.toFixed(1),
      bondHeadX: this.currentSnapshot.bondHeadX.toFixed(3),
      bondHeadZ: this.currentSnapshot.bondHeadZ.toFixed(3),
      bondHeadTemp: this.currentSnapshot.bondHeadTemperature.toFixed(1),
      bondHeadForce: this.currentSnapshot.bondHeadForce.toFixed(2),
      dieOwner: this.currentSnapshot.dieOwner,
    });
  }
}

export default MotionController;
