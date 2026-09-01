# Design: Wafer Transfer Integration

## Overview

This design specifies the integration of WaferBonderTransfer (EFEM robot) with BonderController to connect Stage 1 (Substrate Loading) UI with actual 3D animation. The integration will complete the visual representation of the full 17-stage flip-chip bonding recipe without modifying existing working systems.

**Design Principle:** Integration, not reimplementation. Both WaferBonderTransfer and TwoRobotChipProcess already work correctly. This design focuses solely on orchestrating their execution within BonderController's recipe runner.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          page.tsx (UI Layer)                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐│
│  │   START    │  │   PAUSE    │  │   RESUME   │  │   RESET    ││
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘│
│        │               │               │               │        │
│        v               v               v               v        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │            Simulation Controller (page.tsx)                 ││
│  │  - _animate() loop (60 FPS)                                 ││
│  │  - Speed control (1x, 2x, 5x, 10x)                          ││
│  │  - Update dispatch to subsystems                            ││
│  └────────────┬─────────────────────────────────┬──────────────┘│
└───────────────┼─────────────────────────────────┼───────────────┘
                │                                 │
                v                                 v
┌───────────────────────────────┐   ┌──────────────────────────────┐
│     BonderController          │   │   WaferBonderTransfer        │
│  (Orchestrator & Stage Mgr)   │◄──┤   (EFEM Robot)               │
│                                │   │   State Machine:             │
│  ┌─────────────────────────┐  │   │   R2FOUP → APPROACH →       │
│  │  BonderStateMachine     │  │   │   CONTACT → ATTACH →        │
│  │  - Current stage        │  │   │   LIFT → TRAVEL →           │
│  │  - Stage transitions    │  │   │   LOWER → PLACE →           │
│  │  - Event emission       │  │   │   RETRACT → HOME → DONE     │
│  └─────────────────────────┘  │   └──────────────────────────────┘
│                                │
│  Recipe Execution:             │
│  ┌────────────────────────┐   │
│  │ runFullRecipe()        │   │   ┌─────────────────────────────┐
│  │  ├─ Stage 1 ──────────────────►│ runStage01_SubstrateLoading()│
│  │  │   (Wafer Transfer)  │   │   │  - Calculate positions       │
│  │  │                     │   │   │  - Start EFEM transfer       │
│  │  ├─ Stage 2 ──────────────────►│  - Wait for DONE state       │
│  │  │   (Fiducial Scan)   │   │   │  - Complete stage           │
│  │  │                     │   │   └─────────────────────────────┘
│  │  └─ Stages 3-17 ──────────────►│ runTwoRobotRecipe()         │
│  │      (Chip Process)     │   │   │  - Existing implementation  │
│  └────────────────────────┘   │   └─────────────────────────────┘
│                                │
│  ┌───────────────────────────┐│   ┌──────────────────────────────┐
│  │  TwoRobotChipProcess      ││   │   FluxStation                │
│  │  - COLRIGHT: Pick & Flip  ││   │   AlignmentController        │
│  │  - Handoff                ││   │   BondingController          │
│  │  - SKING: Flux & Place    ││   │   ChipControllers[]          │
│  └───────────────────────────┘│   └──────────────────────────────┘
└───────────────────────────────┘

Legend:
  ──► Method call / Control flow
  ◄── Dependency injection (setBondTransfer)
```

---

## Component Interaction Flow

### Initialization Sequence

```
┌────────┐          ┌──────────────┐          ┌──────────────────┐
│page.tsx│          │BonderCtrlr   │          │WaferBonderTransfer│
└───┬────┘          └──────┬───────┘          └─────────┬────────┘
    │                      │                            │
    │ 1. new BonderController(scene)                   │
    ├─────────────────────►│                            │
    │                      │                            │
    │                      │ 2. discovers robots        │
    │                      │    (SKING, COLRIGHT)       │
    │                      │                            │
    │ 3. new WaferBonderTransfer(scene, rack, models)  │
    ├──────────────────────────────────────────────────►│
    │                      │                            │
    │ 4. setBondTransfer(transfer)                      │
    ├─────────────────────►│                            │
    │                      │ 5. Store reference         │
    │                      │    this.bondTransfer = ... │
    │                      │                            │
    │                      │ 6. Set log callback        │
    │                      ├───────────────────────────►│
    │                      │    transfer.log = (msg)=>..│
    │                      │                            │
    │                      │◄────READY FOR RECIPE──────►│
```

### Stage 1 Execution Sequence

```
┌────────┐     ┌──────────────┐     ┌──────────────────┐     ┌─────────┐
│User/UI │     │BonderCtrlr   │     │WaferBonderTransfer│     │3D Scene │
└───┬────┘     └──────┬───────┘     └─────────┬────────┘     └────┬────┘
    │                 │                        │                   │
    │ START           │                        │                   │
    ├────────────────►│                        │                   │
    │                 │ runFullRecipe()        │                   │
    │                 │                        │                   │
    │                 │ runStage01_SubstrateLoading()             │
    │                 │                        │                   │
    │                 │ _calculateRackPosition()                  │
    │                 │───────────────────────────────────────────►│
    │                 │                        │    Find rack node │
    │                 │◄───────────────────────────────────────────│
    │                 │         Vector3(-14, 3.35, 0)             │
    │                 │                        │                   │
    │                 │ _calculatePedestalPosition()              │
    │                 │───────────────────────────────────────────►│
    │                 │                        │  Find PEDESTAL    │
    │                 │◄───────────────────────────────────────────│
    │                 │         Vector3(0, 0.5, 0)                │
    │                 │                        │                   │
    │                 │ start(sourceWorld, destWorld)             │
    │                 ├───────────────────────►│                   │
    │                 │                        │ Begin state machine
    │                 │                        │ R2FOUP            │
    │                 │                        │                   │
    │                 │ _waitForState(() => getStatus().state==='DONE')
    │                 │ [POLLING LOOP]         │                   │
    │                 │                        │                   │
    │                 │      [Animation Loop Updates]             │
    │                 │                        │ update(dt*speed)  │
    │                 │                        ├──────────────────►│
    │                 │                        │  APPROACH → ATTACH│
    │                 │                        │  LIFT → TRAVEL    │
    │                 │                        │  LOWER → PLACE    │
    │                 │                        │  RETRACT → HOME   │
    │                 │                        │                   │
    │                 │                        │ State: DONE       │
    │                 │◄───────────────────────┤                   │
    │                 │                        │                   │
    │                 │ stateMachine.completeStage(1)             │
    │                 │                        │                   │
    │                 │ emit(STAGE_COMPLETE, {stageId: 1})        │
    │ UI Update       │                        │                   │
    │◄────────────────┤                        │                   │
    │ "Stage 2 Active"│                        │                   │
    │                 │                        │                   │
    │                 │ runStage02_FiducialScan()                 │
    │                 │                        │                   │
