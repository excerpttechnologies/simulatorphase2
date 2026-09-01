"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { SimulationState, ProcessTelemetry } from "../lib/api-service";

interface UseSimulationOptions {
  autoStart?: boolean;
  onTelemetry?: (data: ProcessTelemetry) => void;
}

interface UseSimulationReturn {
  state: SimulationState;
  paused: boolean;
  speed: number;
  labels: boolean;
  setPaused: (paused: boolean) => void;
  setSpeed: (speed: number) => void;
  setLabels: (show: boolean) => void;
  reset: () => void;
  setPreset: (preset: string) => void;
}

const DEFAULT_STATE: SimulationState = {
  wafers: [],
  simTime: 0,
  fps: 60,
  completed: 0,
  active: 0,
  paused: false,
  speed: 1,
};

export function useSimulation(options: UseSimulationOptions = {}): UseSimulationReturn {
  const { autoStart = true, onTelemetry } = options;
  
  const [state, setState] = useState<SimulationState>(DEFAULT_STATE);
  const [paused, setPausedState] = useState(!autoStart);
  const [speed, setSpeedState] = useState(1);
  const [labels, setLabelsState] = useState(true);
  
  const simRef = useRef<{
    paused: boolean;
    speed: number;
    setPreset: (p: unknown) => void;
    reset: () => void;
  } | null>(null);

  // Exposed setters that sync with the Sim instance
  const setPaused = useCallback((value: boolean) => {
    setPausedState(value);
    if (simRef.current) {
      simRef.current.paused = value;
    }
  }, []);

  const setSpeed = useCallback((value: number) => {
    const prev = simRef.current?.speed ?? null;
    setSpeedState(value);
    if (simRef.current) {
      // Update sim speed (single source of truth)
      simRef.current.speed = value;

      // Narration behavior:
      // - Mute/stop narration when running faster than 1x
      // - When returning to 1x, play narration for the current active step only
      try {
        const narration = (simRef.current as any).narration;
        if (narration) {
          if (value > 1) {
            // Immediately stop any spoken/queued narration
            narration.stop?.();
          } else if (value === 1) {
            // Only resume narration for the current active step (do not restart sequence)
            // Determine the current active step index and play its starting script
            const sim: any = simRef.current;
            const getStepInfo =
              typeof sim.getActiveProcessStepInfo === 'function'
                ? sim.getActiveProcessStepInfo.bind(sim)
                : typeof sim.getCurrentStepInfo === 'function'
                  ? sim.getCurrentStepInfo.bind(sim)
                  : null;
            const activeInfo = getStepInfo ? getStepInfo() : null;
            if (activeInfo && narration.isEnabled && narration.isEnabled()) {
              import('../lib/narrationScripts').then(({ getStepNarration }) => {
                const script = getStepNarration(activeInfo.id);
                if (script && script.starting) {
                  narration.speak?.(script.starting, 'normal');
                }
              }).catch(() => {});
            }
          }
        }
      } catch (e) {
        // swallow — narration is optional
        // console.warn('Narration sync failed', e);
      }
    }
  }, []);

  const setLabels = useCallback((show: boolean) => {
    setLabelsState(show);
  }, []);

  const reset = useCallback(() => {
    if (simRef.current) {
      simRef.current.reset();
    }
    // Reset UI state: unpause and reset speed to 1x
    setPausedState(false);
    setSpeedState(1);
    if (simRef.current) simRef.current.speed = 1;

    // After reset, play narration for the first step (if narration enabled)
    try {
      const narration = (simRef.current as any).narration;
      const sim: any = simRef.current;
      const getStepInfo = typeof sim.getCurrentStepInfo === 'function' ? sim.getCurrentStepInfo.bind(sim) : null;
      const activeInfo = getStepInfo ? getStepInfo() : null;
      if (narration && activeInfo && narration.isEnabled && narration.isEnabled()) {
        import('../lib/narrationScripts').then(({ getStepNarration }) => {
          const script = getStepNarration(activeInfo.id);
          if (script && script.starting) {
            narration.speak?.(script.starting, 'high');
          }
        }).catch(() => {});
      }
    } catch (e) {
      // ignore
    }
  }, []);

  const setPreset = useCallback((preset: string) => {
    if (simRef.current) {
      simRef.current.setPreset(preset);
    }
  }, []);

  // Expose sim ref for the renderer to populate
  useEffect(() => {
    const interval = setInterval(() => {
      const sim = (window as unknown as { __SIM_REF?: typeof simRef.current }).__SIM_REF;
      if (sim) {
        simRef.current = sim;
        clearInterval(interval);
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  return {
    state,
    paused,
    speed,
    labels,
    setPaused,
    setSpeed,
    setLabels,
    reset,
    setPreset,
  };
}

// Hook for WebGL context loss handling
export function useWebGLContext() {
  const [isLost, setIsLost] = useState(false);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);

  useEffect(() => {
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      console.warn("WebGL context lost");
      setIsLost(true);
    };

    const handleContextRestored = () => {
      console.log("WebGL context restored");
      setIsLost(false);
      setRecoveryAttempt((prev) => prev + 1);
    };

    // Listen on all canvas elements
    const canvases = document.querySelectorAll("canvas");
    canvases.forEach((canvas) => {
      canvas.addEventListener("webglcontextlost", handleContextLost);
      canvas.addEventListener("webglcontextrestored", handleContextRestored);
    });

    return () => {
      canvases.forEach((canvas) => {
        canvas.removeEventListener("webglcontextlost", handleContextLost);
        canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      });
    };
  }, []);

  return { isLost, recoveryAttempt };
}

// Hook for keyboard accessibility
export function useKeyboardControls(handlers: {
  onPause?: () => void;
  onReset?: () => void;
  onSpeedUp?: () => void;
  onSpeedDown?: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case " ":
          e.preventDefault();
          handlers.onPause?.();
          break;
        case "r":
        case "R":
          if (!e.ctrlKey && !e.metaKey) {
            handlers.onReset?.();
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          handlers.onSpeedUp?.();
          break;
        case "ArrowDown":
          e.preventDefault();
          handlers.onSpeedDown?.();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlers]);
}

export default useSimulation;