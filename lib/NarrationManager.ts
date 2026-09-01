import * as THREE from 'three';

interface NarrationConfig {
  voiceName?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  language?: string;
  stepCommentary?: string[];
}

interface QueuedNarration {
  text: string;
  priority: 'high' | 'normal' | 'low';
  onComplete?: () => void;
}

// ────────────────────────────────────────────────────────────────────
// ── PER-STEP COMMENTARY (HTML narration pattern) ──
// Each entry is a natural-language sentence spoken aloud when that step
// begins. Index must line up with the process step order. Leave an entry
// empty ("") to fall back to a templated "Starting <StepName>..." line.
// ────────────────────────────────────────────────────────────────────
const STEP_COMMENTARY: string[] = [
  // Step 0 — FOUP Input
  'Process initiated. Wafers are loaded into the system from the Front Opening Unified Pod, or FOUP. The automated track handler is preparing to transfer the first wafer into the process chamber.',
  // Step 1 — Dehydration Bake 150°C
  'Step two: Dehydration Bake. The wafer is heated on a hot plate at 150 degrees Celsius to drive off any residual surface moisture. Eliminating moisture is critical to ensure proper photoresist adhesion and to maximize wafer yield.',
  // Step 2 — HMDS Vapor Prime
  'Step three: HMDS Vapor Priming. Performed in-situ within the prep chamber, HMDS vapor is introduced to deposit a thin primer layer. This chemically modifies the surface to significantly improve photoresist adhesion.',
  // Step 3 — Chill Plate #1 22°C
  'Step four: Chill Plate cooling. Before the photoresist can be applied, the wafer is moved to a chill plate and cooled down to an ambient temperature of 22 degrees Celsius to ensure process stability and uniformity.',
  // Step 4 — PR Coat (COT)
  'Step five: Photoresist Coating. The wafer is secured onto a high-speed spindle via a vacuum chuck. Liquid photoresist is dispensed, and centrifugal force spins it into a uniform, thin layer. Coating thickness is precisely controlled by spin speed and resist viscosity. Faster spin gives a thinner film. Higher viscosity gives a thicker film. Simultaneously, a chemical Edge Bead Removal uses solvent nozzles to clean excess photoresist from the wafer edges.',
  // Step 5 — Post-Apply Bake (PAB)
  'Step six: Post-Apply Bake, also known as Soft Bake. The wafer is heated on a single-wafer hot plate to 90 to 120 degrees Celsius to drive out solvents and transition the photoresist from a liquid to a solid state.',
  // Step 6 — Chill Plate #2 22°C
  'Step seven: Second Chill Plate cooling. The soft-baked wafer is brought back down to an ambient 22 degrees Celsius on a chill plate, stabilizing the solid photoresist layer before it transitions to the scanner interface.',
  // Step 7 — Interface → Scanner
  'Step eight: Scanner Interface transfer. The internal track robotics are now transferring the stabilized wafer out of the Coater-Developer track and into the integrated lithography scanner exposure system.',
  // Step 8 — Scanner 193nm Exposure
  'Step nine: Alignment and Exposure. Inside the scanner, the circuit pattern on the reticle is aligned with the pre-existing pattern on the mask and the wafer, and the pattern is then transferred from the reticle mask to the photoresist on the wafer using a 193 nanometer Argon Fluoride Deep Ultra-Violet light source. This alters the chemical structure of the photoresist in the exposed regions.',
  // Step 9 — Interface ← Scanner
  'Step ten: Scanner Interface return. Having completed the exposure process, the wafer is transferred back across the interface into the Developer track for automated post-processing.',
  // Step 10 — Post-Exposure Bake (PEB)
  'Step eleven: Post-Exposure Bake. The wafer is baked at 110 to 120 degrees Celsius. This crucial step activates chemical amplification within the Deep UV photoresist and smoothens out standing wave interference patterns to sharpen line edges.',
  // Step 11 — Developer Module (DEV)
  'Step twelve: Developer Module. A weak base developer, TMAH, is dispensed to form a puddle covering the entire wafer. The developer selectively dissolves and removes the exposed positive photoresist, unmasking the desired circuit pattern. Following the development puddle time, fresh developer is sprayed while the wafer begins to spin, flushing away dissolved resist. Pure DI water is then introduced to thoroughly rinse the wafer and halt the chemical development process.',
  // Step 12 — DI Water Rinse
  'Step thirteen: Deionized Water Rinse. Fresh deionized water rinse is an additional optional step used for defect control. Pure DI water thoroughly rinses the wafer and further reduces particle count.',
  // Step 13 — Spin Dry + Nitrogen Purge
  'Step fourteen: Spin Dry and Nitrogen Purge. The wafer is spun at high speed to clear away fluid via centrifugal force, combined with a nitrogen gas purge to ensure a completely dry, particle-free surface.',
  // Step 14 — Chill Plate #3 22°C
  'Step fifteen: Third Chill Plate cooling. The developed wafer is transferred to a final chill plate, returning it to 22 degrees Celsius to prepare it for the final baking phase.',
  // Step 15 — Hard Bake 130°C
  'Step sixteen: Final Hard Bake. The wafer undergoes a final hot plate bake at 130 degrees Celsius. This drives out any remaining traces of solvent, improves resist adhesion, and structurally strengthens the photoresist pattern to withstand downstream plasma etching and ion implantation. Process is now complete and the wafer returns to the FOUP.',
];