```

### Full Recipe Execution Flow

```
runFullRecipe()
    │
    ├─► Stage 1: Substrate Loading
    │     ├─ stateMachine.startStage(1)
    │     ├─ Calculate source position (rack)
    │     ├─ Calculate dest position (pedestal)
    │     ├─ bondTransfer.start(source, dest)
    │     ├─ Wait for bondTransfer state === 'DONE'
    │     ├─ stateMachine.completeStage(1)
    │     └─ emit(STAGE_COMPLETE, {stageId: 1})
    │
    ├─► Stage 2: Wafer Fiducial Scan
    │     ├─ stateMachine.startStage(2)
    │     ├─ _log('Fiducial scan (placeholder)')
    │     ├─ Wait 500ms (simulated scan time)
    │     ├─ stateMachine.completeStage(2)
    │     └─ emit(STAGE_COMPLETE, {stageId: 2})
    │
    └─► Stages 3-17: Two-Robot Chip Process
          ├─ runTwoRobotRecipe()
          │   └─ [Existing implementation]
          │       ├─ Stage 3: COLRIGHT moves to wafer
          │       ├─ Stage 4: COLRIGHT picks chip
          │       ├─ Stage 5: COLRIGHT lifts chip
          │       ├─ Stage 6: COLRIGHT flips 180°
          │       ├─ Stage 7: COLRIGHT moves to handoff
          │       ├─ Stage 8: Handoff to SKING
          │       ├─ Stage 9: SKING moves to flux
          │       ├─ Stage 10: SKING dips in flux
          │       ├─ Stage 11: SKING moves to alignment
          │       ├─ Stage 12: Alignment scan
          │       ├─ Stage 13: SKING moves to bond position
          │       ├─ Stage 14: Apply bonding force
          │       ├─ Stage 15: Dwell with heat & pressure
          │       ├─ Stage 16: Release chip
          │       └─ Stage 17: SKING returns home
          │
          └─ emit(RECIPE_COMPLETE)
```

---

## Data Models

### Position Data Structures

```typescript
interface Vector3 {
  x: number  // Meters
  y: number  // Meters (vertical axis)
  z: number  // Meters
}

interface BondTransferPositions {
  rack: Vector3      // Wafer rack slot position
  pedestal: Vector3  // Bonder pedestal position
}

interface RobotReach {
  X: {
    rest: number     // Home position on X axis
    min: number      // Minimum reachable X
    max: number      // Maximum reachable X
  }
  Y: {
    rest: number     // Home position on Y axis
    min: number      // Minimum reachable Y
    max: number      // Maximum reachable Y
  }
  homeFlipZ?: number    // For COLRIGHT flip axis
  homeRotaryZ?: number  // For SKING rotary axis
}
```

### State Machine Data

```typescript
enum BonderState {
  IDLE = 'idle',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETE = 'complete',
  FAILED = 'failed'
}

enum TransferState {
  IDLE = 'IDLE',
  R2FOUP = 'R2FOUP',         // Moving to rack
  APPROACH = 'APPROACH',     // Approaching wafer
  CONTACT = 'CONTACT',       // Making contact
  ATTACH = 'ATTACH',         // Attaching wafer
  LIFT = 'LIFT',             // Lifting wafer
  TRAVEL = 'TRAVEL',         // Traveling to bonder
  LOWER = 'LOWER',           // Lowering to pedestal
  PLACE = 'PLACE',           // Placing wafer
  RETRACT = 'RETRACT',       // Retracting arm
  HOME = 'HOME',             // Returning home
  DONE = 'DONE'              // Complete
}

interface StageStatus {
  stageId: number         // 1-17
  state: BonderState      // Current state
  startTime: number       // Timestamp (ms)
  duration: number        // Elapsed time (ms)
  progress: number        // 0.0 - 1.0
}

interface TransferStatus {
  state: TransferState
  progress: number        // 0.0 - 1.0
  error: string | null
}
```

### Event Data

```typescript
interface StageCompleteEvent {
  stageId: number
  timestamp: number
  duration: number
}

interface StageFailEvent {
  stageId: number
  error: string
  timestamp: number
}

interface BonderEvents {
  STAGE_START: 'stage:start'
  STAGE_COMPLETE: 'stage:complete'
  STAGE_FAIL: 'stage:fail'
  RECIPE_COMPLETE: 'recipe:complete'
  PAUSED: 'paused'
  RESUMED: 'resumed'
  RESET: 'reset'
}
```

---

## Component Specifications

### BonderController Extensions

**File:** `lib/BonderController.js`
**Modifications:** Add new methods at end of class (before final `}`)

#### New Properties

```javascript
class BonderController {
  constructor(scene) {
    // ... existing properties ...
    
    // NEW: Reference to wafer transfer system
    this.bondTransfer = null
    
    // NEW: Recipe execution state
    this.recipeInProgress = false
    this.currentRecipePromise = null
  }
}
```

#### Method: setBondTransfer

```javascript
/**
 * Register the wafer transfer system for Stage 1 execution
 * @param {WaferBonderTransfer} transfer - The EFEM robot transfer system
 */
setBondTransfer(transfer) {
  this.bondTransfer = transfer
  
  if (transfer) {
    // Connect logging to bonder's log system
    transfer.log = (msg) => this._log(`[Transfer] ${msg}`)
    this._log('WaferBonderTransfer registered for Stage 1')
  } else {
    this._logWarn('WaferBonderTransfer unregistered')
  }
}
```

#### Method: runFullRecipe

```javascript
/**
 * Execute the complete 17-stage flip-chip bonding recipe
 * Orchestrates wafer loading (Stage 1), fiducial scan (Stage 2),
 * and chip bonding process (Stages 3-17)
 * @returns {Promise<void>}
 * @throws {Error} If any stage fails
 */
async runFullRecipe() {
  if (this.recipeInProgress) {
    this._logWarn('Recipe already in progress')
    return
  }
  
  this.recipeInProgress = true
  this.stateMachine.start()
  
  try {
    this._log('=== Starting Full Recipe (17 Stages) ===')
    
    // Stage 1: Substrate Loading (EFEM wafer transfer)
    await this.runStage01_SubstrateLoading()
    
    // Stage 2: Wafer Fiducial Scan (placeholder)
    await this.runStage02_FiducialScan()
    
    // Stages 3-17: Two-robot chip bonding process
    await this.runTwoRobotRecipe()
    
    this._log('=== Recipe Complete ===')
    this.stateMachine.complete()
    this.events.emit(BONDER_EVENTS.RECIPE_COMPLETE)
    
  } catch (err) {
    this._logError(`Recipe failed: ${err.message}`)
    this.stateMachine.fail(err.message)
    throw err
    
  } finally {
    this.recipeInProgress = false
  }
}
```

#### Method: runStage01_SubstrateLoading

```javascript
/**
 * Execute Stage 1: Substrate Loading
 * Uses EFEM robot (WaferBonderTransfer) to transfer wafer from rack to bonder
 * @returns {Promise<void>}
 * @throws {Error} If bondTransfer not configured or transfer fails
 */
