/**
 * DebugOverlay.ts
 * Real-time visualization of robot state, wafer transfers, and collision detection.
 */

import * as THREE from "three";
import { RobotTransformManager, RobotIK } from "./RobotController";
import { WaferManager } from "./WaferManager";
import { CollisionManager } from "./CollisionManager";

export interface DebugState {
  activeRobot: string | null;
  currentWafer: number | null;
  currentStation: string | null;
  jointAngles: { [key: string]: number };
  ikTarget: THREE.Vector3 | null;
  splinePath: THREE.Vector3[];
  pickupPhase: string;
  parentingNode: string;
  collisionDetected: boolean;
  transportProgress: number;
  motionPhase: "idle" | "pickup" | "transport" | "place" | "return";
}

/**
 * Debug overlay canvas renderer.
 */
export class DebugOverlay {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  state: DebugState = {
    activeRobot: null,
    currentWafer: null,
    currentStation: null,
    jointAngles: {},
    ikTarget: null,
    splinePath: [],
    pickupPhase: "idle",
    parentingNode: "scene",
    collisionDetected: false,
    transportProgress: 0,
    motionPhase: "idle",
  };

  width: number = 400;
  height: number = 600;
  updateRate: number = 1000 / 30; // 30 Hz
  lastUpdate: number = 0;

  constructor(parentElement?: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.canvas.style.cssText =
      "position:fixed;bottom:10px;right:10px;border:2px solid #0f0;background:#000;font-family:monospace;z-index:9999";
    this.ctx = this.canvas.getContext("2d")!;

    if (parentElement) {
      parentElement.appendChild(this.canvas);
    } else {
      document.body.appendChild(this.canvas);
    }
  }

  /**
   * Update debug state.
   */
  setState(newState: Partial<DebugState>): void {
    this.state = { ...this.state, ...newState };
  }

  /**
   * Render overlay (called each frame).
   */
  render(): void {
    const now = performance.now();
    if (now - this.lastUpdate < this.updateRate) return;
    this.lastUpdate = now;

    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.ctx.fillStyle = "#0f0";
    this.ctx.font = "12px monospace";
    this.ctx.textBaseline = "top";

    let y = 12;
    const lineHeight = 14;

    // Header
    this.ctx.fillStyle = "#0ff";
    this.ctx.fillText("╔════ ROBOT DEBUG ════╗", 5, y);
    y += lineHeight;
    this.ctx.fillStyle = "#0f0";

    // Robot status
    this.ctx.fillText(`Robot: ${this.state.activeRobot || "IDLE"}`, 5, y);
    y += lineHeight;

    // Wafer tracking
    this.ctx.fillText(`Wafer ID: ${this.state.currentWafer ?? "-"}`, 5, y);
    y += lineHeight;

    // Station tracking
    this.ctx.fillText(`Station: ${this.state.currentStation || "-"}`, 5, y);
    y += lineHeight;

    // Joint angles
    y += 6;
    this.ctx.fillStyle = "#ff0";
    this.ctx.fillText("Joints (°):", 5, y);
    y += lineHeight;
    this.ctx.fillStyle = "#0f0";

    for (const [joint, angle] of Object.entries(this.state.jointAngles)) {
      const degrees = (angle * 180) / Math.PI;
      this.ctx.fillText(`  ${joint}: ${degrees.toFixed(1)}°`, 10, y);
      y += lineHeight;
    }

    // IK Target
    y += 6;
    this.ctx.fillStyle = "#ff0";
    this.ctx.fillText("IK Target:", 5, y);
    y += lineHeight;
    this.ctx.fillStyle = "#0f0";

    if (this.state.ikTarget) {
      this.ctx.fillText(
        `  [${this.state.ikTarget.x.toFixed(2)}, ${this.state.ikTarget.y.toFixed(2)}, ${this.state.ikTarget.z.toFixed(2)}]`,
        10,
        y
      );
    } else {
      this.ctx.fillText("  -", 10, y);
    }
    y += lineHeight;

    // Motion phase
    y += 6;
    this.ctx.fillStyle = this.getPhaseColor(this.state.motionPhase);
    this.ctx.fillText(`Phase: ${this.state.motionPhase}`, 5, y);
    y += lineHeight;

    // Transport progress
    if (this.state.transportProgress > 0) {
      this.ctx.fillStyle = "#0f0";
      this.ctx.fillText(`Progress: ${(this.state.transportProgress * 100).toFixed(1)}%`, 5, y);
      y += lineHeight;
    }

    // Parenting
    y += 6;
    this.ctx.fillStyle = "#f0f";
    this.ctx.fillText(`Parented: ${this.state.parentingNode}`, 5, y);
    y += lineHeight;

    // Collision status
    y += 6;
    this.ctx.fillStyle = this.state.collisionDetected ? "#f00" : "#0f0";
    this.ctx.fillText(`Collisions: ${this.state.collisionDetected ? "YES" : "NO"}`, 5, y);
    y += lineHeight;

    // Progress bar
    y += 12;
    const barWidth = this.width - 20;
    const barHeight = 8;
    const barX = 10;
    const barY = y;

    this.ctx.strokeStyle = "#0f0";
    this.ctx.strokeRect(barX, barY, barWidth, barHeight);
    this.ctx.fillStyle = "#0f0";
    this.ctx.fillRect(barX + 2, barY + 2, (barWidth - 4) * this.state.transportProgress, barHeight - 4);

    y += barHeight + 8;

    // Footer
    this.ctx.fillStyle = "#0ff";
    this.ctx.fillText("╚════════════════════╝", 5, y);
  }

  /**
   * Get color for motion phase.
   */
  private getPhaseColor(phase: string): string {
    switch (phase) {
      case "pickup":
        return "#ff0";
      case "transport":
        return "#0ff";
      case "place":
        return "#0f0";
      case "return":
        return "#f0f";
      default:
        return "#888";
    }
  }

  /**
   * Show error message.
   */
  showError(message: string, duration: number = 3000): void {
    console.error("[DEBUG OVERLAY]", message);
    // Could display on screen as a toast
  }

  /**
   * Toggle visibility.
   */
  setVisible(visible: boolean): void {
    this.canvas.style.display = visible ? "block" : "none";
  }

  /**
   * Remove overlay.
   */
  destroy(): void {
    this.canvas.remove();
  }
}
