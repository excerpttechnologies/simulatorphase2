# Requirements: Wafer Transfer Integration

## Feature Overview

Integrate the existing WaferBonderTransfer system with BonderController to connect Stage 1 (Substrate Loading) UI with the actual 3D EFEM robot animation. This integration will complete the visual representation of the full 17-stage flip-chip bonding recipe.

## Background

The flip-chip bonder simulation currently has:
- A working BonderController that manages the 17-stage recipe
- A working TwoRobotChipProcess (SKING and COLRIGHT robots) that handles Stages 3-17
- A working WaferBonderTransfer (EFEM robot) that can transfer wafers from rack to bonder
- A UI that shows all 17 stages but Stage 1 has no visible animation

**The Problem:** Stage 1 UI says "Substrate Loading" but no 3D robot animation occurs. The wafer appears on the pedestal without visible transfer.

**The Solution:** Connect WaferBonderTransfer to BonderController's recipe execution so Stage 1 triggers the EFEM robot animation.

---

## Requirement 1

**User Story:** As a simulation user, I want to see the EFEM robot transfer the substrate wafer from the rack to the bonder during Stage 1, so that I understand the complete flip-chip bonding process.

### Acceptance Criteria

1. WHEN the user clicks START THEN the system SHALL begin Stage 1 with the EFEM robot moving to the wafer rack
2. WHEN Stage 1 is active THEN the system SHALL execute the complete WaferBonderTransfer animation sequence (R2FOUP → APPROACH → CONTACT → ATTACH → LIFT → TRAVEL → LOWER → PLACE → RETRACT → HOME)
3. WHEN the EFEM robot completes the wafer transfer THEN the system SHALL mark Stage 1 as complete and proceed to Stage 2
4. WHEN Stage 1 completes THEN the substrate wafer SHALL be visibly placed on the bonder pedestal
5. WHEN the animation is running THEN the system SHALL preserve existing coordinate system conventions (Y-axis vertical)

---

## Requirement 2

**User Story:** As a developer, I want BonderController to manage both the EFEM wafer transfer and the two-robot chip process, so that the entire 17-stage recipe is orchestrated by a single controller.

### Acceptance Criteria

1. WHEN BonderController is initialized THEN the system SHALL provide a method to register the WaferBonderTransfer instance
2. WHEN runFullRecipe() is called THEN the system SHALL execute Stage 1 (wafer transfer), Stage 2 (fiducial scan), and Stages 3-17 (two-robot process) in sequence
3. WHEN executing Stage 1 THEN the system SHALL calculate the source position (wafer rack) and destination position (bonder pedestal) from actual 3D model geometry
4. WHEN a stage animation is in progress THEN the system SHALL wait for completion before proceeding to the next stage
5. WHEN an error occurs during any stage THEN the system SHALL transition to a failed state and emit appropriate error events

---

## Requirement 3

**User Story:** As a developer, I want the animation loop to update both the wafer transfer system and the bonder system, so that all 3D animations run smoothly.

### Acceptance Criteria

1. WHEN the animation loop executes THEN the system SHALL call update() on both BonderController and WaferBonderTransfer with the time delta scaled by simulation speed
2. WHEN WaferBonderTransfer is not running THEN the system SHALL skip its update call to avoid unnecessary processing
3. WHEN the simulation speed changes THEN the system SHALL apply the speed multiplier to both systems uniformly
4. WHEN BonderController is paused THEN the system SHALL prevent all updates to both systems
5. WHEN the animation frame rate drops THEN the system SHALL maintain consistent motion by using delta time rather than frame count

---

## Requirement 4

**User Story:** As a simulation user, I want the UI stage indicator to accurately reflect which stage is currently executing, so that I can track the bonding process.

### Acceptance Criteria

1. WHEN Stage 1 begins THEN the UI SHALL display "Stage 1: Substrate Loading" as active
2. WHEN Stage 1 completes THEN the UI SHALL transition to "Stage 2: Wafer Fiducial Scan" as active
3. WHEN any stage is active THEN the UI SHALL visually highlight that stage in the process flow panel
4. WHEN a stage fails THEN the UI SHALL display an error indicator on that stage
5. WHEN the process completes all 17 stages THEN the UI SHALL display a completion status

---

## Requirement 5

**User Story:** As a simulation user, I want to control the bonding process with START, PAUSE, RESUME, and RESET buttons, so that I can interact with the simulation.

### Acceptance Criteria