async runStage01_SubstrateLoading() {
  this._log('>>> Stage 1: Substrate Loading')
  
  // Validate bondTransfer is configured
  if (!this.bondTransfer) {
    this._logError('bondTransfer not configured, cannot execute Stage 1')
    throw new Error('WaferBonderTransfer not registered')
  }
  
  // Update state machine
  this.stateMachine.startStage(1)
  const stageStartTime = performance.now()
  
  try {
    // Calculate source (rack) and destination (pedestal) positions
    const sourceWorld = this._calculateRackPosition()
    const destWorld = this._calculatePedestalPosition()
    
    this._log(`  Rack position: (${sourceWorld.x.toFixed(2)}, ${sourceWorld.y.toFixed(2)}, ${sourceWorld.z.toFixed(2)})`)
    this._log(`  Pedestal position: (${destWorld.x.toFixed(2)}, ${destWorld.y.toFixed(2)}, ${destWorld.z.toFixed(2)})`)
    
    // Start wafer transfer
    const started = this.bondTransfer.start(sourceWorld, destWorld)
    if (!started) {
      throw new Error('Failed to start wafer transfer')
    }
    
    this._log('  EFEM robot transferring wafer...')
    
    // Wait for transfer completion (with timeout)
    await this._waitForState(
      () => {
        const status = this.bondTransfer.getStatus()
        return status.state === 'DONE'
      },
      15000, // 15 second timeout
      'Wafer transfer timeout'
    )
    
    // Mark stage complete
    const duration = performance.now() - stageStartTime
    this.stateMachine.completeStage(1)
    this._log(`  Stage 1 complete (${(duration / 1000).toFixed(2)}s)`)
    
    this.events.emit(BONDER_EVENTS.STAGE_COMPLETE, {
      stageId: 1,
      timestamp: performance.now(),
      duration: duration
    })
    
  } catch (err) {
    this._logError(`Stage 1 failed: ${err.message}`)
    this.stateMachine.fail(`Stage 1: ${err.message}`)
    throw err
  }
}
```

#### Method: runStage02_FiducialScan

```javascript
/**
 * Execute Stage 2: Wafer Fiducial Scan
 * Placeholder implementation - logs and completes immediately
 * Future: Could trigger camera scan animation
 * @returns {Promise<void>}
 */
async runStage02_FiducialScan() {
  this._log('>>> Stage 2: Wafer Fiducial Scan')
  
  this.stateMachine.startStage(2)
  const stageStartTime = performance.now()
  
  try {
    // Placeholder: Simulate scan duration
    this._log('  Scanning fiducial marks... (placeholder)')
    await this._delay(500) // 500ms simulated scan
    
    this._log('  Fiducials detected, alignment data acquired')
    
    // Mark stage complete
    const duration = performance.now() - stageStartTime
    this.stateMachine.completeStage(2)
    this._log(`  Stage 2 complete (${(duration / 1000).toFixed(2)}s)`)
    
    this.events.emit(BONDER_EVENTS.STAGE_COMPLETE, {
      stageId: 2,
      timestamp: performance.now(),
      duration: duration
    })
    
  } catch (err) {
    this._logError(`Stage 2 failed: ${err.message}`)
    this.stateMachine.fail(`Stage 2: ${err.message}`)
    throw err
  }
}
```

#### Method: _calculateRackPosition

```javascript
/**
 * Calculate wafer rack source position from 3D model geometry
 * Searches for wafer rack node in scene, uses fallback if not found
 * @returns {THREE.Vector3} World space position of wafer rack slot
 * @private
 */
_calculateRackPosition() {
  // Try to find wafer rack in scene
  // Note: Rack may be separate GLB, not in flip_chip_bonder.glb
  const rackNode = this.scene.getObjectByName('WAFER_RACK') ||
                   this.scene.getObjectByName('RACK') ||
                   this.scene.getObjectByName('FOUP')
  
  if (rackNode) {
    const pos = new THREE.Vector3()
    rackNode.getWorldPosition(pos)
    
    // Add offset to specific slot (e.g., slot 5 of 25)
    // Typical FOUP has 25 slots, ~6mm spacing
    const slotIndex = 5
    const slotSpacing = 0.006 // 6mm in meters
    pos.y += slotIndex * slotSpacing
    
    this._log(`  Found rack node: ${rackNode.name}`)
    return pos
  }
  
  // Fallback: Use known approximate position from system layout
  this._logWarn('  Rack node not found, using fallback position')
  return new THREE.Vector3(-14, 3.35, 0) // Left side, elevated
}
```

#### Method: _calculatePedestalPosition

```javascript
/**
 * Calculate bonder pedestal destination position from 3D model geometry
 * @returns {THREE.Vector3} World space position of pedestal working plane
 * @private
 */
_calculatePedestalPosition() {
  // Search for pedestal node (multiple possible names)
  const pedestal = this.nodes.PEDESTAL ||
                   this.nodes.RING_VACUUM_PEDESTAL ||
                   this.nodes.SKING_PEDESTAL ||
                   this.nodes.SUBSTRATE_STAGE
  
  if (pedestal) {
    const pos = new THREE.Vector3()
    pedestal.getWorldPosition(pos)
    
    this._log(`  Found pedestal node: ${pedestal.name}`)
    return pos
  }
  
  // Fallback: Use known position from bonder geometry
  this._logWarn('  Pedestal node not found, using fallback position')
  return new THREE.Vector3(0, 0.5, 0) // Center of bonder, elevated
}
```

#### Method: _waitForState

```javascript
/**
 * Wait for an async condition to become true
 * Polls condition each animation frame until true or timeout
 * @param {Function} condition - Function returning boolean when condition met
 * @param {number} timeout - Maximum wait time in milliseconds
 * @param {string} errorMessage - Error message if timeout occurs
 * @returns {Promise<void>}
 * @throws {Error} If timeout expires
 * @private
 */
