# Recipe State Machine — Visual Guide

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        RECIPE STATE MACHINE                         │
│                                                                     │
│  ┌─────────────┐      ┌──────────────┐      ┌──────────────┐     │
│  │   STATES    │ ───▶ │  CONDITIONS  │ ───▶ │    EVENTS    │     │
│  │             │      │              │      │              │     │
│  │ • Chip      │      │ • Required   │      │ • Multi-     │     │
│  │ • Robot     │      │   Steps      │      │   Effect     │     │
│  │ • Equipment │      │ • Required   │      │ • State      │     │
│  │             │      │   States     │      │   Changes    │     │
│  └─────────────┘      └──────────────┘      └──────────────┘     │
│         ▲                                            │             │
│         │                                            │             │
│         └────────────────────────────────────────────┘             │
│                     Feedback Loop                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Linear vs State-Driven Comparison

### ❌ OLD SYSTEM (Linear)

```
Step 1 ──▶ Step 2 ──▶ Step 3 ──▶ Step 4 ──▶ Step 5
  ↓          ↓          ↓          ↓          ↓
Time       Time       Time       Time       Time
(1.1s)     (1.1s)     (1.1s)     (1.1s)     (1.1s)

Problems:
• No state checking
• Automatic advancement
• Cannot handle failures
• No branching
• Fixed timing only
```

### ✅ NEW SYSTEM (State-Driven)

```
                    ┌──────────┐
                    │  Step 1  │
                    │ Substrate│
                    │  Loading │
                    └────┬─────┘
                         │ Condition: Always ready
                         ↓
                    ┌──────────┐
                    │  Step 2  │
                    │ Fiducial │
                    │   Scan   │
                    └────┬─────┘
                         │ Condition: Step 1 complete + CHIP_ON_WAFER
                         ↓
        ┌────────────────┴────────────────┐
        │                                  │
   ┌────▼─────┐                      ┌────▼─────┐
   │  Step 3  │                      │  Future  │
   │   Die    │                      │  Branch  │
   │ Ejection │                      │(example) │
   └────┬─────┘                      └──────────┘
        │ Condition: Step 2 complete + CHIP_ON_WAFER
        ↓
   ┌────────────┐
   │   Step 4   │ ──── State Changes ────┐
   │   Pick &   │                         │
   │    Lift    │ ◀──── Chip = HELD ──────┤
   └────┬───────┘       Robot = HOLDING   │
        │                                  │
        │ Condition: Step 3 + ROBOT_IDLE  │
        ↓                                  │
   [Continue...]                           │
                                          │
Benefits:                                  │
• State validation at every step          │
• Multiple effects per event              │
• Branching supported                     │
• Failure handling                        │
• Dependency tracking                     │
```

---

## Recipe Progress Display

```
┌──────────────────────────────────────────────────────────┐
│  Recipe Sequencer                                        │
│  ─────────────────────────────────────────────────       │
│                                                           │
│  Recipe A: TCB Die Bonding — Pick, Flip & Reflow         │
│                                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Recipe Progress:  14 / 17  (Steps 15-17 pending) │  │
│  │                    ▲▲▲▲▲▲                          │  │
│  │                LOCKED AT 14/17                     │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │                                                    │  │
│  │         [3D Animation Viewport]                   │  │
│  │                                                    │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  Steps 1-14: ✅ Can Execute                               │
│  Steps 15-17: ⏸️ Defined but Inactive                    │
└──────────────────────────────────────────────────────────┘
```

---

## State Transition Example: Pick & Flip Sequence

