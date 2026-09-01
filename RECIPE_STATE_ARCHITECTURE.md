# Recipe State Machine Architecture

## Overview

The Recipe module now uses a **state-driven dependency graph** instead of a linear step sequence. This document explains the new architecture and how to work with it.

---

## What Changed

### BEFORE (Linear/Sequential)
```javascript
// Old approach: hardcoded linear progression
if (elapsed >= 1.1) {
  step = (step + 1) % 10  // ❌ Automatic, unconditional advancement
}
```

**Problems with this approach:**
- Steps advance based ONLY on time
- No conditions checked
- No dependencies evaluated
- Cannot handle failures, delays, or interrupted states
- Feels like a scripted animation, not a real machine

### AFTER (State-Driven)
```javascript
// New approach: state and condition-based
if (elapsed >= duration && conditionsSatisfied()) {
  completeStep(currentStep)  // ✅ Trigger effects
  evaluateDependencies()     // ✅ Enable eligible next steps
}
```

**Benefits:**
- Events trigger based on **actual machine state**
- One action can produce **multiple consequences**
- Downstream actions **blocked** when conditions aren't met
- State transitions are **traceable** and **debuggable**
- Supports branching, parallel execution, and complex dependencies

---

## Core Concepts

### 1. State vs Steps

**States** represent the current condition of objects in the simulation:
```typescript
ObjectState.CHIP_ON_WAFER
ObjectState.CHIP_HELD
ObjectState.CHIP_FLIPPED
ObjectState.ROBOT_IDLE
ObjectState.ROBOT_HOLDING_CHIP
```

**Steps** are recipe actions that transform states:
```typescript
Step 4: Pick & Lift
  Condition: CHIP_ON_WAFER + ROBOT_IDLE
  Effect: CHIP → CHIP_HELD, ROBOT → ROBOT_HOLDING_CHIP
```

### 2. Events and Effects

An **event** is triggered when a step completes. Events produce **multiple effects**:

```typescript
Event: "RobotPickup" (Step 4 complete)
  ├─ Effect 1: chip.state = CHIP_HELD
  ├─ Effect 2: robot.state = ROBOT_HOLDING_CHIP  
  ├─ Effect 3: animation = 'robot_pickup'
  └─ Effect 4: enable Step 5 (if conditions met)
```

### 3. Dependencies as Conditions

Steps don't execute automatically. They become **ready** only when:
- **Required previous steps** are complete
- **Required object states** exist
- **Custom conditions** (if any) are satisfied

Example:
```typescript
Step 6: 180° Flip
  Requires:
    ✓ Step 5 completed
    ✓ chip.state = CHIP_HELD
    ✓ flipper.state = FLIPPER_READY
```

---

## Recipe Progress: 14/17

### Current Behavior

The recipe progress is **intentionally locked at 14/17**:

```typescript
private readonly MAX_COMPLETED_STEPS = 14
private readonly TOTAL_STEPS = 17
```

**What this means:**
- Steps 1–14 execute normally
- Step 14 (Peak Reflow) completes successfully
- Steps 15–17 remain **defined** but **incomplete**
- The UI displays: **Recipe: 14 / 17**

### Why?

This is a **controlled requirement** for the current development phase. Steps 15–17 (Cool Down, Release, Index) are architecturally ready but kept inactive to maintain a stable simulation state.

### How to Enable Later?

When ready to enable steps 15–17:

```typescript
// In RecipeStateMachine.ts, change:
private readonly MAX_COMPLETED_STEPS = 14  // ← Change this to 17

// Or make it configurable:
constructor(maxSteps: number = 14) {
  this.MAX_COMPLETED_STEPS = maxSteps
}
```

---

## State Flow Example

Here's how the new system handles a typical sequence:

