/**
 * AnimationOrchestrator.ts
 * 
 * Central controller for the 3D animation system.
 * Manages playback state, timeline control, and synchronization with UI.
 */

import { ThreeDAnimationState } from './ThreeDAnimationState';
import StateReconstructor from './StateReconstructor';

// ═══════════════════════════════════════════════════════════════
// ANIMATION PLAYBACK STATE
// ═══════════════════════════════════════════════════════════════

export enum PlaybackState {
  STOPPED = 'stopped',
  PLAYING = 'playing',
  PAUSED = 'paused',
}

export interface PlaybackControl {
  state: PlaybackState;
  currentStep: number;
  stepProgress: number;
  globalProgress: number; // 0-1 across all 17 steps
  isAtEnd: boolean;
}

// ═══════════════════════════════════════════════════════════════
// ANIMATION ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════

export class AnimationOrchestrator {
  private animationState: ThreeDAnimationState;
  private playbackState: PlaybackState = PlaybackState.STOPPED;
  private currentStep: number = 1;
  private stepProgress: number = 0;
  private playbackStartTime: number = 0;
  private pausedTime: number = 0;

  // Total process duration (sum of all step durations)
  private totalDuration: number = 0;

  // Callbacks
  private onPlaybackStateChange?: (state: PlaybackControl) => void;
  private onStepChange?: (step: number) => void;

  constructor() {
    this.animationState = new ThreeDAnimationState();
    this.calculateTotalDuration();
  }

  /**
   * Calculate total duration across all 17 steps
   */
  private calculateTotalDuration(): void {
    this.totalDuration = 0;
    for (let i = 1; i <= 17; i++) {
      this.totalDuration += this.animationState.getStepDuration(i);
    }
    console.log(`[ORCHESTRATOR] Total process duration: ${this.totalDuration}ms`);
  }

  /**
   * Start playback from current position
   */
  play(): void {
    if (this.playbackState === PlaybackState.PLAYING) {
      console.warn('[ORCHESTRATOR] Already playing');
      return;
    }

    this.playbackState = PlaybackState.PLAYING;
    this.playbackStartTime = performance.now() - this.pausedTime;
    console.log(`[ORCHESTRATOR] Play from step ${this.currentStep}, progress ${this.stepProgress}`);
    this.notifyStateChange();
  }

  /**
   * Pause playback at current position
   */
  pause(): void {
    if (this.playbackState !== PlaybackState.PLAYING) {
      console.warn('[ORCHESTRATOR] Not currently playing');
      return;
    }

    this.playbackState = PlaybackState.PAUSED;
    this.pausedTime = performance.now() - this.playbackStartTime;
    console.log(`[ORCHESTRATOR] Paused at step ${this.currentStep}, progress ${this.stepProgress}`);
    this.notifyStateChange();
  }

  /**
   * Stop and reset to step 1
   */
  reset(): void {
    this.currentStep = 1;
    this.stepProgress = 0;
    this.playbackState = PlaybackState.STOPPED;
    this.playbackStartTime = 0;
    this.pausedTime = 0;
    this.animationState.reset();
    console.log('[ORCHESTRATOR] Reset to step 1');
    this.notifyStateChange();
  }

  /**
   * Jump to specific step
   */
  jumpToStep(step: number): void {
    step = Math.max(1, Math.min(17, step));
    this.currentStep = step;
    this.stepProgress = 0;

    // If playing, restart the step
    if (this.playbackState === PlaybackState.PLAYING) {
      this.playbackStartTime = performance.now();
      this.pausedTime = 0;
    }

    console.log(`[ORCHESTRATOR] Jump to step ${step}`);
    this.onStepChange?.(step);
    this.notifyStateChange();
  }

  /**
   * Step forward one step
   */
  stepForward(): void {
    if (this.currentStep < 17) {
      this.jumpToStep(this.currentStep + 1);
    }
  }

  /**
   * Step backward one step
   */
  stepBack(): void {
    if (this.currentStep > 1) {
      this.jumpToStep(this.currentStep - 1);
    }
  }