1. WHEN the user clicks START THEN the system SHALL begin executing the full 17-stage recipe from Stage 1
2. WHEN the user clicks PAUSE during any stage THEN the system SHALL freeze all robot movements and animations
3. WHEN the user clicks RESUME after pausing THEN the system SHALL continue the animation from the exact position where it was paused
4. WHEN the user clicks RESET at any time THEN the system SHALL return all robots, wafers, and chips to their initial positions and reset the stage counter to 0
5. WHEN RESET completes THEN the system SHALL be ready to start a new recipe execution

---

## Requirement 6

**User Story:** As a developer, I want proper error handling and logging throughout the integration, so that issues can be diagnosed and debugged.

### Acceptance Criteria

1. WHEN BonderController attempts to use WaferBonderTransfer but it is not registered THEN the system SHALL log an error and skip Stage 1
2. WHEN position calculation fails for rack or pedestal THEN the system SHALL log a warning and use fallback positions
3. WHEN a stage times out waiting for completion THEN the system SHALL log an error with the timeout duration and transition to failed state
4. WHEN robot calibration fails due to missing nodes THEN the system SHALL log detailed information about which nodes are missing
5. WHEN any stage completes successfully THEN the system SHALL emit a stage completion event with stage ID and timestamp

---

## Requirement 7

**User Story:** As a developer, I want the integration to preserve all existing working code, so that the two-robot chip process (Stages 3-17) continues to work correctly.

### Acceptance Criteria

1. WHEN the integration is implemented THEN the system SHALL NOT modify the core logic of TwoRobotChipProcess
2. WHEN the integration is implemented THEN the system SHALL NOT modify the core logic of WaferBonderTransfer
3. WHEN Stages 3-17 execute THEN the system SHALL use the existing TwoRobotChipProcess methods without changes
4. WHEN adding new methods to BonderController THEN the system SHALL append them at the end of the class before the final closing brace
5. WHEN integrating systems THEN the system SHALL use dependency injection (setBondTransfer) rather than tight coupling

---

## Requirement 8

**User Story:** As a developer, I want clear separation between wafer-level operations (Stage 1) and chip-level operations (Stages 3-17), so that the code is maintainable and understandable.

### Acceptance Criteria

1. WHEN Stage 1 executes THEN the system SHALL use WaferBonderTransfer exclusively for wafer handling
2. WHEN Stages 3-17 execute THEN the system SHALL use TwoRobotChipProcess exclusively for chip handling
3. WHEN Stage 2 executes THEN the system SHALL provide a placeholder implementation that logs and completes immediately
4. WHEN a developer reads the code THEN the system SHALL have clear method names that indicate whether they handle wafer-level or chip-level operations
5. WHEN extending the system in the future THEN the system SHALL allow independent modification of wafer transfer and chip process subsystems

---

## Requirement 9

**User Story:** As a simulation user, I want smooth, realistic robot motion during all stages, so that the simulation accurately represents the physical bonding process.

### Acceptance Criteria

1. WHEN the EFEM robot moves THEN the system SHALL use inverse kinematics to calculate realistic joint angles
2. WHEN the EFEM robot travels from rack to bonder THEN the system SHALL use Bezier curves for smooth path interpolation
3. WHEN objects are picked up or placed THEN the system SHALL preserve world transforms to prevent teleportation
4. WHEN the simulation speed is increased (2x, 5x, 10x) THEN the system SHALL maintain correct mechanical relationships between all moving parts
5. WHEN robots reach their target positions THEN the system SHALL transition states smoothly without visible jumps or discontinuities

---

## Requirement 10

**User Story:** As a developer, I want comprehensive testing coverage for the integration, so that regressions can be caught early.

### Acceptance Criteria

1. WHEN Stage 1 is tested THEN the system SHALL verify the EFEM robot completes all state transitions in the correct order
2. WHEN the full recipe is tested THEN the system SHALL verify all 17 stages execute in sequence without errors
3. WHEN PAUSE/RESUME is tested THEN the system SHALL verify robot positions are preserved across pause boundaries
4. WHEN RESET is tested THEN the system SHALL verify all objects return to their initial positions and the process can be restarted
5. WHEN error conditions are tested THEN the system SHALL verify appropriate error handling and state transitions occur

---

## Non-Functional Requirements

### Performance
- Stage transitions SHALL complete within 100ms
- Position calculations SHALL complete within 50ms
- The system SHALL maintain 60 FPS animation during all stages

### Reliability
- The system SHALL handle missing 3D model nodes gracefully with fallback positions
- The system SHALL recover from transient errors without requiring page reload
- The system SHALL maintain consistent state across all subsystems