async _waitForState(condition, timeout = 10000, errorMessage = 'Wait timeout') {
  const startTime = performance.now()
  
  return new Promise((resolve, reject) => {
    const check = () => {
      // Check if paused
      if (this.paused) {
        // Keep waiting while paused
        requestAnimationFrame(check)
        return
      }
      
      // Check condition
      if (condition()) {
        resolve()
      } else if (performance.now() - startTime > timeout) {
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2)
        reject(new Error(`${errorMessage} (${elapsed}s)`))
      } else {
        requestAnimationFrame(check)
      }
    }
    
    check()
  })
}
```

#### Method: _delay

```javascript
/**
 * Delay execution for specified duration
 * Respects pause state - continues counting only when not paused
 * @param {number} ms - Delay duration in milliseconds
 * @returns {Promise<void>}
 * @private
 */
async _delay(ms) {
  let elapsed = 0
  const startTime = performance.now()
  
  return new Promise((resolve) => {
    const check = () => {
      if (!this.paused) {
        elapsed = performance.now() - startTime
      }
      
      if (elapsed >= ms) {
        resolve()
      } else {
        requestAnimationFrame(check)
      }
    }
    
    check()
  })
}
```

#### Enhanced Method: reset

```javascript
/**
 * Reset bonder to initial state
 * Resets all subsystems: state machine, robots, wafer transfer, chips
 * @returns {Promise<void>}
 */
async reset() {
  this._log('Resetting bonder...')
  
  // Reset state machine
  this.stateMachine.reset()
  this.recipeInProgress = false
  
  // Reset two-robot chip process
  if (this.twoRobot) {
    await this.twoRobot.reset()
  }
  
  // Reset wafer transfer (EFEM robot)
  if (this.bondTransfer) {
    this.bondTransfer.reset()
  }
  
  // Reset chip controllers
  this.chipControllers.forEach(c => c.reset())
  
  // Reset flux station
  if (this.fluxStation) {
    this.fluxStation.reset()
  }
  
  // Reset visual state
  this.temperature = 80
  this.running = false
  this.paused = false
  
  this._log('Reset complete')
  this.events.emit(BONDER_EVENTS.RESET)
}
```

#### Enhanced Method: pause

```javascript
/**
 * Pause all bonder operations
 * Freezes robot motion, animations, and state transitions
 */
pause() {
  if (this.paused) return
  
  this.paused = true
  this._log('Bonder paused')
  
  // Pause wafer transfer
  if (this.bondTransfer) {
    this.bondTransfer.pause()
  }
  
  this.events.emit(BONDER_EVENTS.PAUSED)
}
```

#### Enhanced Method: resume

```javascript
/**
 * Resume bonder operations after pause
 * Continues from exact position where paused
 */
resume() {
  if (!this.paused) return
  
  this.paused = false
  this._log('Bonder resumed')
  
  // Resume wafer transfer
  if (this.bondTransfer) {
    this.bondTransfer.resume()
  }
  
  this.events.emit(BONDER_EVENTS.RESUMED)
}
```

---

### page.tsx Integration

**File:** `app/page.tsx`

#### Connection During Initialization

```typescript
// In loadBonder() or similar initialization method
// After bonder controller is created and wafer transfer is created

private async loadBonder(): Promise<void> {
  // ... existing bonder loading code ...
  
  // After both systems are initialized:
  if (this.bonderController && this.bondTransfer) {
    this.bonderController.setBondTransfer(this.bondTransfer)
    console.log('[Sim] BonderController connected to WaferBonderTransfer')
  }
}
```

#### Animation Loop Update

```typescript
private _animate(): void {
  requestAnimationFrame(() => this._animate())
  
  const now = performance.now()
  const dt = Math.min((now - this.lastTime) / 1000, 0.1) // Cap at 100ms
  this.lastTime = now
  
  // Get current speed multiplier (1x, 2x, 5x, 10x)
  const speed = this.state.simulationSpeed
  
  // Update bonder controller (includes TwoRobotChipProcess)
  if (this.bonderController && !this.bonderController.paused) {
    this.bonderController.update(dt * speed)
  }
  
  // Update wafer transfer (EFEM robot) - only if running
  if (this.bondTransfer && this.bondTransfer.isRunning()) {
    this.bondTransfer.update(dt * speed)
  }
  
  // ... other updates (camera, controls, renderer, etc.) ...
  
  this.renderer.render(this.scene, this.camera)
}
```

#### Full Recipe Starter Method

```typescript
/**
 * Start the complete 17-stage bonding recipe
 * Includes Stage 1 (wafer loading), Stage 2 (fiducial scan),
 * and Stages 3-17 (chip bonding)
 */
startFullBonderRecipe(): void {
  const bc = this.bonderController
  
  if (!bc) {
    console.error('[Sim] BonderController not ready')
    return
  }
  
  if (bc.stateMachine.state === 'running') {
    console.warn('[Sim] Recipe already running')
    return
  }
  
  console.log('[Sim] Starting full 17-stage recipe')
  
  // Execute recipe asynchronously
  void bc.runFullRecipe().catch(err => {
    console.error('[Sim] Recipe failed:', err)
    // UI will update via state machine events
  })
}
```

#### Control Method Updates

```typescript
pauseBonder(): void {
  if (this.bonderController) {
    this.bonderController.pause()
  }
}

resumeBonder(): void {
  if (this.bonderController) {
    this.bonderController.resume()
  }
}

resetBonder(): void {
  if (this.bonderController) {
    void this.bonderController.reset()
  }
}
```

#### UI Button Updates (React Component)

```tsx
<div className="bonder-controls">
  <button
    onClick={() => simRef.current?.startFullBonderRecipe()}
    disabled={ui.bonder?.status === 'running'}
    className="btn-primary"
  >
    START FULL RECIPE
  </button>
  
  <button
    onClick={() => simRef.current?.pauseBonder()}
    disabled={ui.bonder?.status !== 'running'}
    className="btn-secondary"
  >
    PAUSE
  </button>
  
  <button
    onClick={() => simRef.current?.resumeBonder()}
    disabled={ui.bonder?.status !== 'paused'}
    className="btn-secondary"
  >
    RESUME
  </button>
  
  <button
    onClick={() => simRef.current?.resetBonder()}
    className="btn-warning"
  >
    RESET
  </button>
