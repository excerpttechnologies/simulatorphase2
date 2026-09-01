# Quick Start Guide - Enhanced Flip-Chip Bonder

## What Changed

### New Features
1. **Robot 2 (Industrial Gantry)** - Complete second robot for flux dipping and placement
2. **Flux Dipping Station** - Visual flux container with transparent liquid
3. **Real Chip Attachment** - Chip physically attaches to robot tools (no fake movement)
4. **Robot Handoff** - Seamless chip transfer between Robot 1 and Robot 2
5. **16-Step Animation** - Complete pick → flip → flux → place sequence

## Animation Sequence

```
ROBOT 1 (SKING):
  1. Move to wafer → 2. Lower Z-axis → 3. Pickup chip → 4. Lift
  5. Move to flip station → 6. Rotate 180° → 7. Move to handoff

HANDOFF:
  8. Robot 2 approaches → 9. Robot 2 lowers → 10. Chip transfers

ROBOT 2 (New Gantry):
  11. Lift chip → 12. Move to flux → 13. Lower into flux 
  14. Dwell → 15. Lift from flux → 16. Move to bond site → 17. Place

Loop repeats...
```

## Key Improvements

### Robot 1 (SKING)
- ✅ **Real Z-axis movement** - Vertical servo actually moves down/up
- ✅ **Proper chip pickup** - Nozzle aligns with chip center
- ✅ **Physical attachment** - Chip parents to tool, no manual positioning
- ✅ **180° flip** - Rotates around Z-axis, chip follows automatically

### Robot 2 (NEW!)
- ✅ **Industrial design** - Overhead gantry with vertical Z-axis
- ✅ **Independent movement** - Separate X and Y axis control
- ✅ **Vacuum nozzle** - Pickup point at tool tip
- ✅ **Metallic appearance** - Matches industrial flip-chip bonder aesthetic

### Chip Behavior
- ✅ **No teleportation** - Smooth interpolated movement only
- ✅ **Always visible** - Never disappears or duplicates
- ✅ **Proper attachment** - Uses THREE.js parent-child hierarchy
- ✅ **World transform preserved** - No jumping when reparented

### Flux Station
- ✅ **Visible container** - Gray metallic base with corner posts
- ✅ **Transparent flux** - Blue semi-transparent liquid surface
- ✅ **Physical dipping** - Robot lowers chip into flux
- ✅ **Dwell time** - Holds chip in flux for wetting

## How to Run

### 1. Start Development Server
```bash
cd c:\Users\Admin\Downloads\simulator123new\simulator
npm run dev
```

### 2. Open Browser
Navigate to: `http://localhost:3010`

### 3. Watch Animation
The flip-chip bonder will automatically start animating:
- Continuous loop demonstration
- 16-step complete process
- ~17 seconds per cycle

## Camera Controls

- **Rotate**: Left-click + drag
- **Pan**: Right-click + drag (or Middle-click)
- **Zoom**: Scroll wheel

**Tip**: Position camera to view handoff area and flux station clearly

## Understanding the Process

### Phase 1: Pickup (Steps 1-4)
- Robot 1 travels left to the wafer stage
- Lowers Z-axis to reach chip
- Chip attaches to nozzle
- Lifts chip vertically

### Phase 2: Flip (Steps 5-6)
- Robot 1 moves to flip station (center-left)
- Tool rotates 180° around Z-axis
- Chip is now bumps-down

### Phase 3: Handoff (Steps 7-10)
- Robot 1 positions at transfer point (center)
- Robot 2 approaches from right
- Robot 2 lowers Z-axis
- Chip transfers from Robot 1 to Robot 2
- Robot 1 returns home

### Phase 4: Flux (Steps 11-15)
- Robot 2 lifts chip
- Travels right to flux station
- Lowers chip into blue flux liquid
- Dwells for 0.8 seconds (wetting)
- Raises chip out of flux

### Phase 5: Placement (Steps 16-17)
- Robot 2 travels to bond site (far right)
- Lowers chip to substrate
- Releases (placement complete)
- Retracts Z-axis

### Loop
Animation automatically returns to step 1

## Waypoint Positions

