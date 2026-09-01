/**
 * Recipe State Machine
 * 
 * Manages recipe execution as a state-driven dependency graph
 * rather than a linear step sequence.
 * 
 * Key Principles:
 * - Events trigger based on CONDITIONS, not just timers
 * - One event can produce MULTIPLE effects
 * - State transitions are EXPLICIT and TRACEABLE
 * - Dependencies prevent downstream execution when conditions aren't met
 */

export enum RecipeStepStatus {
  PENDING = 'pending',
  READY = 'ready',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  BLOCKED = 'blocked',
  FAILED = 'failed'
}

export enum MachineState {
  IDLE = 'idle',
  WAFER_LOADED = 'wafer_loaded',
  DIE_EJECTED = 'die_ejected',
  DIE_PICKED = 'die_picked',
  DIE_FLIPPED = 'die_flipped',
  DIE_FLUXED = 'die_fluxed',
  DIE_ALIGNED = 'die_aligned',
  DIE_BONDING = 'die_bonding',
  DIE_COOLING = 'die_cooling',
  DIE_RELEASED = 'die_released'
}

export enum ObjectState {
  // Robot states
  ROBOT_IDLE = 'robot_idle',
  ROBOT_MOVING = 'robot_moving',
  ROBOT_HOLDING_CHIP = 'robot_holding_chip',
  
  // Chip states
  CHIP_ON_WAFER = 'chip_on_wafer',
  CHIP_HELD = 'chip_held',
  CHIP_FLIPPED = 'chip_flipped',
  CHIP_FLUXED = 'chip_fluxed',
  CHIP_ALIGNED = 'chip_aligned',
  CHIP_BONDED = 'chip_bonded',
  
  // Equipment states
  FLIPPER_READY = 'flipper_ready',
  FLUX_STATION_READY = 'flux_station_ready',
  BOND_HEAD_READY = 'bond_head_ready',
  BOND_HEAD_AT_TEMP = 'bond_head_at_temp'
}

interface RecipeCondition {
  requiredStates: ObjectState[]
  requiredSteps?: number[]
  customCheck?: () => boolean
}

interface RecipeEvent {
  stepId: number
  name: string
  triggers: RecipeEffect[]
}

interface RecipeEffect {
  type: 'state_change' | 'animation' | 'enable_step' | 'log'
  target?: string
  newState?: ObjectState | MachineState
  animationId?: string
  enableSteps?: number[]
  message?: string
}

interface RecipeStepConfig {
  id: number
  name: string
  condition: RecipeCondition
  event: RecipeEvent
  duration: number
}

export class RecipeStateMachine {
  private currentMachineState: MachineState = MachineState.IDLE
  private objectStates: Map<string, ObjectState> = new Map()
  private stepStatuses: Map<number, RecipeStepStatus> = new Map()
  private completedSteps: Set<number> = new Set()
  private activeAnimations: Map<string, { startTime: number; duration: number }> = new Map()
  
  // IMPORTANT: Recipe progress locked at 14/17
  private readonly MAX_COMPLETED_STEPS = 14
  private readonly TOTAL_STEPS = 17
  
  private readonly DEV_MODE = process.env.NODE_ENV === 'development'
  
  constructor() {
    this.initializeStates()
  }
  
  private initializeStates(): void {
    // Initialize object states
    this.objectStates.set('robot_sking', ObjectState.ROBOT_IDLE)
    this.objectStates.set('robot_colright', ObjectState.ROBOT_IDLE)
    this.objectStates.set('chip', ObjectState.CHIP_ON_WAFER)
    this.objectStates.set('flipper', ObjectState.FLIPPER_READY)
    this.objectStates.set('flux_station', ObjectState.FLUX_STATION_READY)
    this.objectStates.set('bond_head', ObjectState.BOND_HEAD_READY)
    
    // Initialize all steps as pending
    for (let i = 1; i <= this.TOTAL_STEPS; i++) {
      this.stepStatuses.set(i, RecipeStepStatus.PENDING)
    }
    
    // Step 1 is initially ready (substrate loading can start immediately)
    this.stepStatuses.set(1, RecipeStepStatus.READY)
  }
  
  private log(message: string): void {
    if (this.DEV_MODE) {
      console.log(`[RECIPE] ${message}`)
    }
  }
  
  /**
   * Check if a step's conditions are satisfied
   */
  private checkCondition(condition: RecipeCondition): boolean {
    // Check required states
    for (const requiredState of condition.requiredStates) {
      let stateFound = false
      for (const [, state] of this.objectStates) {
        if (state === requiredState) {
          stateFound = true
          break
        }
      }
      if (!stateFound) {
        return false
      }
    }
    
    // Check required steps
    if (condition.requiredSteps) {
      for (const stepId of condition.requiredSteps) {
        if (!this.completedSteps.has(stepId)) {
          return false
        }
      }
    }
    
    // Custom check
    if (condition.customCheck && !condition.customCheck()) {
      return false
    }
    
    return true
  }
  