export class NarrationManager {
  private synth: SpeechSynthesis;
  private voice: SpeechSynthesisVoice | null = null;
  private config: Required<NarrationConfig>;
  private queue: QueuedNarration[] = [];
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private isSpeaking = false;
  private enabled = true;
  private lastStepIndex = -1;
  private currentProcessStepIndex = -1; // Track live process position
  private lastAnnouncedStep = -1;
  private narrationDone = true;
  private narrationStartedAt = 0;
  private stepCommentary: string[];
  
  constructor(config: NarrationConfig = {}) {
    this.synth = window.speechSynthesis;
    this.config = {
      voiceName: config.voiceName ?? '',
      rate: config.rate ?? 1.0,
      pitch: config.pitch ?? 1.0,
      volume: config.volume ?? 0.85,
      language: config.language ?? 'en-US',
      stepCommentary: config.stepCommentary ?? STEP_COMMENTARY,
    };
    
    this.stepCommentary = config.stepCommentary ?? STEP_COMMENTARY;
    this._initVoice();
  }
  
  /** Initialize the voice — try to match avatar's preferred voice */
  private _initVoice() {
    // Voices may load asynchronously
    const tryLoad = () => {
      const voices = this.synth.getVoices();
      if (voices.length === 0) {
        setTimeout(tryLoad, 200);
        return;
      }
      
      // ── Priority order for voice selection ──
      // 1. Exact name match (if specified)
      // 2. High-quality English voices (Google, Microsoft, Apple premium)
      // 3. Any English voice
      // 4. Default voice
      
      const preferred = [
        this.config.voiceName,                                     // user-specified
        'Google US English',                                       // Chrome
        'Microsoft Aria Online (Natural) - English (United States)', // Edge premium
        'Microsoft Jenny Online (Natural) - English (United States)',
        'Microsoft Guy Online (Natural) - English (United States)',
        'Samantha',                                                // macOS / iOS
        'Karen',                                                   // macOS
        'Daniel',                                                  // macOS
      ].filter(Boolean);
      
      for (const name of preferred) {
        const found = voices.find((v) => v.name === name);
        if (found) {
          this.voice = found;
          console.log('[NARRATION] Using voice:', found.name);
          return;
        }
      }
      
      // Fallback: any English voice that sounds natural
      this.voice = voices.find((v) => 
        v.lang.startsWith('en') &&
        (v.name.includes('Natural') || v.name.includes('Premium') || v.name.includes('Enhanced'))
      ) || voices.find((v) => v.lang.startsWith('en')) || voices[0];
      
      console.log('[NARRATION] Fallback voice:', this.voice?.name);
    };
    
    if (this.synth.getVoices().length > 0) {
      tryLoad();
    } else {
      this.synth.onvoiceschanged = tryLoad;
    }
  }
  
  /** Queue a narration to be spoken */
  public speak(text: string, priority: 'high' | 'normal' | 'low' = 'normal', onComplete?: () => void) {
    if (!this.enabled) {
      onComplete?.();
      return;
    }
    
    if (priority === 'high') {
      // High priority: cancel current + clear queue, speak now
      this.stop();
      this.queue = [{ text, priority, onComplete }];
    } else if (priority === 'low') {
      // Low priority: only queue if nothing else playing
      if (this.queue.length === 0 && !this.isSpeaking) {
        this.queue.push({ text, priority, onComplete });
      } else {
        onComplete?.();
      }
    } else {
      // Normal: queue at end
      this.queue.push({ text, priority, onComplete });
    }
    
    this._processQueue();
  }
  
  /** Process the next item in queue */
  private _processQueue() {
    if (this.isSpeaking || this.queue.length === 0) return;
    
    const item = this.queue.shift()!;
    this.isSpeaking = true;
    
    const utterance = new SpeechSynthesisUtterance(item.text);
    if (this.voice) utterance.voice = this.voice;
    utterance.rate = this.config.rate;
    utterance.pitch = this.config.pitch;
    utterance.volume = this.config.volume;
    utterance.lang = this.config.language;
    
    utterance.onend = () => {
      this.isSpeaking = false;
      this.currentUtterance = null;
      item.onComplete?.();
      this._processQueue();
    };
    
    utterance.onerror = (e) => {
      // Browsers often cancel a queued utterance when a higher-priority one starts,
      // or when the user interacts with the page. These are expected and should not
      // be treated as failures.
      const ignoredErrors = new Set(['not-allowed', 'interrupted', 'canceled']);
      if (!ignoredErrors.has(e.error)) {
        console.warn('[NARRATION] Error:', e.error);
      }
      this.isSpeaking = false;
      this.currentUtterance = null;
      item.onComplete?.();
      this._processQueue();
    };
    
    this.currentUtterance = utterance;
    this.narrationStartedAt = performance.now();
    this.synth.speak(utterance);
  }
  