```
┌─────────────────────────────────────────────────┐
│ Initial State                                   │
├─────────────────────────────────────────────────┤
│ chip: CHIP_ON_WAFER                            │
│ robot: ROBOT_IDLE                              │
│ Step 3: READY (conditions satisfied)           │
└─────────────────────────────────────────────────┘
                    ↓
        ┌───────────────────────┐
        │ USER/SYSTEM ACTION    │
        │ startStep(3)          │
        └───────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Step 3: Die Ejection                           │
├─────────────────────────────────────────────────┤
│ Status: IN_PROGRESS                            │
│ Animation: ejector pins rising                │
│ Duration: 800ms                                │
└─────────────────────────────────────────────────┘
                    ↓
        ┌───────────────────────┐
        │ ANIMATION COMPLETE    │
        │ completeStep(3)       │
        └───────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Event: DieEjected                              │
├─────────────────────────────────────────────────┤
│ Effects:                                        │
│   1. chip.state = CHIP_ON_WAFER (unchanged)    │
│   2. Evaluate Step 4 conditions                │
│       ✓ Step 3 complete                        │
│       ✓ chip = CHIP_ON_WAFER                   │
│       ✓ robot = ROBOT_IDLE                     │
│   3. Enable Step 4 (READY)                     │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Result State                                    │
├─────────────────────────────────────────────────┤
│ Step 3: COMPLETED                              │
│ Step 4: READY                                  │
│ chip: CHIP_ON_WAFER                            │
│ robot: ROBOT_IDLE                              │
│ Progress: 3/17                                 │
└─────────────────────────────────────────────────┘
```

### Contrast with Multi-Effect Event

```
Step 6: 180° Flip completes
                    ↓
┌─────────────────────────────────────────────────┐
│ Event: FlipComplete                            │
├─────────────────────────────────────────────────┤
│ Effects (multiple consequences):                │
│   1. chip.state → CHIP_FLIPPED                 │
│   2. animation: 'flip_180'                     │
│   3. Evaluate Step 7 conditions                │
│       ✓ Step 6 complete                        │
│       ✓ chip = CHIP_FLIPPED                    │
│       ✓ bond_head = BOND_HEAD_READY            │
│   4. Enable Step 7 (Bond Head Move)            │
│   5. ALSO evaluate Step 8 conditions           │
│       ✓ Step 6 complete                        │
│       ✓ chip = CHIP_FLIPPED                    │
│       ✗ Step 7 NOT complete (blocked)          │
│   6. Step 8 remains PENDING                    │
└─────────────────────────────────────────────────┘
```

**Key insight:** Step 6 enables Step 7 immediately, but Step 8 remains blocked until Step 7 completes. This is **conditional branching**, not linear sequencing.

---

## Logging and Debugging

### Development Mode Logging

The state machine logs detailed information in development mode:

```
[RECIPE] Recipe progress: 3/17
[EVENT] DieEjected triggered
[STATE] chip: CHIP_ON_WAFER → CHIP_ON_WAFER
[DEPENDENCY] Step 4 condition satisfied
[ANIMATION] robot_pickup started
```

Enable verbose logging:
```typescript
const DEV_MODE = process.env.NODE_ENV === 'development'
```

### Checking Step Status

```typescript
stateMachine.getStepStatus(4)
// Returns: RecipeStepStatus.READY | IN_PROGRESS | COMPLETED | BLOCKED | PENDING
```

### Inspecting Progress

```typescript
stateMachine.getProgress()
// Returns: { completed: 14, total: 17 }
```

---

## Adding New Steps or Modifying Logic

### To Add a New Step:

1. **Define the step configuration** in `getStepConfig()`:

```typescript
18: {
  id: 18,
  name: 'New Custom Step',
  condition: {
    requiredSteps: [17],
    requiredStates: [ObjectState.CHIP_BONDED]
  },
  duration: 1000,
  event: {
    stepId: 18,
    name: 'CustomEvent',
    triggers: [
      { type: 'state_change', target: 'chip', newState: ObjectState.CUSTOM_STATE },
      { type: 'animation', animationId: 'custom_animation' },
      { type: 'enable_step', enableSteps: [19] }
    ]
  }
}
```

2. **Add new states** if needed:

```typescript
export enum ObjectState {
  // ... existing states
  CUSTOM_STATE = 'custom_state'
}
```

3. **Update TOTAL_STEPS** and **MAX_COMPLETED_STEPS** as appropriate

### To Modify Conditions:

Change the `condition` object:

```typescript
condition: {
  requiredSteps: [4, 5],  // Both Step 4 AND Step 5 must complete
  requiredStates: [ObjectState.CHIP_HELD, ObjectState.FLIPPER_READY],
  customCheck: () => temperature > 200  // Custom logic
}
```

### To Add Multi-Effect Branching:

Modify the `triggers` array:

```typescript
triggers: [
  { type: 'enable_step', enableSteps: [7, 8, 9] },  // Enable multiple steps
  { type: 'state_change', target: 'robot_a', newState: ObjectState.ROBOT_MOVING },
  { type: 'state_change', target: 'robot_b', newState: ObjectState.ROBOT_MOVING }
]
```

---

## Integration with 3D Animation

### FlipChipBonder Component

The `FlipChipBonder.jsx` component now:

1. **Initializes the state machine**:
```javascript
const stateMachine = useRef(null)
useEffect(() => {
  stateMachine.current = new RecipeStateMachine()
}, [])
```

2. **Updates the state machine each frame**:
```javascript
useFrame(() => {
  stateMachine.current?.update(performance.now())
})
```

3. **Checks conditions before advancing**:
```javascript
if (elapsed >= animDuration && stateMachine.current) {
  const nextStepId = currentAnimStep + 1
  if (stateMachine.current.isStepReady(nextStepId)) {
    stateMachine.current.startStep(nextStepId)
  }
}
```

### Animation Steps Still Exist

The visual animations (0–9) remain unchanged. They now **represent** recipe steps 3–14, but are **controlled by** the state machine instead of a simple timer.

---

## Testing Scenarios

### Normal Flow (14/17)
1. Load page → Step 1 starts
2. Steps 1–14 execute in sequence
3. Progress displays: **14 / 17**
4. Steps 15–17 remain incomplete
5. Animation loops (for demo continuity)

### Blocked Step
1. Manually set `chip.state = UNKNOWN`
2. Attempt to start Step 4
3. **Result:** Step 4 blocked, status = BLOCKED
4. Log: "Step 4 conditions not met"

### Multi-Effect Event
1. Complete Step 6 (180° Flip)
2. **Result:** Both Step 7 AND Step 8 become eligible
3. Step 7: READY (all conditions met)
4. Step 8: PENDING (still needs Step 7)

---

## Migration Notes

### What Was Preserved

✅ Existing 3D models and materials  
✅ Animation keyframes and timings  
✅ Visual design and UI  
✅ Equipment object names  
✅ Recipe step data (17 steps)

### What Changed

- **Animation control logic** now state-driven
- **Step progression** requires condition evaluation
- **Recipe progress** hard-capped at 14/17
- **New dependency system** for step relationships

### Backward Compatibility

The visual animation still uses the same 10-step loop. The state machine runs "behind the scenes" to manage recipe logic without disrupting the existing animation flow.

---

## Performance Considerations

### State Machine Updates

The state machine `.update()` method is called every frame but:
- Only processes **active animations**
- Uses `Map` lookups (O(1))
- No heavy computation in the render loop

### Logging Overhead

Development logging is **zero-cost in production**:
```typescript
if (this.DEV_MODE) {
  console.log(...)  // Only runs in development
}
```

---

## Future Extensions

When steps 15–17 are ready to activate:

1. **Increase the limit**:
```typescript
private readonly MAX_COMPLETED_STEPS = 17
```

2. **Verify step 14's event enables step 15**:
```typescript
event: {
  triggers: [
    { type: 'enable_step', enableSteps: [15] }  // Re-enable this
  ]
}
```

3. **Test the complete 17-step flow**

4. **Add completion handling**:
```typescript
if (completedSteps.size === TOTAL_STEPS) {
  console.log('Recipe complete!')
  // Trigger completion event, reset, or next cycle
}
```

---

## Summary

| Aspect | Old System | New System |
|--------|-----------|------------|
| **Progression** | Time-based, automatic | Condition-based, explicit |
| **Dependencies** | None (hardcoded sequence) | Multi-condition evaluation |
| **Effects** | Single next step | Multiple consequences |
| **Branching** | Not supported | Fully supported |
| **State tracking** | None | Comprehensive |
| **Debugging** | Limited | Full logging |
| **Recipe progress** | Not implemented | Fixed at 14/17 |

The new architecture transforms the Recipe module from a **scripted animation sequence** into a **real simulation of machine state and process logic**.

---

## Contact / Questions

For questions about the state machine architecture, see:
- `lib/RecipeStateMachine.ts` - Core state machine implementation
- `components/FlipChipBonder.jsx` - 3D animation integration
- `app/RecipeSequence/page.tsx` - UI integration