| Location | X | Y | Z | Description |
|----------|---|---|---|-------------|
| Wafer Pickup | -1.6 | 0.005 | -0.5 | Initial chip position |
| Flip Station | -0.5 | 0.5 | -0.5 | 180° rotation point |
| Handoff | 0.4 | 0.5 | 0.0 | Robot transfer |
| Flux Approach | 0.4 | 0.4 | 0.5 | Above flux station |
| Flux Dip | 0.4 | 0.02 | 0.5 | Inside flux liquid |
| Bond Target | 1.6 | 0.2 | 0.5 | Final placement |

## Coordinate System

- **X-axis**: Left (−) to Right (+)
- **Y-axis**: Down (−) to Up (+) ← VERTICAL
- **Z-axis**: Back (−) to Front (+)

## Visual Elements

### Color Coding
- **Dark Gray**: Frames and structural members
- **Light Gray**: Linear rails and guides
- **Black**: Motors and drives
- **Gold**: Chip (top surface)
- **Dark Gold**: Chip underside (after flip)
- **Blue (transparent)**: Flux liquid
- **Gray Metallic**: Flux container

### Lighting
- Ambient light: Soft overall illumination
- Directional light: From top-right, casts shadows
- Environment: Warehouse preset (industrial feel)
- Contact shadows: Ground plane shadows

## Technical Details

### Animation Timing
| Action | Duration | Notes |
|--------|----------|-------|
| Travel | 1.2-1.5s | Horizontal gantry motion |
| Lift/Lower | 0.8-1.0s | Z-axis servo |
| Flip | 1.4s | 180° rotation |
| Dwell | 0.8s | Flux wetting time |

### Interpolation
- Uses THREE.MathUtils.smoothstep
- Smooth acceleration/deceleration
- No constant-speed motion
- Industrial precision feel

### State Machine
- Integrates with RecipeStateMachine
- Auto-advances recipe steps
- Respects 14/17 step limit
- Compatible with existing UI

## Troubleshooting

### Animation doesn't start
- Refresh browser page
- Check browser console for errors
- Verify RecipeStateMachine is loaded

### Chip disappears
- Should not happen (fixed in this implementation)
- Check chipOwner state in console
- Verify attachment logic

### Robots don't move
- Check refs are properly assigned
- Verify animation loop is running
- Look for JavaScript errors

### Flux not visible
- Check FluxStation position [0.4, 0, 0.5]
- Verify transparent material
- Adjust camera angle

### Performance issues
- Reduce dpr to [1, 1] in Canvas
- Lower shadow quality
- Check GPU usage

## Customization

### Change Animation Speed
In `MotionSystem`, modify `animDuration`:
```javascript
case 0: // Example
  animDuration.current = 2.4  // Double speed
  // or
  animDuration.current = 0.6  // Half speed
```

### Adjust Waypoints
Modify the `WAYPOINTS` object:
```javascript
const WAYPOINTS = {
  FLUX_DIP: { x: 0.4, y: 0.01, z: 0.5 },  // Shallower dip
  // etc.
}
```

### Change Colors
Update materials object:
```javascript
flux: new THREE.MeshStandardMaterial({ 
  color: '#ff6600',  // Orange flux
  opacity: 0.5       // More transparent
})
```

### Add Debug Helpers
```javascript
// In MotionSystem, add:
const axesHelper = new THREE.AxesHelper(1)
skingTool.current.add(axesHelper)  // Shows XYZ axes
```

## Integration with Full System

This simple React Three Fiber version demonstrates the concepts.

For production use with:
- GLB model loading
- Full recipe system
- UI controls
- Reset functionality
- Multiple chips

See: `lib/BonderController.js` and `lib/bonder/TwoRobotChipProcess.js`

## Next Steps

1. **Test visually** - Watch complete animation cycle
2. **Verify handoff** - Chip should transfer smoothly
3. **Check flux dip** - Chip should visibly enter/exit flux
4. **Observe Z-axis** - Both robots should move vertically
5. **Confirm attachment** - Chip should follow robots

## Support

For issues or questions:
1. Check `ROBOT_IMPLEMENTATION_REPORT.md` for detailed specs
2. Review console for error messages
3. Inspect component hierarchy in React DevTools
4. Verify Three.js scene in browser DevTools

---

**Quick Reference:**
- Total Steps: 16
- Cycle Time: ~17 seconds
- Robots: 2 (SKING + New Gantry)
- Waypoints: 6 key positions
- State Machine: Integrated
- Chip Attachment: Physical (parent-child)
- Flux Dipping: Operational
- Status: ✅ COMPLETE