  /**
   * Execute a recipe event and all its effects
   */
  private executeEvent(event: RecipeEvent): void {
    this.log(`[EVENT] ${event.name} triggered`)
    
    for (const effect of event.triggers) {
      switch (effect.type) {
        case 'state_change':
          if (effect.target && effect.newState) {
            const oldState = this.objectStates.get(effect.target)
            this.objectStates.set(effect.target, effect.newState as ObjectState)
            this.log(`[STATE] ${effect.target}: ${oldState} → ${effect.newState}`)
          }
          break
          
        case 'animation':
          if (effect.animationId) {
            this.log(`[ANIMATION] ${effect.animationId} started`)
            // Animation will be handled by the 3D component
          }
          break
          
        case 'enable_step':
          if (effect.enableSteps) {
            for (const stepId of effect.enableSteps) {
              const config = this.getStepConfig(stepId)
              if (config && this.checkCondition(config.condition)) {
                this.stepStatuses.set(stepId, RecipeStepStatus.READY)
                this.log(`[DEPENDENCY] Step ${stepId} condition satisfied`)
              }
            }
          }
          break
          
        case 'log':
          if (effect.message) {
            this.log(effect.message)
          }
          break
      }
    }
  }
  
  /**
   * Start execution of a recipe step
   */
  public startStep(stepId: number): boolean {
    const status = this.stepStatuses.get(stepId)
    
    if (status !== RecipeStepStatus.READY) {
      this.log(`[ERROR] Cannot start step ${stepId}: status is ${status}`)
      return false
    }
    
    // Check if we've reached the 14/17 limit
    if (this.completedSteps.size >= this.MAX_COMPLETED_STEPS) {
      this.log(`[LIMIT] Recipe progress locked at ${this.completedSteps.size}/${this.TOTAL_STEPS}`)
      return false
    }
    
    const config = this.getStepConfig(stepId)
    if (!config) {
      this.log(`[ERROR] No configuration for step ${stepId}`)
      return false
    }
    
    // Check conditions one final time
    if (!this.checkCondition(config.condition)) {
      this.log(`[ERROR] Step ${stepId} conditions not met`)
      this.stepStatuses.set(stepId, RecipeStepStatus.BLOCKED)
      return false
    }
    
    this.stepStatuses.set(stepId, RecipeStepStatus.IN_PROGRESS)
    this.log(`Recipe progress: ${this.completedSteps.size}/${this.TOTAL_STEPS}`)
    
    // Start animation tracking
    this.activeAnimations.set(`step_${stepId}`, {
      startTime: performance.now(),
      duration: config.duration
    })
    
    return true
  }
  
  /**
   * Complete a recipe step and trigger its effects
   */
  public completeStep(stepId: number): void {
    const status = this.stepStatuses.get(stepId)
    
    if (status !== RecipeStepStatus.IN_PROGRESS) {
      this.log(`[ERROR] Cannot complete step ${stepId}: not in progress`)
      return
    }
    
    // Don't actually mark as completed if we've hit the limit
    if (this.completedSteps.size >= this.MAX_COMPLETED_STEPS) {
      this.log(`[LIMIT] Step ${stepId} executed but not counted (at ${this.MAX_COMPLETED_STEPS}/${this.TOTAL_STEPS})`)
      return
    }
    
    const config = this.getStepConfig(stepId)
    if (!config) return
    
    // Mark as completed
    this.stepStatuses.set(stepId, RecipeStepStatus.COMPLETED)
    this.completedSteps.add(stepId)
    
    this.log(`Step ${stepId} completed`)
    this.log(`Recipe progress: ${this.completedSteps.size}/${this.TOTAL_STEPS}`)
    
    // Execute event effects
    this.executeEvent(config.event)
    
    // Clean up animation
    this.activeAnimations.delete(`step_${stepId}`)
  }
  
  /**
   * Get current recipe progress
   */
  public getProgress(): { completed: number; total: number } {
    return {
      completed: Math.min(this.completedSteps.size, this.MAX_COMPLETED_STEPS),
      total: this.TOTAL_STEPS
    }
  }
  
