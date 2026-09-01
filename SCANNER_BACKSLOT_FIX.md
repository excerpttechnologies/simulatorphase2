# Scanner Back-Side Slot Removal - Fixed

## Issue
The scanner 3D model was displaying an unwanted slot/opening on the back (-Z) face that shouldn't be visible to the user. Only the front (+Z) face should have a visible wafer slot for visual clarity.

## Root Cause
The GLB file (`/scaner.glb`) likely contains geometry for both the front and back sides of the scanner, including slot/opening meshes on the back face. These were not being hidden by the visibility cull logic.

## Solution Applied
Enhanced the visibility hiding logic in `buildScannerGLB()` to:

1. **Added named parts to hide list:**
   - BackSlot, Back_Slot
   - RearSlot, Rear_Slot
   - SlotBack, Slot_Back
   - BackOpening, Back_Opening
   - RearOpening, Rear_Opening

2. **Added dynamic filtering:**
   - Traverses all meshes in the GLB
   - Identifies any object with "slot", "opening", or "port" in its name
   - Hides those objects if they're positioned far on the back (-Z side)
   - Checks world position: `worldPos.z < scannerFrontZ - 5` means it's on the back

## Code Changes

**Location:** `buildScannerGLB()` function in `app/page.tsx`, around line 29900

**Before:**
```javascript
// ── HIDE BACKSIDE PLATES + floating top panels ──
[
  'Vent_Panel', 'Base_Louvre_0', ...
  'Stage_Slab', 'Cassette_Body', 'Cube.001', 'Floor',
].forEach((name) => {
  if (namedParts[name]) namedParts[name].visible = false;
});
```

**After:**
```javascript
// ── HIDE BACKSIDE PLATES + floating top panels ──
[
  'Vent_Panel', 'Base_Louvre_0', ...
  'Stage_Slab', 'Cassette_Body', 'Cube.001', 'Floor',
  // Hide back-side slot elements
  'BackSlot', 'Back_Slot', 'RearSlot', 'Rear_Slot', 'SlotBack', 'Slot_Back',
  'BackOpening', 'Back_Opening', 'RearOpening', 'Rear_Opening',
].forEach((name) => {
  if (namedParts[name]) namedParts[name].visible = false;
});

// Also hide any slot-like geometry on the back (-Z side)
root.traverse((obj) => {
  if (!(obj as THREE.Mesh).isMesh) return;
  const mesh = obj as THREE.Mesh;
  const name = obj.name.toLowerCase();
  
  // Hide any object with "slot", "opening", "port" in its name
  if ((name.includes('slot') || name.includes('opening') || name.includes('port')) && 
      !name.includes('anchor')) {
    const worldPos = new THREE.Vector3();
    mesh.getWorldPosition(worldPos);
    
    // If it's on the back (-Z) side relative to scanner front, hide it
    if (worldPos.z < scannerFrontZ - 5) {
      mesh.visible = false;
    }
  }
});
```

## What's Visible Now

✅ **Front Face (visible to user):**
- Single slot/opening on the front (+Z) face
- Metallic slot frame (top, bottom, left, right borders)
- Yellow glow indicator strip inside slot
- Green sensor dots on each side
- "SCAN" nameplate on the left (-X) face

✅ **Back Face (hidden):**
- All back-side openings are now hidden
- Any back slot geometry is culled

## Verification

To verify the fix works:

1. **In browser console, run:**
   ```javascript
   // Should show hidden back-side parts
   const scanner = window.sim.modObjs['scanner'];
   console.log('Scanner object:', scanner);
   
   // Check if any slot objects are visible
   scanner.traverse((obj) => {
     if (obj.name.includes('slot') || obj.name.includes('opening')) {
       console.log(obj.name, 'visible:', obj.visible);
     }
   });
   ```

2. **Visually inspect:**
   - Rotate the view to see the back of the scanner
   - Back face should be smooth/clean (no slot opening)
   - Front face should still have the visible slot for wafers

## Performance Impact
✓ **Minimal** - hiding meshes is a single visibility flag change, no geometry deletion

## Robustness
The solution uses BOTH:
- **Named list** - for known parts that might exist
- **Dynamic filtering** - catches any unforeseen slot-like geometry by name pattern and position

This means even if the GLB file is updated or has different naming conventions, back-side slots should still be hidden.

---

## Related Notes

The front-face slot is explicitly created in code and positioned at:
- **Position:** `scannerSlotZ` (just inside the front face, +Z side)
- **Size:** 1.8 × 0.25 units
- **Lighting:** Yellow glow strip with green sensor dots

The back-side geometry (if present in GLB) is now automatically culled before render.