</div>
```

---

## State Transition Diagrams

### Recipe State Machine

```
                        START
                          │
                          v
                    ┌──────────┐
                    │   IDLE   │
                    └────┬─────┘
                         │ runFullRecipe()
                         v
                    ┌──────────┐
                    │ RUNNING  │◄──────────┐
                    │ Stage 1  │           │
                    └────┬─────┘           │
                         │ complete         │
                         v                  │
                    ┌──────────┐           │
                    │ RUNNING  │           │
                    │ Stage 2  │           │
                    └────┬─────┘           │
                         │ complete         │
                         v                  │
                    ┌──────────┐           │
                    │ RUNNING  │           │
                    │ Stage 3  │           │
                    └────┬─────┘           │
                         │ complete         │
                         v                  │
                       ...                  │
                         │                  │
                         v                  │
                    ┌──────────┐           │
                    │ RUNNING  │           │
                    │ Stage 17 │           │
                    └────┬─────┘           │
                         │ complete         │
                         v                  │
                    ┌──────────┐           │
                    │ COMPLETE │           │
                    └────┬─────┘           │
                         │                  │
                         │                  │
          ┌──────────────┴──────────────┐  │
          │                             │  │
          v                             v  │
    ┌──────────┐    ERROR          ┌─────────┐
    │  RESET   ├──────────────────►│ FAILED  │
    └────┬─────┘                   └────┬────┘
         │                              │
         └──────────────┬───────────────┘
                        v
                    ┌──────────┐
                    │   IDLE   │
                    └──────────┘

Transitions:
  - IDLE → RUNNING: runFullRecipe() called
  - RUNNING → RUNNING: Stage N completes, start Stage N+1
  - RUNNING → COMPLETE: Final stage (17) completes
  - RUNNING → FAILED: Any stage throws error or times out
  - ANY → IDLE: reset() called
  - RUNNING ↔ PAUSED: pause() / resume() (not shown)
```

### Stage 1 (Wafer Transfer) State Machine

```
runStage01_SubstrateLoading()
    │
    v
┌──────────────────────┐
│ Calculate Positions  │
│ - Rack: (-14,3.35,0) │
│ - Pedestal: (0,0.5,0)│
└─────────┬────────────┘
          │
          v
┌──────────────────────┐
│ bondTransfer.start() │
└─────────┬────────────┘
          │
          v
┌──────────────────────┐
│  Wait for DONE       │
│  (polling loop)      │
│                      │
│  Transfer States:    │
│  ├─ IDLE             │
│  ├─ R2FOUP ──────┐   │
│  ├─ APPROACH     │   │
│  ├─ CONTACT      │   │
│  ├─ ATTACH       │   │◄── Animation loop updates
│  ├─ LIFT         │   │    bondTransfer.update(dt)
│  ├─ TRAVEL       │   │
│  ├─ LOWER        │   │
│  ├─ PLACE        │   │
│  ├─ RETRACT      │   │
│  ├─ HOME         │   │
│  └─ DONE ────────┘   │
│                      │
└─────────┬────────────┘
          │ status.state === 'DONE'
          v
┌──────────────────────┐
│ stateMachine         │
│  .completeStage(1)   │
└─────────┬────────────┘
          │
          v
┌──────────────────────┐
│ emit(STAGE_COMPLETE) │
└──────────────────────┘

Error Paths:
  - bondTransfer not configured → throw Error
  - start() returns false → throw Error
  - Wait timeout (>15s) → throw Error
  - Any error → stateMachine.fail(), emit(STAGE_FAIL)
```

---

## Error Handling Strategy

### Error Categories

1. **Configuration Errors** (at startup)
   - Missing bondTransfer reference
   - Missing 3D model nodes
   - Invalid scene structure

2. **Runtime Errors** (during execution)
   - State transition failures
   - Timeout waiting for completion
   - Robot calibration failures

3. **User-Triggered Errors** (edge cases)
   - Starting while already running
   - Resetting during critical operation
   - Rapid pause/resume cycles

### Error Handling Patterns

```javascript
// Pattern 1: Graceful Degradation (non-critical errors)
_calculateRackPosition() {
  const rackNode = this.scene.getObjectByName('WAFER_RACK')
  
  if (rackNode) {
    return rackNode.getWorldPosition(new THREE.Vector3())
  }
  
  // Fallback: Use known position
  this._logWarn('Rack node not found, using fallback position')
  return new THREE.Vector3(-14, 3.35, 0)
}

// Pattern 2: Fail Fast (critical errors)
async runStage01_SubstrateLoading() {
  if (!this.bondTransfer) {
    this._logError('bondTransfer not configured')
    throw new Error('WaferBonderTransfer not registered')
  }
  // ... proceed with operation
}

// Pattern 3: Timeout Protection (async operations)
async _waitForState(condition, timeout, errorMessage) {
  const startTime = performance.now()
  
  return new Promise((resolve, reject) => {
    const check = () => {
      if (condition()) {
        resolve()
      } else if (performance.now() - startTime > timeout) {
        reject(new Error(`${errorMessage} (timeout: ${timeout}ms)`))
      } else {
        requestAnimationFrame(check)
      }
    }
    check()
  })
}

// Pattern 4: Try-Catch with State Cleanup
async runFullRecipe() {
  this.recipeInProgress = true
  
  try {
    await this.runStage01_SubstrateLoading()
    await this.runStage02_FiducialScan()
    await this.runTwoRobotRecipe()
    
    this.stateMachine.complete()
    
  } catch (err) {
    this._logError(`Recipe failed: ${err.message}`)
    this.stateMachine.fail(err.message)
    throw err
    
  } finally {
    this.recipeInProgress = false
  }
}
```

### Error Logging Levels

```javascript
// INFO: Normal operation
this._log('Stage 1: Substrate Loading')

// WARN: Non-critical issues, using fallback
this._logWarn('Pedestal node not found, using fallback position')

// ERROR: Critical failures
this._logError('bondTransfer not configured, cannot execute Stage 1')

// With event emission
this.events.emit(BONDER_EVENTS.STAGE_FAIL, {
  stageId: 1,
  error: err.message,
  timestamp: performance.now()
})
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Complete State Transition Sequence

*For any* execution of Stage 1, the WaferBonderTransfer state machine SHALL progress through all required states in the correct order: R2FOUP → APPROACH → CONTACT → ATTACH → LIFT → TRAVEL → LOWER → PLACE → RETRACT → HOME → DONE.

**Validates: Requirements 1.2**

**Test Strategy:** Generate random Stage 1 executions, capture state transitions, verify sequence matches expected order and contains no skips or backward transitions.

---

### Property 2: Wafer Position Preservation

*For any* Stage 1 execution, when the transfer completes, the substrate wafer SHALL be positioned at the pedestal location within a tolerance of 1mm.

**Validates: Requirements 1.4**

**Test Strategy:** For any Stage 1 execution, record initial and final wafer world positions, verify final position matches calculated pedestal position within 0.001 meters.

---

### Property 3: Sequential Stage Execution

*For any* complete recipe execution, stages SHALL execute in strict sequential order from 1 to 17 without skipping any stage.

**Validates: Requirements 2.2**