  /**
   * Get step configuration with conditions and effects
   */
  private getStepConfig(stepId: number): RecipeStepConfig | null {
    const configs: { [key: number]: RecipeStepConfig } = {
      1: {
        id: 1,
        name: 'Substrate Loading',
        condition: { requiredStates: [] }, // Always ready at start
        duration: 2000,
        event: {
          stepId: 1,
          name: 'SubstrateLoaded',
          triggers: [
            { type: 'state_change', target: 'chip', newState: ObjectState.CHIP_ON_WAFER },
            { type: 'enable_step', enableSteps: [2] }
          ]
        }
      },
      2: {
        id: 2,
        name: 'Wafer Fiducial Scan',
        condition: { requiredSteps: [1], requiredStates: [ObjectState.CHIP_ON_WAFER] },
        duration: 1500,
        event: {
          stepId: 2,
          name: 'FiducialScanComplete',
          triggers: [
            { type: 'enable_step', enableSteps: [3] }
          ]
        }
      },
      3: {
        id: 3,
        name: 'Die Ejection',
        condition: { requiredSteps: [2], requiredStates: [ObjectState.CHIP_ON_WAFER] },
        duration: 800,
        event: {
          stepId: 3,
          name: 'DieEjected',
          triggers: [
            { type: 'state_change', target: 'chip', newState: ObjectState.CHIP_ON_WAFER },
            { type: 'enable_step', enableSteps: [4] }
          ]
        }
      },
      4: {
        id: 4,
        name: 'Pick & Lift',
        condition: { requiredSteps: [3], requiredStates: [ObjectState.ROBOT_IDLE] },
        duration: 1000,
        event: {
          stepId: 4,
          name: 'RobotPickup',
          triggers: [
            { type: 'state_change', target: 'chip', newState: ObjectState.CHIP_HELD },
            { type: 'state_change', target: 'robot_sking', newState: ObjectState.ROBOT_HOLDING_CHIP },
            { type: 'animation', animationId: 'robot_pickup' },
            { type: 'enable_step', enableSteps: [5] }
          ]
        }
      },
      5: {
        id: 5,
        name: 'Transfer to Pedestal',
        condition: { 
          requiredSteps: [4], 
          requiredStates: [ObjectState.CHIP_HELD, ObjectState.FLIPPER_READY] 
        },
        duration: 1200,
        event: {
          stepId: 5,
          name: 'TransferComplete',
          triggers: [
            { type: 'state_change', target: 'robot_sking', newState: ObjectState.ROBOT_IDLE },
            { type: 'animation', animationId: 'transfer_to_pedestal' },
            { type: 'enable_step', enableSteps: [6] }
          ]
        }
      },
      6: {
        id: 6,
        name: '180° Flip',
        condition: { requiredSteps: [5], requiredStates: [ObjectState.CHIP_HELD] },
        duration: 500,
        event: {
          stepId: 6,
          name: 'FlipComplete',
          triggers: [
            { type: 'state_change', target: 'chip', newState: ObjectState.CHIP_FLIPPED },
            { type: 'animation', animationId: 'flip_180' },
            { type: 'enable_step', enableSteps: [7, 8] } // Both bond head move AND pickup become eligible
          ]
        }
      },
      7: {
        id: 7,
        name: 'Bond Head to Pedestal',
        condition: { requiredSteps: [6], requiredStates: [ObjectState.CHIP_FLIPPED, ObjectState.BOND_HEAD_READY] },
        duration: 1200,
        event: {
          stepId: 7,
          name: 'BondHeadArrived',
          triggers: [
            { type: 'animation', animationId: 'bond_head_move' },
            { type: 'enable_step', enableSteps: [8] }
          ]
        }
      },
      8: {
        id: 8,
        name: 'Bond Head Picks Die',
        condition: { requiredSteps: [7], requiredStates: [ObjectState.CHIP_FLIPPED] },
        duration: 800,
        event: {
          stepId: 8,
          name: 'DieTransferredToBondHead',
          triggers: [
            { type: 'state_change', target: 'bond_head', newState: ObjectState.ROBOT_HOLDING_CHIP },
            { type: 'enable_step', enableSteps: [9] }
          ]
        }
      },
      9: {
        id: 9,
        name: 'Move to Flux',
        condition: { 
          requiredSteps: [8], 
          requiredStates: [ObjectState.CHIP_FLIPPED, ObjectState.FLUX_STATION_READY] 
        },
        duration: 1500,
        event: {
          stepId: 9,
          name: 'ArrivedAtFluxStation',
          triggers: [
            { type: 'animation', animationId: 'move_to_flux' },
            { type: 'enable_step', enableSteps: [10] }
          ]
        }
      },
      10: {
        id: 10,
        name: 'Dip Flux',
        condition: { requiredSteps: [9], requiredStates: [ObjectState.FLUX_STATION_READY] },
        duration: 1000,
        event: {
          stepId: 10,
          name: 'FluxDipComplete',
          triggers: [
            { type: 'state_change', target: 'chip', newState: ObjectState.CHIP_FLUXED },
            { type: 'animation', animationId: 'flux_dip' },
            { type: 'enable_step', enableSteps: [11] }
          ]
        }
      },
      11: {
        id: 11,
        name: 'Move to Bond Site',
        condition: { requiredSteps: [10], requiredStates: [ObjectState.CHIP_FLUXED] },
        duration: 1500,
        event: {
          stepId: 11,
          name: 'ArrivedAtBondSite',
          triggers: [
            { type: 'animation', animationId: 'move_to_bond' },
            { type: 'enable_step', enableSteps: [12] }
          ]
        }
      },
      12: {
        id: 12,
        name: 'Optical Alignment',
        condition: { requiredSteps: [11], requiredStates: [ObjectState.CHIP_FLUXED] },
        duration: 2000,
        event: {
          stepId: 12,
          name: 'AlignmentComplete',
          triggers: [
            { type: 'state_change', target: 'chip', newState: ObjectState.CHIP_ALIGNED },
            { type: 'animation', animationId: 'align_optics' },
            { type: 'enable_step', enableSteps: [13] }
          ]
        }
      },
      13: {
        id: 13,
        name: 'Touchdown/Preheat',
        condition: { requiredSteps: [12], requiredStates: [ObjectState.CHIP_ALIGNED] },
        duration: 2000,
        event: {
          stepId: 13,
          name: 'PreheatComplete',
          triggers: [
            { type: 'state_change', target: 'bond_head', newState: ObjectState.BOND_HEAD_AT_TEMP },
            { type: 'animation', animationId: 'preheat' },
            { type: 'enable_step', enableSteps: [14] }
          ]
        }
      },
      14: {
        id: 14,
        name: 'Peak Reflow',
        condition: { 
          requiredSteps: [13], 
          requiredStates: [ObjectState.CHIP_ALIGNED, ObjectState.BOND_HEAD_AT_TEMP] 
        },
        duration: 2500,
        event: {
          stepId: 14,
          name: 'ReflowComplete',
          triggers: [
            { type: 'state_change', target: 'chip', newState: ObjectState.CHIP_BONDED },
            { type: 'animation', animationId: 'reflow_pulse' },
            { type: 'log', message: 'IMC formation complete' },
            // NOTE: Step 15 is NOT auto-enabled - locked at 14/17
            { type: 'enable_step', enableSteps: [] }
          ]
        }
      },
      // Steps 15-17 remain defined but won't execute until limit is raised
      15: {
        id: 15,
        name: 'Cool Down',
        condition: { requiredSteps: [14], requiredStates: [ObjectState.CHIP_BONDED] },
        duration: 2000,
        event: {
          stepId: 15,
          name: 'CooldownComplete',
          triggers: [
            { type: 'animation', animationId: 'cooldown' },
            { type: 'enable_step', enableSteps: [16] }
          ]
        }
      },
      16: {
        id: 16,
        name: 'Release & Retract',
        condition: { requiredSteps: [15], requiredStates: [ObjectState.CHIP_BONDED] },
        duration: 1000,
        event: {
          stepId: 16,
          name: 'ReleaseComplete',
          triggers: [
            { type: 'state_change', target: 'bond_head', newState: ObjectState.BOND_HEAD_READY },
            { type: 'animation', animationId: 'release' },
            { type: 'enable_step', enableSteps: [17] }
          ]
        }
      },
      17: {
        id: 17,
        name: 'Index to Next',
        condition: { requiredSteps: [16], requiredStates: [] },
        duration: 1500,
        event: {
          stepId: 17,
          name: 'IndexComplete',
          triggers: [
            { type: 'state_change', target: 'chip', newState: ObjectState.CHIP_ON_WAFER },
            { type: 'state_change', target: 'robot_sking', newState: ObjectState.ROBOT_IDLE },
            { type: 'animation', animationId: 'index_stage' }
          ]
        }
      }
    }
    
    return configs[stepId] || null
  }
  
  /**
   * Update animations and check for completions
   */
  public update(currentTime: number): void {
    for (const [key, anim] of this.activeAnimations) {
      const elapsed = currentTime - anim.startTime
      if (elapsed >= anim.duration) {
        // Animation complete, trigger step completion
        const stepId = parseInt(key.replace('step_', ''))
        this.completeStep(stepId)
      }
    }
  }
  
  /**
   * Get status of a specific step
   */
  public getStepStatus(stepId: number): RecipeStepStatus {
    return this.stepStatuses.get(stepId) || RecipeStepStatus.PENDING
  }
  
  /**
   * Check if a step is ready to start
   */
  public isStepReady(stepId: number): boolean {
    return this.stepStatuses.get(stepId) === RecipeStepStatus.READY
  }
  
  /**
   * Get current machine state
   */
  public getMachineState(): MachineState {
    return this.currentMachineState
  }
  
  /**
   * Reset the state machine
   */
  public reset(): void {
    this.completedSteps.clear()
    this.activeAnimations.clear()
    this.initializeStates()
    this.log('State machine reset')
  }
}