```
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: Die Ejection                                            │
├─────────────────────────────────────────────────────────────────┤
│ Preconditions:                                                  │
│   ✓ Step 2 (Fiducial Scan) complete                           │
│   ✓ chip.state = CHIP_ON_WAFER                                │
│                                                                 │
│ Event: DieEjected                                              │
│ Effects:                                                        │
│   → chip.state remains CHIP_ON_WAFER                           │
│   → Enable Step 4                                              │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 4: Pick & Lift                                             │
├─────────────────────────────────────────────────────────────────┤
│ Preconditions:                                                  │
│   ✓ Step 3 complete                                            │
│   ✓ robot.state = ROBOT_IDLE                                   │
│                                                                 │
│ Event: RobotPickup                                             │
│ Effects (MULTIPLE):                                             │
│   → chip.state = CHIP_HELD                                     │
│   → robot_sking.state = ROBOT_HOLDING_CHIP                     │
│   → animation: 'robot_pickup'                                  │
│   → Enable Step 5                                              │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 5: Transfer to Pedestal                                    │
├─────────────────────────────────────────────────────────────────┤
│ Preconditions:                                                  │
│   ✓ Step 4 complete                                            │
│   ✓ chip.state = CHIP_HELD                                     │
│   ✓ flipper.state = FLIPPER_READY                             │
│                                                                 │
│ Event: TransferComplete                                         │
│ Effects:                                                        │
│   → robot_sking.state = ROBOT_IDLE                             │
│   → animation: 'transfer_to_pedestal'                          │
│   → Enable Step 6                                              │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 6: 180° Flip                                               │
├─────────────────────────────────────────────────────────────────┤
│ Preconditions:                                                  │
│   ✓ Step 5 complete                                            │
│   ✓ chip.state = CHIP_HELD                                     │
│                                                                 │
│ Event: FlipComplete                                            │
│ Effects (BRANCHING):                                            │
│   → chip.state = CHIP_FLIPPED                                  │
│   → animation: 'flip_180'                                      │
│   → Enable Step 7 (Bond Head Move) ───┐                       │
│   → Enable Step 8 (Pickup)            │                       │
│                                         │                       │
│ Note: Step 8 becomes ELIGIBLE but      │                       │
│       stays PENDING until Step 7       │                       │
│       completes (dependency chain)     │                       │
└─────────────────────────────────────────┴───────────────────────┘
                    ↓                          ↓
         ┌──────────────────┐      ┌──────────────────┐
         │ STEP 7: Ready    │      │ STEP 8: Pending  │
         │ Can execute now  │      │ Waiting for #7   │
         └──────────────────┘      └──────────────────┘
```

---

## Multi-Effect Event Visualization

### Example: Step 4 Completion (RobotPickup)

```
                    ┌────────────────┐
                    │   Step 4       │
                    │   Completes    │
                    └────────┬───────┘
                             │
                   EVENT: RobotPickup
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ↓                   ↓                   ↓
  ┌────────────┐      ┌────────────┐     ┌────────────┐
  │ Effect 1:  │      │ Effect 2:  │     │ Effect 3:  │
  │ chip.state │      │robot.state │     │ Enable     │
  │ = HELD     │      │ = HOLDING  │     │ Step 5     │
  └────────────┘      └────────────┘     └────────────┘
         │                   │                   │
         └───────────────────┴───────────────────┘
                             │
                    ┌────────▼───────┐
                    │  System now    │
                    │  ready for     │
                    │  Step 5        │
                    └────────────────┘

KEY INSIGHT: One completed action triggers MULTIPLE 
            simultaneous consequences, not just one 
            next step.
```

---

## Blocked Step Example

### Scenario: Missing Required State

```
┌────────────────────────────────────────────────────────┐
│ Attempting to start Step 5                             │
├────────────────────────────────────────────────────────┤
│                                                         │
│ Required Conditions:                                    │
│   ✓ Step 4 complete                                    │
│   ✗ chip.state = CHIP_HELD          ◀── MISSING!      │
│   ✓ flipper.state = FLIPPER_READY                     │
│                                                         │
│ Result: Step 5 → BLOCKED                               │
│                                                         │
│ Log Output:                                             │
│   [ERROR] Cannot start step 5: status is pending       │
│   [ERROR] Step 5 conditions not met                    │
│                                                         │
│ Step 5 will NOT execute until chip state is correct.   │
└────────────────────────────────────────────────────────┘

This prevents downstream errors when upstream 
steps fail or are interrupted.
```

---

## Recipe Progress Locking

```
Steps 1-14: EXECUTABLE
────────────────────────────────────────
Step 1:  Substrate Loading      ✅
Step 2:  Wafer Fiducial Scan    ✅
Step 3:  Die Ejection            ✅
Step 4:  Pick & Lift             ✅
Step 5:  Transfer to Pedestal    ✅
Step 6:  180° Flip               ✅
Step 7:  Bond Head Move          ✅
Step 8:  Bond Head Picks Die     ✅
Step 9:  Move to Flux            ✅
Step 10: Dip Flux                ✅
Step 11: Move to Bond Site       ✅
Step 12: Optical Alignment       ✅
Step 13: Touchdown/Preheat       ✅
Step 14: Peak Reflow             ✅
────────────────────────────────────────
         PROGRESS: 14 / 17
────────────────────────────────────────
Steps 15-17: LOCKED (not counted)
────────────────────────────────────────
Step 15: Cool Down               ⏸️
Step 16: Release & Retract       ⏸️
Step 17: Index to Next           ⏸️
────────────────────────────────────────

Code Enforcement:
┌─────────────────────────────────────┐
│ if (completedSteps >= 14) {         │
│   log("Progress locked at 14/17")   │
│   return false                       │
│ }                                    │
└─────────────────────────────────────┘
```