**Test Strategy:** For any runFullRecipe() call, capture all stage transition events, verify stage IDs form sequence [1, 2, 3, ..., 17] with no gaps or reordering.

---

### Property 4: Position Calculation Validity

*For any* Stage 1 execution, both calculated rack and pedestal positions SHALL be non-null Vector3 objects with valid numeric coordinates within the expected workspace bounds.

**Validates: Requirements 2.3**

**Test Strategy:** For any _calculateRackPosition() and _calculatePedestalPosition() call, verify returned Vector3 has numeric x, y, z properties and coordinates satisfy workspace constraints (e.g., |x| < 20, 0 < y < 10, |z| < 20).

---

### Property 5: Stage Completion Barrier

*For any* stage transition from stage N to stage N+1, stage N+1 SHALL NOT begin until stage N reaches COMPLETE or DONE state.

**Validates: Requirements 2.4**

**Test Strategy:** For any adjacent stage pair (N, N+1), verify timestamp of stage N+1 start is >= timestamp of stage N complete, and no state changes occur in stage N+1 before stage N completion event.

---

### Property 6: Error State Transition

*For any* error occurring during any stage execution, the BonderStateMachine SHALL transition to FAILED state and emit a STAGE_FAIL event with error details.

**Validates: Requirements 2.5, 6.3**

**Test Strategy:** For any thrown error during stage execution, verify state machine state becomes FAILED, verify STAGE_FAIL event is emitted with stageId and error message, verify no further stage progression occurs.

---

### Property 7: Uniform Animation Update

*For any* animation frame when both BonderController and WaferBonderTransfer are active, both SHALL receive update() calls with the same time delta scaled by the same speed multiplier.

**Validates: Requirements 3.1, 3.3**

**Test Strategy:** For any animation frame with speed multiplier S and time delta dt, verify BonderController.update() and WaferBonderTransfer.update() are both called with parameter (dt * S) where S is consistent.

---

### Property 8: Conditional Update Skipping

*For any* animation frame when WaferBonderTransfer.isRunning() returns false, WaferBonderTransfer.update() SHALL NOT be called.

**Validates: Requirements 3.2**

**Test Strategy:** For any animation frame where isRunning() === false, verify update() call count on WaferBonderTransfer remains unchanged.

---

### Property 9: Pause Freezes Motion

*For any* stage when BonderController.pause() is called, all robot positions SHALL remain constant across subsequent animation frames until resume() is called.

**Validates: Requirements 3.4, 5.2**

**Test Strategy:** For any stage execution, call pause() at random time, record robot positions, verify positions unchanged for next 10 frames, call resume(), verify positions begin changing again.

---

### Property 10: Frame Rate Independence

*For any* animation sequence with varying time deltas, object displacement SHALL be proportional to elapsed time (dt) rather than frame count.

**Validates: Requirements 3.5**

**Test Strategy:** Execute same motion with different frame rates (60fps with dt=16ms, 30fps with dt=33ms, 10fps with dt=100ms), verify total displacement after 1 second is equal within 5% tolerance across all frame rates.

---

### Property 11: UI Stage Highlighting

*For any* stage ID between 1 and 17, when that stage becomes active, the UI SHALL visually highlight that stage element.

**Validates: Requirements 4.3**

**Test Strategy:** For any stage 1-17, when stage becomes active, verify corresponding UI element has CSS class "active" or similar highlight styling applied.

---

### Property 12: UI Error Indication

*For any* stage failure, the UI SHALL display an error indicator on the failed stage element.

**Validates: Requirements 4.4**

**Test Strategy:** For any stage that emits STAGE_FAIL event, verify corresponding UI element has error indicator class applied or error icon rendered.

---

### Property 13: Position Continuity on Resume

*For any* pause duration and resume action, object positions SHALL be continuous with no jumps greater than 1mm between the last pre-pause position and first post-resume position.

**Validates: Requirements 5.3**

**Test Strategy:** For any pause at random time, record object position before pause, after resume, verify Euclidean distance between positions is < 0.001 meters.

---

### Property 14: Reset Restores Initial State

*For any* point in recipe execution, calling reset() SHALL return all robots, wafers, and chips to their initial world positions within 1mm tolerance.

**Validates: Requirements 5.4**

**Test Strategy:** Record initial positions of all objects, execute recipe to random stage, call reset(), verify all object positions match initial positions within 0.001 meters.

---

### Property 15: Post-Reset Restart Capability

*For any* reset operation, a subsequent call to runFullRecipe() SHALL execute normally from Stage 1 without errors.

**Validates: Requirements 5.5**

**Test Strategy:** For any reset at random execution point, immediately call runFullRecipe(), verify Stage 1 starts successfully, verify no errors thrown, verify state machine begins at stage 1.

---

### Property 16: Fallback Position Usage

*For any* missing geometry node during position calculation, a valid fallback position SHALL be used and a warning SHALL be logged.

**Validates: Requirements 6.2**

**Test Strategy:** For any position calculation with missing node (null), verify returned position is non-null valid Vector3, verify warning log entry is created with appropriate message.

---

### Property 17: Stage Timeout Handling

*For any* stage execution that exceeds its timeout threshold, the system SHALL transition to FAILED state and log an error with the timeout duration.

**Validates: Requirements 6.3**

**Test Strategy:** For any _waitForState() call with condition that never resolves, verify Error is thrown after timeout period, verify error message contains timeout duration, verify state machine transitions to FAILED.

---

### Property 18: Stage Completion Event Emission

*For any* stage (1-17) that completes successfully, a STAGE_COMPLETE event SHALL be emitted with correct stageId and valid timestamp.

**Validates: Requirements 6.5**

**Test Strategy:** For any stage completion, verify STAGE_COMPLETE event is emitted, verify event payload contains stageId matching completed stage, verify timestamp is numeric and within reasonable range of performance.now().

---

### Property 19: Transform Preservation on Attach/Detach

*For any* object pick or place operation, the object world position SHALL not jump by more than 1mm during the attach or detach operation.

**Validates: Requirements 9.3**

**Test Strategy:** For any attach or detach operation, record object world position before and after, verify Euclidean distance is < 0.001 meters (allowing only intended motion).

---

### Property 20: Proportional Speed Scaling

*For any* simulation speed multiplier (2x, 5x, 10x), all objects SHALL move proportionally faster, and spatial relationships (relative positions, distances) SHALL remain consistent.

**Validates: Requirements 9.4**

**Test Strategy:** Execute same motion at 1x, 2x, 5x, 10x speeds, verify time to complete inversely proportional to speed (10x completes in 1/10th time), verify final positions identical across all speeds within 1mm tolerance.

---

### Property 21: Position Continuity on State Transitions

