# Implementation Plan: Wafer Transfer Integration

## Overview

Integrate the existing WaferBonderTransfer (EFEM robot) with BonderController to connect Stage 1 (Substrate Loading) UI with actual 3D animation. This implementation adds orchestration methods to BonderController, updates the simulation component to wire the systems together, and ensures all 17 stages execute sequentially with proper state management.

## Tasks

- [x] 1. Add BonderController integration infrastructure
  - [x] 1.1 Add bondTransfer property and setBondTransfer method to BonderController
    - Add `this.bondTransfer = null` property in constructor
    - Add `this.recipeInProgress = false` and `this.currentRecipePromise = null` properties
    - Implement `setBondTransfer(transfer)` method to register WaferBonderTransfer instance
    - Connect transfer logging to bonder's log system
    - _Requirements: 2.1, 7.5_
  
  - [x] 1.2 Add helper methods for async operations
    - Implement `_waitForState(condition, timeout, errorMessage)` with pause awareness
    - Implement `_delay(ms)` with pause awareness
    - Both methods should respect `this.paused` state
    - _Requirements: 2.4, 5.2_
  
  - [x] 1.3 Add position calculation methods
    - Implement `_calculateRackPosition()` to find wafer rack in scene
    - Implement `_calculatePedestalPosition()` to find bonder pedestal
    - Use fallback positions if nodes not found
    - Log warnings when using fallback positions
    - _Requirements: 2.3, 6.2_

- [x] 2. Implement Stage 1 execution
  - [x] 2.1 Implement runStage01_SubstrateLoading method
    - Validate bondTransfer is configured
    - Update state machine to Stage 1
    - Calculate source (rack) and destination (pedestal) positions
    - Start wafer transfer with calculated positions
    - Wait for transfer completion with 15-second timeout
    - Mark stage complete and emit STAGE_COMPLETE event
    - Handle errors with proper logging and state machine updates
    - _Requirements: 1.1, 1.2, 1.3, 2.4, 6.3_
  
  - [x] 2.2 Implement runStage02_FiducialScan placeholder method
    - Log "Scanning fiducial marks (placeholder)"
    - Simulate 500ms scan duration
    - Mark stage complete and emit STAGE_COMPLETE event
    - _Requirements: 2.2, 8.3_

- [x] 3. Implement full recipe orchestration
  - [x] 3.1 Implement runFullRecipe method
    - Check if recipe already in progress
    - Execute Stage 1 (substrate loading)
    - Execute Stage 2 (fiducial scan)
    - Execute Stages 3-17 (runTwoRobotRecipe)
    - Handle errors and transition to failed state on exceptions
    - Emit RECIPE_COMPLETE event on success
    - _Requirements: 2.2, 2.5, 8.1, 8.2_

- [ ] 4. Update control methods for wafer transfer
  - [-] 4.1 Enhance pause method to pause wafer transfer
    - Call `bondTransfer.pause()` if bondTransfer exists
    - _Requirements: 5.2, 3.4_
  
  - [-] 4.2 Enhance resume method to resume wafer transfer
    - Call `bondTransfer.resume()` if bondTransfer exists
    - _Requirements: 5.3_
  
  - [-] 4.3 Enhance reset method to reset wafer transfer
    - Call `bondTransfer.reset()` if bondTransfer exists
    - Reset recipeInProgress flag
    - _Requirements: 5.4, 5.5_

- [ ] 5. Integrate systems in simulation component
  - [~] 5.1 Connect BonderController and WaferBonderTransfer
    - Find the initialization code in FlipChipBonder.jsx or page.tsx
    - After both systems are initialized, call `bonderController.setBondTransfer(bondTransfer)`
    - Add console log to confirm connection
    - _Requirements: 2.1, 7.5_
  
  - [~] 5.2 Update animation loop to drive both systems
    - Ensure BonderController.update(dt * speed) is called when not paused
    - Add conditional update for WaferBonderTransfer only when isRunning()
    - Pass same time delta and speed multiplier to both systems
    - _Requirements: 3.1, 3.2, 3.3_
  
  - [~] 5.3 Add full recipe control method
    - Implement `startFullBonderRecipe()` method
    - Check if BonderController is ready
    - Check if recipe already running
    - Call `bonderController.runFullRecipe()` with error handling
    - _Requirements: 5.1_
  
  - [~] 5.4 Update UI control button handlers
    - Connect START button to `startFullBonderRecipe()`
    - Verify PAUSE button calls `pauseBonder()`
    - Verify RESUME button calls `resumeBonder()`
    - Verify RESET button calls `resetBonder()`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [~] 6. Checkpoint - Verify Stage 1 integration
  - Manually test Stage 1 execution
  - Verify EFEM robot moves to rack
  - Verify wafer picks up and transfers to pedestal
  - Verify Stage 1 completes and Stage 2 becomes active
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Test full recipe execution
  - [~] 7.1 Test complete 17-stage sequence
    - Start full recipe and observe all stages
    - Verify stages execute in order 1-17
    - Verify UI highlights match active stage
    - Verify RECIPE_COMPLETE event fires after Stage 17
    - _Requirements: 1.4, 2.2, 4.3_
  
  - [~] 7.2 Test error handling scenarios
    - Test starting without bondTransfer configured
    - Test Stage 1 with missing geometry nodes (fallback positions)
    - Verify error logs and state machine transitions
    - _Requirements: 6.1, 6.2, 6.3_

- [ ] 8. Test pause/resume/reset functionality
  - [~] 8.1 Test pause during Stage 1
    - Start recipe and pause during wafer transfer
    - Verify EFEM robot freezes
    - Verify robot positions remain constant for multiple frames
    - _Requirements: 5.2, 3.4_
  
  - [~] 8.2 Test resume from pause
    - Resume from paused state
    - Verify robot continues from exact position
    - Verify no position jumps or discontinuities
    - _Requirements: 5.3_
  
  - [~] 8.3 Test reset at various stages
    - Reset during Stage 1 (wafer transfer)
    - Reset during Stage 5 (chip process)
    - Reset during Stage 15 (bonding)
    - Verify all objects return to initial positions
    - Verify recipe can restart after reset
    - _Requirements: 5.4, 5.5_

- [ ] 9. Test animation speed scaling
  - [~] 9.1 Test speed multipliers (2x, 5x, 10x)
    - Run Stage 1 at different speeds
    - Verify motion is proportionally faster
    - Verify final positions are consistent across all speeds
    - Verify no animation artifacts or timing issues
    - _Requirements: 3.3, 3.5, 9.4_

- [~] 10. Final checkpoint - Integration validation
  - Run complete end-to-end test of all 17 stages
  - Verify UI stage indicators work correctly
  - Verify error handling for all edge cases
  - Verify pause/resume/reset work in all stages
  - Verify performance maintains 60 FPS
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All BonderController methods should be added at the end of the class before the final closing brace
- Preserve existing TwoRobotChipProcess and WaferBonderTransfer implementations unchanged
- Use dependency injection (setBondTransfer) rather than tight coupling
- All async operations must respect pause state
- Position calculations should use fallback values if geometry nodes missing
- Each stage completion must emit STAGE_COMPLETE event with stageId and timestamp
- Stage 2 is a placeholder implementation only (future: actual fiducial scanning)
- Test tasks verify integration correctness but are not automated test scripts

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3"] },
    { "id": 4, "tasks": ["5.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "5.4"] },
    { "id": 6, "tasks": ["7.1", "7.2"] },
    { "id": 7, "tasks": ["8.1", "8.2", "8.3"] },
    { "id": 8, "tasks": ["9.1"] }
  ]
}
```
