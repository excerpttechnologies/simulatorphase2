/**
 * DieAttachmentSystem.ts
 * 
 * Manages die ownership and attachment to different tools.
 * Prevents die floating, maintains proper handoffs, and ensures no double-rendering.
 * 
 * CRITICAL: There is always exactly ONE active die.
 * When ownership changes, the die is reparented while preserving world position/rotation.
 */

import * as THREE from 'three';
import { DieOwner } from './ThreeDAnimationState';

// ═══════════════════════════════════════════════════════════════
// ATTACHMENT SYSTEM
// ═══════════════════════════════════════════════════════════════

export class DieAttachmentSystem {
  // The single active die object
  private activeDie: THREE.Object3D;

  // Current owner and attachment state
  private currentOwner: DieOwner = DieOwner.WAFER;
  private previousOwner: DieOwner = DieOwner.WAFER;

  // Parent references (tools/stations that can own the die)
  private parents: Map<DieOwner, THREE.Object3D> = new Map();

  // Initial world position/rotation (for resetting)
  private initialWorldPos: THREE.Vector3;
  private initialWorldRot: THREE.Quaternion;

  // Attachment handlers
  private attachmentHandlers: Map<DieOwner, (die: THREE.Object3D) => void> = new Map();

  constructor(activeDie: THREE.Object3D) {
    this.activeDie = activeDie;
    this.initialWorldPos = activeDie.position.clone();
    this.initialWorldRot = activeDie.quaternion.clone();

    this.setupAttachmentHandlers();
  }

  /**
   * Register a parent object for a given owner type
   */
  registerParent(owner: DieOwner, parent: THREE.Object3D): void {
    this.parents.set(owner, parent);
    console.log(`[ATTACHMENT] Registered ${owner} parent:`, parent.name);
  }

  /**
   * Change die ownership and handle reparenting
   */
  changeOwnership(newOwner: DieOwner): void {
    if (this.currentOwner === newOwner) {
      console.warn(`[ATTACHMENT] Die already owned by ${newOwner}, ignoring duplicate ownership`);
      return;
    }

    console.log(`[ATTACHMENT] Die ownership: ${this.currentOwner} → ${newOwner}`);

    this.previousOwner = this.currentOwner;
    this.currentOwner = newOwner;

    // Get current world transform
    const worldPos = new THREE.Vector3();
    const worldRot = new THREE.Quaternion();
    this.activeDie.getWorldPosition(worldPos);
    this.activeDie.getWorldQuaternion(worldRot);

    // Get the new parent
    const newParent = this.parents.get(newOwner);
    if (!newParent) {
      console.warn(`[ATTACHMENT] No parent registered for owner ${newOwner}`);
      return;
    }

    // Remove from current parent (or scene)
    if (this.activeDie.parent) {
      this.activeDie.removeFromParent();
    }

    // Add to new parent
    newParent.add(this.activeDie);

    // Restore world position/rotation (preserve world transform during reparenting)
    this.activeDie.position.copy(worldPos);
    this.activeDie.quaternion.copy(worldRot);

    // Convert to local coordinates in the new parent
    if (newParent.parent) {
      const parentWorldPos = new THREE.Vector3();
      const parentWorldRot = new THREE.Quaternion();
      newParent.getWorldPosition(parentWorldPos);
      newParent.getWorldQuaternion(parentWorldRot);

      const relativePos = worldPos.clone().sub(parentWorldPos);
      const parentInverse = new THREE.Quaternion().copy(parentWorldRot).invert();
      relativePos.applyQuaternion(parentInverse);

      this.activeDie.position.copy(relativePos);
    }

    // Call attachment handler for new owner
    const handler = this.attachmentHandlers.get(newOwner);
    if (handler) {
      handler(this.activeDie);
    }
  }

  /**
   * Setup handlers for different owner types
   */
  private setupAttachmentHandlers(): void {
    // WAFER: die sits on wafer surface
    this.attachmentHandlers.set(DieOwner.WAFER, (die) => {
      die.position.set(0, 0.01, 0);
      die.quaternion.set(0, 0, 0, 1);
      console.log('[ATTACHMENT] Die attached to wafer');
    });

    // PICK ARM: die attached to collet gripper
    this.attachmentHandlers.set(DieOwner.PICK_ARM, (die) => {
      die.position.set(0, 0, 0); // center in collet
      die.quaternion.set(0, 0, 0, 1);
      console.log('[ATTACHMENT] Die attached to pick collet');
    });

    // PEDESTAL: die placed on pedestal
    this.attachmentHandlers.set(DieOwner.PEDESTAL, (die) => {
      die.position.set(0, 0.01, 0); // slightly above surface
      die.quaternion.set(0, 0, 0, 1);
      console.log('[ATTACHMENT] Die placed on pedestal');
    });

    // BONDHEAD: die held by bonding head vacuum
    this.attachmentHandlers.set(DieOwner.BONDHEAD, (die) => {
      die.position.set(0, 0, 0); // centered in nozzle
      die.quaternion.set(0, 0, 0, 1);
      console.log('[ATTACHMENT] Die attached to bondhead');
    });

    // SUBSTRATE: die permanently bonded to substrate
    this.attachmentHandlers.set(DieOwner.SUBSTRATE, (die) => {
      die.position.set(0, 0.002, 0); // bonded flat on substrate
      die.quaternion.set(0, 0, 0, 1);
      console.log('[ATTACHMENT] Die bonded to substrate (permanent)');
    });
  }

  /**
   * Get current owner
   */
  getOwner(): DieOwner {
    return this.currentOwner;
  }

  /**
   * Get die object
   */
  getDie(): THREE.Object3D {
    return this.activeDie;
  }

  /**
   * Check if die is freely held (not on a surface)
   */
  isHeld(): boolean {
    return this.currentOwner === DieOwner.PICK_ARM || this.currentOwner === DieOwner.BONDHEAD;
  }

  /**
   * Check if die is permanently bonded
   */
  isBonded(): boolean {
    return this.currentOwner === DieOwner.SUBSTRATE;
  }

  /**
   * Update die position relative to current owner
   * Called during animation to move the die with its parent
   */
  updatePosition(relativePos: THREE.Vector3): void {
    this.activeDie.position.copy(relativePos);
  }

  /**
   * Update die rotation relative to current owner
   */
  updateRotation(rotation: THREE.Quaternion): void {
    this.activeDie.quaternion.copy(rotation);
  }

  /**
   * Get die world position
   */
  getWorldPosition(): THREE.Vector3 {
    const pos = new THREE.Vector3();
    this.activeDie.getWorldPosition(pos);
    return pos;
  }

  /**
   * Get die world rotation
   */
  getWorldQuaternion(): THREE.Quaternion {
    const rot = new THREE.Quaternion();
    this.activeDie.getWorldQuaternion(rot);
    return rot;
  }

  /**
   * Reset die to initial state
   */
  reset(): void {
    this.changeOwnership(DieOwner.WAFER);
    this.activeDie.position.copy(this.initialWorldPos);
    this.activeDie.quaternion.copy(this.initialWorldRot);
    this.currentOwner = DieOwner.WAFER;
    this.previousOwner = DieOwner.WAFER;
  }

  /**
   * Debug visualization - log current state
   */
  logState(): void {
    console.log('[ATTACHMENT STATE]', {
      owner: this.currentOwner,
      worldPosition: this.getWorldPosition(),
      worldRotation: this.getWorldQuaternion(),
      parentName: this.activeDie.parent?.name || 'scene',
      visible: this.activeDie.visible,
    });
  }
}

export default DieAttachmentSystem;