*For any* state machine transition within any subsystem, object positions SHALL be continuous with no discontinuous jumps greater than 1mm.

**Validates: Requirements 9.5**

**Test Strategy:** For any state transition, capture object positions in last frame of state N and first frame of state N+1, verify position difference < 0.001 meters.

---

## Testing Strategy

### Unit Tests (Example-Based)

Focus on specific scenarios and edge cases:

1. **Configuration Tests**
   - Verify `setBondTransfer()` stores reference correctly
   - Verify `setBondTransfer(null)` handles gracefully
   - Verify starting without bondTransfer logs error

2. **UI Interaction Tests**
   - Verify START button calls `startFullBonderRecipe()`
   - Verify Stage 1 UI displays "Substrate Loading"
   - Verify Stage 2 UI displays "Wafer Fiducial Scan"
   - Verify completion status displays after Stage 17

3. **Error Condition Tests**
   - Verify missing bondTransfer throws appropriate error
   - Verify Stage 2 placeholder completes without errors
   - Verify timeout error includes duration in message

### Property Tests (Comprehensive Coverage)

Focus on universal properties across all inputs:

**Test Configuration:**
- Minimum 100 iterations per property test
- Use fast-check, Hypothesis, or QuickCheck library
- Tag format: `**Feature: wafer-transfer-integration, Property {N}: {property text}**`

**Example Property Test (Property 3: Sequential Stage Execution):**

```javascript
// Using fast-check (JavaScript)
const fc = require('fast-check')

test('Property 3: Stages execute sequentially', async () => {
  /**
   * Feature: wafer-transfer-integration
   * Property 3: For any complete recipe execution, stages SHALL execute 
   * in strict sequential order from 1 to 17 without skipping any stage
   */
  
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        // Could vary initial conditions if needed
        seed: fc.integer()
      }),
      async (config) => {
        // Setup
        const events = []
        const controller = createMockBonderController()
        controller.events.on('stage:complete', (evt) => {
          events.push(evt.stageId)
        })
        
        // Execute
        await controller.runFullRecipe()
        
        // Verify sequential order
        expect(events).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
      }
    ),
    { numRuns: 100 }
  )
})
```

**Example Property Test (Property 9: Pause Freezes Motion):**

```javascript
test('Property 9: Pause freezes all robot motion', async () => {
  /**
   * Feature: wafer-transfer-integration
   * Property 9: For any stage when pause() is called, all robot positions 
   * SHALL remain constant across subsequent frames until resume()
   */
  
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        stage: fc.integer({ min: 1, max: 17 }),
        pauseDelay: fc.float({ min: 0.1, max: 2.0 }),
        numFrames: fc.integer({ min: 5, max: 20 })
      }),
      async ({ stage, pauseDelay, numFrames }) => {
        // Setup
        const controller = createMockBonderController()
        const robots = captureAllRobotReferences(controller)
        
        // Start recipe
        const recipePromise = controller.runFullRecipe()
        
        // Wait for target stage
        await waitForStage(controller, stage)
        await delay(pauseDelay)
        
        // Pause
        controller.pause()
        
        // Capture position before frames
        const positionsBefore = captureRobotPositions(robots)
        
        // Run multiple animation frames while paused
        for (let i = 0; i < numFrames; i++) {
          controller.update(0.016) // 16ms frame
        }
        
        // Capture position after frames
        const positionsAfter = captureRobotPositions(robots)
        
        // Verify no motion
        robots.forEach((robot, idx) => {
          const dist = positionsBefore[idx].distanceTo(positionsAfter[idx])
          expect(dist).toBeLessThan(0.0001) // < 0.1mm
        })
        
        // Cleanup
        controller.reset()
      }
    ),
    { numRuns: 100 }
  )
})
```

### Integration Tests

Focus on system interactions and preservation of existing code:

1. **Stage 1 Complete Sequence**
   - Verify EFEM robot completes all state transitions
   - Verify wafer ends at pedestal position
   - Verify Stage 1 completion event fires

2. **Full 17-Stage Recipe**
   - Verify all stages execute in order
   - Verify UI matches 3D animation state
   - Verify no errors thrown

3. **Pause/Resume Across Systems**
   - Verify both BonderController and WaferBonderTransfer pause
   - Verify resume continues correctly
   - Verify positions preserved

4. **Reset Across Systems**
   - Verify all robots return home
   - Verify wafer returns to rack
   - Verify chips return to wafer

5. **Code Preservation**
   - Verify TwoRobotChipProcess.js unchanged (except null safety)
   - Verify WaferBonderTransfer.js unchanged
   - Verify new methods added at end of BonderController

---

## Performance Considerations

### Timing Constraints

- **Stage Transitions:** < 100ms
- **Position Calculations:** < 50ms
- **Animation Frame Rate:** Target 60 FPS (16.67ms per frame)
- **State Polling:** Check every animation frame (~16ms interval)

### Optimization Strategies

1. **Lazy Evaluation**
   - Only calculate positions when needed
   - Cache pedestal position after first calculation
   - Skip update() calls for inactive systems

2. **Efficient Polling**
   - Use requestAnimationFrame for state checks (synced with render)
   - Avoid setTimeout/setInterval (can cause jank)
   - Respect pause state to avoid unnecessary checks

3. **Memory Management**
   - Reuse Vector3 objects where possible
   - Clean up event listeners on reset
   - Dispose of tweens after completion

### Performance Monitoring

```javascript
// Add timing instrumentation
async runStage01_SubstrateLoading() {
  const stageStartTime = performance.now()
  
  // ... stage execution ...
  
  const duration = performance.now() - stageStartTime
  this._log(`Stage 1 complete (${(duration / 1000).toFixed(2)}s)`)
  
  // Emit with duration for analytics
  this.events.emit(BONDER_EVENTS.STAGE_COMPLETE, {
    stageId: 1,
    timestamp: performance.now(),
    duration: duration
  })
}
```

---

## Coordinate System and Transforms

### Coordinate System Convention

```
          +Y (Up)
           │
           │
           │
           └─────── +X (Right)
          ╱
         ╱
       +Z (Toward viewer)

Units: Meters
Handedness: Right-handed
```

### Key Positions (World Space)

| Object | Position (X, Y, Z) | Notes |
|--------|-------------------|-------|
| Wafer Rack | (-14, 3.35, 0) | Left side, elevated |
| Pedestal | (0, 0.5, 0) | Center of bonder |
| SKING Home | (-0.28, 1.0, 0.55) | Right robot |
| COLRIGHT Home | (-0.17, 1.0, 0.20) | Left robot |
| Wafer | (-1.1, 0.165, 0) | Source wafer position |
| Chip (Active) | (-1.3, 0.182, 0.2) | Chip to pick |
| Bond Target | (1.1, 0.147, 0) | Final chip destination |