  /**
   * Seek to specific timeline position (0-1 = 0% to 100%)
   * Used by scrubber slider
   */
  seek(globalProgress: number): void {
    globalProgress = Math.max(0, Math.min(1, globalProgress));

    // Calculate which step and local progress this corresponds to
    let elapsedTime = globalProgress * this.totalDuration;
    let step = 1;
    let timeInStep = 0;

    for (step = 1; step <= 17; step++) {
      const stepDuration = this.animationState.getStepDuration(step);
      if (elapsedTime <= stepDuration) {
        timeInStep = elapsedTime;
        break;
      }
      elapsedTime -= stepDuration;
    }

    step = Math.min(step, 17);
    this.currentStep = step;
    this.stepProgress = timeInStep / this.animationState.getStepDuration(step);

    console.log(
      `[ORCHESTRATOR] Seek to ${(globalProgress * 100).toFixed(1)}% = Step ${step}, progress ${this.stepProgress.toFixed(3)}`
    );

    if (this.playbackState === PlaybackState.PLAYING) {
      this.playbackStartTime = performance.now();
      this.pausedTime = 0;
    }

    this.notifyStateChange();
  }

  /**
   * Update playback position (called each frame)
   * Returns current playback state
   */
  update(): PlaybackControl {
    if (this.playbackState === PlaybackState.PLAYING) {
      // Update step progress based on elapsed time
      const elapsed = performance.now() - this.playbackStartTime;
      const stepDuration = this.animationState.getStepDuration(this.currentStep);

      this.stepProgress = elapsed / stepDuration;

      // Auto-advance to next step if completed
      if (this.stepProgress >= 1.0) {
        this.stepProgress = 0;

        if (this.currentStep < 17) {
          this.currentStep += 1;
          this.playbackStartTime = performance.now();
          this.onStepChange?.(this.currentStep);
        } else {
          // End of process
          this.playbackState = PlaybackState.PAUSED;
        }
      }
    }

    return this.getState();
  }

  /**
   * Get current playback state
   */
  getState(): PlaybackControl {
    return {
      state: this.playbackState,
      currentStep: this.currentStep,
      stepProgress: this.stepProgress,
      globalProgress: this.calculateGlobalProgress(),
      isAtEnd: this.currentStep === 17 && this.stepProgress >= 1.0,
    };
  }

  /**
   * Calculate global progress (0-1) across entire process
   */
  private calculateGlobalProgress(): number {
    let elapsed = 0;

    // Sum durations of completed steps
    for (let i = 1; i < this.currentStep; i++) {
      elapsed += this.animationState.getStepDuration(i);
    }

    // Add progress in current step
    const currentStepDuration = this.animationState.getStepDuration(this.currentStep);
    elapsed += this.stepProgress * currentStepDuration;

    return elapsed / this.totalDuration;
  }

  /**
   * Get animation state snapshot at current position
   */
  getCurrentState() {
    return StateReconstructor.reconstructState(this.currentStep, this.stepProgress);
  }

  /**
   * Register callback for playback state changes
   */
  onStateChange(callback: (state: PlaybackControl) => void): void {
    this.onPlaybackStateChange = callback;
  }

  /**
   * Register callback for step changes
   */
  onStep(callback: (step: number) => void): void {
    this.onStepChange = callback;
  }

  /**
   * Private: notify listeners of state change
   */
  private notifyStateChange(): void {
    this.onPlaybackStateChange?.(this.getState());
  }

  /**
   * Get step duration in milliseconds
   */
  getStepDuration(step: number): number {
    return this.animationState.getStepDuration(step);
  }

  /**
   * Get total process duration in milliseconds
   */
  getTotalDuration(): number {
    return this.totalDuration;
  }

  /**
   * Debug: log current state
   */
  logState(): void {
    console.log('[ORCHESTRATOR STATE]', {
      playback: this.playbackState,
      step: this.currentStep,
      progress: this.stepProgress.toFixed(3),
      global: this.calculateGlobalProgress().toFixed(3),
      total_ms: this.totalDuration,
    });
  }
}

export default AnimationOrchestrator;