### Maintainability
- All new methods SHALL include JSDoc comments explaining parameters and return values
- All state transitions SHALL be logged with appropriate severity levels
- The code SHALL follow the existing project conventions and patterns

### Compatibility
- The integration SHALL work with the existing Three.js scene graph structure
- The integration SHALL work with the existing TWEEN.js animation system
- The integration SHALL work with the existing event emission pattern

---

## Out of Scope

The following items are explicitly out of scope for this integration:

1. ❌ Implementing actual fiducial scanning logic in Stage 2 (placeholder only)
2. ❌ Adding collision detection between robots and environment
3. ❌ Creating new 3D models or modifying existing GLB files
4. ❌ Implementing temperature control or heating simulation
5. ❌ Adding networking or remote control capabilities
6. ❌ Creating automated test scripts (manual testing only for this phase)
7. ❌ Refactoring or rewriting existing working code
8. ❌ Adding VR/AR visualization capabilities

---

## Dependencies

### Required 3D Model Nodes (from flip_chip_bonder.glb)
- SKING_PICKUP_NOZZLE
- SKING_ARM_TIP_ANCHOR
- SKING_CARRIAGE
- COLRIGHT_CARRIAGE
- COLRIGHT_VERTICAL_AXIS
- PEDESTAL or RING_VACUUM_PEDESTAL or SKING_PEDESTAL
- WAFER
- CHIP_01, CHIP_02, etc.
- BONDBASE_TARGET

### Required External Systems
- WaferBonderTransfer class (already exists)
- TwoRobotChipProcess class (already exists)
- BonderStateMachine class (already exists)
- Three.js library
- TWEEN.js library

### Required Coordinate System Conventions
- Y-axis is vertical (up direction)
- Units are in meters
- World space coordinates for all position calculations

---

## Acceptance Testing Scenarios

### Scenario 1: Complete Recipe Execution
```
GIVEN the simulation is loaded and initialized
WHEN the user clicks START
THEN Stage 1 begins with EFEM robot moving to rack
AND the EFEM robot picks the wafer from rack slot
AND the EFEM robot travels to the bonder
AND the EFEM robot places the wafer on the pedestal
AND Stage 1 completes and Stage 2 becomes active
AND Stage 2 completes and Stage 3 becomes active
AND Stages 3-17 execute using the two-robot process
AND all stages complete successfully
AND the UI shows "Process Complete"
```

### Scenario 2: Pause and Resume
```
GIVEN Stage 1 is executing with the EFEM robot in transit
WHEN the user clicks PAUSE
THEN all robot motion freezes immediately
AND the UI shows "Paused" status
WHEN the user clicks RESUME after 5 seconds
THEN the EFEM robot continues from the exact paused position
AND the animation completes normally
```

### Scenario 3: Reset During Execution
```
GIVEN Stage 5 is executing with COLRIGHT robot holding a chip
WHEN the user clicks RESET
THEN all robots return to home positions
AND the chip returns to the wafer
AND the wafer returns to the rack
AND the stage counter resets to 0
AND the UI shows "Ready" status
WHEN the user clicks START again
THEN the process executes correctly from Stage 1
```

### Scenario 4: Error Recovery
```
GIVEN the BonderController is initialized without WaferBonderTransfer
WHEN the user clicks START
THEN the system logs an error about missing bondTransfer
AND the system skips Stage 1
AND the system proceeds to Stage 2
AND the remaining stages execute normally
```

---

## Glossary

- **EFEM Robot**: Equipment Front End Module robot that transfers wafers between rack and bonder
- **SKING Robot**: The robot with a vacuum nozzle that receives chips, dips them in flux, and places them on the substrate
- **COLRIGHT Robot**: The robot that picks chips from the wafer, flips them 180°, and hands them off to SKING
- **Substrate**: The target wafer or board onto which chips will be bonded
- **Die/Chip**: Individual semiconductor chips picked from the source wafer
- **Pedestal**: The platform on the bonder where the substrate rests during the bonding process
- **Flip-Chip Bonding**: A process where chips are flipped upside-down and bonded directly to a substrate
- **Thermocompression Bonding (TCB)**: A bonding process using heat and pressure to create electrical connections
- **World Transform**: The global 3D position, rotation, and scale of an object in the scene
- **IK (Inverse Kinematics)**: Mathematical technique to calculate joint angles needed to position a robot's end effector
- **Bezier Curve**: A smooth mathematical curve used for path interpolation