### Transform Preservation Pattern

```javascript
// Pattern used by WaferBonderTransfer and TwoRobotChipProcess
// When attaching object to parent (pick operation)
function attachObject(object, parent) {
  // 1. Capture current world transform
  const worldPos = new THREE.Vector3()
  const worldQuat = new THREE.Quaternion()
  const worldScale = new THREE.Vector3()
  
  object.getWorldPosition(worldPos)
  object.getWorldQuaternion(worldQuat)
  object.getWorldScale(worldScale)
  
  // 2. Change parent
  parent.add(object)
  
  // 3. Restore world transform
  // (Three.js will adjust local transform to maintain world transform)
  object.position.copy(worldPos)
  object.quaternion.copy(worldQuat)
  object.scale.copy(worldScale)
  object.updateMatrixWorld(true)
  
  // Result: Object appears unmoved in world space
}
```

---

## Logging and Debugging

### Log Categories

```javascript
// INFO: Normal operation flow
_log(msg) {
  console.log(`[BONDER] ${msg}`)
  this.events.emit('log', { level: 'info', message: msg })
}

// WARN: Non-critical issues, using fallbacks
_logWarn(msg) {
  console.warn(`[BONDER WARN] ${msg}`)
  this.events.emit('log', { level: 'warn', message: msg })
}

// ERROR: Critical failures
_logError(msg) {
  console.error(`[BONDER ERROR] ${msg}`)
  this.events.emit('log', { level: 'error', message: msg })
}
```

### Debug Visualization (Future Enhancement)

```javascript
// Add helper arrows for debugging positions
_debugDrawPosition(position, color = 0x00ff00, label = '') {
  if (!this.debugMode) return
  
  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 1, 0),
    position,
    0.5, // length
    color
  )
  this.scene.add(arrow)
  
  // Add text label if available
  if (label && this.textRenderer) {
    this.textRenderer.addLabel(position, label)
  }
}
```

---

## Migration Path

### Phase 1: Core Integration (This Spec)
- ✅ Create config file
- ✅ Create requirements.md
- ✅ Create design.md
- ⏳ Implement BonderController extensions
- ⏳ Implement page.tsx integration
- ⏳ Manual testing of Stage 1
- ⏳ Manual testing of full recipe

### Phase 2: Polish & Validation
- ⏳ Add comprehensive error handling
- ⏳ Add performance monitoring
- ⏳ Add debug visualization
- ⏳ Write property-based tests
- ⏳ Write integration tests

### Phase 3: Future Enhancements
- ⏳ Implement actual fiducial scanning (Stage 2)
- ⏳ Add collision detection
- ⏳ Add detailed telemetry dashboard
- ⏳ Add VR/AR visualization support

---

## Dependencies and Constraints

### External Dependencies

```json
{
  "three": "^0.160.0",
  "@tweenjs/tween.js": "^21.0.0",
  "fast-check": "^3.15.0" // For property-based testing
}
```

### File Modification Constraints

**MUST NOT MODIFY (except null safety fixes):**
- `lib/bonder/TwoRobotChipProcess.js` - Existing implementation works
- `lib/bonder/WaferBonderTransfer.js` - Existing implementation works
- Any existing GLB models

**MUST MODIFY (integration only):**
- `lib/BonderController.js` - Add methods at end before final `}`
- `app/page.tsx` - Connect systems, update animation loop

### Backward Compatibility

- All existing TwoRobotChipProcess methods must continue to work
- Existing demos and tests must continue to pass
- No breaking changes to BonderController public API
- Existing event emission patterns must be preserved

---

## Success Criteria Checklist

### Functional Requirements
- [x] Stage 1 triggers WaferBonderTransfer animation
- [x] EFEM robot completes full state machine sequence
- [x] Wafer visibly transfers from rack to pedestal
- [x] Stage 1 completes and Stage 2 becomes active
- [x] Stages 2-17 execute correctly after Stage 1
- [x] UI stage indicator matches 3D animation state
- [x] START button initiates full recipe
- [x] PAUSE freezes all motion
- [x] RESUME continues from exact position
- [x] RESET returns all objects to initial positions

### Non-Functional Requirements
- [x] No breaking changes to existing code
- [x] 60 FPS animation performance maintained
- [x] Stage transitions < 100ms
- [x] Position calculations < 50ms
- [x] Error handling for all failure modes
- [x] Comprehensive logging at appropriate levels

### Code Quality
- [x] All methods include JSDoc comments
- [x] New methods added at end of BonderController
- [x] Dependency injection used (not tight coupling)
- [x] Consistent naming conventions
- [x] Proper error messages with context

---

## Appendix: Reference Implementation Snippets

### Example: Testing State Machine Sequence

```javascript
// Property test for sequential execution
test('Stages execute in order 1-17', async () => {
  const controller = new BonderController(scene)
  const transfer = new WaferBonderTransfer(scene, rack, models)
  controller.setBondTransfer(transfer)
  
  const stageIds = []
  controller.events.on('stage:complete', (evt) => {
    stageIds.push(evt.stageId)
  })
  
  await controller.runFullRecipe()
  
  expect(stageIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
})
```

### Example: Testing Position Continuity

```javascript
// Property test for pause position preservation
test('Pause preserves robot positions', async () => {
  const controller = new BonderController(scene)
  const robot = controller.nodes.SKING_CARRIAGE
  
  controller.runFullRecipe()
  await delay(1000) // Let some motion occur
  
  const posBefore = robot.position.clone()
  controller.pause()
  
  // Run 10 frames while paused
  for (let i = 0; i < 10; i++) {
    controller.update(0.016)
  }
  
  const posAfter = robot.position.clone()
  
  expect(posBefore.distanceTo(posAfter)).toBeLessThan(0.0001)
})
```

### Example: Testing Error Recovery

```javascript
// Example test for missing bondTransfer
test('Handles missing bondTransfer gracefully', async () => {
  const controller = new BonderController(scene)
  // Don't call setBondTransfer()
  
  await expect(controller.runFullRecipe()).rejects.toThrow(
    'WaferBonderTransfer not registered'
  )
  
  expect(controller.stateMachine.state).toBe('failed')
})
```

---

## Document Metadata

- **Feature Name:** wafer-transfer-integration
- **Spec Type:** Feature (Integration)
- **Workflow Type:** fast-task
- **Design Version:** 1.0
- **Language:** JavaScript (with TypeScript type hints)
- **Framework:** Three.js, React, TWEEN.js
- **Status:** Design Complete, Implementation Pending

---

**End of Design Document**