  /** Stop all narration immediately */
  public stop() {
    this.queue = [];
    this.synth.cancel();
    this.isSpeaking = false;
    this.currentUtterance = null;
    this.narrationDone = true;
  }

  /** Reset narration internal state without changing whether it is enabled */
  public reset() {
    this.stop();
    this.lastStepIndex = -1;
    this.lastAnnouncedStep = -1;
    this.narrationDone = true;
    this.currentProcessStepIndex = -1; // Reset process position tracking
  }
  
  /** Pause / resume */
  public pause() {
    this.synth.pause();
  }
  
  public resume() {
    this.synth.resume();
  }
  
  /** Enable / disable narration */
  public setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.stop();
    } else {
      // When re-enabling, sync to current process position
      // The simulation should call updateProcessPosition after setEnabled(true)
      // to ensure narration starts from the correct step
    }
  }
  
  public isEnabled(): boolean {
    return this.enabled;
  }
  
  /** Update the current process step index (called by simulation on every step transition) */
  public updateProcessPosition(stepIndex: number) {
    this.currentProcessStepIndex = stepIndex;
  }
  
  /** Get the current process position being tracked */
  public getCurrentProcessStep(): number {
    return this.currentProcessStepIndex;
  }
  
  /** Set volume/rate dynamically */
  public setVolume(v: number) { this.config.volume = Math.max(0, Math.min(1, v)); }
  public setRate(r: number) { this.config.rate = Math.max(0.5, Math.min(2.0, r)); }
  
  // ────────────────────────────────────────────────────────────────────
  // ── PROCESS-SPECIFIC NARRATION ──
  // ────────────────────────────────────────────────────────────────────
  
  /** Announce a process step transition — uses the per-step commentary (HTML narration pattern). */
  public announceStepTransition(
    previousStepName: string | null,
    currentStepName: string,
    stepIndex: number,
    totalSteps: number
  ) {
    // Avoid repeating the same announcement (e.g. scrubbing within a step).
    if (this.lastAnnouncedStep === stepIndex) return;
    this.lastAnnouncedStep = stepIndex;

    const commentary = this.stepCommentary[stepIndex];
    let text: string;
    if (commentary && commentary.length > 0) {
      text = commentary;
    } else if (previousStepName) {
      text = `${previousStepName} is completed. ${currentStepName} step starting now.`;
    } else {
      text = `Starting ${currentStepName}. Step ${stepIndex + 1} of ${totalSteps}.`;
    }

    this.speakStepCommentary(text);
  }

  /** Speak a step's commentary and arm the narration-gate so the animation can hold until speech finishes. */
  private speakStepCommentary(text: string) {
    if (!this.enabled || !('speechSynthesis' in window)) {
      this.narrationDone = true;
      return;
    }
    this.narrationDone = false;
    this.speak(text, 'normal', () => { this.narrationDone = true; });
  }

  /** Whether the current step's spoken narration has finished. The animation should gate
   *  its step-advance on this so it never runs ahead of the audio (HTML narration pattern). */
  public isNarrationDone(): boolean {
    if (this.narrationDone) return true;
    if (!this.enabled || !('speechSynthesis' in window)) return (this.narrationDone = true);
    const grace = 150; // ignore the first instant after speak() — some engines briefly idle
    if (performance.now() - this.narrationStartedAt < grace) return false;
    if (!this.synth.speaking && !this.synth.pending) {
      this.narrationDone = true;
    }
    return this.narrationDone;
  }

  /** Announce process start — uses the full Step 01 FOUP narration */
  public announceProcessStart() {
    // Delay slightly to ensure browser has registered user interaction
    setTimeout(() => {
      this.speak(
        'Process initiated. Wafers are loaded into the system from the Front Opening Unified Pod, or FOUP. The automated track handler is preparing to transfer the first wafer into the process chamber.',
        'high'
      );
    }, 500);
  }
  
  /** Announce process complete */
  public announceProcessComplete() {
    this.speak(
      'All process steps completed. Wafer returning to FOUP for unload.',
      'high'
    );
  }
  
  /** Announce process pause/resume */
  public announcePause() {
    this.speak('Process paused.', 'high');
  }
  
  public announceResume() {
    this.speak('Process resumed.', 'high');
  }
  
  /** Announce reset */
  public announceReset() {
    this.speak('Simulation reset. Ready to start.', 'high');
  }
  /** Custom announcement with template */
  public announceCustom(template: string, vars: Record<string, string | number>) {
    let text = template;
    Object.entries(vars).forEach(([key, value]) => {
      text = text.replace(`{${key}}`, String(value));
    });
    this.speak(text, 'normal');
  }
}