---

## Development Logging Flow

```
Console Output During Execution:
════════════════════════════════════════════════════════════
[RECIPE] Recipe progress: 3/17
[EVENT] DieEjected triggered
[DEPENDENCY] Step 4 condition satisfied

[RECIPE] Recipe progress: 4/17
[EVENT] RobotPickup triggered
[STATE] chip: CHIP_ON_WAFER → CHIP_HELD
[STATE] robot_sking: ROBOT_IDLE → ROBOT_HOLDING_CHIP
[ANIMATION] robot_pickup started
[DEPENDENCY] Step 5 condition satisfied

[RECIPE] Recipe progress: 5/17
[EVENT] TransferComplete triggered
[STATE] robot_sking: ROBOT_HOLDING_CHIP → ROBOT_IDLE
[ANIMATION] transfer_to_pedestal started
[DEPENDENCY] Step 6 condition satisfied

...

[RECIPE] Recipe progress: 14/17
[EVENT] ReflowComplete triggered
[STATE] chip: CHIP_ALIGNED → CHIP_BONDED
[ANIMATION] reflow_pulse started
[LIMIT] Recipe progress locked at 14/17
════════════════════════════════════════════════════════════

Production builds: NO logging overhead
Development mode:  Full visibility into state machine
```

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│ LAYER 1: UI (RecipeSequence/page.tsx)                      │
│ ───────────────────────────────────────────────────────     │
│ • Displays recipe progress: 14/17                          │
│ • Shows 3D viewport                                         │
│ • User controls (if any)                                    │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│ LAYER 2: 3D Animation (FlipChipBonder.jsx)                 │
│ ───────────────────────────────────────────────────────     │
│ • Visual representation of equipment                        │
│ • Animation timing and keyframes                            │
│ • Integrates with state machine                             │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│ LAYER 3: State Machine (RecipeStateMachine.ts)             │
│ ───────────────────────────────────────────────────────     │
│ • Tracks object states                                      │
│ • Evaluates conditions                                      │
│ • Manages step progression                                  │
│ • Enforces dependencies                                     │
│ • Triggers multi-effect events                              │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│ LAYER 4: Data (recipeSteps.ts, types.ts)                   │
│ ───────────────────────────────────────────────────────     │
│ • Recipe step definitions (17 steps)                        │
│ • Type definitions                                          │
│ • Parameter specifications                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Takeaways

### 🎯 Core Principle
**State → Conditions → Events → Effects → New States**

Not: Timer → Next Step

### 🔑 Key Features
1. **Conditional Execution** — Steps only run when ready
2. **Multi-Effect Events** — One action → many consequences
3. **State Tracking** — Full visibility into system state
4. **Dependency Management** — Explicit relationships
5. **Progress Locking** — Controlled at 14/17

### 📊 Status Indicators
- ✅ **COMPLETED** — Step finished successfully
- ▶️ **IN_PROGRESS** — Currently executing
- 🟢 **READY** — Conditions met, can start
- ⏸️ **PENDING** — Waiting for dependencies
- 🚫 **BLOCKED** — Conditions not satisfied
- ❌ **FAILED** — Execution error

### 🔧 Maintenance
- Steps 15-17 ready to activate
- No breaking changes to existing code
- Full backward compatibility
- Extensible architecture

---

## Quick Reference

### Check Step Status
```typescript
stateMachine.getStepStatus(4)
// → RecipeStepStatus.READY
```

### Get Progress
```typescript
stateMachine.getProgress()
// → { completed: 14, total: 17 }
```

### Start a Step
```typescript
stateMachine.startStep(5)
// Returns true if started, false if blocked
```

### Enable Future Steps
Change MAX_COMPLETED_STEPS from 14 to 17 in RecipeStateMachine.ts

---

**For detailed implementation, see:**
- `RECIPE_STATE_ARCHITECTURE.md` — Full technical documentation
- `RECIPE_FIX_SUMMARY.md` — Implementation summary
- `lib/RecipeStateMachine.ts` — Source code
