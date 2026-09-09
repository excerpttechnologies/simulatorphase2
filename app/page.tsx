"use client"
// @ts-nocheck

import { useState, useEffect, useCallback, useRef, Suspense } from "react"
import { useRouter } from "next/navigation"
import * as THREE from "three"
// ===== GLB-REMOVED (top-level GLTFLoader import) - re-wire the new module here. See GLB_WIRING_CONTRACT.md =====
// import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import StationIcon from '../components/StationIcon'
import { BonderController } from '../lib/BonderController.js'
import {
  attachAllNamePlates,
  toggleNamePlates,
  tickNamePlateLEDs,
} from '../lib/buildNamePlate';
import ComponentInfoToggle from '../lib/components/ComponentInfoToggle';
import NarrationControls from '../lib/components/NarrationControls';
import { ProfileMenu } from '../lib/components/ProfileMenu';
import ProcessFlowPanel from '../components/ProcessFlowPanel';
import TcbComponentInfoPanel from '../components/TcbComponentInfoPanel';
import { TCB_STEPS } from '../lib/data/tcbSteps';
import { WaferBonderTransfer } from '../lib/bonder/WaferBonderTransfer.js';
import { loadOptimizedGLB } from '../lib/loadOptimizedGLB';
import { FlipChipRobot } from '../lib/flipChipRobot';



// and remove the require() inside buildRobotGLB — use the import instead

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface ProcessStep {
  id: string;
  name: string;
  short: string;
  temp: number | null;
  time: number;
  color: number;
  type: string;
  x: number;
  z: number;
}

interface RobotObject {
  group: THREE.Group;
  turret: THREE.Group;
  shoulder: THREE.Group;
  upperArm: THREE.Group;
  elbow: THREE.Group;
  foreArm: THREE.Group;
  wrist: THREE.Group;
  gripper: THREE.Group;
  /** End-effector / fork joint when present in GLB (e.g. Joint_Extension_A); else use gripper. */
  fork: THREE.Object3D;
  statusPL: THREE.PointLight;
  basePos: THREE.Vector3;
  runIK: (tgt: THREE.Vector3, options?: {
    isScanner?: boolean;
    isHMDS?: boolean;
    isDIRinse?: boolean;
    isTravel?: boolean;
    placeHeightOffset?: number;
    approachHeight?: number;
    safetyMargin?: number;
  }) => void;
  getJoints: () => JointData;
  worldPos: () => THREE.Vector3;
}

interface JointData {
  base: { c: number };
  shoulder: { c: number };
  elbow: { c: number };
  wrist: { c: number };
}

interface WaferUIState {
  wi: number;
  name: string;
  state: string;
  stepIdx: number;
  stepName: string;
  processTimer: number;
  stepTime: number;
  done: boolean;
  launched: boolean;
}

interface UIState {
  wafers: WaferUIState[];
  simTime: number;
  fps: number;
  active: number;
  completed: number;
  jointsEFEM: JointData | null;
  bonder: {
    stageId: number;
    stageLabel: string;
    phase: string;
    status: string;
    progress: number;
    temperature: number;
    chipState: string;
    vacuum: boolean;
    flipped: boolean;
    fluxed: boolean;
    aligned: boolean;
    bonded: boolean;
  } | null;
}

interface LogEntry {
  id: number;
  msg: string;
  cls: "pick" | "place" | "move" | "";
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  name: string;
  temp: string;
  meta: string;
  tempColor: string;
}

interface CameraPreset {
  theta: number;
  phi: number;
  radius: number;
  cx: number;
  cy: number;
  cz: number;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const MODULE_FLOOR_Y = 3.0;   // ← single knob for ALL module heights
const SP = 3.8;
const TOP_Z = -SP;
const BOT_Z = SP;
const WAFER_TRANSFER_Y = 3.35;
const PLINTH_TOP_Y = 2.7;  // World Y of plinth top surface (box center 1.1 + H/2 1.6)
/** Belt top: just below module floor constant (embedded track). */
const CONVEYOR_SURFACE_Y = MODULE_FLOOR_Y - 0.05;
/** Wafer centroid while riding the belt. */
const CONVEYOR_WAFER_Y = CONVEYOR_SURFACE_Y + 0.02;
/** Belt centreline Z — parallel to +X, slightly outside each process row. */
const TOP_TRACK_BELT_Z = TOP_Z - 0.75;
const BOT_TRACK_BELT_Z = BOT_Z + 0.75;
const IFACE_LOCAL_Z: Record<string, number> = {
  iface_out: 0,
  iface_in: -0.4,
};
// Per-module fine offset along Z to seat the GLB inside its plinth.
// Positive = push toward +Z (front), negative = pull back into the box.
const IFACE_GLB_Z_OFFSET: Record<string, number> = {
  iface_out: -1.0,
  iface_in: + 1.4,   // ← tune this (e.g. -0.6) if iface_in still pokes forward
};
const DEG = Math.PI / 180;
const NUM_WAFERS = 1;

// Lazy loader proxy to avoid importing three/examples during server-side bundling.
// Calls to loader.load(...) in this file will use this proxy which dynamically
// imports the real GLTFLoader in the browser at runtime.
const loader = {
  load: (url: string, onLoad?: (gltf: any) => void, onProgress?: any, onError?: any) => {
    (async () => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const l = new GLTFLoader();
        l.load(url, onLoad, onProgress, onError);
      } catch (e) {
        // If dynamic import fails (e.g. server environment), surface a helpful error.
        // Most callers already provide onError — call it if present.
        console.error('Failed to dynamically load GLTFLoader:', e);
        if (typeof onError === 'function') onError(e);
      }
    })();
  }
};
const PLACE_DELAY = 0.3;
// ─── PICK ALIGNMENT THRESHOLDS ───────────────────────────────────────────────
const PICK_APPROACH_DIST = 2.5;    // realistic for your scale
const PICK_SNAP_DIST = 1.5;    // begin snap when within 1.5 units
const PICK_ATTACH_DIST = 0.8;    // attach when reasonably close
const PICK_ANGULAR_TOL_DEG = 45.0;   // loose tolerance — IK isn't precise yet
const PICK_SOFT_IK_BLEND = 0.18;
const PICK_POS_SNAP_BLEND = 0.25;
const GRIPPER_OFFSET_EULER = new THREE.Euler(0, 0, 0);  // no offset — bones are skinned // blade faces down

// ════════════════════════════════════════════════════════════════
// INPUT WAFER LOADING STATION LAYOUT CONFIGURATION
// Move FOUP and EFEM robot forward for natural wafer pickup reach
// ════════════════════════════════════════════════════════════════
const INPUT_STATION_CONFIG = {
  // FOUP forward offset: CONSERVATIVE - keep FOUP safely outside machine
  // Bonder body starts at X = 3.2 (center 13.2, width 20)
  // FOUP original at X = -20, move only 2 units forward to X = -18 (SAFE)
  foupForwardOffset: 2,
  
  // Robot forward offset: AGGRESSIVE - let robot do most of the reaching
  // Before: x = -15, After: x = -7 (move forward 8 units)
  // Robot has longer reach, so compensate here
  robotForwardOffset: 8,
  
  // Machine clearance: Minimum gap between FOUP and machine boundary
  machineClearance: 3.0,  // Must maintain at least 3 units gap
};

const EFEM_X = -15 + INPUT_STATION_CONFIG.robotForwardOffset;  // Now: -7 (was -15)
const EFEM_Z = 0;
const EFEM_RIGHT_SIDE_YAW = -THREE.MathUtils.degToRad(90);
const WAFER_RACK_ROTATION_Y = THREE.MathUtils.degToRad(0);
const OUTPUT_RACK_ROTATION_Y = WAFER_RACK_ROTATION_Y + Math.PI; // 180° rotation for output rack
// Second wafer module, served from /public by the Next.js server.
const SECOND_RACK_URL = '/waferrxk.glb';
// Work-surface plane shared by the input station. Matches FOUP_FLOOR_CLEARANCE
// in _buildFoup(), so the Input Wafer and the second module rest on one plane.
// (The scene floor itself is lower, at y = -0.52.)
const WORK_SURFACE_Y = 1.2;
// Footprint the wafer module is scaled to, in world units. The model is a flat
// wafer disc (natural aspect ~11.5 : 1 : 11.4), so it needs real width to read
// from an overview camera. Uniform scale — height follows the model's own
// aspect ratio and is never stretched. Raise this to make the wafer bigger.
const SECOND_MODULE_TARGET_WIDTH = 15.0;

// ── PRODUCTION AXIS ─────────────────────────────────────────────────────────
// X is the machine-flow axis, not Z. Evidence from the existing scene:
//   ALL_STEPS runs x = -20 (foup) -> 19 (iface) -> 38 (scanner) at z ~= 0
//   the EFEM rail clamps on X (TRACK_MIN -14 .. TRACK_MAX 22)
//   _buildLinkBelt(startX, endX, z) draws belts along X at constant z
// Every station below is therefore placed along X at ONE shared Z, so the line
// reads straight. Do not introduce per-station Z offsets.
const PRODUCTION_AXIS_Z = 1.2165;   // the single Z every station shares

// ── LAYOUT: wafer rack, robot corridor, flux fixture - all on X ────────────
//   [ FOUP RACK ] gap [ WAFER RACK ] <-- RACK_CLEARANCE --> [ FLUX FIXTURE ]
// The wafer rack is the fixed reference; everything else is placed relative to
// it, so nothing needs hand-typed coordinates.
const WAFER_MODULE_X = -18;
const WAFER_MODULE_Z = PRODUCTION_AXIS_Z;
// Derived, never hand-typed, so it cannot drift out of sync with the width.
const WAFER_MODULE_HALF_X = SECOND_MODULE_TARGET_WIDTH / 2;
// ►► INPUT WAFER RACK SIZE KNOB ◄◄
// Uniform scale applied to the whole rack group (model AND its anchors, so the
// slot/pickup targets keep matching the geometry). Raise to enlarge the rack.
// Measured against the real asset:
//   x1.7 ->  4.76 x  5.10 x  5.44   (previous - smallest station in the scene)
//   x2.5 ->  7.00 x  7.50 x  8.00
//   x3.5 ->  9.80 x 10.50 x 11.20   (current)
//   x5.0 -> 14.00 x 15.00 x 16.00
// No upper bound to worry about: RACK_RELOCATED_X and the Y compensation are
// both derived from this, so the 10-unit gap to the wafer module and the base
// sitting on the work surface hold at every scale.
const RACK_SCALE = 3.5;
// ROBOT WORKING CORRIDOR: the minimum straight-line clearance between the wafer
// rack area and the flux fixture working area, in three.js WORLD UNITS (not
// pixels, not zoom). The robot picks at the rack, travels this corridor along
// X, and approaches the fixture. FLUX_FIXTURE_POSITION is derived from it, so
// changing this number physically moves the fixture.
const RACK_CLEARANCE = 45.0;
// Separate, smaller gap between the wafer rack and the black FOUP rack parked
// beside it. Kept distinct from RACK_CLEARANCE so widening the robot corridor
// does not fling the FOUP rack off into the distance.
const WAFER_TO_RACK_GAP = 10.0;
// The rack is rotated a quarter turn about the vertical (Y) axis, which swaps
// its footprint: FOUP_WIDTH 3.2 (X) x FOUP_LENGTH 2.8 (Z) becomes 2.8 x 3.2,
// then RACK_SCALE enlarges it.
const RACK_QUARTER_TURN = Math.PI / 2;
const RACK_ROTATED_HALF_X = (2.8 / 2) * RACK_SCALE;  // FOUP_LENGTH/2, scaled
// FOUP rack sits on the -X side of the wafer, i.e. UPSTREAM of the production
// flow, so it never intrudes into the robot corridor on the +X side.
const RACK_RELOCATED_X =
  WAFER_MODULE_X - WAFER_MODULE_HALF_X - WAFER_TO_RACK_GAP - RACK_ROTATED_HALF_X;
const RACK_RELOCATED_MAX_X = RACK_RELOCATED_X + RACK_ROTATED_HALF_X;

// ── FLUX FIXTURE (public/flux_fixture.glb) ──────────────────────────────────
// Real GLB, loaded through the same loadOptimizedGLB path as every other model.
// Natural size 2.400 x 1.655 x 1.440, base at local y -0.18, 39 meshes,
// named parts BasePlate / FluxSurface / TrayPart / Chip / Pad, clip
// "FluxAnimation".
const FLUX_FIXTURE_URL = '/flux_fixture.glb';
// ►► FLUX FIXTURE SIZE KNOB ◄◄
// One normalisation factor applied at load, NOT a camera trick. Raise this
// number to enlarge the fixture. Natural size is 2.40 x 1.655 x 1.44.
//   x2 -> 4.80 wide, 3.31 tall  (current: matches the 4.76-wide FOUP rack)
//   x3 -> 7.20 wide, 4.97 tall
// FLUX_FIXTURE_HALF_X below is derived from it, so the 30-unit clearance to the
// wafer rack is preserved automatically whatever value you choose.
const FLUX_FIXTURE_SCALE = 4.0;
const FLUX_FIXTURE_NATURAL_WIDTH = 2.4;
const FLUX_FIXTURE_HALF_X = (FLUX_FIXTURE_NATURAL_WIDTH * FLUX_FIXTURE_SCALE) / 2;
// THE single source of truth for where the fixture lives. Derived from the
// wafer rack's +X edge plus the robot corridor, so the 30-unit clearance is a
// real world-space distance rather than an eyeballed coordinate.
const FLUX_FIXTURE_POSITION = {
  x: WAFER_MODULE_X + WAFER_MODULE_HALF_X + RACK_CLEARANCE + FLUX_FIXTURE_HALF_X,
  y: WORK_SURFACE_Y,
  z: PRODUCTION_AXIS_Z,
};

// ── SUBSTRATE ALIGN STAGE (public/SUBSTAGE_Align.glb) ───────────────────────
// The station AFTER the flux fixture: the chip is dipped in flux, then placed
// and aligned here. Natural size 0.280 x 0.043 x 0.140, 6 meshes, 7,626 tris,
// no animation. Named parts SUBSTAGE_ActiveSite / AnvilBase / BondPads /
// Carrier / MountDetails.
const SUBSTAGE_URL = '/SUBSTAGE_Align.glb';
// ►► SUBSTAGE SIZE KNOB ◄◄ - normalises the asset's metres to scene units.
//   x35 ->  9.80 x 1.49 x 4.90  (current - matches the flux fixture's width)
//   x50 -> 14.00 x 2.13 x 7.00
const SUBSTAGE_SCALE = 35;
const SUBSTAGE_NATURAL_WIDTH = 0.28;
const SUBSTAGE_HALF_X = (SUBSTAGE_NATURAL_WIDTH * SUBSTAGE_SCALE) / 2;
// Gap between the flux fixture's +X edge and this stage's -X edge.
const SUBSTAGE_GAP = 6.0;
// Derived from the flux fixture, so it always follows it down the line.
const SUBSTAGE_POSITION = {
  x: FLUX_FIXTURE_POSITION.x + FLUX_FIXTURE_HALF_X + SUBSTAGE_GAP + SUBSTAGE_HALF_X,
  y: WORK_SURFACE_Y,
  z: PRODUCTION_AXIS_Z,
};

// ── FLIP CHIP ROBOT (public/FlipChip_Robotfinal.glb) ────────────────────────
// Stands IN the robot working corridor, between the wafer rack and the flux
// fixture. Driven by lib/flipChipRobot.ts (the asset author's controller): the
// rig's Rotary_Actuator has a non-identity rest quaternion, so its joints must
// not be posed with plain rotation.x/y/z writes.
const FLIP_ROBOT_URL = '/FlipChip_Robotfinal.glb';
// ►► ROBOT SIZE KNOB ◄◄
// The GLB is authored in METRES (base platform 0.60 x 0.35 m, 0.31 m tall), so
// it must be normalised to scene units. Raise this number to enlarge the robot.
// Measured against the real asset at RACK_CLEARANCE 45 (loaded fresh, not
// cloned - clone(true) does not reproduce skinned-mesh bind state and reports
// a shorter box than the robot really is):
//   x20 -> 12.00 x  6.48 x  7.00   (16.50 clear to each neighbour)
//   x30 -> 18.00 x  9.71 x 10.50   (13.50 clear)
//   x40 -> 24.00 x 12.95 x 14.00   (current - 10.50 clear)
//   x50 -> 30.00 x 16.19 x 17.50   (7.50 clear)
//   x60 -> 36.00 x 19.43 x 21.00   (4.50 clear)
//   x70 -> 42.00 x 22.67 x 24.50   (1.50 clear - practical ceiling)
// Headroom scales with RACK_CLEARANCE. Raise that first if you want more.
const FLIP_ROBOT_SCALE = 40;
// Dead centre of the corridor: midway between the wafer rack's +X edge and the
// flux fixture's -X edge, on the shared production axis.
const FLIP_ROBOT_POSITION = {
  x: (WAFER_MODULE_X + WAFER_MODULE_HALF_X + (FLUX_FIXTURE_POSITION.x - FLUX_FIXTURE_HALF_X)) / 2,
  y: WORK_SURFACE_Y,
  z: PRODUCTION_AXIS_Z,
};
const FIRST_RACK_OFFSET_Z = 6.5;
const ROBOT_OFFSET_Z = 2.5;
const ALL_STEPS: ProcessStep[] = [
  { id: "foup", name: "FOUP Input", short: "FOUP", temp: null, time: 1, color: 0x4488ff, type: "foup", x: -20, z: 0 },
  { id: "dehy", name: "Dehydration Bake 150°C", short: "DEHY", temp: 150, time: 8, color: 0xff2200, type: "hot", x: -11, z: TOP_Z },
  { id: "hmds", name: "HMDS Vapor Prime", short: "HMDS", temp: 110, time: 2, color: 0xff8800, type: "hot", x: -6, z: TOP_Z },
  { id: "chill1", name: "Chill Plate #1  22°C", short: "CP-1", temp: 22, time: 3, color: 0x00ccff, type: "cold", x: -1, z: TOP_Z },
  { id: "prcoat", name: "PR Coat (COT)", short: "COT", temp: null, time: 5, color: 0xcc00ff, type: "coat", x: 4, z: TOP_Z },
  { id: "pab", name: "Post-Apply Bake 90°C", short: "PAB", temp: 90, time: 3, color: 0xff5500, type: "hot", x: 9, z: TOP_Z },
  { id: "chill2", name: "Chill Plate #2  22°C", short: "CP-2", temp: 22, time: 2, color: 0x00aaee, type: "cold", x: 14, z: TOP_Z },
  { id: "iface_out", name: "Interface → Scanner", short: "IF→", temp: null, time: 2, color: 0xffdd00, type: "iface", x: 19, z: -3 },
  { id: "scanner", name: "Scanner 193nm Exposure", short: "SCAN", temp: null, time: 5, color: 0xee00cc, type: "scan", x: 38, z: 0 },
  { id: "iface_in", name: "Interface ← Scanner", short: "IF←", temp: null, time: 2, color: 0xffaa00, type: "iface", x: 19, z: 3 },
  { id: "peb", name: "Post-Exposure Bake 120°C", short: "PEB", temp: 120, time: 3, color: 0xff3300, type: "hot", x: 14, z: BOT_Z },
  { id: "develop", name: "Developer Module (DEV)", short: "DEV", temp: null, time: 4, color: 0x00ff88, type: "wet", x: 9, z: BOT_Z },
  { id: "rinse", name: "DI Water Rinse", short: "RINSE", temp: null, time: 3, color: 0x0088ff, type: "wet", x: 4, z: BOT_Z },
  { id: "spindry", name: "Spin Dry + N₂ Purge", short: "DRY", temp: null, time: 3, color: 0x00eeff, type: "dry", x: -1, z: BOT_Z },
  { id: "chill3", name: "Chill Plate #3  22°C", short: "CP-3", temp: 22, time: 2, color: 0x22ddbb, type: "cold", x: -6, z: BOT_Z },
  { id: "hardbake", name: "Hard Bake  130°C", short: "HBAK", temp: 130, time: 3, color: 0xff1100, type: "hot", x: -11, z: BOT_Z },
];

const WAFER_COLORS = [0xffaa00, 0x00eeff, 0xdd44ff, 0x44ffaa];
const WAFER_NAMES = ["W-001", "W-002", "W-003", "W-004"];
const W_CSS = ["#ffaa00", "#00eeff", "#dd44ff", "#44ffaa"];

// ── PERFORMANCE: global geometry detail multiplier ──
const PERF_DETAIL = 0.5;  // 0.5 = half segments everywhere (50% faster)

// Helper for downscaled segment counts
function perfSegments(n: number): number {
  return Math.max(6, Math.round(n * PERF_DETAIL));
}

function buildWafer(color: number): THREE.Group {
  const g = new THREE.Group();

  // ── SCALE: reduced from 0.88 → 0.45 (half size) ──
  const R = 0.75;       // wafer radius (was 0.88)
  const H = 0.070;      // wafer thickness (was 0.055)
  const PR_R = 0.73;    // PR layer radius (was 0.84)
  const PR_H = 0.020;   // PR layer thickness (was 0.025)
  const EDGE_R = 0.75;  // edge ring radius (was 0.88)
  const EDGE_T = 0.025; // edge tube thickness (was 0.032)

  // Iridescent base disk
  const disk = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, H, 32),
    new THREE.MeshPhysicalMaterial({
      color: 0x8899cc,
      roughness: 0.05,
      metalness: 0.6,
      clearcoat: 0.4,
      clearcoatRoughness: 0.2,
      envMapIntensity: 1.0,
      emissive: 0x112244,
      emissiveIntensity: 0.15,
    })
  );
  disk.castShadow = true;
  g.add(disk);

  // Holographic PR layer — starts grey/invisible, turns colored at PR coat
  const pr = new THREE.Mesh(
    new THREE.CylinderGeometry(PR_R, PR_R, PR_H, 80),
    new THREE.MeshPhysicalMaterial({
      color: 0xc0c8d0,          // grey silicon (resist not applied yet)
      roughness: 0.12,
      metalness: 0.05,
      clearcoat: 0.6,
      clearcoatRoughness: 0.1,
      emissive: 0x222428,       // faint grey
      emissiveIntensity: 0.15,
      transparent: true,
      opacity: 0.0,             // invisible until PR coat
      envMapIntensity: 0.7,
    })
  );
  pr.position.y = H / 2 + PR_H / 2 - 0.002;
  g.add(pr);
  g.userData.prLayer = pr;
  g.userData.resistColor = color; // store intended resist color for later

  // Smaller die array (scaled to new wafer)
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx * dx + dz * dz > 5) continue;
      const dieColor = new THREE.Color(0xc0c8d0).multiplyScalar(1.1); // grey dies
      const die = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.003, 0.11),
        new THREE.MeshStandardMaterial({
          color: dieColor,
          roughness: 0.06,
          metalness: 0.9,
          emissive: 0x445566,
          emissiveIntensity: 0.2,
        })
      );
      die.position.set(dx * 0.13, H / 2 + 0.003, dz * 0.13);
      g.add(die);
    }
  }

  // Neon edge ring
  const edge = new THREE.Mesh(
    new THREE.TorusGeometry(EDGE_R, EDGE_T, 8, 32),
    new THREE.MeshStandardMaterial({
      color: 0xaabbee,
      roughness: 0.02,
      metalness: 0.99,
      emissive: 0x445566,       // grey edge
      emissiveIntensity: 0.3,
    })
  );
  edge.rotation.x = Math.PI / 2;
  g.add(edge);

  // Alignment rings removed to reduce geometry detail.

  // Notch
  const notch = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.03, 0.022),
    new THREE.MeshStandardMaterial({
      color: 0x8899cc,
      roughness: 0.08,
      metalness: 0.9,
      emissive: 0x4466aa,
      emissiveIntensity: 0.4,
    })
  );
  notch.position.set(R, 0, 0);
  g.add(notch);

  // Glow ring (smaller)
  const glowGeo = new THREE.TorusGeometry(R + 0.02, 0.008, 12, 36);
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x8899aa,            // grey glow
    emissive: 0x445566,
    emissiveIntensity: 0.6,
    roughness: 0.3,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.rotation.x = Math.PI / 2;
  glow.position.y = H / 2 + 0.002;
  g.add(glow);
  g.userData.glowRing = glow;
  
  return g;
}

const CAMERA_PRESETS: Record<string, CameraPreset> = {
  "OVERVIEW": { theta: Math.PI * 0.13, phi: 0.34, radius: 24, cx: 2, cy: 0, cz: 0 },
  "TOP DOWN": { theta: Math.PI * 0.13, phi: 0.03, radius: 28, cx: 2, cy: 0, cz: 0 },
  "EFEM": { theta: Math.PI * 0.62, phi: 0.30, radius: 10, cx: -8, cy: 0, cz: 0 },
  "TOP TRACK": { theta: Math.PI * 0.03, phi: 0.28, radius: 14, cx: 2, cy: 0, cz: TOP_Z },
  "BOT TRACK": { theta: Math.PI * 1.0, phi: 0.28, radius: 14, cx: 2, cy: 0, cz: BOT_Z },
  "SCANNER": { theta: Math.PI * 0.88, phi: 0.28, radius: 9, cx: 16, cy: 0, cz: 0 },
  "PR COAT": { theta: Math.PI * 0.55, phi: 0.32, radius: 8, cx: 4, cy: 0, cz: TOP_Z },
};

const COMPONENT_INFO: Record<string, {
  section: string; hardware: string; process: string; specs: Record<string, string>
}> = {
  "foup": { section: "EFEM / Loading", hardware: "Polycarbonate/PEEK enclosure with precision-machined door interface. SEMI-standard kinematic coupling. N₂-purged micro-atmosphere.", process: "Mini-environment isolating 300mm wafers. Maintains N₂-purged atmosphere preventing native oxide growth and AMC during transport.", specs: { "Purge Gas": "N₂, 5–10 LPM", "Environment": "ISO Class 1", "Coupling": "SEMI-standard kinematic" } },
  "dehy": { section: "Main Process Track", hardware: "Proximity hotplate with programmable lift pins 0.1mm–1.0mm. Multi-zone heating, thermal uniformity <±0.5%.", process: "Thermally desorbs adsorbed H₂O molecules from wafer surface. Critical prerequisite for primer bonding.", specs: { "Temperature": "150°C", "Time": "60s", "Proximity Gap": "0.1mm", "Uniformity": "<±0.5%" } },
  "hmds": { section: "Main Process Track", hardware: "Vacuum-sealed chamber with HMDS bubbler and N₂ carrier gas. Heated walls prevent condensation.", process: "Silylation: HMDS replaces –OH groups with –Si(CH₃)₃. Converts hydrophilic to hydrophobic, prevents resist peeling.", specs: { "Temperature": "110°C", "Vacuum": "<1 Torr", "Time": "30s", "Contact Angle": ">70° post-prime" } },
  "chill1": { section: "Main Process Track", hardware: "Water-cooled or Peltier aluminium plate with helium-backside gas for thermal conduction.", process: "Rapidly quenches thermal energy. Normalizes wafer temperature for consistent resist viscosity.", specs: { "Target Temp": "22.0°C ±0.1°C", "Time": "45s", "Cooling": "Water/Peltier + He backside" } },
  "prcoat": { section: "Main Process Track", hardware: "High-speed spindle up to 6000 RPM. Programmable dispense arm, suck-back valves, EBR nozzle.", process: "Centrifugal force spreads viscous polymer. h ∝ 1/√ω. EBR removes edge bead.", specs: { "Spin Speed": "1500–3000 RPM", "Acceleration": "20,000 RPM/s", "Dispense": "Dynamic 2.0cc", "EBR Solvent": "PGMEA" } },
  "pab": { section: "Main Process Track", hardware: "Isobaric hotplate with exhaust system for solvent vapor removal.", process: "Evaporates PGMEA solvent. Reduces dark-reactivity, stabilizes thickness.", specs: { "Temperature": "100–120°C", "Time": "60–90s", "Solvent Removed": "~90% PGMEA" } },
  "chill2": { section: "Main Process Track", hardware: "Water-cooled aluminium plate with helium-backside gas.", process: "Stabilizes film before scanner transfer. Ensures identical thermal budget.", specs: { "Target Temp": "22.0°C", "Time": "30s", "Cooling": "Water/Peltier + He backside" } },
  "iface_out": { section: "Interface / Scanner", hardware: "High-precision bridge between track and scanner. Centering unit, cooling station.", process: "Sync hub managing timing between asynchronous track and scanner. Ensures consistent Time-to-Exposure (TTE).", specs: { "Function": "Buffer / Sync", "Key Metric": "TTE consistency" } },
  "scanner": { section: "Interface / Scanner", hardware: "193nm ArF excimer laser scanner. High-precision wafer stage. Reticle stage and projection optics.", process: "Generates Photo-Acid Generators via latent image formation at 193nm wavelength.", specs: { "Wavelength": "193nm (ArF)", "Dose": "20–50 mJ/cm²", "NA": "0.93 (dry)" } },
  "iface_in": { section: "Interface / Scanner", hardware: "Return bridge from scanner back to process track.", process: "Returns exposed wafer to track for post-exposure processing.", specs: { "Function": "Scanner → Track handoff" } },
  "peb": { section: "Post-Exposure Sequence", hardware: "High-uniformity hotplate with multi-zone thermal control.", process: "Acid-catalyzed deprotection in CAR resists. 1°C error → 1.5–2.0nm CD shift.", specs: { "Temperature": "110–120°C (critical)", "Time": "60s", "CD Sensitivity": "1.5–2.0 nm/°C" } },
  "develop": { section: "Post-Exposure Sequence", hardware: "Multi-nozzle dispense (stream/spray/puddle) with rotating chuck. Temperature-controlled developer lines.", process: "Selective dissolution of exposed resist in alkaline TMAH. Defines final relief pattern.", specs: { "Developer": "2.38% TMAH", "Puddle Time": "30–60s", "Temperature": "23°C" } },
  "rinse": { section: "Post-Exposure Sequence", hardware: "DI water manifold with rotating chuck and N₂ blow-off.", process: "Removes dissolved resist and developer salts. Prevents water mark defects.", specs: { "Fluid": "DIW + N₂ purge", "Purpose": "Remove developer salts" } },
  "spindry": { section: "Post-Exposure Sequence", hardware: "High-speed spin chuck with N₂ purge nozzle.", process: "Centrifugal drying removes residual rinse water. N₂ purge prevents redeposition.", specs: { "Spin Speed": "4000 RPM", "Gas": "N₂ purge" } },
  "chill3": { section: "Post-Exposure Sequence", hardware: "Water-cooled aluminium plate with helium-backside gas.", process: "Quenches hard bake thermal energy before unloading.", specs: { "Target Temp": "22.0°C", "Time": "45s" } },
  "hardbake": { section: "Post-Exposure Sequence", hardware: "High-temperature hotplate, typically 10–20°C above PAB.", process: "Removes remaining solvent. Thermally cross-links resist for improved etch resistance.", specs: { "Temperature": "130°C", "Time": "60s", "Purpose": "Cross-link polymer" } },
  "output": { section: "EFEM / Loading", hardware: "Output FOUP with N₂ purge. Same mechanical interface as input FOUP.", process: "Stores processed wafers in purged environment pending inspection and metrology.", specs: { "Purge Gas": "N₂", "Capacity": "25 wafers", "Environment": "ISO Class 1" } },
};

// ─── UTILS ───────────────────────────────────────────────────────────────────

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const hex2css = (h: number) => `#${h.toString(16).padStart(6, "0")}`;
// const fmtClock = (s: number) =>
//   [s / 3600, (s % 3600) / 60, s % 60]
//     .map((v) => Math.floor(v).toString().padStart(2, "0"))
//     .join(":");

// ══════════════════════════════════════════════════════════════════════
// ─── QUATERNION ALIGNMENT MATH ───────────────────────────────────────────────

const _tmpV1 = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();
const _tmpQ1 = new THREE.Quaternion();
const _tmpQ2 = new THREE.Quaternion();
const _tmpM = new THREE.Matrix4();

/** Get world quaternion of any object, including nested GLB hierarchies */
function getWorldQuaternion(obj: THREE.Object3D, out: THREE.Quaternion): THREE.Quaternion {
  obj.updateWorldMatrix(true, false);
  obj.getWorldQuaternion(out);
  return out.normalize();
}

/** Compute target gripper quaternion: align gripper -Y (down) to wafer +Y (surface normal) */
function computeGripperTargetQuat(
  waferObj: THREE.Object3D,
  gripperOffsetEuler: THREE.Euler,
  out: THREE.Quaternion
): THREE.Quaternion {
  // Wafer's world rotation
  getWorldQuaternion(waferObj, _tmpQ1);
  // Gripper offset (e.g. blade rotated 180° about X to face down)
  _tmpQ2.setFromEuler(gripperOffsetEuler);
  // targetQ = waferWorldQ * gripperOffsetQ  (order matters!)
  out.multiplyQuaternions(_tmpQ1, _tmpQ2).normalize();
  return out;
}

/** Angular error in radians between two quaternions via dot product */
function angularError(qa: THREE.Quaternion, qb: THREE.Quaternion): number {
  const d = Math.abs(qa.dot(qb));
  return 2 * Math.acos(Math.min(1, d));   // shortest-path angle
}

/** Damped slerp with shortest-path correction */
function softSlerp(current: THREE.Quaternion, target: THREE.Quaternion, t: number) {
  if (current.dot(target) < 0) target.set(-target.x, -target.y, -target.z, -target.w);
  current.slerp(target, t).normalize();
}

/** Smooth-step easing (cinematic, frame-rate friendly) */
function smoothStep(t: number): number {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}
// ─── MATERIAL HELPERS ─────────────────────────────────────────────────────────

function matGlass(color = 0x88ccff, opacity = 0.22) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.04, metalness: 0.0,
    transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
  });
}
function matEmissive(color: number, ei = 4.0) {
  return new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: ei, roughness: 0.4,
  });
}
function matPBR(c: number, rough = 0.25, metal = 0.95) {
  return new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });
}

// ─── WAFER CHUCK / PLATE BUILDER ──────────────────────────────────────────────
function addWaferChuck(
  parentGroup: THREE.Group,
  chuckType: "chill" | "spin" | "hotplate" | "bake",
  x = 0,
  z = 0
): THREE.Group {
  const CHUCK_TOP_Y = WAFER_TRANSFER_Y - 0.0175;
  const CHUCK_THICK = 0.08;
  const CHUCK_CENTER_Y = CHUCK_TOP_Y - CHUCK_THICK / 2;
  const localY = CHUCK_CENTER_Y;

  const grp = new THREE.Group();
  grp.position.set(x, localY, z);
  grp.renderOrder = 10;

  const R = 0.96;

  // ── ADD SUPPORT POST/STAND ──
  // Cylindrical post connecting chuck to module base
  const glbRoot = parentGroup.userData.glbRoot;
  if (glbRoot) {
    const baseBox = new THREE.Box3().setFromObject(glbRoot);
    const baseSize = new THREE.Vector3();
    baseBox.getSize(baseSize);

    // Position stand at corner (back-right: +X, -Z) FLUSH with base edges (zero gap)
    const standRadius = 0.12;
    const standHeight = localY - (MODULE_FLOOR_Y + baseSize.y / 2);
    const cornerX = (baseSize.x / 2) - standRadius;  // Zero gap - flush with edge
    const cornerZ = -(baseSize.z / 2) + standRadius;  // Zero gap - flush with edge

    const standPost = new THREE.Mesh(
      new THREE.CylinderGeometry(standRadius, standRadius * 1.2, standHeight, 24),
      new THREE.MeshStandardMaterial({
        color: 0x445566,
        roughness: 0.18,
        metalness: 0.95,
        emissive: 0x112233,
        emissiveIntensity: 0.3
      })
    );
    standPost.position.set(cornerX, -localY + standHeight / 2, cornerZ);
    
    // Add 45-degree rotation for proper orientation
    standPost.rotation.y = Math.PI / 4;  // 45 degrees
    
    standPost.castShadow = true;
    grp.add(standPost);

    console.log(`[CHUCK] Added support stand at corner: X=${cornerX.toFixed(2)}, Z=${cornerZ.toFixed(2)}, Height=${standHeight.toFixed(2)}, Rotation=45°`);
  }

  if (chuckType === "chill") {
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, CHUCK_THICK, 64),
      new THREE.MeshStandardMaterial({
        color: 0xb8c8d8,
        roughness: 0.18,
        metalness: 0.92,
        envMapIntensity: 0.8,
      })
    );
    plate.castShadow = true;
    plate.receiveShadow = true;
    plate.material.side = THREE.DoubleSide;
    grp.add(plate);

    for (let r = 0.15; r <= 0.85; r += 0.14) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.006, 8, 64),
        new THREE.MeshStandardMaterial({
          color: 0x8899bb,
          emissive: 0x0055aa,
          emissiveIntensity: 0.4,
          roughness: 0.2,
          metalness: 0.9,
        })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = CHUCK_THICK / 2 + 0.001;
      grp.add(ring);
    }

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const port = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, 0.012, 12),
        new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.3, metalness: 0.95 })
      );
      port.position.set(Math.cos(a) * 0.55, CHUCK_THICK / 2 + 0.006, Math.sin(a) * 0.55);
      grp.add(port);
    }

    const pl = new THREE.PointLight(0x0099ff, 1.2, 3.5);
    pl.position.set(0, CHUCK_THICK / 2 + 0.1, 0);
    grp.add(pl);
    grp.userData.chuckLight = pl;

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(R, 0.012, 10, 64),
      new THREE.MeshStandardMaterial({
        color: 0xaabbcc,
        emissive: 0x0066cc,
        emissiveIntensity: 0.5,
        roughness: 0.12,
        metalness: 0.98,
      })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = CHUCK_THICK / 2;
    grp.add(rim);

  } else if (chuckType === "spin") {
    const chuck = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R * 0.98, CHUCK_THICK, 80),
      new THREE.MeshStandardMaterial({
        color: 0x1a2535,
        roughness: 0.15,
        metalness: 0.92,
        emissive: 0x110022,
        emissiveIntensity: 0.2,
      })
    );
    chuck.castShadow = true;
    chuck.receiveShadow = true;
    chuck.material.side = THREE.DoubleSide;
    grp.add(chuck);

    for (let r = 0.12; r <= 0.88; r += 0.10) {
      const groove = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.004, 6, 72),
        new THREE.MeshStandardMaterial({
          color: 0x334455,
          roughness: 0.3,
          metalness: 0.7,
        })
      );
      groove.rotation.x = Math.PI / 2;
      groove.position.y = CHUCK_THICK / 2 + 0.0005;
      grp.add(groove);
    }

    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const vPort = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.02, 16),
        new THREE.MeshStandardMaterial({ color: 0x0a0f18, roughness: 0.6, metalness: 0.8 })
      );
      vPort.position.set(Math.cos(a) * 0.45, CHUCK_THICK / 2 + 0.01, Math.sin(a) * 0.45);
      grp.add(vPort);
    }

    const center = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.02, 24),
      new THREE.MeshStandardMaterial({ color: 0x050810, roughness: 0.8, metalness: 0.6 })
    );
    center.position.y = CHUCK_THICK / 2 + 0.01;
    grp.add(center);

    const clampRing = new THREE.Mesh(
      new THREE.TorusGeometry(R + 0.02, 0.018, 10, 64),
      new THREE.MeshStandardMaterial({
        color: 0x445566,
        roughness: 0.2,
        metalness: 0.95,
      })
    );
    clampRing.rotation.x = Math.PI / 2;
    clampRing.position.y = CHUCK_THICK / 2;
    grp.add(clampRing);

    const pl = new THREE.PointLight(0xcc00ff, 0.8, 3.0);
    pl.position.set(0, CHUCK_THICK / 2 + 0.1, 0);
    grp.add(pl);
    grp.userData.chuckLight = pl;

  } else if (chuckType === "hotplate") {
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, CHUCK_THICK * 1.5, 64),
      new THREE.MeshStandardMaterial({
        color: 0x551108,
        roughness: 0.45,
        metalness: 0.45,
        emissive: 0xff4422,
        emissiveIntensity: 2.5,
      })
    );
    plate.castShadow = true;
    plate.receiveShadow = true;
    plate.material.side = THREE.DoubleSide;
    grp.add(plate);

    for (let r = 0.1; r <= 0.88; r += 0.125) {
      const coil = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.018, 10, 64),
        new THREE.MeshStandardMaterial({
          color: 0xff3300,
          emissive: 0xff1100,
          emissiveIntensity: 2.5,
          roughness: 0.35,
          metalness: 0.4,
        })
      );
      coil.rotation.x = Math.PI / 2;
      coil.position.y = CHUCK_THICK * 1.5 / 2 + 0.001;
      grp.add(coil);
    }

    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const pin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8),
        new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.2, metalness: 0.95 })
      );
      pin.position.set(Math.cos(a) * 0.72, CHUCK_THICK * 1.5 / 2 + 0.03, Math.sin(a) * 0.72);
      grp.add(pin);
    }

    const pl = new THREE.PointLight(0xff3300, 2.5, 4.0);
    pl.position.set(0, CHUCK_THICK * 1.5 / 2 + 0.15, 0);
    grp.add(pl);
    grp.userData.chuckLight = pl;

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(R + 0.015, 0.022, 10, 64),
      new THREE.MeshStandardMaterial({
        color: 0x663300,
        emissive: 0xff2200,
        emissiveIntensity: 0.8,
        roughness: 0.6,
        metalness: 0.2,
      })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = CHUCK_THICK * 1.5 / 2;
    grp.add(rim);

  } else if (chuckType === "bake") {
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 0.05, R + 0.08, CHUCK_THICK * 2, 64),
      new THREE.MeshStandardMaterial({
        color: 0x4a1505,
        roughness: 0.40,
        metalness: 0.55,
        emissive: 0xff3322,
        emissiveIntensity: 1.5,
      })
    );
    base.castShadow = true;
    base.receiveShadow = true;
    base.material.side = THREE.DoubleSide;
    grp.add(base);

    const topSurf = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, 0.018, 64),
      new THREE.MeshStandardMaterial({
        color: 0x661a08,
        roughness: 0.50,
        metalness: 0.3,
        emissive: 0xff3322,
        emissiveIntensity: 4.0,
      })
    );
    topSurf.position.y = CHUCK_THICK * 2 / 2 + 0.009;
    grp.add(topSurf);

    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, 0.006, R * 0.85),
        new THREE.MeshStandardMaterial({
          color: 0xff2200,
          emissive: 0xff1100,
          emissiveIntensity: 3.5,
          roughness: 0.3,
        })
      );
      bar.rotation.y = a;
      bar.position.y = CHUCK_THICK * 2 / 2 + 0.004;
      grp.add(bar);
    }

    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const strut = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.04, 0.18, 8),
        new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.3, metalness: 0.9 })
      );
      strut.position.set(
        Math.cos(a) * (R + 0.04),
        -CHUCK_THICK * 2 / 2 - 0.09,
        Math.sin(a) * (R + 0.04)
      );
      grp.add(strut);
    }

    const pl = new THREE.PointLight(0xff2200, 3.0, 4.5);
    pl.position.set(0, CHUCK_THICK * 2 / 2 + 0.2, 0);
    grp.add(pl);
    grp.userData.chuckLight = pl;

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(R + 0.055, 0.028, 10, 64),
      new THREE.MeshStandardMaterial({
        color: 0x551100,
        emissive: 0xff2200,
        emissiveIntensity: 1.5,
        roughness: 0.5,
        metalness: 0.3,
      })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = CHUCK_THICK * 2 / 2;
    grp.add(rim);
  }

  parentGroup.add(grp);
  parentGroup.userData.waferChuck = grp;
  const lightInChuck = grp.userData.chuckLight as THREE.PointLight | undefined;
  if (lightInChuck) lightInChuck.userData.baseIntensity = lightInChuck.intensity;
  return grp;
}



function setupLighting(scene: THREE.Scene) {
  // ── CLEAN WHITE CLEANROOM ──
  const WHITE = 0xffffff;
  const WARM_WHITE = 0xfff8f0;

  // ── WHITE SKY / BACKGROUND ──
  scene.background = new THREE.Color(0xf0f2f5);
  scene.fog = new THREE.FogExp2(0xf0f2f5, 0.0035);

  // ── AMBIENT: neutral fill light ──
  scene.add(new THREE.AmbientLight(WHITE, 1.2));

  // ── HEMISPHERE: white sky and light floor bounce ──
  scene.add(new THREE.HemisphereLight(WHITE, 0xcccccc, 1.0));

  // ── KEY LIGHT: clean white ──
  const key = new THREE.DirectionalLight(WARM_WHITE, 2.5);
  key.position.set(-4, 35, 12);
  key.castShadow = false;
  scene.add(key);

  // ── FILL LIGHTS: cool white support lights ──
  const fill1 = new THREE.DirectionalLight(WARM_WHITE, 1.5);
  fill1.position.set(12, 20, -8);
  fill1.castShadow = false;
  scene.add(fill1);

  const fill2 = new THREE.DirectionalLight(WARM_WHITE, 1.0);
  fill2.position.set(32, 14, -18);
  fill2.castShadow = false;
  scene.add(fill2);

  // ── RIM LIGHT: subtle edge accent ──
  const rim = new THREE.DirectionalLight(WARM_WHITE, 0.8);
  rim.position.set(-12, 5, -30);
  rim.castShadow = false;
  scene.add(rim);
}





function buildEnv(scene: THREE.Scene) {
  // ============================================================
  // 1. SOFT STERILE BACKGROUND + FOG
  // ============================================================
  //scene.background = new THREE.Color(0xeaf0f5);
  // scene.fog = new THREE.FogExp2(0xeaf0f5, 0.0028);

  // ============================================================
  // 2. PERFORATED FLOOR PANEL TEXTURE (procedural canvas)
  //    - 600mm × 600mm panel = one texture tile
  //    - Dense circular perforations in a square grid
  //    - Visible hole depth via dark interior + subtle ring
  // ============================================================
  const PANEL_PX = 512;                 // texture resolution per panel
  const HOLES_PER_SIDE = 10;            // 10 × 10 holes per 600mm panel
  const HOLE_RADIUS_PX = 14;            // hole visible radius
  const BEVEL_PX = 6;                   // recessed shading width

  const panelCanvas = document.createElement("canvas");
  panelCanvas.width = PANEL_PX;
  panelCanvas.height = PANEL_PX;
  const pctx = panelCanvas.getContext("2d")!;

  // ── 2a. Base panel: clean white anti-static powder-coat ──
  const baseGrad = pctx.createLinearGradient(0, 0, PANEL_PX, PANEL_PX);
  baseGrad.addColorStop(0, "#ffffff");
  baseGrad.addColorStop(0.5, "#f5f5f5");
  baseGrad.addColorStop(1, "#ebebeb");
  pctx.fillStyle = baseGrad;
  pctx.fillRect(0, 0, PANEL_PX, PANEL_PX);

  // ── 2b. Very faint brushed-metal noise ──
  pctx.globalAlpha = 0.04;
  for (let i = 0; i < 2000; i++) {
    pctx.fillStyle = Math.random() > 0.5 ? "#ffffff" : "#c8ced4";
    pctx.fillRect(Math.random() * PANEL_PX, Math.random() * PANEL_PX, 1, 1);
  }
  pctx.globalAlpha = 1;

  // ── 2c. Tile edge bevel — thin dark seam around panel border ──
  pctx.strokeStyle = "rgba(60,70,80,0.55)";
  pctx.lineWidth = 4;
  pctx.strokeRect(2, 2, PANEL_PX - 4, PANEL_PX - 4);
  pctx.strokeStyle = "rgba(255,255,255,0.7)";
  pctx.lineWidth = 1;
  pctx.strokeRect(6, 6, PANEL_PX - 12, PANEL_PX - 12);

  // ── 2d. Recessed mounting screws (4 corners) ──
  const drawScrew = (cx: number, cy: number) => {
    // dark recess
    pctx.beginPath();
    pctx.arc(cx, cy, 9, 0, Math.PI * 2);
    pctx.fillStyle = "#3a4048";
    pctx.fill();
    // screw head
    pctx.beginPath();
    pctx.arc(cx, cy, 6, 0, Math.PI * 2);
    pctx.fillStyle = "#9aa3ac";
    pctx.fill();
    // slot
    pctx.strokeStyle = "#252a30";
    pctx.lineWidth = 1.6;
    pctx.beginPath();
    pctx.moveTo(cx - 4, cy);
    pctx.lineTo(cx + 4, cy);
    pctx.stroke();
    // tiny highlight
    pctx.beginPath();
    pctx.arc(cx - 1.5, cy - 1.5, 1.2, 0, Math.PI * 2);
    pctx.fillStyle = "rgba(255,255,255,0.6)";
    pctx.fill();
  };
  drawScrew(30, 30);
  drawScrew(PANEL_PX - 30, 30);
  drawScrew(30, PANEL_PX - 30);
  drawScrew(PANEL_PX - 30, PANEL_PX - 30);

  // ── 2e. PERFORATION HOLE GRID — this is the dominant feature ──
  const margin = 70;
  const usable = PANEL_PX - margin * 2;
  const spacing = usable / (HOLES_PER_SIDE - 1);

  for (let row = 0; row < HOLES_PER_SIDE; row++) {
    for (let col = 0; col < HOLES_PER_SIDE; col++) {
      const cx = margin + col * spacing;
      const cy = margin + row * spacing;

      // Outer recessed ring (gives depth illusion)
      const ringGrad = pctx.createRadialGradient(
        cx - 2, cy - 2, 0,
        cx, cy, HOLE_RADIUS_PX + BEVEL_PX
      );
      ringGrad.addColorStop(0, "rgba(180,188,196,0.0)");
      ringGrad.addColorStop(0.55, "rgba(140,148,156,0.35)");
      ringGrad.addColorStop(1, "rgba(90,98,106,0.0)");
      pctx.fillStyle = ringGrad;
      pctx.beginPath();
      pctx.arc(cx, cy, HOLE_RADIUS_PX + BEVEL_PX, 0, Math.PI * 2);
      pctx.fill();

      // Dark hole interior (deep recess)
      const holeGrad = pctx.createRadialGradient(
        cx + 1.5, cy + 1.5, 0,
        cx, cy, HOLE_RADIUS_PX
      );
      holeGrad.addColorStop(0, "#1a1d22");
      holeGrad.addColorStop(0.7, "#0d1014");
      holeGrad.addColorStop(1, "#05070a");
      pctx.fillStyle = holeGrad;
      pctx.beginPath();
      pctx.arc(cx, cy, HOLE_RADIUS_PX, 0, Math.PI * 2);
      pctx.fill();

      // Subtle top-left highlight on rim (catches overhead light)
      pctx.strokeStyle = "rgba(255,255,255,0.45)";
      pctx.lineWidth = 1.2;
      pctx.beginPath();
      pctx.arc(cx, cy, HOLE_RADIUS_PX + 0.5, Math.PI * 1.1, Math.PI * 1.7);
      pctx.stroke();

      // Bottom-right shadow on rim
      pctx.strokeStyle = "rgba(0,0,0,0.35)";
      pctx.lineWidth = 1;
      pctx.beginPath();
      pctx.arc(cx, cy, HOLE_RADIUS_PX + 0.5, Math.PI * 0.1, Math.PI * 0.7);
      pctx.stroke();
    }
  }

  const panelTex = new THREE.CanvasTexture(panelCanvas);
  panelTex.wrapS = THREE.RepeatWrapping;
  panelTex.wrapT = THREE.RepeatWrapping;
  panelTex.anisotropy = 16;
  panelTex.magFilter = THREE.LinearFilter;
  panelTex.minFilter = THREE.LinearMipmapLinearFilter;

  // Floor is 180 × 90 units. One panel = 3 units (≈ 600mm scaled).
  // → repeat 60 × 30 across the floor.
  panelTex.repeat.set(60, 30);

  // ============================================================
  // 3. MAIN FLOOR MESH (perforated panels)
  // ============================================================
  const floorMat = new THREE.MeshStandardMaterial({
    map: panelTex,
    color: 0xf0f0f0,
    roughness: 0.55,
    metalness: 0.18,
    envMapIntensity: 0.7,
    emissive: 0xdddddd,
    emissiveIntensity: 0.05,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(180, 90), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.52;
  floor.receiveShadow = false;
  floor.castShadow = false;
  scene.add(floor);

  // ============================================================
  // 4. TILE SEAM OVERLAY — sharp dark grid lines between panels
  //    Gives that crisp "modular raised floor" look on top of texture.
  // ============================================================
  const seamCanvas = document.createElement("canvas");
  seamCanvas.width = 512;
  seamCanvas.height = 512;
  const sctx = seamCanvas.getContext("2d")!;
  sctx.clearRect(0, 0, 512, 512);
  // dark seam on right + bottom edges of every panel
  sctx.strokeStyle = "rgba(35,42,50,0.85)";
  sctx.lineWidth = 3;
  sctx.beginPath();
  sctx.moveTo(0, 510); sctx.lineTo(512, 510);
  sctx.moveTo(510, 0); sctx.lineTo(510, 512);
  sctx.stroke();
  // bright highlight on left + top (lip of next tile)
  sctx.strokeStyle = "rgba(255,255,255,0.55)";
  sctx.lineWidth = 1.5;
  sctx.beginPath();
  sctx.moveTo(0, 2); sctx.lineTo(512, 2);
  sctx.moveTo(2, 0); sctx.lineTo(2, 512);
  sctx.stroke();

  const seamTex = new THREE.CanvasTexture(seamCanvas);
  seamTex.wrapS = THREE.RepeatWrapping;
  seamTex.wrapT = THREE.RepeatWrapping;
  seamTex.repeat.set(60, 30);     // match panel count

  const seamOverlay = new THREE.Mesh(
    new THREE.PlaneGeometry(180, 90),
    new THREE.MeshBasicMaterial({
      map: seamTex,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    })
  );
  seamOverlay.rotation.x = -Math.PI / 2;
  seamOverlay.position.y = -0.515;     // 5mm above floor to avoid z-fight
  seamOverlay.renderOrder = 1;
  scene.add(seamOverlay);

  // ============================================================
  // 5. SUBTLE OVERHEAD HIGHLIGHT POOLS (HEPA downflow spots)
  // ============================================================
  for (let i = 0; i < 12; i++) {
    const spot = new THREE.Mesh(
      new THREE.CircleGeometry(1.2 + Math.random() * 0.6, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.10 + Math.random() * 0.06,
        depthWrite: false,
      })
    );
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(
      -40 + Math.random() * 80,
      -0.508,
      -20 + Math.random() * 40
    );
    scene.add(spot);
  }

  // ============================================================
  // 7. CLEAN BACK WALL (minimal, neutral, slight blue tint)
  // ============================================================
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xb0b0b0,
    roughness: 0.6,
    metalness: 0.05,
    emissive: 0x999999,
    emissiveIntensity: 0.05,
  });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(180, 22), wallMat);
  wall.position.set(6, 10, -32);
  wall.receiveShadow = false;
  wall.castShadow = false;
  scene.add(wall);

  // Lower wall accent (darker base strip)
  const wallBase = new THREE.Mesh(
    new THREE.PlaneGeometry(180, 4),
    new THREE.MeshStandardMaterial({
      color: 0x888888,
      roughness: 0.6,
      metalness: 0.08,
    })
  );
  wallBase.position.set(6, 1.5, -31.99);
  wallBase.receiveShadow = false;
  wallBase.castShadow = false;
  scene.add(wallBase);

  // Thin dark seam between wall and floor
  const wallSeam = new THREE.Mesh(
    new THREE.BoxGeometry(180, 0.04, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.4, metalness: 0.7 })
  );
  wallSeam.position.set(6, -0.48, -31.95);
  scene.add(wallSeam);
}

// ─── ENVIRONMENT ─────────────────────────────────────────────────────────────

function addSLabel(scene: THREE.Scene, text: string, x: number, y: number, z: number, color: number) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 72;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = hex2css(color);
  ctx.font = "bold 20px 'Courier New',monospace";
  ctx.textAlign = "center"; ctx.shadowColor = hex2css(color); ctx.shadowBlur = 12;
  ctx.fillText(text, 256, 46);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.85 }));
  sp.scale.set(7, 0.95, 1); sp.position.set(x, y, z); scene.add(sp);
}

// ─── CONVEYOR BELT (from code 1, with enhanced animation) ────────────────────

class ConveyorBelt {
  beltSegments: THREE.Mesh[] = [];
  rollers: THREE.Mesh[] = [];
  beltOffset = 0;
  beltLength: number;
  beltWidth: number;

  constructor(scene: THREE.Scene, startX: number, endX: number, z: number, color: number, surfaceY?: number, beltWidth = 2.2) {
    this.beltLength = Math.abs(endX - startX);
    this.beltWidth = beltWidth;
    const centerX = (startX + endX) / 2;
    const legOff = beltWidth / 2 - 0.18;
    const railOff = beltWidth / 2 - 0.06;

    // ── LOW BELT: default legacy height, or explicit fab floor (under module plane) ──
    const LEG_H = 0.16;
    const BELT_Y = surfaceY !== undefined ? surfaceY : LEG_H + 0.04;
    const legH = Math.max(0.1, Math.min(BELT_Y - 0.015, 0.28));

    const legMat = new THREE.MeshStandardMaterial({ color: 0x3a4450, roughness: 0.35, metalness: 0.88 });
    const legSpacing = this.beltLength / 5;
    for (let i = 1; i <= 4; i++) {
      const lx = startX + i * legSpacing;
      [-legOff, legOff].forEach((lz) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.10, legH, 0.10), legMat);
        leg.position.set(lx, legH * 0.5, z + lz);
        scene.add(leg);
      });
    }

    // Side rails — clean white/grey to match reference
    const railMat = new THREE.MeshStandardMaterial({
      color: 0xc8d4e0,
      roughness: 0.25,
      metalness: 0.7,
      emissive: color,
      emissiveIntensity: 0.15,
    });
    [-railOff, railOff].forEach((zOff) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(this.beltLength, 0.07, 0.12), railMat);
      rail.position.set(centerX, BELT_Y + 0.035, z + zOff);
      scene.add(rail);
    });

    // Belt surface — light coloured, animated stripe texture
    const beltCanvas = document.createElement("canvas");
    beltCanvas.width = 512; beltCanvas.height = 64;
    const bCtx = beltCanvas.getContext("2d")!;
    this._drawBelt(bCtx, 0, color);
    const beltTex = new THREE.CanvasTexture(beltCanvas);
    beltTex.wrapS = THREE.RepeatWrapping; beltTex.wrapT = THREE.RepeatWrapping;
    beltTex.repeat.set(this.beltLength / 2, 1);

    const beltMesh = new THREE.Mesh(
      new THREE.BoxGeometry(this.beltLength, 0.05, beltWidth),
      new THREE.MeshStandardMaterial({
        color: 0x2a2e32,
        emissive: 0x112233,
        emissiveIntensity: 0.12,
        roughness: 0.55,
        metalness: 0.35,
        map: beltTex,
      })
    );
    beltMesh.position.set(centerX, BELT_Y, z);
    beltMesh.userData.beltTex = beltTex;
    beltMesh.userData.beltCanvas = beltCanvas;
    beltMesh.userData.beltCtx = bCtx;
    beltMesh.userData.beltColor = color;
    beltMesh.receiveShadow = true;
    scene.add(beltMesh);
    this.beltSegments.push(beltMesh);

    // Bright glow strip BELOW belt — gives the neon-line look from reference
    const glowStrip = new THREE.Mesh(
      new THREE.BoxGeometry(this.beltLength, 0.022, 0.20),
      new THREE.MeshStandardMaterial({
        color: 0x224466,
        emissive: 0x3366aa,
        emissiveIntensity: 0.55,
        roughness: 0.35,
        transparent: true,
        opacity: 0.55,
      })
    );
    glowStrip.position.set(centerX, BELT_Y - 0.028, z);
    scene.add(glowStrip);

    // Animated stripe markers (sliding along belt)
    const stripeMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.85,
      roughness: 0.35,
    });
    const numStripes = Math.floor(this.beltLength / 1.6);
    for (let i = 0; i <= numStripes; i++) {
      const sx = startX + (i / numStripes) * this.beltLength;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, beltWidth - 0.08), stripeMat);
      stripe.position.set(sx, BELT_Y + 0.03, z);
      stripe.userData.beltStripe = true;
      stripe.userData.baseX = sx;
      stripe.userData.startX = startX;
      stripe.userData.endX = endX;
      scene.add(stripe);
      this.rollers.push(stripe);
    }

    // End rollers
    const rollerMat = new THREE.MeshStandardMaterial({
      color: 0xb0c0d0,
      roughness: 0.18,
      metalness: 0.92,
    });
    [startX + 0.25, endX - 0.25].forEach((rx) => {
      const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, beltWidth + 0.2, 18), rollerMat);
      roller.rotation.x = Math.PI / 2;
      roller.position.set(rx, BELT_Y, z);
      scene.add(roller);
    });
  }

  private _drawBelt(ctx: CanvasRenderingContext2D, offset: number, color: number) {
    ctx.clearRect(0, 0, 512, 64);
    // Lighter belt base — matches clean cleanroom feel
    const grad = ctx.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, "#dde6f0");
    grad.addColorStop(0.5, "#e8f0f8");
    grad.addColorStop(1, "#dde6f0");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 64);

    const css = `#${color.toString(16).padStart(6, "0")}`;
    ctx.strokeStyle = css; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.55;
    const spacing = 56;
    for (let x = (offset % spacing) - spacing; x < 512 + spacing; x += spacing) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 18, 64); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Edge accents
    ctx.strokeStyle = css; ctx.lineWidth = 2; ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(512, 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 60); ctx.lineTo(512, 60); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  tick(dt: number, speed: number, direction = 1) {
    this.beltOffset += dt * speed * direction * 32;
    this.rollers.forEach((stripe) => {
      if (!stripe.userData.beltStripe) return;
      const range = stripe.userData.endX - stripe.userData.startX;
      let nx = stripe.userData.baseX + (this.beltOffset * direction * 0.09) % range;
      if (nx > stripe.userData.endX) nx -= range;
      if (nx < stripe.userData.startX) nx += range;
      stripe.position.x = nx;
    });
    this.beltSegments.forEach((seg) => {
      const ctx = seg.userData.beltCtx as CanvasRenderingContext2D;
      const tex = seg.userData.beltTex as THREE.CanvasTexture;
      const color = seg.userData.beltColor as number;
      if (ctx && tex) { this._drawBelt(ctx, this.beltOffset, color); tex.needsUpdate = true; }
    });
  }
}
// ─── PARTICLES (from code 2) ──────────────────────────────────────────────────
class Particles {
  n: number;
  origin: THREE.Vector3;
  active: boolean;
  mat: THREE.PointsMaterial;
  pts: THREE.Points;
  geo: THREE.BufferGeometry;
  vel: { vx: number; vy: number; vz: number; life: number }[];
  colors: Float32Array;
  baseColor: THREE.Color;

  constructor(scene: THREE.Scene, pos: THREE.Vector3, color: number, n: number, sz = 0.07) {
    this.n = n;
    this.origin = pos.clone();
    this.active = false;
    this.baseColor = new THREE.Color(color);

    const pa = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.vel = [];

    for (let i = 0; i < n; i++) {
      pa[i * 3] = pos.x + (Math.random() - 0.5) * 0.9;
      pa[i * 3 + 1] = pos.y + 0.5;
      pa[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.9;

      // Color variation
      const shade = 0.7 + Math.random() * 0.3;
      this.colors[i * 3] = this.baseColor.r * shade;
      this.colors[i * 3 + 1] = this.baseColor.g * shade;
      this.colors[i * 3 + 2] = this.baseColor.b * shade;

      this.vel.push({
        vx: (Math.random() - 0.5) * 0.55,
        vy: 0.6 + Math.random() * 1.2,
        vz: (Math.random() - 0.5) * 0.55,
        life: Math.random()
      });
    }

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(pa, 3));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));

    this.mat = new THREE.PointsMaterial({
      size: sz,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
    });

    this.pts = new THREE.Points(this.geo, this.mat);
    this.pts.visible = false;
    scene.add(this.pts);
  }

  // ⬇️ ADD THESE TWO METHODS ⬇️
  on() {
    this.active = true;
    this.pts.visible = true;
  }

  off() {
    this.active = false;
    this.pts.visible = false;
  }
  // ⬆️ ADD THESE TWO METHODS ⬆️

  tick(dt: number, spd: number) {
    if (!this.active) return;
    const pa = this.geo.attributes.position.array as Float32Array;
    const ca = this.geo.attributes.color.array as Float32Array;

    for (let i = 0; i < this.n; i++) {
      const v = this.vel[i];
      v.life += dt * spd * 0.6;

      // Color pulsing
      const pulse = 0.5 + 0.5 * Math.sin(v.life * 8);
      ca[i * 3] = this.baseColor.r * (0.5 + pulse * 0.5);
      ca[i * 3 + 1] = this.baseColor.g * (0.3 + pulse * 0.7);
      ca[i * 3 + 2] = this.baseColor.b * (0.7 + pulse * 0.3);

      if (v.life > 1.2) {
        v.life = 0;
        pa[i * 3] = this.origin.x + (Math.random() - 0.5) * 0.9;
        pa[i * 3 + 1] = this.origin.y + 0.5;
        pa[i * 3 + 2] = this.origin.z + (Math.random() - 0.5) * 0.9;
        v.vx = (Math.random() - 0.5) * 0.55;
        v.vy = 0.6 + Math.random() * 1.2;
        v.vz = (Math.random() - 0.5) * 0.55;
      } else {
        pa[i * 3] += v.vx * dt * spd;
        pa[i * 3 + 1] += v.vy * dt * spd;
        pa[i * 3 + 2] += v.vz * dt * spd;
        v.vy -= 0.15 * dt * spd;
      }
    }

    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

// ─── HEAT VAPOR PARTICLES (for hot plates) ───────────────────────────────────

class HeatVapor {
  pts: THREE.Points;
  geo: THREE.BufferGeometry;
  origin: THREE.Vector3;
  n: number;
  active = false;
  vel: { vy: number; life: number; ox: number; oz: number; size: number }[] = [];
  sizes: Float32Array;

  constructor(scene: THREE.Scene, pos: THREE.Vector3, color: number, n = 80) {
    this.n = n;
    this.origin = pos.clone();
    const pa = new Float32Array(n * 3);
    this.sizes = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      pa[i * 3] = pos.x;
      pa[i * 3 + 1] = pos.y;
      pa[i * 3 + 2] = pos.z;
      this.sizes[i] = 0.06 + Math.random() * 0.04;
      this.vel.push({
        vy: 0.5 + Math.random() * 0.4,        // gentler rise
        life: Math.random(),
        ox: (Math.random() - 0.5) * 0.25,     // tight ±0.25 spread (was ±0.7)
        oz: (Math.random() - 0.5) * 0.25,     // tight ±0.25 spread (was ±0.7)
        size: 0.06 + Math.random() * 0.04,
      });
    }

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(pa, 3));

    const mat = new THREE.PointsMaterial({
      color,
      size: 0.10,                              // smaller particles (was 0.22)
      transparent: true,
      opacity: 0.45,                           // softer (was 0.65)                             // more visible
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.pts = new THREE.Points(this.geo, mat);
    this.pts.visible = false;
    scene.add(this.pts);
  }

  on() { this.active = true; this.pts.visible = true; }
  off() { this.active = false; this.pts.visible = false; }

  tick(dt: number, spd: number) {
    if (!this.active) return;
    const pa = this.geo.attributes.position.array as Float32Array;

    for (let i = 0; i < this.n; i++) {
      const v = this.vel[i];
      v.life += dt * spd * 0.55;

      if (v.life > 1.8) {
        // Respawn AT the module top
        v.life = 0;
        pa[i * 3] = this.origin.x + v.ox * 0.3;
        pa[i * 3 + 1] = this.origin.y;
        pa[i * 3 + 2] = this.origin.z + v.oz * 0.3;
      } else {
        // Rise upward with sideways wobble (like real heat shimmer)
        pa[i * 3] += Math.sin(v.life * 4 + i) * 0.008 * spd;
        pa[i * 3 + 1] += v.vy * dt * spd;
        pa[i * 3 + 2] += Math.cos(v.life * 4 + i) * 0.008 * spd;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

// ─── HMDS VAPOR (swirling fog inside chamber) ────────────────────────────────

class HMDSFog {
  group: THREE.Group;
  fogShells: THREE.Mesh[] = [];
  active = false;

  constructor(scene: THREE.Scene, pos: THREE.Vector3) {
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    scene.add(this.group);
    this.group.visible = false;
    for (let i = 0; i < 4; i++) {
      const r = 0.7 + i * 0.15;
      const fog = new THREE.Mesh(
        new THREE.SphereGeometry(r, 24, 16),
        new THREE.MeshStandardMaterial({
          color: 0xff9933,
          emissive: 0xff7700,
          emissiveIntensity: 0.3,
          transparent: true,
          opacity: 0.05 + i * 0.02,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      );
      this.group.add(fog);
      this.fogShells.push(fog);
    }
  }
  on() {
    this.active = true;
    this.group.visible = false;
  }

  off() {
    this.active = false;
    this.group.visible = false;
  }
  // ⬆️ ADD THESE ⬆️

  tick(dt: number, spd: number, time: number) {
    if (!this.active) return;
    this.fogShells.forEach((s, i) => {
      s.rotation.y += dt * spd * (0.4 + i * 0.15) * (i % 2 ? 1 : -1);
      s.rotation.x = Math.sin(time * 0.8 + i) * 0.1;
      const mat = s.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.05 + i * 0.02 + Math.sin(time * 1.5 + i) * 0.02;
    });
  }
}

// ─── ENVIRONMENT BUILD ───────────────────────────────────────────────────────

// function buildEnv(scene: THREE.Scene) {
//   // Floor
//   const flMat = new THREE.MeshStandardMaterial({ color: 0xdde8f0, roughness: 0.06, metalness: 0.3 });
//   const fl = new THREE.Mesh(new THREE.PlaneGeometry(160, 80), flMat);
//   fl.rotation.x = -Math.PI / 2; fl.position.y = -0.52; fl.receiveShadow = true; scene.add(fl);

//   // Grid
//   const grid = new THREE.GridHelper(160, 80, 0x8899aa, 0xaabbc0);
//   grid.position.y = -0.5;
//   (grid.material as THREE.Material).transparent = true;
//   (grid.material as THREE.Material).opacity = 0.18;
//   scene.add(grid);

//   // Back wall
//   const wallMat = new THREE.MeshStandardMaterial({ color: 0xe8eff5, roughness: 0.7, metalness: 0.05 });
//   const wall = new THREE.Mesh(new THREE.PlaneGeometry(160, 28), wallMat);
//   wall.position.set(6, 13, -30); scene.add(wall);

//   // Ceiling with FFU panels
//   const ceilMat = new THREE.MeshStandardMaterial({ color: 0xf5f9ff, roughness: 0.9, metalness: 0.0 });
//   const ceil = new THREE.Mesh(new THREE.PlaneGeometry(160, 80), ceilMat);
//   ceil.rotation.x = Math.PI / 2; ceil.position.y = 18; scene.add(ceil);

//   for (let x = -22; x <= 38; x += 8) {
//     for (let z = -8; z <= 8; z += 6) {
//       const ffu = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.18, 5.5),
//         new THREE.MeshStandardMaterial({ color: 0xc8d8e8, roughness: 0.5, metalness: 0.4 }));
//       ffu.position.set(x, 17.9, z); scene.add(ffu);
//     }
//   }

//   // Section labels
//   [
//     { t: "EFEM / LOADING SECTION",   x: -19, y: 5.5, z: 0,     c: 0x2266cc },
//     { t: "MAIN PROCESS TRACK →",     x: 7,   y: 5.5, z: TOP_Z, c: 0x0055cc },
//     { t: "← POST-EXPOSURE TRACK",    x: 7,   y: 5.5, z: BOT_Z, c: 0x007755 },
//     { t: "SCANNER MODULE",           x: 37,  y: 5.5, z: 0,     c: 0x8800cc },
//     { t: "INTERFACE SECTION",        x: 31,  y: 5.5, z: 0,     c: 0xaa8800 },
//   ].forEach((o) => addSLabel(scene, o.t, o.x, o.y, o.z, o.c));

//   // Info box
//   buildInfoBox(scene);
// // }
// function buildEnv(scene: THREE.Scene) {
//   // Medium-dark reflective floor
//   const flMat = new THREE.MeshStandardMaterial({ 
//     color: 0x7a8e9e,
//     roughness: 0.12, 
//     metalness: 0.42,
//     envMapIntensity: 0.6,
//   });
//   const fl = new THREE.Mesh(new THREE.PlaneGeometry(180, 90), flMat);
//   fl.rotation.x = -Math.PI / 2; 
//   fl.position.y = -0.52; 
//   fl.receiveShadow = true; 
//   scene.add(fl);

//   // Subtle grid with blue accent
//   const gridCanvas = document.createElement("canvas");
//   gridCanvas.width = 1024; 
//   gridCanvas.height = 512;
//   const gCtx = gridCanvas.getContext("2d")!;
//   gCtx.strokeStyle = "#3355aa";
//   gCtx.lineWidth = 1.8;
//   gCtx.globalAlpha = 0.25;
//   for (let x = 0; x < 1024; x += 64) {
//     gCtx.beginPath(); 
//     gCtx.moveTo(x, 0); 
//     gCtx.lineTo(x, 512); 
//     gCtx.stroke();
//   }
//   for (let y = 0; y < 512; y += 64) {
//     gCtx.beginPath(); 
//     gCtx.moveTo(0, y); 
//     gCtx.lineTo(1024, y); 
//     gCtx.stroke();
//   }

//   const gridTex = new THREE.CanvasTexture(gridCanvas);
//   gridTex.wrapS = THREE.RepeatWrapping;
//   gridTex.wrapT = THREE.RepeatWrapping;
//   gridTex.repeat.set(3, 3);

//   const grid = new THREE.Mesh(
//     new THREE.PlaneGeometry(180, 90),
//     new THREE.MeshStandardMaterial({ 
//       map: gridTex, 
//       transparent: true, 
//       opacity: 0.45, 
//       depthWrite: false,
//       emissive: 0x3355aa,
//       emissiveIntensity: 0.25,
//     })
//   );
//   grid.rotation.x = -Math.PI / 2; 
//   grid.position.y = -0.5; 
//   scene.add(grid);

//   // Back wall only — no ceiling, no hex panels
//   const wallMat = new THREE.MeshStandardMaterial({ 
//     color: 0xc0d4e8, 
//     roughness: 0.45, 
//     metalness: 0.1,
//     emissive: 0x152030,
//     emissiveIntensity: 0.12,
//   });
//   const wall = new THREE.Mesh(new THREE.PlaneGeometry(180, 30), wallMat);
//   wall.position.set(6, 14, -32); 
//   scene.add(wall);

//   // ── CEILING AND HEX PANELS REMOVED ──
//   // No ceil mesh, no hexagonal FFU panels
// }
// ─── INFO BOX ────────────────────────────────────────────────────────────────

function buildInfoBox(scene: THREE.Scene) {
  const grp = new THREE.Group();
  grp.position.set(50, 0, -8);

  const boxMat = new THREE.MeshStandardMaterial({ color: 0xffee88, roughness: 0.4, metalness: 0.05, emissive: 0xddcc44, emissiveIntensity: 0.2 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 0.12), boxMat);
  box.position.y = 2.5; grp.add(box);

  const borderMat = new THREE.MeshStandardMaterial({ color: 0xcc8800, roughness: 0.3, metalness: 0.3, emissive: 0xaa6600, emissiveIntensity: 0.3 });
  const border = new THREE.Mesh(new THREE.BoxGeometry(6.15, 5.15, 0.08), borderMat);
  border.position.set(0, 2.5, -0.02); grp.add(border);

  const c = document.createElement("canvas"); c.width = 400; c.height = 300;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffee44";
  ctx.fillRect(0, 0, 400, 300);
  ctx.fillStyle = "#cc8800";
  ctx.font = "bold 28px 'Courier New',monospace";
  ctx.textAlign = "left";
  ctx.fillText("Info Box", 14, 40);
  ctx.font = "12px 'Courier New',monospace";
  ctx.fillStyle = "#554400";
  const lines = [
    "Process Parameters: 65°C",
    "Preset Parameters: 1500°C",
    "Chill Coating: 27.5",
    "Post-Apply Bake: 90°C",
    "Edge Diam: Silicon wafers",
  ];
  lines.forEach((l, i) => ctx.fillText(l, 14, 75 + i * 24));

  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: false }));
  sp.scale.set(5.8, 4.8, 1); sp.position.set(0, 2.5, 0.12); grp.add(sp);

  scene.add(grp);
}

class DevLiquidAnimator {
  group: THREE.Group;
  liquidPool: THREE.Mesh;

  // ── SWING ARM ASSEMBLY ──
  pivotPost: THREE.Mesh;
  swingBar: THREE.Group;
  valveBody: THREE.Mesh;
  nozzleTip: THREE.Mesh;
  tipGlow: THREE.Mesh;

  // ── CONTINUOUS STREAMS ──
  liquidStreams: THREE.Mesh[] = [];
  streamMats: THREE.MeshStandardMaterial[] = [];

  // ── SPIRAL PATTERN ──
  spiralCanvas!: HTMLCanvasElement;
  spiralCtx!: CanvasRenderingContext2D;
  spiralTex!: THREE.CanvasTexture;
  spiralMesh!: THREE.Mesh;
  spiralAngle = 0;

  private _drawAccum = 0;
  private _matUpdateAccum = 0;

  poolGroup!: THREE.Group;
  poolSpin = 0;

  readonly POST_X = 1.2;   // + moves stand to +X corner (was 0.0, centered)
  readonly POST_Z = 1.4;   // more positive = further back (was 1.2)
  readonly BAR_LENGTH = 1.85;  // lengthened to reach center from corner (was 1.4)
  readonly NOZZLE_DROP = 0.30;
  readonly TIP_DROP = 0.10;

  active = false;
  phase: "idle" | "swing_in" | "spray" | "puddle" | "rinse" | "swing_out" | "drain" | "done" = "idle";
  phaseT = 0;
  phaseDur = 1;

  readonly SWING_PARKED = -Math.PI / 2;              // ← changed
readonly SWING_OVER = -Math.PI / 2 - Math.PI / 4;  // unchanged
swingAngle = -Math.PI / 2;                          // ← changed

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.group.visible = false;

    // ── LIQUID POOL ──
    this.poolGroup = new THREE.Group();
    this.poolGroup.position.y = 0.05;
    this.group.add(this.poolGroup);

    this.liquidPool = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.75, 0.012, 64),
      new THREE.MeshStandardMaterial({
        color: 0x33cc88, roughness: 0.05, metalness: 0.05,
        transparent: true, opacity: 0,
        emissive: 0x22aa66, emissiveIntensity: 0.4,
      })
    );
    this.poolGroup.add(this.liquidPool);

    // ── SPIRAL PATTERN ──
    this.spiralCanvas = document.createElement("canvas");
    this.spiralCanvas.width = 512;
    this.spiralCanvas.height = 512;
    this.spiralCtx = this.spiralCanvas.getContext("2d")!;
    this.spiralTex = new THREE.CanvasTexture(this.spiralCanvas);

    this.spiralMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.74, 80),
      new THREE.MeshBasicMaterial({
        map: this.spiralTex, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
    );
    this.spiralMesh.rotation.x = -Math.PI / 2;
    this.spiralMesh.position.y = 0.015;
    this.spiralMesh.renderOrder = 10;
    this.poolGroup.add(this.spiralMesh);

    // ═══════════════════════════════════════════════════════════════════
    // BASE MOUNTING ASSEMBLY — VERTICAL STACK
    // Plate → Box → Box Top → Post Flange → Post → Swing Arm
    // Everything centered at (POST_X, POST_Z) so post rises FROM the box
    // ═══════════════════════════════════════════════════════════════════
    const POST_X = this.POST_X;
    const POST_Z = this.POST_Z;

    // ── BASE PLATE (sits on module surface) ──
    const basePlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.10, 0.75),
      new THREE.MeshStandardMaterial({
        color: 0x1c2230,
        roughness: 0.35,
        metalness: 0.92,
        emissive: 0x050810,
        emissiveIntensity: 0.4,
      })
    );
    basePlate.position.set(POST_X, 0.05, POST_Z);
    basePlate.castShadow = true;
    this.group.add(basePlate);

    // ── BASE BEVEL (chamfer on top of plate) ──
    const baseBevel = new THREE.Mesh(
      new THREE.BoxGeometry(0.88, 0.025, 0.78),
      new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.20, metalness: 0.95 })
    );
    baseBevel.position.set(POST_X, 0.108, POST_Z);
    this.group.add(baseBevel);

    // ── 4 CORNER BOLTS ──
    [[-0.32, -0.27], [0.32, -0.27], [-0.32, 0.27], [0.32, 0.27]].forEach(([dx, dz]) => {
      const boltBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.06, 6),
        new THREE.MeshStandardMaterial({ color: 0x111118, metalness: 0.98, roughness: 0.2 })
      );
      boltBody.position.set(POST_X + (dx as number), 0.135, POST_Z + (dz as number));
      this.group.add(boltBody);

      const boltHead = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.02, 6),
        new THREE.MeshStandardMaterial({ color: 0x778899, metalness: 0.95, roughness: 0.15 })
      );
      boltHead.position.set(POST_X + (dx as number), 0.17, POST_Z + (dz as number));
      this.group.add(boltHead);
    });

    // ── CONTROL BOX (sits centered on base plate, post will sit on top) ──
    const controlBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.40, 0.50),
      new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.32, metalness: 0.88, emissive: 0x0a1525, emissiveIntensity: 0.5 })
    );
    controlBox.position.set(POST_X, 0.32, POST_Z);
    controlBox.castShadow = true;
    this.group.add(controlBox);

    // ── FRONT PANEL (faces +Z direction) ──
    const frontPanel = new THREE.Mesh(
      new THREE.BoxGeometry(0.50, 0.36, 0.015),
      new THREE.MeshStandardMaterial({ color: 0x1a1f28, roughness: 0.4, metalness: 0.7 })
    );
    frontPanel.position.set(POST_X, 0.32, POST_Z + 0.26);
    this.group.add(frontPanel);

    // ── STATUS LED ──
    const statusLED = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.015, 12),
      new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ddff, emissiveIntensity: 3.5, roughness: 0.2 })
    );
    statusLED.rotation.x = Math.PI / 2;
    statusLED.position.set(POST_X - 0.18, 0.42, POST_Z + 0.27);
    this.group.add(statusLED);

    // ── POWER LED ──
    const powerLED = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.015, 12),
      new THREE.MeshStandardMaterial({ color: 0x00ff44, emissive: 0x00ff44, emissiveIntensity: 3.0, roughness: 0.2 })
    );
    powerLED.rotation.x = Math.PI / 2;
    powerLED.position.set(POST_X - 0.08, 0.42, POST_Z + 0.27);
    this.group.add(powerLED);

    // ── TIP GLOW LED ──
    this.tipGlow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.015, 12),
      new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xff8800, emissiveIntensity: 0.5, roughness: 0.2 })
    );
    this.tipGlow.rotation.x = Math.PI / 2;
    this.tipGlow.position.set(POST_X + 0.02, 0.42, POST_Z + 0.27);
    this.group.add(this.tipGlow);

    // ── BOX TOP CAP (top surface of control box where post mounts) ──
    const boxTopCap = new THREE.Mesh(
      new THREE.BoxGeometry(0.58, 0.04, 0.53),
      new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.22, metalness: 0.94 })
    );
    boxTopCap.position.set(POST_X, 0.54, POST_Z);
    this.group.add(boxTopCap);

    // ── POST FLANGE (where post bolts to box top) ──
    const postFlange = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.20, 0.08, 16),
      new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.18, metalness: 0.96, emissive: 0x112233, emissiveIntensity: 0.3 })
    );
    postFlange.position.set(POST_X, 0.60, POST_Z);
    this.group.add(postFlange);

    // ── FLANGE BOLTS ──
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const bolt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.018, 0.025, 6),
        new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.95, roughness: 0.25 })
      );
      bolt.position.set(POST_X + Math.cos(angle) * 0.155, 0.64, POST_Z + Math.sin(angle) * 0.155);
      this.group.add(bolt);
    }

    // ── PIVOT POST (rises from flange on box top) ──
    const POST_HEIGHT = 1.8;
    const POST_BASE_Y = 0.64;
    this.pivotPost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.090, POST_HEIGHT, 16),
      new THREE.MeshStandardMaterial({ color: 0x37404a, roughness: 0.12, metalness: 0.95 })
    );
    this.pivotPost.position.set(POST_X, POST_BASE_Y + POST_HEIGHT / 2, POST_Z);
    this.group.add(this.pivotPost);

    // ── POST REINFORCEMENT BANDS ──
    [0.25, 0.55, 0.85].forEach((frac) => {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.082, 0.014, 6, 20),
        new THREE.MeshStandardMaterial({ color: 0x778899, metalness: 0.96, roughness: 0.2 })
      );
      band.rotation.x = Math.PI / 2;
      band.position.set(POST_X, POST_BASE_Y + POST_HEIGHT * frac, POST_Z);
      this.group.add(band);
    });

    // ── CABLE CONDUIT (alongside post on opposite side from brace) ──
    const conduit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, POST_HEIGHT * 0.85, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7, metalness: 0.2 })
    );
    conduit.position.set(POST_X - 0.11, POST_BASE_Y + POST_HEIGHT * 0.45, POST_Z);
    this.group.add(conduit);

    [0.2, 0.5, 0.8].forEach((frac) => {
      const clamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.03, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x556677, metalness: 0.94, roughness: 0.25 })
      );
      clamp.position.set(POST_X - 0.10, POST_BASE_Y + POST_HEIGHT * frac, POST_Z);
      this.group.add(clamp);
    });

    // ── POST TOP HOUSING (rotation joint) ──
    const postTopHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.18, 16),
      new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.18, metalness: 0.95, emissive: 0x002244, emissiveIntensity: 0.4 })
    );
    postTopHousing.position.set(POST_X, POST_BASE_Y + POST_HEIGHT + 0.05, POST_Z);
    this.group.add(postTopHousing);

    // ── POST TOP CAP ──
    const postTopCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.13, 0.04, 16),
      new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.15, metalness: 0.96 })
    );
    postTopCap.position.set(POST_X, POST_BASE_Y + POST_HEIGHT + 0.16, POST_Z);
    this.group.add(postTopCap);

    // ═══════════════════════════════════════════════════════════════════
    // SWING BAR
    // ═══════════════════════════════════════════════════════════════════
    this.swingBar = new THREE.Group();
    this.swingBar.position.set(POST_X, POST_BASE_Y + POST_HEIGHT + 0.05, POST_Z);
    this.group.add(this.swingBar);

    const BAR_LENGTH = this.BAR_LENGTH;
    const swingBarMesh = new THREE.Mesh(
      new THREE.BoxGeometry(BAR_LENGTH, 0.09, 0.13),
      new THREE.MeshStandardMaterial({ color: 0x37404a, roughness: 0.18, metalness: 0.92 })
    );
    swingBarMesh.position.set(BAR_LENGTH / 2 + 0.06, 0, 0);
    this.swingBar.add(swingBarMesh);

    const barRibTop = new THREE.Mesh(
      new THREE.BoxGeometry(BAR_LENGTH * 0.92, 0.04, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.20, metalness: 0.94 })
    );
    barRibTop.position.set(BAR_LENGTH / 2 + 0.05, 0.045, 0);
    this.swingBar.add(barRibTop);

    const barRibBot = new THREE.Mesh(
      new THREE.BoxGeometry(BAR_LENGTH * 0.92, 0.04, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.20, metalness: 0.94 })
    );
    barRibBot.position.set(BAR_LENGTH / 2 + 0.05, -0.045, 0);
    this.swingBar.add(barRibBot);

    // ── VALVE BODY ──
    this.valveBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.10, 0.32, 16),
      new THREE.MeshStandardMaterial({ color: 0x1a1f24, roughness: 0.40, metalness: 0.55, emissive: 0x002244, emissiveIntensity: 0.3 })
    );
    this.valveBody.position.set(BAR_LENGTH - 0.05, -this.NOZZLE_DROP, 0);
    this.swingBar.add(this.valveBody);

    [-0.10, 0.10].forEach((yOff) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.135, 0.018, 6, 20),
        new THREE.MeshStandardMaterial({ color: 0x778899, metalness: 0.95, roughness: 0.18 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(BAR_LENGTH - 0.05, -this.NOZZLE_DROP + yOff, 0);
      this.swingBar.add(ring);
    });

    // ── NOZZLE MANIFOLD ──
    this.nozzleTip = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.08, 0.16),
      new THREE.MeshStandardMaterial({ color: 0xb8c4d0, roughness: 0.08, metalness: 0.98 })
    );
    this.nozzleTip.position.set(BAR_LENGTH - 0.05, -this.TIP_DROP, 0);
    this.swingBar.add(this.nozzleTip);

    [-0.06, 0, 0.06].forEach((zOff) => {
      const tipBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.025, 0.06, 12),
        new THREE.MeshStandardMaterial({ color: 0x778899, metalness: 0.96, roughness: 0.12 })
      );
      tipBody.position.set(BAR_LENGTH - 0.05, -this.TIP_DROP - 0.03, zOff);
      this.swingBar.add(tipBody);

      const tipPoint = new THREE.Mesh(
        new THREE.ConeGeometry(0.018, 0.04, 10),
        new THREE.MeshStandardMaterial({ color: 0x445566, metalness: 0.98, roughness: 0.1 })
      );
      tipPoint.position.set(BAR_LENGTH - 0.05, -this.TIP_DROP - 0.08, zOff);
      tipPoint.rotation.x = Math.PI;
      this.swingBar.add(tipPoint);
    });

    // ── LIQUID STREAMS ──
    [-0.06, 0, 0.06].forEach((zOff) => {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x33cc88, emissive: 0x22aa66, emissiveIntensity: 1.0,
        roughness: 0.15, metalness: 0.1,
        transparent: true, opacity: 0, depthWrite: false,
      });
      const streamLen = 1.0;
      const stream = new THREE.Mesh(
        new THREE.CylinderGeometry(0.020, 0.014, streamLen, 12, 1, true),
        mat
      );
      stream.position.set(BAR_LENGTH - 0.05, -this.TIP_DROP - streamLen / 2 - 0.10, zOff);
      this.swingBar.add(stream);
      this.liquidStreams.push(stream);
      this.streamMats.push(mat);
    });

    this.swingBar.rotation.y = this.SWING_PARKED;
  }

  startDev(wx: number, wz: number) {
    this.group.visible = true;
    this.active = true;
    this.phase = "swing_in";
    this.phaseT = 0;
    this.phaseDur = 1.0;
    this.poolSpin = 0;
    this.spiralAngle = 0;
    this.swingAngle = this.SWING_PARKED;
    this.swingBar.rotation.y = this.SWING_PARKED;

    (this.liquidPool.material as THREE.MeshStandardMaterial).opacity = 0;
    (this.liquidPool.material as THREE.MeshStandardMaterial).color.setHex(0x33cc88);

    this.streamMats.forEach((m) => {
      m.opacity = 0;
      m.color.setHex(0x33cc88);
      m.emissive.setHex(0x22aa66);
      m.needsUpdate = true;
    });

    this.spiralCtx.clearRect(0, 0, 512, 512);
    this.spiralTex.needsUpdate = true;
    (this.spiralMesh.material as THREE.MeshBasicMaterial).opacity = 0;
    this.tipGlow.visible = false;
    console.log('[DEV] startDev at', wx, wz, 'visible:', this.group.visible);
  }

  stopDev() {
    this.active = false;
    this.phase = "idle";
    this.streamMats.forEach((m) => { m.opacity = 0; });
    this.tipGlow.visible = false;
  }

  private _drawSpiralTrail(spiralR: number, spinSpeed: number, dt: number, isRinse: boolean) {
    const ctx = this.spiralCtx;
    const C = 256;
    const maxR = 230;
    const steps = Math.max(3, Math.floor(spinSpeed * dt * 30));
    const color = isRinse ? "#66bbff" : "#33ccaa";

    for (let s = 0; s < steps; s++) {
      this.spiralAngle += (spinSpeed / 60) * Math.PI * 2 * (dt / steps);
      const r = spiralR * maxR;
      const px = C + Math.cos(this.spiralAngle) * r;
      const py = C + Math.sin(this.spiralAngle) * r;

      const grad = ctx.createRadialGradient(px, py, 0, px, py, 10);
      grad.addColorStop(0, color + "ff");
      grad.addColorStop(0.5, color + "88");
      grad.addColorStop(1, color + "00");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, 10, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    this.spiralTex.needsUpdate = true;
  }

  tick(dt: number, speed: number) {
    if (!this.active) return;

    const sDt = dt * speed;
    this.phaseT += sDt;
    const t = Math.min(this.phaseT / this.phaseDur, 1);
    const poolMat = this.liquidPool.material as THREE.MeshStandardMaterial;
    const ease = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);

    switch (this.phase) {
      case "swing_in": {
        this.swingAngle = lerp(this.SWING_PARKED, this.SWING_OVER, ease);
        this.swingBar.rotation.y = this.swingAngle;
        if (t >= 1) {
          this.phase = "spray";
          this.phaseT = 0;
          this.phaseDur = 2.2;
          this.tipGlow.visible = true;
          this.streamMats.forEach((m) => {
            m.color.setHex(0x33ccee);
            m.emissive.setHex(0x0099dd);
          });
          (this.tipGlow.material as THREE.MeshStandardMaterial).color.setHex(0x00aaff);
          (this.tipGlow.material as THREE.MeshStandardMaterial).emissive.setHex(0x0088ff);
        }
        break;
      }

      case "spray": {
        this.streamMats.forEach((m, i) => {
          m.opacity = Math.min(t * 2, 0.92);
          m.emissiveIntensity = 1.0 + 0.4 * Math.sin(this.phaseT * 12 + i * 0.7);
        });
        (this.tipGlow.material as THREE.MeshStandardMaterial).emissiveIntensity =
          3.0 + 0.8 * Math.sin(this.phaseT * 18);

        poolMat.opacity = Math.min(t * 0.85, 0.85);
        this.poolSpin += sDt * lerp(0.5, 3.0, t);
        this.poolGroup.rotation.y = this.poolSpin;

        const spiralR = lerp(0.05, 0.85, t);
        this._drawSpiralTrail(spiralR, lerp(60, 300, t), sDt, false);
        (this.spiralMesh.material as THREE.MeshBasicMaterial).opacity = lerp(0, 0.75, t);

        if (t >= 1) {
          this.phase = "puddle";
          this.phaseT = 0;
          this.phaseDur = 1.8;
          this.streamMats.forEach((m) => { m.opacity = 0; });
        }
        break;
      }

      case "puddle": {
        poolMat.color.lerp(new THREE.Color(0x22aa66), sDt * 0.6);
        this.poolSpin += sDt * 1.2;
        this.poolGroup.rotation.y = this.poolSpin;
        (this.spiralMesh.material as THREE.MeshBasicMaterial).opacity = lerp(0.75, 0.3, t);

        if (t >= 1) {
          this.phase = "rinse";
          this.phaseT = 0;
          this.phaseDur = 1.5;
          this.streamMats.forEach((m) => {
            m.color.setHex(0x66bbff);
            m.emissive.setHex(0x3399ff);
          });
          this.spiralCtx.clearRect(0, 0, 512, 512);
          this.spiralTex.needsUpdate = true;
          this.spiralAngle = 0;
        }
        break;
      }

      case "rinse": {
        this.streamMats.forEach((m, i) => {
          m.opacity = Math.min(t * 2, 0.92);
          m.emissiveIntensity = 1.2 + 0.4 * Math.sin(this.phaseT * 14 + i * 0.7);
        });
        poolMat.color.lerp(new THREE.Color(0x66bbff), sDt * 1.2);
        poolMat.opacity = Math.max(0, poolMat.opacity - sDt * 0.3);
        this.poolSpin += sDt * 5.0;
        this.poolGroup.rotation.y = this.poolSpin;

        const spiralR = lerp(0.1, 0.9, t);
        this._drawSpiralTrail(spiralR, 400, sDt, true);
        (this.spiralMesh.material as THREE.MeshBasicMaterial).opacity =
          lerp(0, 0.7, t < 0.7 ? t : (1 - t) * 3);

        if (t >= 1) {
          this.phase = "swing_out";
          this.phaseT = 0;
          this.phaseDur = 1.0;
          this.streamMats.forEach((m) => { m.opacity = 0; });
          this.tipGlow.visible = false;
        }
        break;
      }

      case "swing_out": {
        this.swingAngle = lerp(this.SWING_OVER, this.SWING_PARKED, ease);
        this.swingBar.rotation.y = this.swingAngle;
        this.poolSpin += sDt * 3.0;
        this.poolGroup.rotation.y = this.poolSpin;
        if (t >= 1) {
          this.phase = "drain";
          this.phaseT = 0;
          this.phaseDur = 0.8;
        }
        break;
      }

      case "drain": {
        poolMat.opacity = Math.max(0, poolMat.opacity - sDt * 1.2);
        (this.spiralMesh.material as THREE.MeshBasicMaterial).opacity = Math.max(
          0, (this.spiralMesh.material as THREE.MeshBasicMaterial).opacity - sDt * 1.5
        );
        if (t >= 1) {
          this.phase = "done";
          this.phaseT = 0;
        }
        break;
      }

      case "done": break;
    }
  }
}






class SpinCoatAnimator {
  group: THREE.Group;
  spinChuck: THREE.Group;
  spinDisc: THREE.Mesh;
  resistRings: THREE.Mesh[] = [];
  resistGroup: THREE.Group;
  bowl: THREE.Mesh;

  pivotPost: THREE.Mesh;
  swingBar: THREE.Group;
  valveBody: THREE.Mesh;
  nozzleTip: THREE.Mesh;
  tipGlow: THREE.Mesh;

  liquidStream: THREE.Mesh;
  streamMat: THREE.MeshStandardMaterial;

  spiralCanvas!: HTMLCanvasElement;
  spiralCtx!: CanvasRenderingContext2D;
  spiralTex!: THREE.CanvasTexture;
  spiralMesh!: THREE.Mesh;
  spiralAngle = 0;

  phase: "idle" | "swing_in" | "dispense" | "spinup" | "coating" | "swing_out" | "spindown" | "done" = "idle";
  phaseT = 0; phaseDur = 1; spinRPM = 0; spinAngle = 0;
  resistRadius = 0; coatColor = 0x9922ff; active = false;

  private _drawAccum = 0;
  private _cachedCss = '';
  private _lastColor = 0;
  private _matUpdateAccum = 0;

  readonly SWING_PARKED = Math.PI / 2;
  readonly SWING_OVER = -Math.PI / 2 - Math.PI / 4;  // +45° more travel past center to reach from corner
  swingAngle = Math.PI / 2;

  readonly CHUCK_Y = 0.35;
  readonly POST_X = 1.2;   // + moves stand to +X corner (was 0.0, centered)
  readonly POST_Z = -1.4;  // more negative = further back (was -1.2)
  readonly BAR_LENGTH = 1.85;  // lengthened to reach center from corner (was 1.4)
  readonly NOZZLE_DROP = 0.10;
  readonly TIP_DROP = 0.30;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.group.visible = false;

    // ── BOWL ──
    const bowlMat = new THREE.MeshStandardMaterial({
      color: 0xeef3f8,
      roughness: 0.28,
      metalness: 0.05,
    });
    this.bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.4, 0.25, 64, 1, true),
      bowlMat
    );
    this.bowl.position.y = 0.6;
    this.group.add(this.bowl);

    for (let i = 0; i < 5; i++) {
      const r = 1.1 + i * 0.08;
      const ridge = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.018, 8, 64),
        new THREE.MeshStandardMaterial({ color: 0xdde8f0, roughness: 0.3, metalness: 0.1 })
      );
      ridge.rotation.x = Math.PI / 2;
      ridge.position.y = 0.38 + i * 0.04;
      this.group.add(ridge);
    }

    const baseRing = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.4, 64),
      new THREE.MeshStandardMaterial({
        color: 0xe8eef5,
        roughness: 0.22,
        metalness: 0.08,
        side: THREE.DoubleSide,
      })
    );
    baseRing.rotation.x = -Math.PI / 2;
    baseRing.position.y = 0.01;
    this.group.add(baseRing);

    // ── SPIN CHUCK ──
    this.spinChuck = new THREE.Group();
    this.spinChuck.position.y = this.CHUCK_Y;
    this.group.add(this.spinChuck);

    this.spinDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.92, 0.92, 0.08, 80),
      new THREE.MeshStandardMaterial({
        color: 0x556677,
        roughness: 0.12,
        metalness: 0.92,
        emissive: 0x223355,
        emissiveIntensity: 0.4,
      })
    );
    this.spinDisc.position.y = 0;
    this.spinChuck.add(this.spinDisc);

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const port = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12),
        new THREE.MeshStandardMaterial({
          color: 0x111122,
          emissive: 0x004488,
          emissiveIntensity: 1.0,
        })
      );
      port.position.set(Math.cos(a) * 0.65, 0.06, Math.sin(a) * 0.65);
      this.spinChuck.add(port);
    }

    // ── RESIST RING LAYERS ──
    this.resistGroup = new THREE.Group();
    this.resistGroup.position.y = 0.05;
    this.spinChuck.add(this.resistGroup);
    const numRings = 18;
    for (let i = 0; i < numRings; i++) {
      const r0 = (i / numRings) * 0.88, r1 = ((i + 1) / numRings) * 0.88;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r0, r1, 64),
        new THREE.MeshStandardMaterial({
          color: 0x9922ff, emissive: 0x5511aa, emissiveIntensity: 0.6,
          roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0,
          side: THREE.DoubleSide, depthWrite: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.001 * i;
      this.resistGroup.add(ring);
      this.resistRings.push(ring);
    }

    // ── SPIRAL PATTERN ──
    this.spiralCanvas = document.createElement("canvas");
    this.spiralCanvas.width = 256;
    this.spiralCanvas.height = 256;
    this.spiralCtx = this.spiralCanvas.getContext("2d")!;
    this.spiralTex = new THREE.CanvasTexture(this.spiralCanvas);

    this.spiralMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.88, perfSegments(80)),
      new THREE.MeshBasicMaterial({
        map: this.spiralTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.spiralMesh.rotation.x = -Math.PI / 2;
    this.spiralMesh.position.y = 0.08;
    this.spiralMesh.renderOrder = 10;
    this.spinChuck.add(this.spiralMesh);

    // ═══════════════════════════════════════════════════════════════════
    // BASE MOUNTING ASSEMBLY — VERTICAL STACK (MIRRORED for back-side)
    // Plate → Box → Box Top → Post Flange → Post → Swing Arm
    // Everything centered at (POST_X, POST_Z) so post rises FROM the box
    // ═══════════════════════════════════════════════════════════════════
    const POST_X = this.POST_X;
    const POST_Z = this.POST_Z;

    // ── BASE PLATE ──
    const basePlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.10, 0.75),
      new THREE.MeshStandardMaterial({
        color: 0x1c2230,
        roughness: 0.35,
        metalness: 0.92,
        emissive: 0x050810,
        emissiveIntensity: 0.4,
      })
    );
    basePlate.position.set(POST_X, 0.05, POST_Z);
    basePlate.castShadow = true;
    this.group.add(basePlate);

    // ── BASE BEVEL ──
    const baseBevel = new THREE.Mesh(
      new THREE.BoxGeometry(0.88, 0.025, 0.78),
      new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.20, metalness: 0.95 })
    );
    baseBevel.position.set(POST_X, 0.108, POST_Z);
    this.group.add(baseBevel);

    // ── 4 CORNER BOLTS ──
    [[-0.32, -0.27], [0.32, -0.27], [-0.32, 0.27], [0.32, 0.27]].forEach(([dx, dz]) => {
      const boltBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.06, 6),
        new THREE.MeshStandardMaterial({ color: 0x111118, metalness: 0.98, roughness: 0.2 })
      );
      boltBody.position.set(POST_X + (dx as number), 0.135, POST_Z + (dz as number));
      this.group.add(boltBody);

      const boltHead = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.02, 6),
        new THREE.MeshStandardMaterial({ color: 0x778899, metalness: 0.95, roughness: 0.15 })
      );
      boltHead.position.set(POST_X + (dx as number), 0.17, POST_Z + (dz as number));
      this.group.add(boltHead);
    });

    // ── CONTROL BOX ──
    const controlBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.40, 0.50),
      new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.32, metalness: 0.88, emissive: 0x0a1525, emissiveIntensity: 0.5 })
    );
    controlBox.position.set(POST_X, 0.32, POST_Z);
    controlBox.castShadow = true;
    this.group.add(controlBox);

    // ── FRONT PANEL (faces -Z direction — toward front of module) ──
    const frontPanel = new THREE.Mesh(
      new THREE.BoxGeometry(0.50, 0.36, 0.015),
      new THREE.MeshStandardMaterial({ color: 0x1a1f28, roughness: 0.4, metalness: 0.7 })
    );
    frontPanel.position.set(POST_X, 0.32, POST_Z - 0.26);
    this.group.add(frontPanel);

    // ── STATUS LED ──
    const statusLED = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.015, 12),
      new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ddff, emissiveIntensity: 3.5, roughness: 0.2 })
    );
    statusLED.rotation.x = Math.PI / 2;
    statusLED.position.set(POST_X - 0.18, 0.42, POST_Z - 0.27);
    this.group.add(statusLED);

    // ── POWER LED ──
    const powerLED = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.015, 12),
      new THREE.MeshStandardMaterial({ color: 0x00ff44, emissive: 0x00ff44, emissiveIntensity: 3.0, roughness: 0.2 })
    );
    powerLED.rotation.x = Math.PI / 2;
    powerLED.position.set(POST_X - 0.08, 0.42, POST_Z - 0.27);
    this.group.add(powerLED);

    // ── TIP GLOW LED ──
    this.tipGlow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.015, 12),
      new THREE.MeshStandardMaterial({ color: 0xff44cc, emissive: 0xff44cc, emissiveIntensity: 0.5, roughness: 0.2 })
    );
    this.tipGlow.rotation.x = Math.PI / 2;
    this.tipGlow.position.set(POST_X + 0.02, 0.42, POST_Z - 0.27);
    this.group.add(this.tipGlow);

    // ── BOX TOP CAP ──
    const boxTopCap = new THREE.Mesh(
      new THREE.BoxGeometry(0.58, 0.04, 0.53),
      new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.22, metalness: 0.94 })
    );
    boxTopCap.position.set(POST_X, 0.54, POST_Z);
    this.group.add(boxTopCap);

    // ── POST FLANGE (post mounts on top of box) ──
    const postFlange = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.20, 0.08, 16),
      new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.18, metalness: 0.96, emissive: 0x112233, emissiveIntensity: 0.3 })
    );
    postFlange.position.set(POST_X, 0.60, POST_Z);
    this.group.add(postFlange);

    // ── FLANGE BOLTS ──
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const bolt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.018, 0.025, 6),
        new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.95, roughness: 0.25 })
      );
      bolt.position.set(POST_X + Math.cos(angle) * 0.155, 0.64, POST_Z + Math.sin(angle) * 0.155);
      this.group.add(bolt);
    }

    // ── PIVOT POST ──
    const POST_HEIGHT = 1.8;
    const POST_BASE_Y = 0.64;
    this.pivotPost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.090, POST_HEIGHT, 16),
      new THREE.MeshStandardMaterial({ color: 0x37404a, roughness: 0.12, metalness: 0.95 })
    );
    this.pivotPost.position.set(POST_X, POST_BASE_Y + POST_HEIGHT / 2, POST_Z);
    this.group.add(this.pivotPost);

    // ── POST REINFORCEMENT BANDS ──
    [0.25, 0.55, 0.85].forEach((frac) => {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.082, 0.014, 6, 20),
        new THREE.MeshStandardMaterial({ color: 0x778899, metalness: 0.96, roughness: 0.2 })
      );
      band.rotation.x = Math.PI / 2;
      band.position.set(POST_X, POST_BASE_Y + POST_HEIGHT * frac, POST_Z);
      this.group.add(band);
    });

    // ── CABLE CONDUIT (alongside post, opposite of brace side = +X here) ──
    const conduit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, POST_HEIGHT * 0.85, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7, metalness: 0.2 })
    );
    conduit.position.set(POST_X + 0.11, POST_BASE_Y + POST_HEIGHT * 0.45, POST_Z);
    this.group.add(conduit);

    [0.2, 0.5, 0.8].forEach((frac) => {
      const clamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.03, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x556677, metalness: 0.94, roughness: 0.25 })
      );
      clamp.position.set(POST_X + 0.10, POST_BASE_Y + POST_HEIGHT * frac, POST_Z);
      this.group.add(clamp);
    });

    // ── POST TOP HOUSING ──
    const postTopHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.18, 16),
      new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.18, metalness: 0.95, emissive: 0x002244, emissiveIntensity: 0.4 })
    );
    postTopHousing.position.set(POST_X, POST_BASE_Y + POST_HEIGHT + 0.05, POST_Z);
    this.group.add(postTopHousing);

    // ── POST TOP CAP ──
    const postTopCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.13, 0.04, 16),
      new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.15, metalness: 0.96 })
    );
    postTopCap.position.set(POST_X, POST_BASE_Y + POST_HEIGHT + 0.16, POST_Z);
    this.group.add(postTopCap);

    // ═══════════════════════════════════════════════════════════════════
    // SWING BAR
    // ═══════════════════════════════════════════════════════════════════
    this.swingBar = new THREE.Group();
    this.swingBar.position.set(POST_X, POST_BASE_Y + POST_HEIGHT + 0.05, POST_Z);
    this.group.add(this.swingBar);

    const BAR_LENGTH = this.BAR_LENGTH;
    const swingBarMesh = new THREE.Mesh(
      new THREE.BoxGeometry(BAR_LENGTH, 0.09, 0.13),
      new THREE.MeshStandardMaterial({ color: 0x37404a, roughness: 0.18, metalness: 0.92 })
    );
    swingBarMesh.position.set(BAR_LENGTH / 2 + 0.06, 0, 0);
    this.swingBar.add(swingBarMesh);

    const barRibTop = new THREE.Mesh(
      new THREE.BoxGeometry(BAR_LENGTH * 0.92, 0.04, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.20, metalness: 0.94 })
    );
    barRibTop.position.set(BAR_LENGTH / 2 + 0.05, 0.045, 0);
    this.swingBar.add(barRibTop);

    const barRibBot = new THREE.Mesh(
      new THREE.BoxGeometry(BAR_LENGTH * 0.92, 0.04, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.20, metalness: 0.94 })
    );
    barRibBot.position.set(BAR_LENGTH / 2 + 0.05, -0.045, 0);
    this.swingBar.add(barRibBot);

    // ── VALVE BODY ──
    this.valveBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.10, 0.32, 16),
      new THREE.MeshStandardMaterial({ color: 0x1a1f24, roughness: 0.40, metalness: 0.55, emissive: 0x002244, emissiveIntensity: 0.3 })
    );
    this.valveBody.position.set(BAR_LENGTH - 0.05, -this.NOZZLE_DROP, 0);
    this.swingBar.add(this.valveBody);

    [-0.10, 0.10].forEach((yOff) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.135, 0.018, 6, 20),
        new THREE.MeshStandardMaterial({ color: 0x778899, metalness: 0.95, roughness: 0.18 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(BAR_LENGTH - 0.05, -this.NOZZLE_DROP + yOff, 0);
      this.swingBar.add(ring);
    });

    // ── NOZZLE MANIFOLD ──
    this.nozzleTip = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.08, 0.16),
      new THREE.MeshStandardMaterial({ color: 0xb8c4d0, roughness: 0.08, metalness: 0.98 })
    );
    this.nozzleTip.position.set(BAR_LENGTH - 0.05, -this.TIP_DROP, 0);
    this.swingBar.add(this.nozzleTip);

    [-0.06, 0, 0.06].forEach((zOff) => {
      const tipBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.025, 0.06, 12),
        new THREE.MeshStandardMaterial({ color: 0x778899, metalness: 0.96, roughness: 0.12 })
      );
      tipBody.position.set(BAR_LENGTH - 0.05, -this.TIP_DROP - 0.03, zOff);
      this.swingBar.add(tipBody);

      const tipPoint = new THREE.Mesh(
        new THREE.ConeGeometry(0.018, 0.04, 10),
        new THREE.MeshStandardMaterial({ color: 0x445566, metalness: 0.98, roughness: 0.1 })
      );
      tipPoint.position.set(BAR_LENGTH - 0.05, -this.TIP_DROP - 0.08, zOff);
      tipPoint.rotation.x = Math.PI;
      this.swingBar.add(tipPoint);
    });

    // ── LIQUID STREAM ──
    this.streamMat = new THREE.MeshStandardMaterial({
      color: 0xcc1177,
      emissive: 0xcc1177,
      emissiveIntensity: 2.5,
      roughness: 0.1,
      metalness: 0.0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.liquidStream = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.025, 1.0, 12, 1, true),
      this.streamMat
    );
    this.liquidStream.position.set(BAR_LENGTH - 0.05, -this.TIP_DROP - 0.5 - 0.10, 0);
    this.swingBar.add(this.liquidStream);

    this.swingBar.rotation.y = this.SWING_PARKED;
  }

  startCoat(wx: number, wz: number, color: number) {
    this.coatColor = color;
    this.group.visible = true;
    this.active = true;
    this.phase = "swing_in";
    this.phaseT = 0;
    this.phaseDur = 1.0;
    this.spinRPM = 0;
    this.spinAngle = 0;
    this.resistRadius = 0;
    this.spiralAngle = 0;
    this.swingAngle = this.SWING_PARKED;
    this.swingBar.rotation.y = this.SWING_PARKED;

    this.resistRings.forEach((r) => {
      (r.material as THREE.MeshStandardMaterial).opacity = 0;
      (r.material as THREE.MeshStandardMaterial).color.setHex(color);
      (r.material as THREE.MeshStandardMaterial).emissive.setHex(color);
    });

    this.streamMat.color.setHex(color);
    this.streamMat.emissive.setHex(color);
    this.streamMat.opacity = 0;

    const tipGlowMat = this.tipGlow.material as THREE.MeshStandardMaterial;
    tipGlowMat.color.setHex(color);
    tipGlowMat.emissive.setHex(color);
    tipGlowMat.emissiveIntensity = 0.5;

    (this.spiralMesh.material as THREE.MeshBasicMaterial).opacity = 0;
    this.spiralCtx.clearRect(0, 0, 256, 256);
    this.spiralTex.needsUpdate = true;

    console.log('[COAT] startCoat at', wx, wz, 'color:', color.toString(16));
  }

  stopCoat() {
    this.active = false;
    this.phase = "idle";
    this.streamMat.opacity = 0;
    (this.tipGlow.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5;
  }

  private _drawSpiralTrail(centerSpiralRadius: number, spinSpeed: number, dt: number) {
    this._drawAccum += dt;
    if (this._drawAccum < 0.05) return;
    const drawDt = this._drawAccum;
    this._drawAccum = 0;

    const ctx = this.spiralCtx;
    const C = 128;
    const maxR = 115;

    if (this.coatColor !== this._lastColor) {
      this._cachedCss = `#${this.coatColor.toString(16).padStart(6, "0")}`;
      this._lastColor = this.coatColor;
    }
    const css = this._cachedCss;

    ctx.globalCompositeOperation = "source-over";

    const steps = Math.min(8, Math.max(2, Math.floor(spinSpeed * drawDt * 20)));

    const cssFull = css + "ff";
    const cssMid = css + "88";
    const cssZero = css + "00";

    for (let s = 0; s < steps; s++) {
      this.spiralAngle += (spinSpeed / 60) * Math.PI * 2 * (drawDt / steps);
      const r = centerSpiralRadius * maxR;
      const px = C + Math.cos(this.spiralAngle) * r;
      const py = C + Math.sin(this.spiralAngle) * r;

      const grad = ctx.createRadialGradient(px, py, 0, px, py, 12);
      grad.addColorStop(0, cssFull);
      grad.addColorStop(0.5, cssMid);
      grad.addColorStop(1, cssZero);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, 12, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    this.spiralTex.needsUpdate = true;
  }

  tick(dt: number, speed: number) {
    if (!this.active) return;
    if (!this.group.visible) return;

    const sDt = dt * speed;
    this.phaseT += sDt;

    this._matUpdateAccum += sDt;
    const updateMaterials = this._matUpdateAccum >= 0.066;
    if (updateMaterials) this._matUpdateAccum = 0;

    const t = Math.min(this.phaseT / this.phaseDur, 1);
    const ease = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);

    switch (this.phase) {
      case "swing_in": {
        this.swingAngle = lerp(this.SWING_PARKED, this.SWING_OVER, ease);
        this.swingBar.rotation.y = this.swingAngle;
        if (t >= 1) {
          this.phase = "dispense";
          this.phaseT = 0;
          this.phaseDur = 1.2;
          (this.tipGlow.material as THREE.MeshStandardMaterial).emissiveIntensity = 3.0;
        }
        break;
      }

      case "dispense": {
        this.streamMat.opacity = Math.min(t * 2.5, 0.98);
        if (updateMaterials) {
          this.streamMat.emissiveIntensity = 1.5 + 0.3 * Math.sin(this.phaseT * 18);
          (this.tipGlow.material as THREE.MeshStandardMaterial).emissiveIntensity =
            2.5 + 0.8 * Math.sin(this.phaseT * 22);
        }
        this.spinRPM = lerp(0, 120, t);
        if (t >= 1) {
          this.phase = "spinup";
          this.phaseT = 0;
          this.phaseDur = 1.0;
        }
        break;
      }

      case "spinup": {
        this.spinRPM = lerp(120, 2400, t * t);
        this.resistRadius = lerp(0, 0.2, t);
        this._updateResist();
        this.streamMat.opacity = 0.95;
        this.streamMat.emissiveIntensity = 1.5 + 0.3 * Math.sin(this.phaseT * 18);
        const spiralR = lerp(0.05, 0.3, t);
        this._drawSpiralTrail(spiralR, this.spinRPM, sDt);
        (this.spiralMesh.material as THREE.MeshBasicMaterial).opacity = lerp(0, 0.7, t);
        if (t >= 1) {
          this.phase = "coating";
          this.phaseT = 0;
          this.phaseDur = 2.5;
        }
        break;
      }

      case "coating": {
        this.spinRPM = 2400;
        this.resistRadius = lerp(0.2, 0.88, t);
        this._updateResist();
        if (t < 0.3) {
          this.streamMat.opacity = 0.95;
        } else {
          this.streamMat.opacity = Math.max(0, 0.95 * (1 - (t - 0.3) / 0.4));
        }
        this.streamMat.emissiveIntensity = 1.5 + 0.3 * Math.sin(this.phaseT * 18);
        const spiralR = lerp(0.3, 0.95, t);
        this._drawSpiralTrail(spiralR, this.spinRPM, sDt);
        (this.spiralMesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
        if (t >= 1) {
          this.resistRadius = 0.88;
          this._updateResist(true);
          this.streamMat.opacity = 0;
          (this.tipGlow.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5;
          this.phase = "swing_out";
          this.phaseT = 0;
          this.phaseDur = 1.0;
        }
        break;
      }

      case "swing_out": {
        this.swingAngle = lerp(this.SWING_OVER, this.SWING_PARKED, ease);
        this.swingBar.rotation.y = this.swingAngle;
        this.spinRPM = 2400;
        if (t >= 1) {
          this.phase = "spindown";
          this.phaseT = 0;
          this.phaseDur = 1.5;
        }
        break;
      }

      case "spindown": {
        this.spinRPM = lerp(2400, 0, t);
        (this.spiralMesh.material as THREE.MeshBasicMaterial).opacity = lerp(0.85, 0.3, t);
        if (t >= 1) {
          this.phase = "done";
          this.phaseT = 0;
        }
        break;
      }

      case "done": {
        this.spinRPM = 0;
        break;
      }
    }

    this.spinAngle = (this.spinAngle + (this.spinRPM / 60) * Math.PI * 2 * sDt) % (Math.PI * 2);
    this.spinChuck.rotation.y = this.spinAngle;
  }

  private _updateResist(full = false) {
    const numRings = this.resistRings.length;
    const fillFraction = full ? 1 : this.resistRadius / 0.88;
    this.resistRings.forEach((ring, i) => {
      const ringFrac = (i + 1) / numRings;
      const mat = ring.material as THREE.MeshStandardMaterial;
      if (ringFrac <= fillFraction)
        mat.opacity = Math.min(mat.opacity + 0.06, 0.88 - i * 0.003);
    });
  }
}



// ─── MODULE BUILDER ───────────────────────────────────────────────────────────

// function buildModule(mod: ProcessStep): THREE.Group {
//   const grp = new THREE.Group();
//   grp.position.set(mod.x, 0, mod.z);
//   grp.userData.id = mod.id;

//  const W = 2.9, D = 2.9, H = 1.7;  // was H = 0.85

// // LINE 2: Make body GRAY (replace the themes object entirely)
// const themes: Record<string, { base: number; edge: number; glass: number }> = {
//   hot:   { base: 0x4a4a4a, edge: 0xff2200, glass: 0xff4400 },
//   cold:  { base: 0x4a4a4a, edge: 0x00ccff, glass: 0x00aaff },
//   coat:  { base: 0x4a4a4a, edge: 0xcc00ff, glass: 0xee22ff },
//   wet:   { base: 0x4a4a4a, edge: 0x00ff88, glass: 0x00dd66 },
//   scan:  { base: 0x4a4a4a, edge: 0xee00cc, glass: 0xff00ee },
//   iface: { base: 0x4a4a4a, edge: 0xffdd00, glass: 0xffcc00 },
//   foup:  { base: 0x4a4a4a, edge: 0x4488ff, glass: 0x3377ff },
//   dry:   { base: 0x4a4a4a, edge: 0x00eeff, glass: 0x00ddee },
// };
//   const th = themes[mod.type] ?? { base: 0xaabbcc, edge: 0x4477aa, glass: mod.color };

//   // Base body
// const bodyMat = new THREE.MeshStandardMaterial({ 
//   color: th.base, 
//   roughness: 0.35,    // slightly rougher for gray metal look
//   metalness: 0.65, 
//   emissive: th.edge, 
//   emissiveIntensity: 0.08  // was 0.15 — reduce for gray
// });  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), bodyMat);
//   body.position.y = H / 2; body.castShadow = true; body.receiveShadow = true; grp.add(body);

//   // Top plate
//   const topPl = new THREE.Mesh(new THREE.BoxGeometry(W - 0.04, 0.062, D - 0.04),
//     new THREE.MeshStandardMaterial({ color: 0xe0e8f0, roughness: 0.05, metalness: 0.98 }));
//   topPl.position.y = H + 0.031; grp.add(topPl);

//   // Emissive disc
//   const discMat = new THREE.MeshStandardMaterial({ color: mod.color, roughness: 0.12, metalness: 0.6, emissive: mod.color, emissiveIntensity: 0.55 });
//   const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.96, 0.96, 0.07, 80), discMat);
//   disc.position.y = H + 0.035; grp.add(disc);

//   // Concentric rings on chuck
//   for (let r = 0.2; r <= 0.88; r += 0.11) {
//     const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.004, 4, 72),
//       new THREE.MeshStandardMaterial({ color: 0x8899cc, emissive: 0x2244aa, emissiveIntensity: 0.4 }));
//     ring.rotation.x = Math.PI / 2; ring.position.y = H + 0.072; grp.add(ring);
//   }

//   // Inner pulsing ring
//   const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.04, 8, 60), matEmissive(mod.color, 2.5));
//   innerRing.rotation.x = Math.PI / 2; innerRing.position.y = H + 0.075; grp.add(innerRing);
//   grp.userData.innerRing = innerRing;

//   // LED strip
//   const led = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.1, 0.07), matEmissive(mod.color, 5.0));
//   led.position.set(0, H * 0.55, -(D / 2) + 0.05); grp.add(led);
//   grp.userData.led = led;

//   // Control panel with status dots
//   const panel = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 0.04),
//     new THREE.MeshStandardMaterial({ color: 0x0e1c2a, roughness: 0.35, metalness: 0.75 }));
//   panel.position.set(0, H * 0.32, -(D / 2 + 0.02)); grp.add(panel);
//   for (let i = 0; i < 5; i++) {
//     const dt2 = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 10),
//       matEmissive(i === 0 ? mod.color : i === 1 ? 0x00ff88 : 0x333333, i < 2 ? 3.5 : 0.5));
//     dt2.position.set(-0.55 + i * 0.28, H * 0.32, -(D / 2) + 0.04); grp.add(dt2);
//   }

//   // Temp indicator
//   if (mod.temp !== null) {
//     const tempColor = mod.temp > 50 ? 0xff3300 : 0x0099ff;
//     const tempBar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.06), matEmissive(tempColor, 4.0));
//     tempBar.position.set(0, H * 0.78, -(D / 2) + 0.05); grp.add(tempBar);

//     const tc = document.createElement("canvas"); tc.width = 200; tc.height = 52;
//     const tctx = tc.getContext("2d")!;
//     tctx.fillStyle = mod.temp > 50 ? "#ff4400" : "#0099ff";
//     tctx.font = "bold 22px 'Courier New',monospace"; tctx.textAlign = "center";
//     tctx.fillText(`${mod.temp}°C`, 100, 36);
//     const tsp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(tc), transparent: true, opacity: 0.95 }));
//     tsp.scale.set(1.5, 0.4, 1); tsp.position.set(0, H + 0.55, -(D / 2) - 0.1); grp.add(tsp);
//   }

//   // Glass enclosure
// //   const glassH = 2.0;
// //   const gm = matGlass(th.glass, 0.10);
// //   [
// //     { sz: [W + 0.06, glassH, 0.03], p: [0, glassH / 2 + H / 2 - 0.12,  D / 2 + 0.015] },
// //     { sz: [W + 0.06, glassH, 0.03], p: [0, glassH / 2 + H / 2 - 0.12, -D / 2 - 0.015] },
// //     { sz: [0.03, glassH, D + 0.06], p: [ W / 2 + 0.015, glassH / 2 + H / 2 - 0.12, 0] },
// //     { sz: [0.03, glassH, D + 0.06], p: [-W / 2 - 0.015, glassH / 2 + H / 2 - 0.12, 0] },
// //   ].forEach((o) => {
// //     const gp = new THREE.Mesh(new THREE.BoxGeometry(o.sz[0], o.sz[1], o.sz[2]), gm.clone());
// //     gp.position.set(o.p[0], o.p[1], o.p[2]); grp.add(gp);
// //   });

//   // Frame rails
// //   const frameMat = new THREE.MeshStandardMaterial({ color: 0x7a8fa0, roughness: 0.15, metalness: 0.92 });
// //   const topY = H + glassH - 0.12; const railT = 0.045;
// //   [
// //     { sz: [W + 0.10, railT, railT], p: [0, topY,  D / 2 + 0.015] },
// //     { sz: [W + 0.10, railT, railT], p: [0, topY, -D / 2 - 0.015] },
// //     { sz: [railT, railT, D + 0.10], p: [ W / 2 + 0.015, topY, 0] },
// //     { sz: [railT, railT, D + 0.10], p: [-W / 2 - 0.015, topY, 0] },
// //   ].forEach((o) => {
// //     const rail = new THREE.Mesh(new THREE.BoxGeometry(o.sz[0], o.sz[1], o.sz[2]), frameMat);
// //     rail.position.set(o.p[0], o.p[1], o.p[2]); grp.add(rail);
// //   });

//   // Process light
//   const pl = new THREE.PointLight(mod.color, 0, 7);
//   pl.position.set(0, H + 1.8, 0); grp.add(pl);
//   grp.userData.processLight = pl;

//   // ── TYPE-SPECIFIC INTERNALS ──

//   // HOT: heating coils (visible inside chuck)
//   if (mod.type === "hot") {
//     for (let r = 0.1; r <= 0.85; r += 0.13) {
//       const coil = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 12, 60),
//         new THREE.MeshStandardMaterial({ color: 0xff3300, emissive: 0xff1100, emissiveIntensity: 0.4, roughness: 0.35 }));
//       coil.rotation.x = Math.PI / 2; coil.position.y = H + 0.048; grp.add(coil);
//       grp.userData.coils = grp.userData.coils || [];
//       (grp.userData.coils as THREE.Mesh[]).push(coil);
//     }
//   }

//   // COLD: cooling fins beneath chuck
//   if (mod.type === "cold") {
//     for (let i = -7; i <= 7; i++) {
//       const fin = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.42, 1.22),
//         new THREE.MeshStandardMaterial({ color: 0x1c2e44, roughness: 0.16, metalness: 0.97, emissive: 0x0055cc, emissiveIntensity: 0.6 }));
//       fin.position.set(i * 0.175, H - 0.04, 0); grp.add(fin);
//     }
//   }

//   // SCAN: scanner housing + UV beam
//   if (mod.type === "scan") {
//     const housing = new THREE.Mesh(new THREE.BoxGeometry(W + 1.2, H * 4, D + 1.2),
//       new THREE.MeshStandardMaterial({ color: 0x9080b0, roughness: 0.18, metalness: 0.72, emissive: 0x440088, emissiveIntensity: 0.3 }));
//     housing.position.y = H * 2.3; grp.add(housing);
//     const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.2, 32),
//       new THREE.MeshStandardMaterial({ color: 0x100020, roughness: 0.05, metalness: 0.7, emissive: 0xcc00ff, emissiveIntensity: 1.4 }));
//     lens.position.y = H * 4.4; grp.add(lens);
//     const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.32, H * 3.5, 20, 1, true),
//       new THREE.MeshStandardMaterial({ color: 0xcc00ff, emissive: 0x9900cc, emissiveIntensity: 2.2, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
//     beam.position.y = H * 1.75; grp.add(beam);
//     grp.userData.uvBeam = beam;
//     addBigLabel(grp, "300mm\nSCANNER", 0xcc00ff, 0, H * 4.8, 0);
//   }

//   // FOUP — visual slots + named pickup anchors (world targets for EFEM IK)
//   if (mod.type === "foup") {
//     // FOUP transform fix (world-space, NOT camera-relative):
//     // - Local model "opening" is at +Z (door/slots around z≈+0.9).
//     // - We want the opening to face +X (toward the process line).
//     // - Apply an explicit 180° Y-rotation as requested, then set facing for +X.
//     grp.rotation.set(0, -Math.PI / 2, 0);
//     grp.rotateY(Math.PI);
//     // Raise so slot planes align with robot pickup height.
//     grp.position.y += 0.25;
//     // Small alignment nudge so fork centers on slot stack.
//     grp.position.x += 0.12;

//     // Explicit pickup anchor at FOUP access port (prevents robot penetrating enclosure).
//     const foupPickupAnchor = new THREE.Group();
//     foupPickupAnchor.name = "FoupPickupPoint";
//     // Local +Z is FOUP opening direction; after FOUP group rotation this stays “front”.
//     foupPickupAnchor.position.set(0, 1.15, 1.25);
//     grp.add(foupPickupAnchor);
//     grp.userData.pickupAnchor = foupPickupAnchor;

//     const foupBody = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.4, 2.8),
//       new THREE.MeshStandardMaterial({ color: 0x162230, metalness: 0.82, roughness: 0.22, emissive: 0x081822, emissiveIntensity: 0.16 }));
//     foupBody.position.y = 1.7; foupBody.castShadow = true; grp.add(foupBody);
//     const door = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.8, 0.08),
//       new THREE.MeshStandardMaterial({ color: 0x1c2938, metalness: 0.9, roughness: 0.12, emissive: 0x003566, emissiveIntensity: 0.2 }));
//     door.position.set(0, 1.7, 1.35); grp.add(door);
//     const slotAnchors: THREE.Object3D[] = [];
//     for (let s = 0; s < 6; s++) {
//       const slot = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.03, 64),
//         new THREE.MeshStandardMaterial({ color: 0x91a8c2, metalness: 0.9, roughness: 0.08 }));
//       slot.position.set(0, 0.55 + s * 0.42, 1.05); grp.add(slot);
//       const anchor = new THREE.Group();
//       anchor.name = `FoupSlot_${s + 1}`;
//       anchor.position.set(0, 0.55 + s * 0.42, 1.08);
//       grp.add(anchor);
//       slotAnchors.push(anchor);
//     }
//     grp.userData.slotAnchors = slotAnchors;
//     grp.userData.slotCount = slotAnchors.length;
//     const foupPL = new THREE.PointLight(0x0066ff, 0, 4);
//     foupPL.position.set(0, 2.5, 1.2); grp.add(foupPL);
//     grp.userData.processLight = foupPL;
//   } else {
//     const waferAnchor = new THREE.Group();
//     waferAnchor.name = "ModuleWaferAnchor";
//     waferAnchor.position.set(0, H + 0.098, 0);
//     grp.add(waferAnchor);
//     grp.userData.waferAnchor = waferAnchor;
//   }

//   // WET / DRY: rotating chuck
//   if (mod.type === "wet" || mod.type === "dry") {
//     const chuck = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.05, 48),
//       new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.12, metalness: 0.92 }));
//     chuck.position.y = H + 0.025; grp.add(chuck);
//   }

//   // DRY: N2 nozzles
//   if (mod.type === "dry") {
//     for (let a = 0; a < 6; a++) {
//       const ang = (a / 6) * Math.PI * 2;
//       const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.065, 0.35, 12),
//         new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.18, metalness: 0.95 }));
//       noz.position.set(Math.cos(ang) * 0.58, H + 0.6, Math.sin(ang) * 0.58); grp.add(noz);
//       const tip = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 8), matEmissive(0x44ddff, 2.5));
//       tip.position.set(Math.cos(ang) * 0.58, H + 0.42, Math.sin(ang) * 0.58); grp.add(tip);
//     }
//   }

//   // Module name label
// // ── Module name label (FLOATING ABOVE module) ──
//   const nc = document.createElement("canvas");
//   nc.width = 512;
//   nc.height = 180;
//   const nctx = nc.getContext("2d")!;

//   // Soft dark background pill behind text for readability against any floor color
//   nctx.fillStyle = "rgba(10, 18, 32, 0.78)";
//   nctx.beginPath();
//   const pillX = 20, pillY = 20, pillW = 472, pillH = 140, pillR = 18;
//   nctx.moveTo(pillX + pillR, pillY);
//   nctx.lineTo(pillX + pillW - pillR, pillY);
//   nctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + pillR);
//   nctx.lineTo(pillX + pillW, pillY + pillH - pillR);
//   nctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - pillR, pillY + pillH);
//   nctx.lineTo(pillX + pillR, pillY + pillH);
//   nctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - pillR);
//   nctx.lineTo(pillX, pillY + pillR);
//   nctx.quadraticCurveTo(pillX, pillY, pillX + pillR, pillY);
//   nctx.closePath();
//   nctx.fill();

//   // Colored border in module color
//   nctx.strokeStyle = hex2css(mod.color);
//   nctx.lineWidth = 3;
//   nctx.stroke();

//   // Big short-code (top line)
//   nctx.fillStyle = hex2css(mod.color);
//   nctx.font = "bold 52px 'Courier New', monospace";
//   nctx.textAlign = "center";
//   nctx.textBaseline = "middle";
//   nctx.shadowColor = hex2css(mod.color);
//   nctx.shadowBlur = 14;
//   nctx.fillText(mod.short, 256, 65);

//   // Full name (smaller line below)
//   nctx.shadowBlur = 4;
//   nctx.fillStyle = "#e8f0ff";
//   nctx.font = "bold 22px 'Inter', 'Arial', sans-serif";
//   nctx.fillText(mod.name, 256, 120);

//   // Optional: temperature badge
//   if (mod.temp !== null) {
//     nctx.shadowBlur = 0;
//     nctx.fillStyle = mod.temp > 50 ? "#ff6633" : "#33aaff";
//     nctx.font = "bold 18px 'Courier New', monospace";
//     nctx.fillText(`${mod.temp}°C`, 256, 148);
//   }

//   const nameTex = new THREE.CanvasTexture(nc);
//   nameTex.minFilter = THREE.LinearFilter;
//   const nsp = new THREE.Sprite(
//     new THREE.SpriteMaterial({
//       map: nameTex,
//       transparent: true,
//       opacity: 0.96,
//       depthTest: false,    // always visible, never occluded by modules
//       depthWrite: false,
//     })
//   );
//   // Width 4.2, height 1.5 — readable from camera radius 32+
//   nsp.scale.set(4.2, 1.5, 1);
//   // Float above the module — scanner is taller, so push label higher for it
//   const labelY = mod.type === "scan" ? H * 6.0 : H + 2.4;
//   nsp.position.set(0, labelY, 0);
//   // Render labels on top of everything so they're never hidden
//   nsp.renderOrder = 999;
//   grp.add(nsp);
//   grp.userData.nameLabel = nsp;

//   return grp;
// }

function buildModule(mod: ProcessStep): THREE.Group {
  const grp = new THREE.Group();
  const nudgeZ = mod.type === "iface" ? IFACE_LOCAL_Z[mod.id] ?? 0 : 0;
  grp.position.set(mod.x, 0, mod.z + nudgeZ);
  grp.userData.id = mod.id;

  const W = 2.9, D = 2.9, H = 2.7;

  // All base colors are now grey
  const themes_UNIFORM_GREY: Record<string, { base: number; edge: number; glass: number }> = {
    hot: { base: 0x5a5a5a, edge: 0x6a6a6a, glass: 0x808080 },
    cold: { base: 0x5a5a5a, edge: 0x6a6a6a, glass: 0x808080 },
    coat: { base: 0x5a5a5a, edge: 0x6a6a6a, glass: 0x808080 },
    wet: { base: 0x5a5a5a, edge: 0x6a6a6a, glass: 0x808080 },
    scan: { base: 0x5a5a5a, edge: 0x6a6a6a, glass: 0x808080 },
    iface: { base: 0x5a5a5a, edge: 0x6a6a6a, glass: 0x808080 },
    foup: { base: 0x5a5a5a, edge: 0x6a6a6a, glass: 0x808080 },
    dry: { base: 0x5a5a5a, edge: 0x6a6a6a, glass: 0x808080 },
  };

  const th = themes_UNIFORM_GREY[mod.type] ?? { base: 0x5a5a5a, edge: 0x4477aa, glass: mod.color };

  // Body material with NO emissive color bleed
  const bodyMat = new THREE.MeshStandardMaterial({
    color: th.base,
    roughness: 0.40,
    metalness: 0.60,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;

  // CRITICAL FIX: Raise the module base by 0.5 units from floor
  const MODULE_BASE_Y = 0.5;
  body.position.y = MODULE_BASE_Y + H / 2;
  grp.add(body);

  // Top plate
  const topPl = new THREE.Mesh(new THREE.BoxGeometry(W - 0.04, 0.062, D - 0.04),
    new THREE.MeshStandardMaterial({ color: 0xe0e8f0, roughness: 0.05, metalness: 0.98 }));
  topPl.position.y = MODULE_BASE_Y + H + 0.031;
  grp.add(topPl);

  // Emissive disc
  const discMat = new THREE.MeshStandardMaterial({ color: mod.color, roughness: 0.12, metalness: 0.6, emissive: mod.color, emissiveIntensity: 0.55 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.96, 0.96, 0.07, 80), discMat);
  disc.position.y = MODULE_BASE_Y + H + 0.035;
  grp.add(disc);

  // Concentric rings on chuck
  for (let r = 0.2; r <= 0.88; r += 0.11) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.004, 4, 72),
      new THREE.MeshStandardMaterial({ color: 0x8899cc, emissive: 0x2244aa, emissiveIntensity: 0.4 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = MODULE_BASE_Y + H + 0.072;
    grp.add(ring);
  }

  // Inner pulsing ring
  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.04, 8, 60), matEmissive(mod.color, 2.5));
  innerRing.rotation.x = Math.PI / 2;
  innerRing.position.y = MODULE_BASE_Y + H + 0.075;
  grp.add(innerRing);
  grp.userData.innerRing = innerRing;

  // LED strip
  const led = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.1, 0.07), matEmissive(mod.color, 5.0));
  led.position.set(0, MODULE_BASE_Y + H * 0.55, -(D / 2) + 0.05);
  grp.add(led);
  grp.userData.led = led;

  // Control panel with status dots
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x0e1c2a, roughness: 0.35, metalness: 0.75 }));
  panel.position.set(0, MODULE_BASE_Y + H * 0.32, -(D / 2 + 0.02));
  grp.add(panel);

  for (let i = 0; i < 5; i++) {
    const dt2 = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 10),
      matEmissive(i === 0 ? mod.color : i === 1 ? 0x00ff88 : 0x333333, i < 2 ? 3.5 : 0.5));
    dt2.position.set(-0.55 + i * 0.28, MODULE_BASE_Y + H * 0.32, -(D / 2) + 0.04);
    grp.add(dt2);
  }

  // Temp indicator
  if (mod.temp !== null) {
    const tempColor = mod.temp > 50 ? 0xff3300 : 0x0099ff;
    const tempBar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.06), matEmissive(tempColor, 4.0));
    tempBar.position.set(0, MODULE_BASE_Y + H * 0.78, -(D / 2) + 0.05);
    grp.add(tempBar);
  }

  // Process light
  const pl = new THREE.PointLight(mod.color, 0, 7);
  pl.position.set(0, MODULE_BASE_Y + H + 1.8, 0);
  grp.add(pl);
  grp.userData.processLight = pl;

  // TYPE-SPECIFIC INTERNALS
  if (mod.type === "hot") {
    for (let r = 0.1; r <= 0.85; r += 0.13) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 12, 60),
        new THREE.MeshStandardMaterial({ color: 0xff3300, emissive: 0xff1100, emissiveIntensity: 0.4, roughness: 0.35 }));
      coil.rotation.x = Math.PI / 2;
      coil.position.y = MODULE_BASE_Y + H + 0.048;
      grp.add(coil);
      grp.userData.coils = grp.userData.coils || [];
      (grp.userData.coils as THREE.Mesh[]).push(coil);
    }
  }

  if (mod.type === "cold") {
    for (let i = -7; i <= 7; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.42, 1.22),
        new THREE.MeshStandardMaterial({ color: 0x1c2e44, roughness: 0.16, metalness: 0.97, emissive: 0x0055cc, emissiveIntensity: 0.6 }));
      fin.position.set(i * 0.175, MODULE_BASE_Y + H - 0.04, 0);
      grp.add(fin);
    }
  }

  if (mod.type === "scan") {
    const housing = new THREE.Mesh(new THREE.BoxGeometry(W + 1.2, H * 4, D + 1.2),
      new THREE.MeshStandardMaterial({ color: 0x9080b0, roughness: 0.18, metalness: 0.72, emissive: 0x440088, emissiveIntensity: 0.3 }));
    housing.position.y = MODULE_BASE_Y + H * 2.3;
    grp.add(housing);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.2, 32),
      new THREE.MeshStandardMaterial({ color: 0x100020, roughness: 0.05, metalness: 0.7, emissive: 0xcc00ff, emissiveIntensity: 1.4 }));
    lens.position.y = MODULE_BASE_Y + H * 4.4;
    grp.add(lens);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.32, H * 3.5, 20, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xcc00ff, emissive: 0x9900cc, emissiveIntensity: 2.2, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = MODULE_BASE_Y + H * 1.75;
    grp.add(beam);
    grp.userData.uvBeam = beam;
  }

  // Wafer anchor for non-FOUP modules
  if (mod.type !== "foup") {
    const waferAnchor = new THREE.Group();
    waferAnchor.name = "ModuleWaferAnchor";
    waferAnchor.position.set(0, WAFER_TRANSFER_Y, 0);
    grp.add(waferAnchor);
    grp.userData.waferAnchor = waferAnchor;
  }

  if (mod.type === "wet" || mod.type === "dry") {
    const chuck = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.05, 48),
      new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.12, metalness: 0.92 }));
    chuck.position.y = MODULE_BASE_Y + H + 0.025;
    grp.add(chuck);
  }

  if (mod.type === "dry") {
    for (let a = 0; a < 6; a++) {
      const ang = (a / 6) * Math.PI * 2;
      const noz = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.065, 0.06, 12),
        new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.18, metalness: 0.95 })
      );
      noz.position.set(Math.cos(ang) * 0.58, MODULE_BASE_Y + H + 0.035, Math.sin(ang) * 0.58);
      grp.add(noz);

      const tip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 0.02, 8),
        matEmissive(0x44ddff, 3.5)
      );
      tip.position.set(Math.cos(ang) * 0.58, MODULE_BASE_Y + H + 0.07, Math.sin(ang) * 0.58);
      grp.add(tip);
    }

    const drain = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.02, 24),
      new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.4, metalness: 0.8 })
    );
    drain.position.set(0, MODULE_BASE_Y + H + 0.01, 0);
    grp.add(drain);
  }

  // FOUP special handling
  //   if (mod.type === "foup") {
  //     // Override position for FOUP
  //     grp.position.y = 3.0;
  //     grp.rotation.set(0, -Math.PI / 2, 0);
  //     grp.rotateY(Math.PI);
  //     grp.position.x += 0.12;

  // //    const foupPickupAnchor  = new THREE.Group();
  // //     foupPickupAnchor.name = "FoupPickupPoint";
  // //     foupPickupAnchor.position.set(0, 1.15, 1.25);
  // //     grp.add(foupPickupAnchor);
  // //     grp.userData.pickupAnchor = foupPickupAnchor;

  //        const foupPickupAnchor = new THREE.Group();
  //       foupPickupAnchor.name = "FoupPickupPoint";
  //       foupPickupAnchor.position.set(0, 1.15, 2.2);  // ← push further front (was 1.25)
  //       grp.add(foupPickupAnchor);
  //       grp.userData.pickupAnchor = foupPickupAnchor;

  //     const foupBody = new THREE.Mesh(new THREE.BoxGeometry(3.2, 5.5, 2.8),
  //       new THREE.MeshStandardMaterial({ color: 0x162230, metalness: 0.82, roughness: 0.22, emissive: 0x081822, emissiveIntensity: 0.16 }));
  //     foupBody.position.y = 1.7;
  //     foupBody.castShadow = true;
  //     grp.add(foupBody);

  //     const door = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.8, 0.08),
  //       new THREE.MeshStandardMaterial({ color: 0x1c2938, metalness: 0.9, roughness: 0.12, emissive: 0x003566, emissiveIntensity: 0.2 }));
  //     door.position.set(0, 1.7, 1.35);
  //     grp.add(door);

  //     const slotAnchors: THREE.Object3D[] = [];
  //     for (let s = 0; s < 6; s++) {
  //       const slotY = 0.55 + s * 0.42;

  //       // Visible slot disc (where wafer rests) — laid flat
  //       const slot = new THREE.Mesh(
  //         new THREE.CylinderGeometry(0.8, 0.8, 0.03, 64),
  //         new THREE.MeshStandardMaterial({ color: 0x91a8c2, metalness: 0.9, roughness: 0.08 })
  //       );
  //       slot.rotation.x = Math.PI / 2;   // lay disc flat (FOUP is rotated)
  //       slot.position.set(0, slotY, 1.05);
  //       grp.add(slot);

  //       // Anchor sits AT the slot disc (wafer goes here, not z=2.0)
  //       const anchor = new THREE.Group();
  //       anchor.name = `FoupSlot_${s + 1}`;
  //       anchor.position.set(0, slotY, 1.05);
  //       grp.add(anchor);
  //       slotAnchors.push(anchor);
  //     }
  //     grp.userData.slotAnchors = slotAnchors;
  //     grp.userData.slotCount = slotAnchors.length;

  //     const foupPL = new THREE.PointLight(0x0066ff, 0, 4);
  //     foupPL.position.set(0, 2.5, 1.2);
  //     grp.add(foupPL);
  //     grp.userData.processLight = foupPL;
  //   }


  if (mod.type === "foup") {
    // The rack's local +Z opening faces the process-side robot after this
    // exact in-place Y rotation. Keep the root as the only rotation owner.
    const rackPosition = grp.position.clone();
    grp.position.y = 3.0;
    grp.rotation.set(0, WAFER_RACK_ROTATION_Y, 0);
    grp.position.x += 0.12;
    grp.userData.rackRoot = grp;
    grp.userData.rackRotationY = WAFER_RACK_ROTATION_Y;
    grp.userData.rackOriginalPosition = rackPosition;

    // ── PICKUP TARGET: Align with actual first wafer slot inside FOUP ──
    // Wafers are stored at Z=0.35 (inside FOUP), not Z=2.2 (at front edge)
    // Add +0.12 offset in Z for gripper tool clearance
    const foupPickupAnchor = new THREE.Group();
    foupPickupAnchor.name = "FoupPickupPoint";
    foupPickupAnchor.position.set(0, 0.55, 0.47);  // Align with actual wafer slot + tool offset
    grp.add(foupPickupAnchor);
    grp.userData.pickupAnchor = foupPickupAnchor;

    // ── APPROACH TARGET: Safe entry point behind pickup position ──
    const rackApproachTarget = new THREE.Object3D();
    rackApproachTarget.name = "RackApproachTarget";
    rackApproachTarget.position.set(0, 0.55, 0.75);  // Entry approach from further back
    grp.add(rackApproachTarget);
    grp.userData.rackApproachTarget = rackApproachTarget;
    grp.userData.rackPickTarget = foupPickupAnchor;

    // ── FOUP BODY (box-based, designed in three.js rather than loaded from GLB)
    const foupBody = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 5.5, 2.8),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0c, metalness: 0.25, roughness: 0.55 })
    );
    foupBody.position.y = 1.7;
    foupBody.castShadow = true;
    grp.add(foupBody);
    // Expose as glbRoot for existing helpers that expect a glbRoot (positioning, nameplates)
    grp.userData.glbRoot = foupBody;

    // ── DOOR ──
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 2.8, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0x141418, metalness: 0.35, roughness: 0.45,
      })
    );
    door.position.set(0, 1.7, 1.35);
    grp.add(door);

    // ══════════════════════════════════════════════════════════════
    // ── VISIBLE WAFER STACK (seated INSIDE the FOUP, no backside poke) ──
    // ══════════════════════════════════════════════════════════════
    const VISIBLE_WAFERS = 20;        // ← plate count
    const VIS_START_Y = 0.55;
    const VIS_END_Y   = 4.10;
    const VIS_SPACING = (VIS_END_Y - VIS_START_Y) / (VISIBLE_WAFERS - 1);
    const WAFER_RADIUS = 1.05;        // ← slightly smaller so edge stays inside body
    const WAFER_THICK  = 0.022;

    // ── KEY KNOB ──────────────────────────────────────────────
    // FOUP body front face is at local z = +1.4, door at z = 1.35.
    // 1.05 (old value) pushed discs almost to the door → looked like
    // they were sticking out / showing from the back.
    // Pull them back to sit cleanly inside the cassette.
    const WAFER_Z = 0.35;             // ← decrease to push deeper in, increase to bring forward
    // ──────────────────────────────────────────────────────────

    for (let v = 0; v < VISIBLE_WAFERS; v++) {
      const wY = VIS_START_Y + v * VIS_SPACING;

      // Silicon wafer disc (dark grey, polished)
      const waferDisc = new THREE.Mesh(
        new THREE.CylinderGeometry(WAFER_RADIUS, WAFER_RADIUS, WAFER_THICK, 96),
        new THREE.MeshPhysicalMaterial({
          color: 0xc8ccd0,
          metalness: 0.88,
          roughness: 0.22,
          clearcoat: 0.5,
          clearcoatRoughness: 0.15,
          emissive: 0x0a0a0c,
          emissiveIntensity: 0.05,
        })
      );
      waferDisc.position.set(0, wY, WAFER_Z);
      grp.add(waferDisc);

      // Polished silver edge ring
      const edgeRing = new THREE.Mesh(
        new THREE.TorusGeometry(WAFER_RADIUS, 0.011, 8, 64),
        new THREE.MeshStandardMaterial({
          color: 0x888888,
          metalness: 0.98,
          roughness: 0.1,
        })
      );
      edgeRing.rotation.x = Math.PI / 2;
      edgeRing.position.set(0, wY, WAFER_Z);
      grp.add(edgeRing);

      // NOTE: amberCoat pie-wedge removed — it was the arc poking out
      // the front/back of the FOUP. The flat resist tint is now baked
      // into a full thin disc that never extends past the wafer edge.
      const resistTint = new THREE.Mesh(
        new THREE.CylinderGeometry(WAFER_RADIUS * 0.96, WAFER_RADIUS * 0.96, 0.003, 96),
        new THREE.MeshPhysicalMaterial({
          color: 0xb8bcc0,
          metalness: 0.35,
          roughness: 0.30,
          clearcoat: 0.85,
          clearcoatRoughness: 0.08,
          transparent: true,
          opacity: 0.5,
        })
      );
      resistTint.position.set(0, wY + WAFER_THICK / 2 + 0.002, WAFER_Z);
      grp.add(resistTint);
    }

    // ══════════════════════════════════════════════════════════════
    // ── OPERATIONAL SLOTS (just 6 for robot pick/place logic) ──
    // ══════════════════════════════════════════════════════════════
    const slotAnchors: THREE.Object3D[] = [];
    for (let s = 0; s < 6; s++) {
      const slotY = 0.55 + s * 0.42;
      const anchor = new THREE.Group();
      anchor.name = `FoupSlot_${s + 1}`;
      anchor.position.set(0, slotY, WAFER_Z);   // ← was 1.05, now matches stack
      grp.add(anchor);
      slotAnchors.push(anchor);
    }
    grp.userData.slotAnchors = slotAnchors;
    grp.userData.slotCount = slotAnchors.length;

    // ── INTERIOR LIGHT ──
    const foupPL = new THREE.PointLight(0xffaa55, 0.4, 4);
    foupPL.position.set(0, 2.5, 1.2);
    grp.add(foupPL);
    grp.userData.processLight = foupPL;
  }








  const SKIP_FLOATING_LABEL_IDS = new Set(['spindry', 'scanner', 'foup']);
  if (SKIP_FLOATING_LABEL_IDS.has(mod.id)) {
    console.log(`[buildModule] Skipping floating sprite for: ${mod.id}`);
    return grp;     // ← exit early, no floating sprite created
  }

  const labelHeight = mod.type === "scan" ? MODULE_BASE_Y + H * 6.0 : MODULE_BASE_Y + H + 2.4;

  const nc = document.createElement("canvas");
  nc.width = 512;
  nc.height = 180;
  const nctx = nc.getContext("2d")!;

  nctx.fillStyle = "rgba(10, 18, 32, 0.78)";
  nctx.beginPath();
  const pillX = 20, pillY = 20, pillW = 472, pillH = 140, pillR = 18;
  nctx.moveTo(pillX + pillR, pillY);
  nctx.lineTo(pillX + pillW - pillR, pillY);
  nctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + pillR);
  nctx.lineTo(pillX + pillW, pillY + pillH - pillR);
  nctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - pillR, pillY + pillH);
  nctx.lineTo(pillX + pillR, pillY + pillH);
  nctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - pillR);
  nctx.lineTo(pillX, pillY + pillR);
  nctx.quadraticCurveTo(pillX, pillY, pillX + pillR, pillY);
  nctx.closePath();
  nctx.fill();

  nctx.strokeStyle = hex2css(mod.color);
  nctx.lineWidth = 3;
  nctx.stroke();

  nctx.fillStyle = hex2css(mod.color);
  nctx.font = "bold 52px 'Courier New', monospace";
  nctx.textAlign = "center";
  nctx.textBaseline = "middle";
  nctx.shadowColor = hex2css(mod.color);
  nctx.shadowBlur = 14;
  nctx.fillText(mod.short, 256, 65);

  nctx.shadowBlur = 4;
  nctx.fillStyle = "#e8f0ff";
  nctx.font = "bold 22px 'Inter', 'Arial', sans-serif";
  nctx.fillText(mod.name, 256, 120);

  if (mod.temp !== null) {
    nctx.shadowBlur = 0;
    nctx.fillStyle = mod.temp > 50 ? "#ff6633" : "#33aaff";
    nctx.font = "bold 18px 'Courier New', monospace";
    nctx.fillText(`${mod.temp}°C`, 256, 148);
  }

  const nameTex = new THREE.CanvasTexture(nc);
  nameTex.minFilter = THREE.LinearFilter;
  const nsp = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: nameTex,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
      depthWrite: false,
    })
  );
  nsp.scale.set(4.2, 1.5, 1);
  nsp.position.set(0, labelHeight, 0);
  nsp.renderOrder = 999;
  grp.add(nsp);
  grp.userData.nameLabel = nsp;

  return grp;
}

function addBigLabel(parent: THREE.Group | THREE.Scene, text: string, color: number, x: number, y: number, z: number) {
  const lines = text.split("\n");
  const c = document.createElement("canvas"); c.width = 400; c.height = 100 * lines.length;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = hex2css(color);
  ctx.font = "bold 40px 'Courier New',monospace";
  ctx.textAlign = "center";
  ctx.shadowColor = hex2css(color); ctx.shadowBlur = 16;
  lines.forEach((l, i) => ctx.fillText(l, 200, 60 + i * 80));
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
  sp.scale.set(4, 2 * lines.length, 1); sp.position.set(x, y, z);
  parent.add(sp);
}

// ─── FLOW / TRACK (yellow arrow meshes removed — real belts in Sim._build) ───

function buildFlowArrows(_scene: THREE.Scene) {
  /* no-op: static yellow “process arrows” replaced by ConveyorBelt track meshes */
}


const RAIL_Y = 8;
const RAIL_START = -22;
const RAIL_END = 30;

function buildGantryRail(scene: THREE.Scene): THREE.Group {
  const grp = new THREE.Group();
  scene.add(grp);
  const beamLen = RAIL_END - RAIL_START;
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.18, metalness: 0.92 });
  const web = new THREE.Mesh(new THREE.BoxGeometry(beamLen, 0.18, 0.06), beamMat);
  web.position.set((RAIL_START + RAIL_END) / 2, RAIL_Y, 0);
  grp.add(web);
  const topFlange = new THREE.Mesh(new THREE.BoxGeometry(beamLen, 0.07, 0.38), beamMat);
  topFlange.position.set((RAIL_START + RAIL_END) / 2, RAIL_Y + 0.12, 0);
  grp.add(topFlange);
  const botFlange = new THREE.Mesh(new THREE.BoxGeometry(beamLen, 0.07, 0.38), beamMat);
  botFlange.position.set((RAIL_START + RAIL_END) / 2, RAIL_Y - 0.12, 0);
  grp.add(botFlange);
  const ROPE_SEGS = 60;
  const SAG = 0.55;
  const ropeY = RAIL_Y - 0.28;
  const ropePoints: THREE.Vector3[] = [];
  for (let i = 0; i <= ROPE_SEGS; i++) {
    const frac = i / ROPE_SEGS;
    const x = RAIL_START + frac * beamLen;
    const sag = SAG * 4 * frac * (1 - frac);
    ropePoints.push(new THREE.Vector3(x, ropeY - sag, 0));
  }
  const ropeCurve = new THREE.CatmullRomCurve3(ropePoints);
  const ropeTube = new THREE.TubeGeometry(ropeCurve, 120, 0.022, 6, false);
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x00d8ff, emissive: 0x00aaff, emissiveIntensity: 2.8, roughness: 0.25, metalness: 0.6, transparent: true, opacity: 0.88 });
  grp.add(new THREE.Mesh(ropeTube, ropeMat));
  const glowTube = new THREE.TubeGeometry(ropeCurve, 120, 0.065, 6, false);
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x00d8ff, emissive: 0x00aaff, emissiveIntensity: 1.2, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending });
  grp.add(new THREE.Mesh(glowTube, glowMat));
  const strutMat = new THREE.MeshStandardMaterial({ color: 0x3a4455, roughness: 0.3, metalness: 0.88 });
  for (let i = 0; i <= 6; i++) {
    const frac = i / 6;
    const x = RAIL_START + frac * beamLen;
    const sag = SAG * 4 * frac * (1 - frac);
    const strutH = 0.28 + sag;
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, strutH, 6), strutMat);
    strut.position.set(x, RAIL_Y - 0.12 - strutH / 2, 0);
    grp.add(strut);
  }
  const colH = RAIL_Y + 0.5;
  const colMat = new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.2, metalness: 0.95 });
  [RAIL_START + 0.3, RAIL_END - 0.3].forEach((cx) => {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.12, colH, 0.12), colMat);
    col.position.set(cx, colH / 2 - 0.52, 0);
    grp.add(col);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), new THREE.MeshStandardMaterial({ color: 0x00d8ff, emissive: 0x00aaff, emissiveIntensity: 3.0, roughness: 0.3 }));
    cap.position.set(cx, colH - 0.52 + 0.09, 0);
    grp.add(cap);
  });
  const trolley = new THREE.Group();
  grp.add(trolley);
  grp.userData.trolley = trolley;
  const trolleyBody = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 0.52), new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.15, metalness: 0.95 }));
  trolleyBody.position.y = RAIL_Y + 0.02;
  trolley.add(trolleyBody);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.99 });
  [[-0.18, -0.14], [0.18, -0.14], [-0.18, 0.14], [0.18, 0.14]].forEach(([wx, wz]) => {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 16), wheelMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(wx!, RAIL_Y - 0.06, wz!);
    trolley.add(wheel);
  });
  const cableH = 4.8;
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, cableH, 6), new THREE.MeshStandardMaterial({ color: 0x00aaff, emissive: 0x0088ff, emissiveIntensity: 1.8, roughness: 0.3, transparent: true, opacity: 0.75 }));
  cable.position.set(0, RAIL_Y - 0.18 - cableH / 2, 0);
  trolley.add(cable);
  const cableGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, cableH, 6), new THREE.MeshStandardMaterial({ color: 0x00aaff, emissive: 0x0088ff, emissiveIntensity: 0.8, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
  cableGlow.position.copy(cable.position);
  trolley.add(cableGlow);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 4 }));
  led.position.set(0, RAIL_Y + 0.12, 0.27);
  trolley.add(led);
  grp.userData.trolleyLED = led;
  const glowBeads: THREE.PointLight[] = [];
  for (let i = 0; i < 6; i++) {
    const pl = new THREE.PointLight(0x00d8ff, 0.8, 5);
    grp.add(pl);
    glowBeads.push(pl);
  }
  grp.userData.glowBeads = glowBeads;
  grp.userData.ropeCurve = ropeCurve;
  grp.userData.ropeMat = ropeMat;
  return grp;
}

function tickGantryRail(grpRail: THREE.Group, robotX: number, simTime: number) {
  const trolley = grpRail.userData.trolley as THREE.Group;
  const glowBeads = grpRail.userData.glowBeads as THREE.PointLight[];
  const ropeCurve = grpRail.userData.ropeCurve as THREE.CatmullRomCurve3;
  const ropeMat = grpRail.userData.ropeMat as THREE.MeshStandardMaterial;
  const trolleyLED = grpRail.userData.trolleyLED as THREE.Mesh;
  if (!trolley) return;
  const targetX = Math.max(RAIL_START + 0.5, Math.min(RAIL_END - 0.5, robotX));
  trolley.position.x += (targetX - trolley.position.x) * 0.12;
  if (ropeMat) ropeMat.emissiveIntensity = 2.2 + 0.8 * Math.sin(simTime * 3.5);
  glowBeads.forEach((pl, i) => {
    const t = ((simTime * 0.18 + i / glowBeads.length) % 1 + 1) % 1;
    const pt = ropeCurve.getPoint(t);
    pl.position.copy(pt);
    pl.intensity = 0.6 + 0.5 * Math.sin(simTime * 6 + i * 1.4);
  });
  if (trolleyLED) {
    (trolleyLED.material as THREE.MeshStandardMaterial).emissiveIntensity = 3.5 + 1.5 * Math.sin(simTime * 8);
  }
}

export class PrCoatOverlay {
  plane: THREE.Mesh;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  active = false;
  spinAngle = 0;
  resistR = 0;
  phase: "idle" | "dispense" | "spinup" | "coating" | "spindown" | "done" = "idle";
  phaseT = 0;
  color: number;
  spinRPM = 0;

  constructor(scene: THREE.Scene, x: number, z: number, color: number) {
    this.color = color;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 256;
    this.canvas.height = 256;
    this.ctx = this.canvas.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(this.canvas);

    this.plane = new THREE.Mesh(
      new THREE.CircleGeometry(0.94, 80),
      new THREE.MeshBasicMaterial({
        map: this.tex,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.plane.rotation.x = -Math.PI / 2;
    this.plane.position.set(x, MODULE_FLOOR_Y + 0.35 + 0.01, z);
    this.plane.renderOrder = 5;
    scene.add(this.plane);
  }

  start() {
    this.active = true;
    this.phase = "dispense";
    this.phaseT = 0;
    this.resistR = 0;
    this.spinRPM = 0;
    (this.plane.material as THREE.MeshBasicMaterial).opacity = 1;
  }

  stop() {
    this.active = false;
    this.phase = "idle";
    (this.plane.material as THREE.MeshBasicMaterial).opacity = 0;
    this.resistR = 0;
    this.spinRPM = 0;
  }

  tick(dt: number, speed: number) {
    if (!this.active) return;
    const sDt = dt * speed;
    this.phaseT += sDt;

    switch (this.phase) {
      case "dispense":
        this.spinRPM = 0;
        this.resistR = Math.min(this.phaseT / 1.5, 1) * 20;
        if (this.phaseT > 1.5) { this.phase = "spinup"; this.phaseT = 0; }
        break;
      case "spinup":
        this.spinRPM = 500 * (1 - Math.exp(-this.phaseT * 3));
        this.resistR = 20 + (108 - 20) * Math.min(this.phaseT / 1.2, 1);
        if (this.phaseT > 1.2) { this.phase = "coating"; this.phaseT = 0; }
        break;
      case "coating":
        this.spinRPM = 3000;
        this.resistR = 108;
        if (this.phaseT > 3.5) { this.phase = "spindown"; this.phaseT = 0; }
        break;
      case "spindown":
        this.spinRPM = Math.max(0, 3000 * (1 - this.phaseT / 1.2));
        if (this.phaseT > 1.2) { this.phase = "done"; this.phaseT = 0; }
        break;
      case "done":
        this.spinRPM = 0;
        break;
    }

    this.spinAngle += (this.spinRPM / 60) * Math.PI * 2 * sDt;
    this._draw();
    this.tex.needsUpdate = true;
  }

  private _draw() {
    const C = 128;
    const WR = 118;
    const R = this.resistR;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 256, 256);

    if (R < 1) return;

    const col = `#${this.color.toString(16).padStart(6, "0")}`;
    const rpm = this.spinRPM;

    if (this.phase === "dispense") {
      const blob = Math.min(this.phaseT / 1.5, 1);
      const rr = R * blob;
      const g = ctx.createRadialGradient(C - 6, C - 6, 0, C, C, rr);
      g.addColorStop(0, col + "ee");
      g.addColorStop(0.4, col + "cc");
      g.addColorStop(1, col + "44");
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const wobble = rr * (1 + 0.12 * Math.sin(a * 5 + 1.3) + 0.08 * Math.sin(a * 3));
        i === 0 ? ctx.moveTo(C + Math.cos(a) * wobble, C + Math.sin(a) * wobble)
          : ctx.lineTo(C + Math.cos(a) * wobble, C + Math.sin(a) * wobble);
      }
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(C - rr * 0.22, C - rr * 0.26, rr * 0.28, rr * 0.17, -0.4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,235,120,0.28)";
      ctx.fill();

    } else if (this.phase === "spinup") {
      const sp = Math.min(this.phaseT / 1.2, 1);
      ctx.save();
      ctx.translate(C, C);
      ctx.rotate(this.spinAngle);

      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
      grad.addColorStop(0, col + "ee");
      grad.addColorStop(0.3, col + "bb");
      grad.addColorStop(0.7, col + "55");
      grad.addColorStop(1, col + "22");
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      const numArms = 7;
      for (let arm = 0; arm < numArms; arm++) {
        const baseAngle = (arm / numArms) * Math.PI * 2;
        ctx.beginPath();
        for (let j = 0; j <= 55; j++) {
          const p = j / 55;
          const r = R * p;
          const sa = baseAngle + p * 2.5 * Math.PI;
          j === 0 ? ctx.moveTo(0, 0) : ctx.lineTo(Math.cos(sa) * r, Math.sin(sa) * r);
        }
        ctx.strokeStyle = `rgba(255,220,80,${sp * (1 - sp * 0.4) * 0.55})`;
        ctx.lineWidth = Math.max(0.5, 3.5 - sp * 3);
        ctx.stroke();
      }
      ctx.restore();

    } else if (this.phase === "coating" || this.phase === "spindown") {
      ctx.save();
      ctx.translate(C, C);
      ctx.rotate(this.spinAngle);

      const nSectors = 42;
      for (let s = 0; s < nSectors; s++) {
        const sa = (s / nSectors) * Math.PI * 2;
        const ea = ((s + 1) / nSectors) * Math.PI * 2;
        const hue = (s / nSectors * 300 + this.spinAngle * 20) % 360;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, R * 0.92, sa, ea);
        ctx.closePath();
        ctx.fillStyle = `hsla(${hue},60%,65%,0.5)`;
        ctx.fill();
      }

      const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.92);
      sg.addColorStop(0, "rgba(200,220,255,0.22)");
      sg.addColorStop(0.6, "rgba(150,180,255,0.12)");
      sg.addColorStop(1, "rgba(80,120,220,0.06)");
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.92, 0, Math.PI * 2);
      ctx.fillStyle = sg;
      ctx.fill();

      const beadAlpha = this.phase === "spindown" ? Math.max(0, 1 - this.phaseT / 1.2) : 1;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(240,180,50,${beadAlpha * 0.85})`;
      ctx.lineWidth = 6 + 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, R + 3, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,200,80,${beadAlpha * 0.3})`;
      ctx.lineWidth = 4;
      ctx.stroke();

      if (rpm > 800) {
        const la = Math.min(rpm / 3000, 1) * 0.4;
        const nLines = Math.min(16, Math.floor(rpm / 250));
        ctx.globalAlpha = la;
        for (let i = 0; i < nLines; i++) {
          const a = (i / nLines) * Math.PI * 2;
          const cv = 0.18;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(
            Math.cos(a + cv) * R * 0.5, Math.sin(a + cv) * R * 0.5,
            Math.cos(a + cv * 2) * R * 0.88, Math.sin(a + cv * 2) * R * 0.88
          );
          ctx.strokeStyle = `rgba(180,210,255,${i % 2 === 0 ? 1 : 0.3})`;
          ctx.lineWidth = 0.9;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();

    } else if (this.phase === "done") {
      ctx.save();
      ctx.translate(C, C);
      const dg = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.92);
      dg.addColorStop(0, col + "cc");
      dg.addColorStop(0.5, col + "88");
      dg.addColorStop(1, col + "44");
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.92, 0, Math.PI * 2);
      ctx.fillStyle = dg;
      ctx.fill();
      ctx.restore();
    }
  }
}


export class DevPuddleOverlay {
  poolPlane: THREE.Mesh;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;

  swirls: { angle: number; radius: number; speed: number; alpha: number; color: string }[] = [];
  drops: { x: number; y: number; r: number; alpha: number; vx: number; vy: number; color: string }[] = [];

  phase: "idle" | "spray" | "puddle" | "rinse" | "drain" | "done" = "idle";
  phaseT = 0;
  active = false;
  spinAngle = 0;

  constructor(scene: THREE.Scene, x: number, z: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 256;
    this.canvas.height = 256;
    this.ctx = this.canvas.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(this.canvas);

    this.poolPlane = new THREE.Mesh(
      new THREE.CircleGeometry(0.92, 80),
      new THREE.MeshBasicMaterial({
        map: this.tex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.NormalBlending,
      })
    );
    this.poolPlane.rotation.x = -Math.PI / 2;
    this.poolPlane.position.set(x, MODULE_FLOOR_Y + 0.06, z);
    this.poolPlane.renderOrder = 6;
    scene.add(this.poolPlane);
  }

  start() {
    this.active = true;
    this.phase = "spray";
    this.phaseT = 0;
    this.drops = [];
    this.swirls = [];
    this.spinAngle = 0;
    (this.poolPlane.material as THREE.MeshBasicMaterial).opacity = 1;
  }

  stop() {
    this.active = false;
    this.phase = "idle";
    this.drops = [];
    this.swirls = [];
    (this.poolPlane.material as THREE.MeshBasicMaterial).opacity = 0;
  }

  tick(dt: number, speed: number) {
    if (!this.active) return;
    const sDt = dt * speed;
    this.phaseT += sDt;
    this.spinAngle += sDt * speed * 0.6;

    switch (this.phase) {
      case "spray":
        if (Math.random() < sDt * 35) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 0.55;
          this.drops.push({
            x: 128 + Math.cos(a) * r * 128 * 0.4,
            y: 128 + Math.sin(a) * r * 128 * 0.4,
            r: 2 + Math.random() * 4,
            alpha: 0.9,
            vx: (Math.random() - 0.5) * 2,
            vy: (Math.random() - 0.5) * 2,
            color: `hsl(${145 + Math.random() * 30},80%,${40 + Math.random() * 20}%)`,
          });
        }
        if (this.phaseT > 2.5) { this.phase = "puddle"; this.phaseT = 0; }
        break;

      case "puddle":
        this.spinAngle += sDt * 0.3;
        if (this.phaseT > 2.0) { this.phase = "rinse"; this.phaseT = 0; this.drops = []; }
        break;

      case "rinse":
        if (Math.random() < sDt * 55) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 0.9;
          this.drops.push({
            x: 128 + Math.cos(a) * r * 115,
            y: 128 + Math.sin(a) * r * 115,
            r: 1.5 + Math.random() * 3,
            alpha: 0.85,
            vx: (Math.random() - 0.5) * 3,
            vy: (Math.random() - 0.5) * 3,
            color: `hsl(${200 + Math.random() * 20},90%,${60 + Math.random() * 20}%)`,
          });
        }
        if (this.phaseT > 1.8) { this.phase = "drain"; this.phaseT = 0; this.swirls = []; }
        break;

      case "drain":
        if (this.swirls.length < 8 && Math.random() < sDt * 12) {
          this.swirls.push({ angle: Math.random() * Math.PI * 2, radius: 80 + Math.random() * 30, speed: 2 + Math.random() * 3, alpha: 0.7, color: `hsl(210,85%,70%)` });
        }
        this.swirls.forEach(s => { s.radius *= 0.97 - sDt * 0.5; s.angle += sDt * s.speed; s.alpha -= sDt * 0.4; });
        this.swirls = this.swirls.filter(s => s.radius > 4 && s.alpha > 0);
        if (this.phaseT > 1.5) { this.phase = "done"; this.phaseT = 0; }
        break;

      case "done":
        break;
    }

    this.drops.forEach(d => {
      d.x += d.vx * sDt * 8;
      d.y += d.vy * sDt * 8;
      d.alpha -= sDt * 0.35;
    });
    this.drops = this.drops.filter(d => d.alpha > 0.02);

    this._draw();
    this.tex.needsUpdate = true;
  }

  private _draw() {
    const ctx = this.ctx;
    const C = 128;
    const R = 115;
    ctx.clearRect(0, 0, 256, 256);

    if (this.phase === "idle" || this.phase === "done") return;

    // Pool background
    const poolAlpha =
      this.phase === "spray" ? Math.min(this.phaseT / 1.5, 0.72) :
        this.phase === "puddle" ? 0.82 :
          this.phase === "rinse" ? 0.7 + 0.15 * Math.sin(this.phaseT * 6) :
            this.phase === "drain" ? Math.max(0, 0.72 * (1 - this.phaseT / 1.5)) : 0;

    if (poolAlpha > 0) {
      const poolColor =
        this.phase === "spray" ? "#1a6640" :
          this.phase === "puddle" ? "#0d4d2e" :
            this.phase === "rinse" ? "#1a4a88" :
              "#1a4488";

      const pg = ctx.createRadialGradient(C - 10, C - 10, 0, C, C, R);
      pg.addColorStop(0, poolColor + "ff");
      pg.addColorStop(0.7, poolColor + "cc");
      pg.addColorStop(1, poolColor + "44");

      ctx.beginPath();
      ctx.arc(C, C, R, 0, Math.PI * 2);
      ctx.fillStyle = pg;
      ctx.globalAlpha = poolAlpha;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Swirl pattern (puddle phase)
    if (this.phase === "puddle" || this.phase === "spray") {
      ctx.save();
      ctx.translate(C, C);
      ctx.rotate(this.spinAngle);
      for (let arm = 0; arm < 5; arm++) {
        const baseA = (arm / 5) * Math.PI * 2;
        ctx.beginPath();
        for (let j = 0; j <= 40; j++) {
          const p = j / 40;
          const r = R * 0.85 * p;
          const sa = baseA + p * Math.PI * 1.6;
          j === 0 ? ctx.moveTo(0, 0) : ctx.lineTo(Math.cos(sa) * r, Math.sin(sa) * r);
        }
        ctx.strokeStyle = `rgba(80,210,130,${this.phase === "puddle" ? 0.4 : 0.2})`;
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Rinse swirl lines
    if (this.phase === "rinse") {
      ctx.save();
      ctx.translate(C, C);
      ctx.rotate(-this.spinAngle * 1.4);
      for (let arm = 0; arm < 7; arm++) {
        const baseA = (arm / 7) * Math.PI * 2;
        ctx.beginPath();
        for (let j = 0; j <= 40; j++) {
          const p = j / 40;
          const r = R * 0.9 * p;
          const sa = baseA + p * Math.PI * 1.8;
          j === 0 ? ctx.moveTo(0, 0) : ctx.lineTo(Math.cos(sa) * r, Math.sin(sa) * r);
        }
        ctx.strokeStyle = `rgba(80,160,255,0.35)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Drain vortex
    if (this.phase === "drain") {
      this.swirls.forEach(s => {
        ctx.save();
        ctx.translate(C, C);
        ctx.rotate(s.angle);
        ctx.globalAlpha = s.alpha;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, s.radius, 0, Math.PI * 1.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.restore();
      });
    }

    // Droplets
    this.drops.forEach(d => {
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.globalAlpha = d.alpha;
      ctx.fillStyle = d.color;
      ctx.fill();
      if (d.alpha > 0.5) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r * 1.6, 0, Math.PI * 2);
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 0.7;
        ctx.globalAlpha = d.alpha * 0.4;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });

    // Reflective sheen
    if (this.phase === "puddle" || this.phase === "rinse") {
      const sg = ctx.createRadialGradient(C - 25, C - 30, 0, C, C, R * 0.6);
      sg.addColorStop(0, "rgba(255,255,255,0.18)");
      sg.addColorStop(0.4, "rgba(200,230,255,0.06)");
      sg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(C, C, R, 0, Math.PI * 2);
      ctx.fillStyle = sg;
      ctx.fill();
    }
  }
}


// function buildRobotGLB(
//   scene: THREE.Scene,
//   basePos: THREE.Vector3,
//   ledColor = 0x00ff88,
//   scale = 0.35,
//   onReady: (robot: RobotObject) => void
// ): void {
//   const loader = new GLTFLoader();
//   loader.load(
//     '/roboticarm.glb',
//     (gltf: any) => {
//       const root = gltf.scene as THREE.Group;
//       root.scale.setScalar(scale);
//       root.rotation.y = Math.PI;

//       root.position.set(0, 0, 0);
//       scene.add(root);

//       // Validate transforms
//       root.traverse((obj) => {
//         if (obj instanceof THREE.Group || (obj as THREE.Mesh).isMesh) {
//           obj.quaternion.normalize();
//           const s = obj.scale;
//           if (Math.abs(s.x - s.y) > 1e-4 || Math.abs(s.y - s.z) > 1e-4) {
//             console.warn(`[GLB] Non-uniform scale on '${obj.name}':`, s.toArray());
//           }
//         }
//       });

//       const box = new THREE.Box3().setFromObject(root);
//       const bottomOffset = box.min.y;
//       const FLOOR_Y = 0.8;
//       root.position.set(basePos.x, FLOOR_Y - bottomOffset, basePos.z);

//       // Enable shadows + LED emissive
//       root.traverse((obj: THREE.Object3D) => {
//         if ((obj as THREE.Mesh).isMesh) {
//           obj.castShadow = true;
//           obj.receiveShadow = true;
//           const mesh = obj as THREE.Mesh;
//           const mat = mesh.material as THREE.MeshStandardMaterial;
//           if (mat && (mat.name?.includes('LED') || mat.name?.includes('emit'))) {
//             mat.emissive = new THREE.Color(ledColor);
//             mat.emissiveIntensity = 2.5;
//           }
//         }
//       });

//       // Index by name
//       const byName: Record<string, THREE.Object3D> = {};
//       root.traverse((obj: THREE.Object3D) => { byName[obj.name] = obj; });

//       console.log('NEW ROBOT GLB nodes:', Object.keys(byName));

//       // ── Hide IK gizmos and Bezier curve controllers (Blender helpers) ──
// // These are rigging aids, not part of the visible robot
// const HIDDEN_NODES = [
//   'BezierCircle', 'BezierCircle.001', 'BezierCircle.002', 'BezierCircle.003',
//   'IK', 'Curve', 'Empty', 'Target', 'Pole',
// ];

// root.traverse((obj) => {
//   // Hide any node whose name matches a helper pattern
//   const name = obj.name || '';
//   if (HIDDEN_NODES.some(h => name === h || name.startsWith(h))) {
//     obj.visible = false;
//     // Also mark as non-pickable for raycasts
//     if ((obj as THREE.Mesh).isMesh) {
//       (obj as THREE.Mesh).raycast = () => {};
//     }
//   }
//   // Hide any mesh that's a flat circle/curve (likely a Bezier helper)
//   if ((obj as THREE.Mesh).isMesh) {
//     const mesh = obj as THREE.Mesh;
//     const mat = mesh.material as THREE.MeshStandardMaterial;
//     // Hide unlit yellow/orange disc meshes typical of rig helpers
//     if (mat && mat.name && (
//       mat.name.toLowerCase().includes('curve') ||
//       mat.name.toLowerCase().includes('helper') ||
//       mat.name.toLowerCase().includes('gizmo')
//     )) {
//       mesh.visible = false;
//     }
//   }
// });

//       // ── Bind to NEW hierarchy ──
//       // Convention: Main → Arm_01 → Arm_02 → Arm_03 → Hand → fingers
//       const turret   = (byName['Main']    ?? byName['Robotic Arm'] ?? new THREE.Group()) as THREE.Group;
//       const shoulder = (byName['Arm_01']  ?? new THREE.Group()) as THREE.Group;
//       const upperArm = (byName['Arm_02']  ?? new THREE.Group()) as THREE.Group;
//       const elbow    = (byName['Arm_02']  ?? new THREE.Group()) as THREE.Group;
//       const foreArm  = (byName['Arm_03']  ?? new THREE.Group()) as THREE.Group;
//       const wrist    = (byName['Hand']    ?? byName['Hand_a_low.001'] ?? new THREE.Group()) as THREE.Group;
//       const gripper  = (byName['Hand_a_low.001'] ?? byName['Hand'] ?? new THREE.Group()) as THREE.Group;
//       const fork =
//         (byName['Joint_Extension_A'] as THREE.Object3D | undefined) ?? (gripper as THREE.Object3D);

//       // Finger references for grip animation
//       const fingerTop1  = byName['Finger_top_01']  as THREE.Object3D | undefined;
//       const fingerTop2  = byName['Finger_top_02']  as THREE.Object3D | undefined;
//       const fingerDown1 = byName['Finger_down_01'] as THREE.Object3D | undefined;
//       const fingerDown2 = byName['Finger_down_02'] as THREE.Object3D | undefined;

//       // Vertical lift (Updown_low.001) — use as Z lift if needed
//       const verticalLift = byName['Updown_low.001'] as THREE.Object3D | undefined;

//       // IK target empty (drive this directly if curves attached)
//       const ikTarget = byName['IK'] as THREE.Object3D | undefined;

//       console.log('NEW ROBOT bindings:', {
//         turret:   turret.name,
//         shoulder: shoulder.name,
//         elbow:    elbow.name,
//         foreArm:  foreArm.name,
//         wrist:    wrist.name,
//         gripper:  gripper.name,
//         fingers:  [fingerTop1?.name, fingerTop2?.name, fingerDown1?.name, fingerDown2?.name],
//         ikTarget: ikTarget?.name,
//         verticalLift: verticalLift?.name,
//       });

//       const statusPL = new THREE.PointLight(ledColor, 1.6, 10);
//       statusPL.position.set(0, 2.0, 0);
//       root.add(statusPL);

//       // Store finger rest poses + IK target reference on root userData
//       root.userData.fingerTop1  = fingerTop1;
//       root.userData.fingerTop2  = fingerTop2;
//       root.userData.fingerDown1 = fingerDown1;
//       root.userData.fingerDown2 = fingerDown2;
//       root.userData.fingerRest = {
//         top1:  fingerTop1  ? { x: fingerTop1.rotation.x,  y: fingerTop1.rotation.y,  z: fingerTop1.rotation.z  } : null,
//         top2:  fingerTop2  ? { x: fingerTop2.rotation.x,  y: fingerTop2.rotation.y,  z: fingerTop2.rotation.z  } : null,
//         down1: fingerDown1 ? { x: fingerDown1.rotation.x, y: fingerDown1.rotation.y, z: fingerDown1.rotation.z } : null,
//         down2: fingerDown2 ? { x: fingerDown2.rotation.x, y: fingerDown2.rotation.y, z: fingerDown2.rotation.z } : null,
//       };
//       root.userData.gripperState = 0; // 0 = open, 1 = closed
//       root.userData.ikTarget = ikTarget;

//       // Geometry constants — measure from actual GLB instead of hardcoding
//       const armBox = new THREE.Box3().setFromObject(shoulder);
//       const armSize = new THREE.Vector3();
//       armBox.getSize(armSize);

//       const L1 = Math.max(armSize.y, 0.7) * scale;
//       const L2 = L1 * 1.6;
//       const shoulderH = armBox.min.y * scale + 0.5 * scale;
//       const wristToGrip = 0.25 * scale;
//       const axisY = new THREE.Vector3(0, 1, 0);
//       const axisZ = new THREE.Vector3(0, 0, 1);
//       const qTurretT = new THREE.Quaternion();
//       const qSegT = new THREE.Quaternion();
//       const eTmp = new THREE.Euler();

//       function runIK(tgt: THREE.Vector3): void {
//         const baseWP = new THREE.Vector3();
//         root.getWorldPosition(baseWP);
//         const dx = tgt.x - baseWP.x;
//         const dz = tgt.z - baseWP.z;

//         let rawYaw = Math.atan2(dx, dz) + Math.PI;
//         rawYaw = normalizeAngle(rawYaw);

//         if (root.userData._ikYaw === undefined) root.userData._ikYaw = turret.rotation.y;
//         let tw = root.userData._ikYaw as number;
//         let delta = normalizeAngle(rawYaw - tw);
//         delta = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, delta));
//         tw = normalizeAngle(tw + delta);
//         root.userData._ikYaw = tw;

//         qTurretT.setFromAxisAngle(axisY, tw);
//         turret.quaternion.slerp(qTurretT, 0.2);
//         turret.quaternion.normalize();

//         // Blender "IK" empties are not solved in three.js at runtime. Driving only ikTarget
//         // leaves the real mesh chain (shoulder → gripper) frozen, so vacuum attach parents
//         // the wafer to a gripper that never reaches the chuck — wafer stays on the station.

//         const localTgt = turret.worldToLocal(tgt.clone());
//         const reach = Math.hypot(localTgt.x, localTgt.z);
//         const dy = localTgt.y - shoulderH - wristToGrip;

//         let D = Math.hypot(reach, dy);
//         const Dmin = Math.abs(L1 - L2) + 0.02;
//         const Dmax = L1 + L2 - 0.02;
//         D = Math.max(Dmin, Math.min(Dmax, D));

//         const cosElbow = (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2);
//         const elbowInner = Math.acos(Math.max(-1, Math.min(1, cosElbow)));
//         const elbowAngle = -(Math.PI - elbowInner);

//         const cosShoulder = (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D);
//         const shoulderInner = Math.acos(Math.max(-1, Math.min(1, cosShoulder)));
//         const targetAngle = Math.atan2(reach, dy);
//         let shoulderAngle = targetAngle - shoulderInner;
//         shoulderAngle = Math.max(0, Math.min(Math.PI / 2.2, shoulderAngle));

//         qSegT.setFromAxisAngle(axisZ, shoulderAngle);
//         shoulder.quaternion.slerp(qSegT, 0.22);
//         shoulder.quaternion.normalize();

//         qSegT.setFromAxisAngle(axisZ, elbowAngle);
//         if (foreArm !== elbow) {
//           foreArm.quaternion.slerp(qSegT, 0.22);
//           foreArm.quaternion.normalize();
//         } else {
//           elbow.quaternion.slerp(qSegT, 0.22);
//           elbow.quaternion.normalize();
//         }

//         const totalPitch = shoulderAngle + elbowAngle;
//         let wristAngle = -totalPitch;
//         const isPlacing = Math.abs(localTgt.y - 0.93) < 0.28;
//         if (isPlacing) wristAngle += -0.26;
//         wristAngle = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, wristAngle));
//         qSegT.setFromAxisAngle(axisZ, wristAngle);
//         wrist.quaternion.slerp(qSegT, 0.22);
//         wrist.quaternion.normalize();
//       }

//       function getJoints(): JointData {
//         eTmp.setFromQuaternion(turret.quaternion, "YXZ");
//         const baseA = eTmp.y;
//         eTmp.setFromQuaternion(shoulder.quaternion, "XYZ");
//         const shoulderA = eTmp.z;
//         eTmp.setFromQuaternion(foreArm.quaternion, "XYZ");
//         const elbowA = eTmp.z;
//         eTmp.setFromQuaternion(wrist.quaternion, "XYZ");
//         const wristA = eTmp.z;
//         return {
//           base: { c: baseA },
//           shoulder: { c: shoulderA },
//           elbow: { c: elbowA },
//           wrist: { c: wristA },
//         };
//       }

//       console.log('=== NEW ROBOT BONE TEST ===');
//       console.log('turret:',   turret.name);
//       console.log('shoulder:', shoulder.name);
//       console.log('foreArm:',  foreArm.name);
//       console.log('wrist:',    wrist.name);
//       console.log('gripper:',  gripper.name);
//       console.log('IK target:', ikTarget?.name ?? 'none');

//       onReady({
//         group: root,
//         turret,
//         shoulder,
//         upperArm,
//         elbow,
//         foreArm,
//         wrist,
//         gripper,
//         fork,
//         statusPL,
//         basePos: basePos.clone(),
//         runIK,
//         getJoints,
//         worldPos: () => {
//           const v = new THREE.Vector3();
//           fork.getWorldPosition(v);
//           return v;
//         },
//       });
//     },
//     (progress: any) => {
//       if (progress.total > 0) {
//         console.log('GLB loading:', Math.round(progress.loaded / progress.total * 100) + '%');
//       }
//     },
//     (error: any) => {
//       console.error('GLB FAILED TO LOAD:', error);
//     }
//   );
// }


// ===== GLB-REMOVED (buildRobotGLB - /roboticarm.glb EFEM robot) - re-wire the new module here. See GLB_WIRING_CONTRACT.md =====
// function buildRobotGLB(
//   scene: THREE.Scene,
//   basePos: THREE.Vector3,
//   ledColor = 0x00ff88,
//   scale = 0.35,
//   onReady: (robot: RobotObject) => void,
//   baseYaw = EFEM_RIGHT_SIDE_YAW
// ): void {
//   const loader = new GLTFLoader();
//   loader.load(
//     '/roboticarm.glb',
//     (gltf: any) => {
//       const root = gltf.scene as THREE.Group;
//       root.scale.setScalar(scale);
//       // Mount the robot rotated toward its wafer-rack. IK below compensates
//       // for this local base yaw when aiming at world targets.
//       root.rotation.y = baseYaw;
//       scene.add(root);
// 
//       // Validate transforms
//       root.traverse((obj) => {
//         if (obj instanceof THREE.Group || (obj as THREE.Mesh).isMesh) {
//           obj.quaternion.normalize();
//         }
//       });
// 
//       // Snap to floor
//       const box = new THREE.Box3().setFromObject(root);
//       const FLOOR_Y = 0.3;
//       root.position.set(basePos.x, FLOOR_Y - box.min.y, basePos.z);
// 
//       // Shadows + LEDs
//       root.traverse((obj: THREE.Object3D) => {
//         if ((obj as THREE.Mesh).isMesh) {
//           obj.castShadow = true;
//           obj.receiveShadow = true;
//           const mesh = obj as THREE.Mesh;
//           const mat = mesh.material as THREE.MeshStandardMaterial;
//           if (mat && mat.name && (mat.name.includes('LED') || mat.name.includes('emit'))) {
//             mat.emissive = new THREE.Color(ledColor);
//             mat.emissiveIntensity = 2.5;
//           }
//         }
//       });
// 
//       // Hide rigging helpers from old file (left in just in case GLB has them)
//       const HIDDEN = ['BezierCircle', 'IK', 'CameraTarget', 'Curve', 'Empty', 'Pole'];
//       root.traverse((obj) => {
//         const name = obj.name || '';
//         if (HIDDEN.some(h => name === h || name.startsWith(h))) {
//           obj.visible = false;
//           if ((obj as THREE.Mesh).isMesh) (obj as THREE.Mesh).raycast = () => { };
//         }
//       });
// 
//       // ── Index nodes by name ──
//       const byName: Record<string, THREE.Object3D> = {};
//       root.traverse((obj) => { byName[obj.name] = obj; });
//       console.log('GLB nodes:', Object.keys(byName).filter(n => n.startsWith('Joint') || n.startsWith('Blade')));
// 
//       // ── Bind to the NEW joint hierarchy ──
//       const zLift = byName['Joint_ZLift'] as THREE.Object3D;
//       const turret = byName['Joint_Rot'] as THREE.Group;        // yaw (Y)
//       const shoulder = byName['Joint_Shoulder'] as THREE.Group;        // pitch (Z)
//       const elbow = byName['Joint_Elbow'] as THREE.Group;        // pitch (Z) — at +X 0.355 from shoulder
//       const foreArm = byName['Joint_Forearm'] as THREE.Group;        // pitch (Z)
//       const wrist = byName['Joint_Wrist'] as THREE.Group;        // pitch (Z) — at +X 0.305 from elbow
//       const gripper = (byName['Joint_Wrist'] ?? byName['Blade_Mount']) as THREE.Group;
//       // Blade tip lives ~0.335 along +X from the wrist (per Joint_Wrist children).
//       const fork = byName['Blade_Mount'] as THREE.Object3D ?? gripper;
// 
//       if (!turret || !shoulder || !elbow || !wrist) {
//         console.error('GLB binding failed — joint nodes not found. Got:',
//           { turret: !!turret, shoulder: !!shoulder, elbow: !!elbow, wrist: !!wrist });
//         return;
//       }
// 
//       // ── Status LED ──
//       const statusPL = new THREE.PointLight(ledColor, 1.6, 10);
//       statusPL.position.set(0, 2.0, 0);
//       root.add(statusPL);
// 
//       // ── Rest-pose offsets used by IK (from GLB inspection, multiplied by scale) ──
//       // shoulder→elbow distance along X
//       const L1 = 0.355 * scale;
//       // elbow→wrist distance along X
//       const L2 = 0.305 * scale;
//       // wrist→blade-tip distance along X (Joint_Wrist x=0.335 to its children blade meshes)
//       const L3 = 0.335 * scale;
//       // Shoulder Y position above the rail
//       const SHOULDER_Y = (0.93 + 0.46) * scale;   // Joint_ZLift + Joint_Rot offsets
// 
//       // Save state for animations / restoration
//       root.userData.vacuumEngaged = false;
//       root.userData.bladeFlash = 0;        // for visual "engaged" pulse
//       root.userData._ikYaw = 0;
//       root.userData.L1 = L1;
//       root.userData.L2 = L2;
//       root.userData.L3 = L3;
//       root.userData.SHOULDER_Y = SHOULDER_Y;
// 
//       // Reusable temp objects
//       const axisY = new THREE.Vector3(0, 1, 0);
//       const axisZ = new THREE.Vector3(0, 0, 1);
//       const qTmp = new THREE.Quaternion();
//       const eTmp = new THREE.Euler();
// 
//       // ── INVERSE KINEMATICS (closed-form 3R planar in the rotated X-Y plane) ──
//       //      function runIK(tgt: THREE.Vector3): void {
//       //   // ── 1. Turret yaw (unchanged — aim at target on the XZ plane) ──────────
//       //   const baseWP = new THREE.Vector3();
//       //   root.getWorldPosition(baseWP);
//       //   const dx = tgt.x - baseWP.x;
//       //   const dz = tgt.z - baseWP.z;
//       //   const rawYaw = Math.atan2(dx, dz);
//       //   const prev = root.userData._ikYaw as number;
//       //   let delta = rawYaw - prev;
//       //   while (delta >  Math.PI) delta -= 2 * Math.PI;
//       //   while (delta < -Math.PI) delta += 2 * Math.PI;
//       //   delta = Math.max(-Math.PI / 1.2, Math.min(Math.PI / 1.2, delta));
//       //   const newYaw = prev + delta;
//       //   root.userData._ikYaw = newYaw;
//       //   qTmp.setFromAxisAngle(axisY, newYaw);
//       //   turret.quaternion.slerp(qTmp, 0.22).normalize();
// 
//       //   // ── 2. Target in turret-local frame ────────────────────────────────────
//       //   turret.updateWorldMatrix(true, false);
//       //   const localTgt = turret.worldToLocal(tgt.clone());
// 
//       //   // After yaw, the planar reach is along +Z (because we rotated INTO the
//       //   // target). The vertical axis is Y. So treat the IK plane as (reachZ, Y).
//       //   // Important: use the absolute z because the turret might be slightly
//       //   // mis-aimed due to the slerp lag.
//       //   const reach = Math.abs(localTgt.z);
// 
//       //   // Wrist target = wafer target minus the blade extension L3 along the
//       //   // arm's current outward direction. Since the wrist points +X in local
//       //   // shoulder frame, but after turret yaw the outward direction is +Z in
//       //   // turret-local frame, we subtract L3 from reach.
//       //   const wx = reach - L3;                          // horizontal distance to wrist
//       //   const wy = localTgt.y - SHOULDER_Y;             // vertical offset to wrist
// 
//       //   let D = Math.hypot(wx, wy);
// 
//       //   // Force the wrist target to sit strictly inside the bend annulus so the
//       //   // arm always bends. NEVER let D ≥ L1+L2 (which would force straight arm).
//       //   const MIN_BEND_ANGLE = 0.20;                    // ~11.5° minimum elbow bend
//       //   const Dmax_bent = Math.sqrt(
//       //     L1 * L1 + L2 * L2 - 2 * L1 * L2 * Math.cos(Math.PI - MIN_BEND_ANGLE)
//       //   );
//       //   const Dmin = Math.abs(L1 - L2) + 0.005;
//       //   D = Math.max(Dmin, Math.min(Dmax_bent, D));
// 
//       //   // ── 3. Law-of-cosines (ELBOW-BACK branch) ──────────────────────────────
//       //   // Interior elbow angle (between L1 and L2)
//       //   const cosElbow = (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2);
//       //   const elbowInner = Math.acos(Math.max(-1, Math.min(1, cosElbow)));
// 
//       //   // Shoulder offset from straight-line-to-wrist
//       //   const cosShOff = (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D);
//       //   const shOff = Math.acos(Math.max(-1, Math.min(1, cosShOff)));
// 
//       //   // Angle from shoulder's +X (outward direction) to the wrist target.
//       //   // In the (wx, wy) plane:  +wx = outward, +wy = up.
//       //   const targetAng = Math.atan2(wy, wx);
// 
//       //   // ── Elbow-BACK branch: forearm folds BACK toward the base, like a real
//       //   // wafer handler reaching around obstacles.
//       //   //   shoulderAngle = targetAng - shOff   (negative offset bends arm UP first)
//       //   //   elbowAngle    = π - elbowInner      (positive = forearm angled back)
//       //   const shoulderAngle = targetAng - shOff;
//       //   const elbowAngle    = Math.PI - elbowInner;
// 
//       //   // ── 4. Wrist counter-rotation so the blade stays horizontal ────────────
//       //   // Sum of pitches in the chain must equal 0 for the blade to stay level.
//       //   // Chain: shoulder(+sA) → elbow(-eA) → forearm(0) → wrist(wA)
//       //   //   sA − eA + wA = 0   →   wA = eA − sA
//       //   const wristAngle = elbowAngle - shoulderAngle;
// 
//       //   // ── 5. Apply with damped slerp ─────────────────────────────────────────
//       //   // Use larger blend (0.3) on shoulder/elbow so the bend is responsive,
//       //   // smaller (0.22) on wrist for stability.
//       //   qTmp.setFromAxisAngle(axisZ, shoulderAngle);
//       //   shoulder.quaternion.slerp(qTmp, 0.30).normalize();
// 
//       //   qTmp.setFromAxisAngle(axisZ, -elbowAngle);   // negative = fold back
//       //   elbow.quaternion.slerp(qTmp, 0.30).normalize();
// 
//       //   // Forearm stays identity (structural link in this rig)
//       //   foreArm.quaternion.slerp(new THREE.Quaternion(), 0.15).normalize();
// 
//       //   qTmp.setFromAxisAngle(axisZ, wristAngle);
//       //   wrist.quaternion.slerp(qTmp, 0.22).normalize();
//       // }
// 
// 
//       // function runIK(tgt: THREE.Vector3): void {
//       //   // ── 1. Turret yaw — aim toward target on the XZ plane ─────────────────
//       //   const baseWP = new THREE.Vector3();
//       //   root.getWorldPosition(baseWP);
//       //   const dx = tgt.x - baseWP.x;
//       //   const dz = tgt.z - baseWP.z;
// 
//       //   // Note: arm's outward direction in turret-local frame is +X.
//       //   // Standard yaw: atan2(dx, dz) aims local +Z; we want local +X. So use atan2(dz, dx) negated, OR rotate by +π/2.
//       //   // Easier: aim the arm's local +X by yaw = atan2(dz, dx)? No — let's stick with whichever
//       //   // axis the GLB actually extends along. Joint_Elbow translates +X 0.355 → arm extends +X.
//       //   // So we want yaw such that turret-local +X points at the target.
//       //   // World direction to target on XZ plane: (dx, dz).
//       //   // After yaw θ around Y, local +X maps to world (cos θ, 0, -sin θ).
//       //   // Setting that equal to normalized (dx, dz): cos θ = dx/r, -sin θ = dz/r  →  θ = atan2(-dz, dx).
//       //   const r2d = Math.hypot(dx, dz) || 1;
//       //   const rawYaw = Math.atan2(-dz, dx);
// 
//       //   const prev = root.userData._ikYaw as number;
//       //   let delta = rawYaw - prev;
//       //   while (delta >  Math.PI) delta -= 2 * Math.PI;
//       //   while (delta < -Math.PI) delta += 2 * Math.PI;
//       //   const newYaw = prev + delta;
//       //   root.userData._ikYaw = newYaw;
//       //   qTmp.setFromAxisAngle(axisY, newYaw);
//       //   turret.quaternion.slerp(qTmp, 0.20).normalize();
// 
//       //   // ── 2. Target in shoulder-local plane ──────────────────────────────────
//       //   // After the turret is yawed, the arm reaches outward along +X in turret-local space.
//       //   // The horizontal reach we need to solve for is the distance from the shoulder
//       //   // pivot to the (projected) target on the horizontal plane.
//       //   // We use world distance directly to avoid issues with slerp lag:
//       //   const reachHoriz = r2d;                          // horizontal distance shoulder→target
//       //   const verticalOff = tgt.y - (baseWP.y + SHOULDER_Y);
// 
//       //   // The blade tip sits L3 beyond the wrist along +X. So the WRIST must reach
//       //   // a point that is L3 closer to the shoulder than the target:
//       //   const wx = reachHoriz - L3;
//       //   const wy = verticalOff;
// 
//       //   // ── 3. Solve 2-link IK in the (wx, wy) plane ──────────────────────────
//       //   let D = Math.hypot(wx, wy);
// 
//       //   // Reach limits — keep the arm slightly bent at extremes to avoid singularity,
//       //   // and prevent inversion when target is too close.
//       //   const Dmax = (L1 + L2) * 1.4;                   // 97% of max reach
//       //   const Dmin = Math.abs(L1 - L2) + 0.02;
//       //   D = Math.max(Dmin, Math.min(Dmax, D));
// 
//       //   // Law of cosines:
//       //   //   cos(elbow_interior) = (L1² + L2² - D²) / (2·L1·L2)
//       //   // When D = Dmax, elbow_interior ≈ 0 (arm nearly straight) — fine.
//       //   // When D = Dmin, elbow_interior ≈ π (arm fully folded) — also fine.
//       //   const cosElbow = (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2);
//       //   const elbowInterior = Math.acos(Math.max(-1, Math.min(1, cosElbow)));
// 
//       //   // Angle from shoulder to wrist target, measured from local +X (outward).
//       //   // wx = outward, wy = up.  atan2(wy, wx) ∈ (-π, π].
//       //   const wristDirAng = Math.atan2(wy, wx);
// 
//       //   // Offset between upper-arm direction and shoulder→wrist line:
//       //   //   cos(offset) = (L1² + D² - L2²) / (2·L1·D)
//       //   const cosShOff = (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D);
//       //   const shOff = Math.acos(Math.max(-1, Math.min(1, cosShOff)));
// 
//       //   // ── 4. ELBOW-UP branch (upper arm goes ABOVE the line to wrist) ───────
//       //   // This is the natural SCARA-style "shoulder lifts, elbow droops back down"
//       //   // silhouette for an outward-reaching horizontal arm.
//       //   //
//       //   //   shoulderAngle =  wristDirAng + shOff      (rotates upper arm UP)
//       //   //   elbowAngle    = -(π - elbowInterior)      (forearm rotates DOWN to reach wrist)
//       //   //
//       //   // Sign convention: positive Z-rotation rotates local +X toward local +Y (up).
//       //   const shoulderAngle = wristDirAng + shOff;
//       //   const elbowAngle    = -(Math.PI - elbowInterior);
// 
//       //   // ── 5. Wrist keeps blade level ────────────────────────────────────────
//       //   // Chain pitches sum to zero so blade points horizontally:
//       //   //   shoulderAngle + elbowAngle + wristAngle = 0
//       //   const wristAngle = -(shoulderAngle + elbowAngle);
// 
//       //   // ── 6. Apply ──────────────────────────────────────────────────────────
//       //   qTmp.setFromAxisAngle(axisZ, shoulderAngle);
//       //   shoulder.quaternion.slerp(qTmp, 0.22).normalize();
// 
//       //   qTmp.setFromAxisAngle(axisZ, elbowAngle);
//       //   elbow.quaternion.slerp(qTmp, 0.22).normalize();
// 
//       //   // Forearm is a rigid link in this rig
//       //   foreArm.quaternion.slerp(new THREE.Quaternion(), 0.15).normalize();
// 
//       //   qTmp.setFromAxisAngle(axisZ, wristAngle);
//       //   wrist.quaternion.slerp(qTmp, 0.22).normalize();
//       // }
// 
// 
//       // function runIK(tgt: THREE.Vector3): void {
//       //   // ── 1. Turret yaw ──
//       //   const baseWP = new THREE.Vector3();
//       //   root.getWorldPosition(baseWP);
//       //   const dx = tgt.x - baseWP.x;
//       //   const dz = tgt.z - baseWP.z;
//       //   const r2d = Math.hypot(dx, dz) || 1;
//       //   const rawYaw = Math.atan2(-dz, dx);
// 
//       //   const prev = root.userData._ikYaw as number;
//       //   let delta = rawYaw - prev;
//       //   while (delta >  Math.PI) delta -= 2 * Math.PI;
//       //   while (delta < -Math.PI) delta += 2 * Math.PI;
//       //   const newYaw = prev + delta;
//       //   root.userData._ikYaw = newYaw;
//       //   qTmp.setFromAxisAngle(axisY, newYaw);
//       //   turret.quaternion.slerp(qTmp, 0.20).normalize();
// 
//       //   // ── 2. 2-link IK in shoulder-local plane ──
//       //   const reachHoriz = Math.max(r2d, 0.1);  // tiny minimum to avoid singularity
//       //   const verticalOff = tgt.y - (baseWP.y + SHOULDER_Y);
// 
//       //   const wx = reachHoriz - L3;
//       //   const wy = verticalOff;
// 
//       //   let D = Math.hypot(wx, wy);
//       //   const Dmax = (L1 + L2) * 0.98;
//       //   const Dmin = Math.abs(L1 - L2) + 0.02;
//       //   D = Math.max(Dmin, Math.min(Dmax, D));
// 
//       //   const cosElbow = (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2);
//       //   const elbowInterior = Math.acos(Math.max(-1, Math.min(1, cosElbow)));
// 
//       //   const wristDirAng = Math.atan2(wy, wx);
//       //   const cosShOff = (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D);
//       //   const shOff = Math.acos(Math.max(-1, Math.min(1, cosShOff)));
// 
//       //   // ── ELBOW-UP branch ──
//       //   let shoulderAngle = wristDirAng + shOff;
//       //   let elbowAngle    = -(Math.PI - elbowInterior);
// 
//       //   // ── Joint limits (loose) ──
//       //   shoulderAngle = Math.max(-0.4, Math.min(Math.PI * 0.7, shoulderAngle));
//       //   elbowAngle    = Math.max(-Math.PI * 0.95, Math.min(-0.03, elbowAngle));
// 
//       //   let wristAngle = -(shoulderAngle + elbowAngle);
//       //   wristAngle = Math.max(-Math.PI * 0.8, Math.min(Math.PI * 0.8, wristAngle));
// 
//       //   qTmp.setFromAxisAngle(axisZ, shoulderAngle);
//       //   shoulder.quaternion.slerp(qTmp, 0.22).normalize();
// 
//       //   qTmp.setFromAxisAngle(axisZ, elbowAngle);
//       //   elbow.quaternion.slerp(qTmp, 0.22).normalize();
// 
//       //   foreArm.quaternion.slerp(new THREE.Quaternion(), 0.15).normalize();
// 
//       //   qTmp.setFromAxisAngle(axisZ, wristAngle);
//       //   wrist.quaternion.slerp(qTmp, 0.22).normalize();
//       // }
//       // function runIK(tgt: THREE.Vector3): void {
//       //   // ── FLOOR CLEARANCE GUARD ──────────────────────────────────────
//       //   // Clamp target Y so the end-effector never descends below a safe
//       //   // clearance height above the module tops (~3.7 units from floor).
//       //   const MIN_SAFE_Y = 3.7;          // ← tune: MODULE_BASE_Y + H + margin
//       //   const clampedTgt = tgt.clone();
//       //   clampedTgt.y = Math.max(tgt.y, MIN_SAFE_Y);
// 
//       //   // ── 1. Turret yaw ──
//       //   const baseWP = new THREE.Vector3();
//       //   root.getWorldPosition(baseWP);
//       //   const dx = clampedTgt.x - baseWP.x;
//       //   const dz = clampedTgt.z - baseWP.z;
//       //   const r2d = Math.hypot(dx, dz) || 1;
//       //   const rawYaw = Math.atan2(-dz, dx);
// 
//       //   const prev = root.userData._ikYaw as number;
//       //   let delta = rawYaw - prev;
//       //   while (delta >  Math.PI) delta -= 2 * Math.PI;
//       //   while (delta < -Math.PI) delta += 2 * Math.PI;
//       //   const newYaw = prev + delta;
//       //   root.userData._ikYaw = newYaw;
//       //   qTmp.setFromAxisAngle(axisY, newYaw);
//       //   turret.quaternion.slerp(qTmp, 0.20).normalize();
// 
//       //   // ── 2. 2-link IK in shoulder-local plane ──
//       //   const reachHoriz = Math.max(r2d, 0.1);
//       //   const verticalOff = clampedTgt.y - (baseWP.y + SHOULDER_Y);  // ← use clamped Y
// 
//       //   const wx = reachHoriz - L3;
//       //   const wy = verticalOff;
// 
//       //   let D = Math.hypot(wx, wy);
//       //   const Dmax = (L1 + L2) * 0.98;
//       //   const Dmin = Math.abs(L1 - L2) + 0.02;
//       //   D = Math.max(Dmin, Math.min(Dmax, D));
// 
//       //   const cosElbow = (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2);
//       //   const elbowInterior = Math.acos(Math.max(-1, Math.min(1, cosElbow)));
// 
//       //   const wristDirAng = Math.atan2(wy, wx);
//       //   const cosShOff = (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D);
//       //   const shOff = Math.acos(Math.max(-1, Math.min(1, cosShOff)));
// 
//       //   // ── ELBOW-UP branch ──
//       //   let shoulderAngle = wristDirAng + shOff;
//       //   let elbowAngle    = -(Math.PI - elbowInterior);
// 
//       //   // ── Joint limits — tightened to prevent floor crash ──
//       //   // FIX: raised shoulder min from -0.4 → +0.05 so arm never dips below horizon
//       //   shoulderAngle = Math.max(0.05, Math.min(Math.PI * 0.7, shoulderAngle));
//       //   // FIX: tightened elbow upper bound from -0.03 → -0.10 prevents hyper-extension low
//       //   elbowAngle    = Math.max(-Math.PI * 0.95, Math.min(-0.10, elbowAngle));
// 
//       //   // ── Wrist compensation with clearance clamp ──
//       //   let wristAngle = -(shoulderAngle + elbowAngle);
//       //   // FIX: clamp wrist so it can't pitch the end-effector downward past level
//       //   wristAngle = Math.max(-Math.PI * 0.5, Math.min(Math.PI * 0.8, wristAngle));
// 
//       //   qTmp.setFromAxisAngle(axisZ, shoulderAngle);
//       //   shoulder.quaternion.slerp(qTmp, 0.22).normalize();
// 
//       //   qTmp.setFromAxisAngle(axisZ, elbowAngle);
//       //   elbow.quaternion.slerp(qTmp, 0.22).normalize();
// 
//       //   foreArm.quaternion.slerp(new THREE.Quaternion(), 0.15).normalize();
// 
//       //   qTmp.setFromAxisAngle(axisZ, wristAngle);
//       //   wrist.quaternion.slerp(qTmp, 0.22).normalize();
//       // }
// 
// 
//       // ── Hydraulic Lift Cylinder — global state ──
//       let liftCylinder: THREE.Object3D | null = null;   // assigned when robot is built
//       let currentLiftHeight = 0.0;
// 
//       function setLiftHeight(targetHeight: number, speed = 0.25) {
//         currentLiftHeight = THREE.MathUtils.lerp(currentLiftHeight, targetHeight, speed);
//         if (liftCylinder) {
//           // Scale the cylinder along Y and shift its base position
//           liftCylinder.scale.y = Math.max(0.3, 1 + currentLiftHeight * 2.5);
//           liftCylinder.position.y = currentLiftHeight * 0.8;
//         }
//       }
// 
//       function clamp(x: number, min: number, max: number): number {
//         return Math.max(min, Math.min(max, x));
//       }
// 
//       function runIK(tgt: THREE.Vector3, options: {
//   isScanner?: boolean;
//   isHMDS?: boolean;
//   isDIRinse?: boolean;
//   isHardBake?: boolean;     // ← NEW
//   isTravel?: boolean;
//   placeHeightOffset?: number;
//   approachHeight?: number;
//   safetyMargin?: number;
// } = {}): void {
//   const {
//     isScanner = false,
//     isHMDS = false,
//     isDIRinse = false,
//     isHardBake = false,     // ← NEW
//     isTravel = false,
//     placeHeightOffset = 0.0,
//     approachHeight = 0.12,
//     safetyMargin = 0.08,
//   } = options;
// 
//         // ══════════════════════════════════════════════════════════════════════
//         // 0. SANITY CHECK on target — prevent NaN/Infinity from breaking IK
//         // ══════════════════════════════════════════════════════════════════════
//         if (!Number.isFinite(tgt.x) || !Number.isFinite(tgt.y) || !Number.isFinite(tgt.z)) {
//           console.warn('[IK] Invalid target — skipping', tgt);
//           return;
//         }
// 
//         // ══════════════════════════════════════════════════════════════════════
//         // 1. LIFT HEIGHT — column rises higher for tall modules (scanner especially)
//         // ══════════════════════════════════════════════════════════════════════
//        let requiredLift = 0.0;
//   if (isScanner) {
//     requiredLift = 0.88;
//   } else if (isHMDS) {
//     requiredLift = 0.28;
//   } else if (isDIRinse) {
//     requiredLift = 0.22;
//   } else if (isHardBake) {
//     requiredLift = 0.32;     // ← NEW — tune this against the box wall height in your screenshot
//   }
// 
//         // ── Faster column rise for scanner (smaller smoothing factor = quicker) ──
//         const liftSmoothing = isScanner ? 0.25 : 0.18;
//         setLiftHeight(requiredLift, liftSmoothing);
// 
//         // ══════════════════════════════════════════════════════════════════════
//         // 2. TURRET YAW — with safe shortest-path resolution
//         // ══════════════════════════════════════════════════════════════════════
//         const baseWP = new THREE.Vector3();
//         root.getWorldPosition(baseWP);
//         const dx = tgt.x - baseWP.x;
//         const dz = tgt.z - baseWP.z;
//         const r2d = Math.hypot(dx, dz);
// 
//         // ── CRITICAL: Avoid yaw singularity when target is directly above base ──
//         // For HMDS especially, the wafer can be very close to the base,
//         // causing dx/dz to be near-zero and atan2 to flip wildly.
//         // Implement hysteresis + rate-limited logging to avoid console spam.
//         const closeThresh = isHMDS ? 0.15 : 0.12;
//         const reopenThresh = closeThresh + 0.04;
//         const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
//         const lastWarn = (root.userData._ikLastCloseWarn as number) ?? 0;
//         const locked = !!root.userData._ikYawLocked;
// 
//         if (r2d < closeThresh) {
//           if (!locked) {
//             root.userData._ikYawLocked = true;
//             root.userData._ikLastCloseWarn = now;
//             console.warn('[IK] Target too close to base — yaw locked');
//           } else if (now - lastWarn > 2000) {
//             // periodic reminder if still stuck close for a while
//             root.userData._ikLastCloseWarn = now;
//             console.warn('[IK] Target too close to base — yaw still locked');
//           }
//           // keep previous yaw, skip update
//         } else {
//           // If we were locked and target moved away past reopen threshold, unlock
//           if (locked && r2d > reopenThresh) {
//             root.userData._ikYawLocked = false;
//             // log unlock once
//             console.info('[IK] Target moved away from base — yaw unlocked');
//           }
// 
//           const rootYaw = EFEM_RIGHT_SIDE_YAW;
//           const rawYaw = Math.atan2(-dz, dx) - rootYaw;
//           const prev = (root.userData._ikYaw as number) ?? rawYaw;
//           let delta = rawYaw - prev;
// 
//           // ── Normalize delta to [-π, π]
//           delta = Math.atan2(Math.sin(delta), Math.cos(delta));
// 
//           // ── HMDS extra safety: limit rotation speed when going through tight angles
//           let yawStepLimit = Math.PI;
//           if (isHMDS) yawStepLimit = Math.PI * 0.6;
//           if (Math.abs(delta) > yawStepLimit) delta = Math.sign(delta) * yawStepLimit;
// 
//           const newYaw = prev + delta;
//           root.userData._ikYaw = newYaw;
//           qTmp.setFromAxisAngle(axisY, newYaw);
// 
//           // Slower slerp for HMDS or travel to prevent overshoot
//           const yawSlerpRate = isHMDS || isTravel ? 0.12 : 0.18;
//           turret.quaternion.slerp(qTmp, yawSlerpRate).normalize();
//         }
// 
//         // ══════════════════════════════════════════════════════════════════════
//         // 3. ARM IK — 2-link in shoulder-local plane with crash protection
//         // ══════════════════════════════════════════════════════════════════════
//         const shoulderBaseY = baseWP.y + SHOULDER_Y + currentLiftHeight * 0.9;
//         let finalTargetY = tgt.y + placeHeightOffset;
// 
//         // ── HMDS gets extra approach height to clear walls ──
//         if (isHMDS) {
//           finalTargetY += 0.05;       // raise approach by 5cm
//         }
//         if (isTravel) {
//           const SAFE_TRAVEL_Y = WAFER_TRANSFER_Y + 1.2;   // keep travel motion well above all modules
//           finalTargetY = Math.max(finalTargetY, SAFE_TRAVEL_Y);
//         }
// 
//         const verticalOff = finalTargetY - shoulderBaseY + Math.max(safetyMargin, isTravel ? 0.12 : 0.0);
//         const reachHoriz = Math.max(r2d, 0.15);   // bumped min from 0.12 to 0.15
// 
//         const wx = reachHoriz - L3;
//         const wy = verticalOff;
// 
//         // ── CRITICAL: Validate wx, wy before computing D ──
//         if (!Number.isFinite(wx) || !Number.isFinite(wy)) {
//           console.warn('[IK] Invalid wrist target — aborting arm IK');
//           return;
//         }
// 
//         let D = Math.hypot(wx, wy);
// 
//         // ── Reach clamping with HMDS-specific tighter bounds ──
//         const Dmax = (L1 + L2) * (isHMDS ? 0.92 : 0.96);   // ← Tighter for HMDS
//         const Dmin = Math.abs(L1 - L2) + (isHMDS ? 0.08 : 0.04);
//         D = Math.max(Dmin, Math.min(Dmax, D));
// 
//         // ── CRITICAL: Guard against D being zero or invalid ──
//         if (D < 0.001 || !Number.isFinite(D)) {
//           console.warn('[IK] Degenerate reach — aborting');
//           return;
//         }
// 
//         // Law of Cosines with clamping (prevents NaN from floating point error)
//         const cosElbow = clamp((L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2), -1, 1);
//         const elbowInterior = Math.acos(cosElbow);
// 
//         const wristDirAng = Math.atan2(wy, wx);
//         const cosShOff = clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1);
//         const shOff = Math.acos(cosShOff);
// 
//         // ── CRITICAL: Validate computed angles ──
//         if (!Number.isFinite(elbowInterior) || !Number.isFinite(wristDirAng) || !Number.isFinite(shOff)) {
//           console.warn('[IK] NaN in IK computation — aborting');
//           return;
//         }
// 
//         // ── Elbow-up branch ──
//         let shoulderAngle = wristDirAng + shOff;
//         let elbowAngle = -(Math.PI - elbowInterior);
// 
//         // ── HMDS-specific joint limits (slightly more conservative) ──
//         if (isHMDS) {
//           shoulderAngle = clamp(shoulderAngle, -0.50, Math.PI * 0.60);   // tighter shoulder range
//           elbowAngle = clamp(elbowAngle, -Math.PI * 0.80, -0.15);  // tighter elbow range
//         } else if (isScanner) {
//           // Scanner needs wide upward shoulder range to reach raised slot
//           shoulderAngle = clamp(shoulderAngle, -0.30, Math.PI * 0.85);   // ← higher upper limit
//           elbowAngle = clamp(elbowAngle, -Math.PI * 0.90, 0.05);   // ← allows straighter arm
//         } else {
//           shoulderAngle = clamp(shoulderAngle, isTravel ? 0.10 : -0.65, Math.PI * 0.70);
//           elbowAngle = clamp(elbowAngle, -Math.PI * 0.85, -0.10);
//         }
// 
//         let wristAngle = -(shoulderAngle + elbowAngle);
//         wristAngle = clamp(wristAngle, -Math.PI * 0.80, Math.PI * 0.80);
// 
//         // ══════════════════════════════════════════════════════════════════════
//         // 4. APPLY ROTATIONS — with HMDS slower slerp to prevent crash
//         // ══════════════════════════════════════════════════════════════════════
//         const armSlerpRate = isHMDS || isTravel ? 0.14 : 0.20;   // slower for HMDS/travel = smoother
// 
//         qTmp.setFromAxisAngle(axisZ, shoulderAngle);
//         shoulder.quaternion.slerp(qTmp, armSlerpRate).normalize();
// 
//         qTmp.setFromAxisAngle(axisZ, elbowAngle);
//         elbow.quaternion.slerp(qTmp, armSlerpRate).normalize();
// 
//         foreArm.quaternion.slerp(new THREE.Quaternion(), armSlerpRate).normalize();
// 
//         qTmp.setFromAxisAngle(axisZ, wristAngle);
//         wrist.quaternion.slerp(qTmp, armSlerpRate).normalize();
//       }
// 
// 
// 
// 
//       function getJoints(): JointData {
//         eTmp.setFromQuaternion(turret.quaternion, "YXZ");
//         const baseA = eTmp.y;
//         eTmp.setFromQuaternion(shoulder.quaternion, "XYZ");
//         const shoulderA = eTmp.z;
//         eTmp.setFromQuaternion(elbow.quaternion, "XYZ");
//         const elbowA = eTmp.z;
//         eTmp.setFromQuaternion(wrist.quaternion, "XYZ");
//         const wristA = eTmp.z;
//         return {
//           base: { c: baseA },
//           shoulder: { c: shoulderA },
//           elbow: { c: elbowA },
//           wrist: { c: wristA },
//         };
//       }
// 
//       console.log('=== NEW ROBOT BOUND ===');
//       console.log('  turret  :', turret.name);
//       console.log('  shoulder:', shoulder.name);
//       console.log('  elbow   :', elbow.name);
//       console.log('  foreArm :', foreArm.name);
//       console.log('  wrist   :', wrist.name);
//       console.log('  blade   :', fork.name);
//       console.log(`  L1=${L1.toFixed(3)} L2=${L2.toFixed(3)} L3=${L3.toFixed(3)} SH_Y=${SHOULDER_Y.toFixed(3)}`);
// 
//       onReady({
//         group: root,
//         turret,
//         shoulder,
//         upperArm: shoulder,           // alias — no separate upperArm in this rig
//         elbow,
//         foreArm,
//         wrist,
//         gripper,
//         fork,
//         statusPL,
//         basePos: basePos.clone(),
//         runIK,
//         getJoints,
//         worldPos: () => {
//           const v = new THREE.Vector3();
//           fork.getWorldPosition(v);
//           return v;
//         },
//       });
//     },
//     (p: any) => {
//       if (p.total > 0) console.log('GLB loading:', Math.round(p.loaded / p.total * 100) + '%');
//     },
//     (err: any) => console.error('GLB FAILED:', err)
//   );
// }



function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

// ─── FIX 2: Helper to position waferAnchor properly above chuck surface ──────
function positionWaferAnchorAboveChuck(
  placeholder: THREE.Group,
  glbRoot: THREE.Object3D,
  extraClearance: number = 0.02  // Reduced from 0.05
): THREE.Object3D {
  glbRoot.updateWorldMatrix(true, true);

  // ── Step 1: Find the chuck (if it exists) and use ITS top as anchor reference ──
  let chuckTopY: number | null = null;
  const chuckGrp = placeholder.userData.waferChuck as THREE.Group | undefined;

  if (chuckGrp) {
    chuckGrp.updateWorldMatrix(true, true);
    const chuckBox = new THREE.Box3().setFromObject(chuckGrp);
    chuckTopY = chuckBox.max.y;
    console.log(`[ANCHOR] ${placeholder.userData.id}: using CHUCK top Y=${chuckTopY.toFixed(3)}`);
  }

  // ── Step 2: Fall back to GLB top if no chuck ──
  if (chuckTopY === null) {
    const box = new THREE.Box3().setFromObject(glbRoot);
    chuckTopY = box.max.y;
    console.log(`[ANCHOR] ${placeholder.userData.id}: using GLB top Y=${chuckTopY.toFixed(3)} (no chuck)`);
  }

  // ── Step 3: Wafer center sits at chuck top + half wafer thickness + minimal gap ──
  const WAFER_HALF_THICKNESS = 0.035;          // wafer is 0.07 thick
  const SEATING_GAP = 0.001;                    // 1mm gap (reduced from 2mm)
  const anchorWorldY = chuckTopY + WAFER_HALF_THICKNESS + SEATING_GAP + extraClearance;

  // ── Step 4: Convert world Y to local Y relative to placeholder ──
  const placeholderWorldPos = new THREE.Vector3();
  placeholder.getWorldPosition(placeholderWorldPos);
  const anchorLocalY = anchorWorldY - placeholderWorldPos.y;

  // ── Step 5: Replace existing anchor ──
  const existing = placeholder.userData.waferAnchor as THREE.Object3D | undefined;
  if (existing) {
    placeholder.remove(existing);
  }

  const waferAnchor = new THREE.Group();
  waferAnchor.name = "ModuleWaferAnchor";
  waferAnchor.position.set(0, anchorLocalY, 0);
  placeholder.add(waferAnchor);
  placeholder.userData.waferAnchor = waferAnchor;
  placeholder.userData.chuckTopY = chuckTopY;

  console.log(
    `[ANCHOR] ${placeholder.userData.id}: wafer sits at world Y=${anchorWorldY.toFixed(3)} (local=${anchorLocalY.toFixed(3)})`
  );
  return waferAnchor;
}

// ===== GLB-REMOVED (buildDehydrationGLB - /dehydration.glb (dead)) - re-wire the new module here. See GLB_WIRING_CONTRACT.md =====
// function buildDehydrationGLB(
//   scene: THREE.Scene,
//   mod: ProcessStep,
//   onReady?: (group: THREE.Group) => void
// ): THREE.Group {
//   const placeholder = new THREE.Group();
//   placeholder.position.set(mod.x, 0, mod.z);
//   placeholder.userData.id = mod.id;
//   scene.add(placeholder);
// 
// (async () => { const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js'); const loader = new GLTFLoader();
//   loader.load(
//     '/dehydration.glb',
//     (gltf: any) => {
//       const root = gltf.scene as THREE.Group;
// 
//       const tempBox = new THREE.Box3().setFromObject(root);
//       const size = new THREE.Vector3();
//       tempBox.getSize(size);
// 
//       const targetW = 6;
//       const currentMax = Math.max(size.x, size.z);
//       const scale = targetW / currentMax;
//       root.scale.setScalar(scale);
// 
//       const box = new THREE.Box3().setFromObject(root);
//       root.position.y = PLINTH_TOP_Y - box.min.y;
// 
//       const namedParts: Record<string, THREE.Object3D> = {};
//       root.traverse((obj) => {
//         namedParts[obj.name] = obj;
//         if ((obj as THREE.Mesh).isMesh) {
//           obj.castShadow = true;
//           obj.receiveShadow = true;
//         }
//       });
// 
//       const hotPlate =
//         namedParts['HotPlate'] ||
//         namedParts['Hot_Plate'] ||
//         namedParts['Plate'] ||
//         namedParts['Heater'] ||
//         namedParts['Top'];
// 
//       const lightGreen =
//         namedParts['LightGreen'] || namedParts['Light_Green'] || namedParts['LED_Green'];
//       const lightRed =
//         namedParts['LightRed'] || namedParts['Light_Red'] || namedParts['LED_Red'];
// 
//       const colorScheme: Record<string, { base: number; emissive: number; light: number; pl: number }> = {
//         dehy: { base: 0x4a2a15, emissive: 0xff6622, light: 0xff6622, pl: 0xff5500 },
//         pab: { base: 0x5a1505, emissive: 0xff3322, light: 0xff2233, pl: 0xff2200 },
//         hardbake: { base: 0x4a1808, emissive: 0xff4422, light: 0xff3300, pl: 0xff3300 },
//       };
//       const scheme = colorScheme[mod.id] ?? colorScheme.dehy;
// 
//       if (hotPlate && (hotPlate as THREE.Mesh).isMesh) {
//         const heatMat = new THREE.MeshStandardMaterial({
//           color: scheme.base,
//           emissive: scheme.emissive,
//           emissiveIntensity: 1.8,
//           roughness: 0.45,
//           metalness: 0.5,
//         });
//         (hotPlate as THREE.Mesh).material = heatMat;
//         placeholder.userData.heatMaterial = heatMat;
//         placeholder.userData.colorScheme = scheme;
//       }
// 
//       if (lightGreen && (lightGreen as THREE.Mesh).isMesh) {
//         const greenMat = new THREE.MeshStandardMaterial({
//           color: 0x002200, emissive: 0x00ff44, emissiveIntensity: 4.0, roughness: 0.4,
//         });
//         (lightGreen as THREE.Mesh).material = greenMat;
//         placeholder.userData.greenLight = greenMat;
//       }
// 
//       if (lightRed && (lightRed as THREE.Mesh).isMesh) {
//         const redMat = new THREE.MeshStandardMaterial({
//           color: 0x220000, emissive: 0xff0033, emissiveIntensity: 1.0, roughness: 0.4,
//         });
//         (lightRed as THREE.Mesh).material = redMat;
//         placeholder.userData.redLight = redMat;
//       }
// 
//       const pl = new THREE.PointLight(0xff5500, 0, 6);
//       pl.position.set(0, 1.2, 0);
//       root.add(pl);
//       placeholder.userData.processLight = pl;
// 
//       placeholder.add(root);
//       placeholder.userData.glbRoot = root;
//       placeholder.userData.loaded = true;
// 
//       addModuleLabel(placeholder, mod);
//       // ── ADD VISIBLE HOT PLATE CHUCK (force on top of GLB body) ──
//       // Chuck is already positioned correctly by addWaferChuck - no override needed
//       positionWaferAnchorAboveChuck(placeholder, root);
// 
//       if (onReady) onReady(placeholder);
//     },
//     undefined,
//     (err: any) => {
//       console.error('Dehydration GLB failed to load:', err);
//     }
//   );
// })();
// 
//   return placeholder;
// }



// ===== GLB-REMOVED (buildHardBakeGLB - /hardbakeglb.glb (dead)) - re-wire the new module here. See GLB_WIRING_CONTRACT.md =====
// function buildHardBakeGLB(
//   scene: THREE.Scene,
//   mod: ProcessStep,
//   onReady?: (group: THREE.Group) => void
// ): THREE.Group {
//   const placeholder = new THREE.Group();
//   placeholder.position.set(mod.x, 0, mod.z);
//   placeholder.userData.id = mod.id;
//   scene.add(placeholder);
// 
// (async () => { const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js'); const loader = new GLTFLoader();
//   loader.load(
//   '/hardbakeglb.glb',
//   (gltf: any) => {
//     const root = gltf.scene as THREE.Group;
// 
//     // ── NEW: rotate the model to align with the plinth before measuring/centering ──
//     root.rotation.y = Math.PI;   // try Math.PI/2, -Math.PI/2, or Math.PI — see which squares it up
// 
//     const tempBox = new THREE.Box3().setFromObject(root);
//     const size = new THREE.Vector3();
//     tempBox.getSize(size);
// 
//     const targetW = 4;
//     const currentMax = Math.max(size.x, size.z);
//     const scale = targetW / currentMax;
//     root.scale.setScalar(scale);
// 
//     const box = new THREE.Box3().setFromObject(root);
//     root.position.y = PLINTH_TOP_Y - box.min.y;
//     const afterBox = new THREE.Box3().setFromObject(root);
// const afterCenter = new THREE.Vector3();
// afterBox.getCenter(afterCenter);
// root.position.x -= afterCenter.x;
// root.position.z -= afterCenter.z;   // ← ADD THIS LINE (was previously skipped)
// 
//       // ── NEW: record real half-depth so nameplates can sit flush against this GLB's actual front face ──
//       const finalBox = new THREE.Box3().setFromObject(root);
//       placeholder.userData.halfDepth = (finalBox.max.z - finalBox.min.z) / 2;
// 
//       const namedParts: Record<string, THREE.Object3D> = {};
//       root.traverse((obj) => {
//         namedParts[obj.name] = obj;
//         if ((obj as THREE.Mesh).isMesh) {
//           obj.castShadow = true;
//           obj.receiveShadow = true;
//         }
//       });
// 
//       const hotPlate =
//         namedParts['HotPlate'] || namedParts['Hot_Plate'] ||
//         namedParts['Plate'] || namedParts['Heater'] || namedParts['Top'];
// 
//       const lightGreen =
//         namedParts['LightGreen'] || namedParts['Light_Green'] || namedParts['LED_Green'];
//       const lightRed =
//         namedParts['LightRed'] || namedParts['Light_Red'] || namedParts['LED_Red'];
// 
//       const scheme = { base: 0x4a1808, emissive: 0xff4422, light: 0xff3300, pl: 0xff3300 };
// 
//       if (hotPlate && (hotPlate as THREE.Mesh).isMesh) {
//         const heatMat = new THREE.MeshStandardMaterial({
//           color: scheme.base,
//           emissive: scheme.emissive,
//           emissiveIntensity: 2.2,
//           roughness: 0.45,
//           metalness: 0.5,
//         });
//         (hotPlate as THREE.Mesh).material = heatMat;
//         placeholder.userData.heatMaterial = heatMat;
//         placeholder.userData.colorScheme = scheme;
//       }
// 
//       if (lightGreen && (lightGreen as THREE.Mesh).isMesh) {
//         const greenMat = new THREE.MeshStandardMaterial({
//           color: 0x002200, emissive: 0x00ff44, emissiveIntensity: 4.0, roughness: 0.4,
//         });
//         (lightGreen as THREE.Mesh).material = greenMat;
//         placeholder.userData.greenLight = greenMat;
//       }
// 
//       if (lightRed && (lightRed as THREE.Mesh).isMesh) {
//         const redMat = new THREE.MeshStandardMaterial({
//           color: 0x220000, emissive: 0xff0033, emissiveIntensity: 1.0, roughness: 0.4,
//         });
//         (lightRed as THREE.Mesh).material = redMat;
//         placeholder.userData.redLight = redMat;
//       }
// 
//       const pl = new THREE.PointLight(scheme.pl, 0, 7);
//       pl.position.set(0, 1.2, 0);
//       root.add(pl);
//       placeholder.userData.processLight = pl;
// 
//       placeholder.add(root);
//       placeholder.userData.glbRoot = root;
//       placeholder.userData.loaded = true;
// 
//       addModuleLabel(placeholder, mod);
// 
//       // ── NO chuck added here — the GLB already has its own hotplate surface
//       // ── Just set the wafer anchor so robot knows where to place the wafer
//       positionWaferAnchorAboveChuck(placeholder, root);
// 
//       if (onReady) onReady(placeholder);
//     },
//     undefined,
//     (err: any) => console.error('HardBake GLB failed to load:', err)
//   );})();
// 
//   return placeholder;
// }





// ===== GLB-REMOVED (buildPrCoatGLB - /PRCoat.glb (dead)) - re-wire the new module here. See GLB_WIRING_CONTRACT.md =====
// function buildPrCoatGLB(
//   scene: THREE.Scene,
//   mod: ProcessStep,
//   onReady?: (group: THREE.Group) => void
// ): THREE.Group {
//   const placeholder = new THREE.Group();
//   placeholder.position.set(mod.x, 0, mod.z);
//   placeholder.userData.id = mod.id;
//   scene.add(placeholder);
// 
//   const loader = new GLTFLoader();
//   loader.load(
//     '/PRCoat.glb',
//     (gltf: any) => {
//       const root = gltf.scene as THREE.Group;
// 
//       const tempBox = new THREE.Box3().setFromObject(root);
//       const size = new THREE.Vector3();
//       tempBox.getSize(size);
// 
//       const targetW = 3;
//       const currentMax = Math.max(size.x, size.z);
//       const scale = targetW / currentMax;
//       root.scale.setScalar(scale);
// 
//       const box = new THREE.Box3().setFromObject(root);
//       root.position.y = PLINTH_TOP_Y - box.min.y;
// 
//       const namedParts: Record<string, THREE.Object3D> = {};
//       root.traverse((obj) => {
//         namedParts[obj.name] = obj;
//         if ((obj as THREE.Mesh).isMesh) {
//           obj.castShadow = true;
//           obj.receiveShadow = true;
//         }
//       });
// 
//       const spinChuck =
//         namedParts['SpinChuck'] || namedParts['Spin_Chuck'] ||
//         namedParts['Chuck'] || namedParts['Spinner'] ||
//         namedParts['HotPlate'] || namedParts['Plate'] ||
//         namedParts['Top'];
// 
//       const dispenseArm =
//         namedParts['DispenseArm'] || namedParts['Dispense_Arm'] ||
//         namedParts['Arm'] || namedParts['NozzleArm'];
// 
//       const lightGreen =
//         namedParts['LightGreen'] || namedParts['Light_Green'] || namedParts['LED_Green'];
//       const lightRed =
//         namedParts['LightRed'] || namedParts['Light_Red'] || namedParts['LED_Red'];
// 
//       const scheme = { base: 0x180a28, emissive: 0xcc00ff, light: 0xee44ff, pl: 0xcc00ff };
// 
//       if (spinChuck && (spinChuck as THREE.Mesh).isMesh) {
//         const chuckMat = new THREE.MeshStandardMaterial({
//           color: 0x445566,
//           emissive: scheme.emissive,
//           emissiveIntensity: 0.3,
//           roughness: 0.15,
//           metalness: 0.92,
//         });
//         (spinChuck as THREE.Mesh).material = chuckMat;
//         placeholder.userData.chuckMaterial = chuckMat;
//         placeholder.userData.spinChuck = spinChuck;
//         placeholder.userData.colorScheme = scheme;
//       }
// 
//       if (dispenseArm) {
//         placeholder.userData.dispenseArm = dispenseArm;
//         placeholder.userData.armRestY = (dispenseArm as THREE.Object3D).rotation.y;
//       }
// 
//       if (lightGreen && (lightGreen as THREE.Mesh).isMesh) {
//         const greenMat = new THREE.MeshStandardMaterial({
//           color: 0x002200, emissive: 0x00ff44, emissiveIntensity: 4.0, roughness: 0.4,
//         });
//         (lightGreen as THREE.Mesh).material = greenMat;
//         placeholder.userData.greenLight = greenMat;
//       }
// 
//       if (lightRed && (lightRed as THREE.Mesh).isMesh) {
//         const redMat = new THREE.MeshStandardMaterial({
//           color: 0x220000, emissive: 0xff0033, emissiveIntensity: 1.0, roughness: 0.4,
//         });
//         (lightRed as THREE.Mesh).material = redMat;
//         placeholder.userData.redLight = redMat;
//       }
// 
//       const pl = new THREE.PointLight(scheme.pl, 0, 7);
//       pl.position.set(0, 1.2, 0);
//       root.add(pl);
//       placeholder.userData.processLight = pl;
// 
//       placeholder.add(root);
//       placeholder.userData.glbRoot = root;
//       placeholder.userData.loaded = true;
// 
//       addModuleLabel(placeholder, mod);
//       // ── ADD VISIBLE HOT PLATE CHUCK (HMDS warm chamber) ──
//       addWaferChuck(placeholder, 'hotplate');
//       positionWaferAnchorAboveChuck(placeholder, root);
// 
//       if (onReady) onReady(placeholder);
//     },
//     undefined,
//     (err: any) => console.error('PR Coat GLB failed to load:', err)
//   );
// 
//   return placeholder;
// }


// ===== GLB-REMOVED (buildScannerGLB - /scaner.glb (dead)) - re-wire the new module here. See GLB_WIRING_CONTRACT.md =====
// function buildScannerGLB(
//   scene: THREE.Scene,
//   mod: ProcessStep,
//   onReady?: (group: THREE.Group) => void
// ): THREE.Group {
//   const placeholder = new THREE.Group();
//   placeholder.position.set(mod.x, 0, mod.z);
//   placeholder.userData.id = mod.id;
//   scene.add(placeholder);
// 
//   const loader = new GLTFLoader();
//   loader.load(
//     '/scaner.glb',
//     (gltf: any) => {
//       const root = gltf.scene as THREE.Group;
// 
//       const tempBox = new THREE.Box3().setFromObject(root);
//       const size = new THREE.Vector3();
//       tempBox.getSize(size);
// 
//       // Scanner is bigger — target 4.1 wide to match procedural housing
//       const targetW = 12;
//       const currentMax = Math.max(size.x, size.z);
//       const scale = targetW / currentMax;
//       root.scale.setScalar(scale);
// 
//       const box = new THREE.Box3().setFromObject(root);
//       const SCANNER_FLOOR_DROP = 1.5;   // ← increase to sink the scanner lower
//       root.position.y = 0 - box.min.y - SCANNER_FLOOR_DROP;
//       root.updateWorldMatrix(true, true);
//       const rootWorldBox = new THREE.Box3().setFromObject(root);
// 
//       // Compute front Z excluding Floor and Cassette_Body (which are hidden later)
//       const rootBoxFilter = new THREE.Box3();
//       let hasValidMesh = false;
//       root.traverse((obj) => {
//         if ((obj as THREE.Mesh).isMesh) {
//           const name = obj.name;
//           if (name !== 'Floor' && name !== 'Cassette_Body' && name !== 'Cube.001') {
//             rootBoxFilter.expandByObject(obj);
//             hasValidMesh = true;
//           }
//         }
//       });
//       const scannerFrontZ  = hasValidMesh ? rootBoxFilter.max.z : rootWorldBox.max.z;
//       const scannerBackZ   = hasValidMesh ? rootBoxFilter.min.z : rootWorldBox.min.z;
//       const scannerCenterZ = (scannerFrontZ + scannerBackZ) / 2;
// 
//       // ════════════════════════════════════════════════════════════════
//       // DIRECT SLOT POSITION OFFSETS (local Z, measured from body center)
//       // Body center is GUARANTEED inside the scanner. Add a small +/- to
//       // slide the wafer toward whichever face is the opening.
//       //   • Wafer too far FORWARD / poking out → make SCANNER_SLOT_OFFSET
//       //     MORE NEGATIVE (e.g. -1, -2) to pull it back into the body.
//       //   • Wafer buried / want it nearer the opening → make it more positive.
//       // ════════════════════════════════════════════════════════════════
//       const SCANNER_SLOT_OFFSET   = -100.8;   // ← wafer rest depth from center
//       const SCANNER_PICKUP_OFFSET = 1.0;   // ← pickup point, relative to slot (toward opening)
// 
//       const scannerSlotZ   = scannerCenterZ + SCANNER_SLOT_OFFSET;
//       const scannerTunnelZ = scannerSlotZ + SCANNER_PICKUP_OFFSET * 0.5;
//       const scannerPickupZ = scannerSlotZ + SCANNER_PICKUP_OFFSET;
// 
//       console.log('[SCANNER] center=', scannerCenterZ.toFixed(2),
//         'slotZ=', scannerSlotZ.toFixed(2),
//         'depth=', (scannerFrontZ - scannerBackZ).toFixed(2));
// 
//       const namedParts: Record<string, THREE.Object3D> = {};
//       root.traverse((obj) => {
//         namedParts[obj.name] = obj;
//         if ((obj as THREE.Mesh).isMesh) {
//           obj.castShadow = false;
//           obj.receiveShadow = true;
//         }
//         if (obj.name.startsWith('Dot_6_2')) {
//           obj.visible = false;
//         }
//       });
// 
//       console.log('ALL Scanner GLB nodes:', Object.keys(namedParts));
//       console.log('[SCANNER] frontZ=', scannerFrontZ.toFixed(3), 'pickupZ=', scannerPickupZ.toFixed(3), 'slotZ=', scannerSlotZ.toFixed(3));
// 
//       // ── HIDE BACKSIDE PLATES + floating top panels ──
//       [
//         'Vent_Panel', 'Base_Louvre_0', 'Base_Louvre_1', 'Base_Louvre_2', 'Base_Louvre_3', 'Base_Louvre_4',
//         'Top', 'Top_Panel', 'TopPanel', 'Top_Cover', 'TopCover', 'Lid', 'Cover',
//         'Top_Plate', 'TopPlate', 'Roof', 'Hood', 'Cap', 'Upper_Panel', 'UpperPanel',
//         'Top_Housing', 'TopHousing', 'Top_Shell', 'TopShell',
//         'Stage_Slab', 'Cassette_Body', 'Cube.001', 'Floor',
//         'Btn_0', 'Btn_1', 'Handle_-0.28', 'Handle_0.28',
//         // Hide back-side slot elements
//         'BackSlot', 'Back_Slot', 'RearSlot', 'Rear_Slot', 'SlotBack', 'Slot_Back',
//         'BackOpening', 'Back_Opening', 'RearOpening', 'Rear_Opening',
//       ].forEach((name) => {
//         if (namedParts[name]) namedParts[name].visible = false;
//       });
// 
//       // Also hide any slot-like geometry on the back (-Z side)
//       root.traverse((obj) => {
//         if (!(obj as THREE.Mesh).isMesh) return;
//         const mesh = obj as THREE.Mesh;
//         const name = obj.name.toLowerCase();
// 
//         // Hide any object with "slot", "opening", "port" in its name that isn't the main one
//         if ((name.includes('slot') || name.includes('opening') || name.includes('port')) &&
//           !name.includes('anchor')) {
//           const worldPos = new THREE.Vector3();
//           mesh.getWorldPosition(worldPos);
// 
//           // If it's on the back (-Z) side relative to the scanner front, hide it
//           if (worldPos.z < scannerFrontZ - 5) {
//             mesh.visible = false;
//           }
//         }
//       });
// 
//       // Also hide any mesh that is very flat (thin in Y) and positioned high — catches unnamed floating plates
//       root.traverse((obj) => {
//         if (!(obj as THREE.Mesh).isMesh) return;
//         const mesh = obj as THREE.Mesh;
//         const geo = mesh.geometry;
//         if (!geo.boundingBox) geo.computeBoundingBox();
//         const bb = geo.boundingBox!;
//         const worldPos = new THREE.Vector3();
//         mesh.getWorldPosition(worldPos);
//         const sizeY = (bb.max.y - bb.min.y) * mesh.getWorldScale(new THREE.Vector3()).y;
//         const sizeX = (bb.max.x - bb.min.x) * mesh.getWorldScale(new THREE.Vector3()).x;
//         const sizeZ = (bb.max.z - bb.min.z) * mesh.getWorldScale(new THREE.Vector3()).z;
//         // A "floating plate": very thin in Y, wide in X and Z, positioned above y=3
//         if (sizeY < 0.5 && sizeX > 3 && sizeZ > 3 && worldPos.y > 3) {
//           mesh.visible = false;
//         }
//       });
// 
//       // Try to find UV lens / beam emitter (NOT 'Top' — that's the cover panel)
//       const lens =
//         namedParts['Lens'] || namedParts['UVLens'] || namedParts['Beam'] ||
//         namedParts['Emitter'];
// 
//       // Indicator lights
//       const lightGreen =
//         namedParts['LightGreen'] || namedParts['Light_Green'] || namedParts['LED_Green'];
//       const lightRed =
//         namedParts['LightRed'] || namedParts['Light_Red'] || namedParts['LED_Red'];
// 
//       // Magenta/UV scheme for scanner
//       // Line ~45
//       const scheme = { base: 0x1a1400, emissive: 0xffcc00, light: 0xffdd00, pl: 0xffaa00 };
// 
//       if (lens && (lens as THREE.Mesh).isMesh) {
//         const lensMat = new THREE.MeshStandardMaterial({
//           color: scheme.base,
//           emissive: scheme.emissive,
//           emissiveIntensity: 2.5,
//           roughness: 0.05,
//           metalness: 0.7,
//         });
//         (lens as THREE.Mesh).material = lensMat;
//         placeholder.userData.lensMaterial = lensMat;
//         placeholder.userData.colorScheme = scheme;
//       }
// 
//       if (lightGreen && (lightGreen as THREE.Mesh).isMesh) {
//         const greenMat = new THREE.MeshStandardMaterial({
//           color: 0x002200, emissive: 0x00ff44, emissiveIntensity: 4.0, roughness: 0.4,
//         });
//         (lightGreen as THREE.Mesh).material = greenMat;
//         placeholder.userData.greenLight = greenMat;
//       }
// 
//       if (lightRed && (lightRed as THREE.Mesh).isMesh) {
//         const redMat = new THREE.MeshStandardMaterial({
//           color: 0x220000, emissive: 0xff0033, emissiveIntensity: 1.0, roughness: 0.4,
//         });
//         (lightRed as THREE.Mesh).material = redMat;
//         placeholder.userData.redLight = redMat;
//       }
// 
//       // UV beam cone (synthetic — placed even if GLB has no beam mesh)
//       const beam = new THREE.Mesh(
//         new THREE.CylinderGeometry(0.06, 0.32, 2.2, 20, 1, true),
//         new THREE.MeshStandardMaterial({
//           color: 0xffcc00, emissive: 0xffaa00, emissiveIntensity: 2.2,
//           transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false,
//         })
//       );
//       beam.position.set(0, 1.1, 0);
//       root.add(beam);
//       placeholder.userData.uvBeam = beam;
// 
//       // Explicit scanner port pickup point (front opening / interface).
//       const scannerPickupAnchor = new THREE.Group();
//       scannerPickupAnchor.name = "ScannerPickupPoint";
//       scannerPickupAnchor.position.set(0, WAFER_TRANSFER_Y, scannerPickupZ);
//       placeholder.add(scannerPickupAnchor);
//       placeholder.userData.pickupAnchor = scannerPickupAnchor;
// 
//       const pl = new THREE.PointLight(scheme.pl, 0, 10);
//       pl.position.set(0, 2.0, 0);
//       root.add(pl);
//       placeholder.userData.processLight = pl;
// 
//       //   placeholder.add(root);
//       //   placeholder.userData.glbRoot = root;
//       //   placeholder.userData.loaded = true;
// 
// 
//       // ── RECTANGULAR WAFER SLOT on front face of scanner ──
//       const SLOT_W = 1.8;   // ← width of slot opening
//       const SLOT_H = 0.25;  // ← height of slot opening  
//       const SLOT_D = 0;   // ← depth of slot tunnel
// 
//       // Slot tunnel (dark interior — gives depth illusion)
//       const slotTunnel = new THREE.Mesh(
//         new THREE.BoxGeometry(SLOT_W, SLOT_H, SLOT_D),
//         new THREE.MeshStandardMaterial({
//           color: 0x050508,
//           roughness: 0.9,
//           metalness: 0.1,
//           emissive: 0x000510,
//           emissiveIntensity: 0.5,
//         })
//       );
//       slotTunnel.position.set(0, WAFER_TRANSFER_Y, scannerTunnelZ);
//       placeholder.add(slotTunnel);
// 
//       // Slot frame — metallic border around opening
//       const slotFrameMat = new THREE.MeshStandardMaterial({
//         color: 0x778899,
//         roughness: 0.15,
//         metalness: 0.95,
//         emissive: 0xffcc00,
//         emissiveIntensity: 0.15,
//       });
// 
//       // Top border
//       const slotTop = new THREE.Mesh(
//         new THREE.BoxGeometry(SLOT_W + 0.15, 0.06, 0.06),
//         slotFrameMat
//       );
//       slotTop.position.set(0, WAFER_TRANSFER_Y + SLOT_H / 2 + 0.03, scannerSlotZ);
//       placeholder.add(slotTop);
// 
//       // Bottom border
//       const slotBot = new THREE.Mesh(
//         new THREE.BoxGeometry(SLOT_W + 0.15, 0.06, 0.06),
//         slotFrameMat.clone()
//       );
//       slotBot.position.set(0, WAFER_TRANSFER_Y - SLOT_H / 2 - 0.03, scannerSlotZ);
//       placeholder.add(slotBot);
// 
//       // Left border
//       const slotLeft = new THREE.Mesh(
//         new THREE.BoxGeometry(0.06, SLOT_H + 0.12, 0.06),
//         slotFrameMat.clone()
//       );
//       slotLeft.position.set(-SLOT_W / 2 - 0.03, WAFER_TRANSFER_Y, scannerSlotZ);
//       placeholder.add(slotLeft);
// 
//       // Right border
//       const slotRight = new THREE.Mesh(
//         new THREE.BoxGeometry(0.06, SLOT_H + 0.12, 0.06),
//         slotFrameMat.clone()
//       );
//       slotRight.position.set(SLOT_W / 2 + 0.03, WAFER_TRANSFER_Y, scannerSlotZ);
//       placeholder.add(slotRight);
// 
//       // Slot glow strip inside (yellow indicator light)
//       const slotGlow = new THREE.Mesh(
//         new THREE.BoxGeometry(SLOT_W - 0.1, 0.02, 0.02),
//         new THREE.MeshStandardMaterial({
//           color: 0xffcc00,
//           emissive: 0xffcc00,
//           emissiveIntensity: 3.0,
//           roughness: 0.3,
//         })
//       );
//       slotGlow.position.set(0, WAFER_TRANSFER_Y - SLOT_H / 2 + 0.02, scannerSlotZ);
//       placeholder.add(slotGlow);
//       placeholder.userData.slotGlow = slotGlow;
// 
//       // Sensor dots on each side of slot
//       const sensorMat = new THREE.MeshStandardMaterial({
//         color: 0x00ff88,
//         emissive: 0x00ff88,
//         emissiveIntensity: 4.0,
//         roughness: 0.3,
//       });
//       [-SLOT_W / 2 - 0.15, SLOT_W / 2 + 0.15].forEach((sx) => {
//         const sensor = new THREE.Mesh(
//           new THREE.SphereGeometry(0.04, 8, 8),
//           sensorMat.clone()
//         );
//         sensor.position.set(sx, WAFER_TRANSFER_Y, scannerSlotZ);
//         placeholder.add(sensor);
//       });
// 
//       // ── WAFER PICKUP ANCHOR inside the slot — Y matches global transfer height ──
//       const scannerSlotAnchor = new THREE.Group();
//       scannerSlotAnchor.name = "ScannerSlotAnchor";
//       scannerSlotAnchor.position.set(0, WAFER_TRANSFER_Y, scannerSlotZ);
//       placeholder.add(scannerSlotAnchor);
//       placeholder.userData.slotAnchor = scannerSlotAnchor;
// 
//       placeholder.add(root);
//       placeholder.userData.glbRoot = root;
//       placeholder.userData.loaded = true;
//       // Update keep-out box once the GLB is present (prevents TCP entering scanner).
//       placeholder.userData._bbox = new THREE.Box3().setFromObject(placeholder).expandByScalar(0.15);
// 
//       // Wafer anchor at the computed slot position (nameplate added below).
//       const scannerWaferAnchor = new THREE.Group();
//       scannerWaferAnchor.name = "ModuleWaferAnchor";
//       scannerWaferAnchor.position.set(0, WAFER_TRANSFER_Y, scannerSlotZ);
//       placeholder.add(scannerWaferAnchor);
//       placeholder.userData.waferAnchor = scannerWaferAnchor;
// 
//       // ── Scanner front-face nameplate (parented to placeholder in local space) ──
//       (() => {
//         const CW = 1024, CH = 300;
//         const nc = document.createElement('canvas');
//         nc.width = CW; nc.height = CH;
//         const ctx = nc.getContext('2d')!;
// 
//         const metalGrad = ctx.createLinearGradient(0, 0, 0, CH);
//         metalGrad.addColorStop(0, '#dde2e8');
//         metalGrad.addColorStop(0.12, '#f0f4f7');
//         metalGrad.addColorStop(0.45, '#c8ced4');
//         metalGrad.addColorStop(0.88, '#e4e8ec');
//         metalGrad.addColorStop(1, '#adb4bc');
//         ctx.fillStyle = metalGrad;
//         ctx.fillRect(0, 0, CW, CH);
// 
//         ctx.globalAlpha = 0.045;
//         ctx.strokeStyle = '#ffffff';
//         ctx.lineWidth = 1;
//         for (let y = 2; y < CH; y += 3) {
//           ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke();
//         }
//         ctx.globalAlpha = 1;
// 
//         // Bevels
//         ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CW, 7); ctx.fillRect(0, 0, 7, CH);
//         ctx.fillStyle = '#555c64'; ctx.fillRect(0, CH - 7, CW, 7); ctx.fillRect(CW - 7, 0, 7, CH);
// 
//         const innerGrad = ctx.createLinearGradient(0, 12, 0, CH - 12);
//         innerGrad.addColorStop(0, '#b0b8c0');
//         innerGrad.addColorStop(0.25, '#d0d8de');
//         innerGrad.addColorStop(0.75, '#c8d0d6');
//         innerGrad.addColorStop(1, '#a0a8b0');
//         ctx.fillStyle = innerGrad;
//         ctx.fillRect(11, 11, CW - 22, CH - 22);
// 
//         // Color accent stripe (scanner is magenta/ee00cc)
//         ctx.fillStyle = `rgb(238,0,204)`;
//         ctx.fillRect(11, 11, 14, CH - 22);
//         ctx.fillStyle = 'rgba(255,255,255,0.5)';
//         ctx.fillRect(11, 11, 5, CH - 22);
// 
//         // Short code
//         ctx.font = "bold 120px 'Arial Black', Arial, sans-serif";
//         ctx.textAlign = 'left';
//         ctx.textBaseline = 'alphabetic';
//         ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillText('SCAN', 48, 168);
//         ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.fillText('SCAN', 46, 166);
//         ctx.fillStyle = '#1a2028'; ctx.fillText('SCAN', 47, 167);
// 
//         // Full name
//         ctx.font = "bold 44px Arial, sans-serif";
//         ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillText('Scanner 193nm Exposure', 48, 234);
//         ctx.fillStyle = '#1a2030'; ctx.fillText('Scanner 193nm Exposure', 47, 233);
// 
//         // Rivets
//         const drawRivet = (rx: number, ry: number) => {
//           ctx.fillStyle = 'rgba(0,0,0,0.3)';
//           ctx.beginPath(); ctx.arc(rx + 2, ry + 2, 10, 0, Math.PI * 2); ctx.fill();
//           const rg = ctx.createRadialGradient(rx - 3, ry - 3, 0, rx, ry, 10);
//           rg.addColorStop(0, '#eef2f6'); rg.addColorStop(0.4, '#a8b0b8'); rg.addColorStop(1, '#707880');
//           ctx.fillStyle = rg;
//           ctx.beginPath(); ctx.arc(rx, ry, 10, 0, Math.PI * 2); ctx.fill();
//         };
//         drawRivet(28, 28); drawRivet(CW - 28, 28); drawRivet(28, CH - 28); drawRivet(CW - 28, CH - 28);
// 
//         const tex = new THREE.CanvasTexture(nc);
//         tex.minFilter = THREE.LinearFilter;
//         tex.magFilter = THREE.LinearFilter;
//         tex.anisotropy = 8;
// 
//         const plate = new THREE.Mesh(
//           new THREE.PlaneGeometry(2.8, 1.25),
//           new THREE.MeshBasicMaterial({
//             map: tex, transparent: false,
//             depthTest: true, depthWrite: true,
//             side: THREE.DoubleSide,
//             polygonOffset: true,
//             polygonOffsetFactor: -2,
//             polygonOffsetUnits: -2,
//           })
//         );
// 
//         // ── -X face: flush on hull, centered on visible body (exclude hidden floor/cassette) ──
//         root.updateWorldMatrix(true, true);
//         const bodyBox = new THREE.Box3();
//         let hasBodyBox = false;
//         root.traverse((obj) => {
//           if (!(obj as THREE.Mesh).isMesh || !obj.visible) return;
//           const n = obj.name;
//           if (n === 'Floor' || n === 'Cassette_Body' || n === 'Cube.001') return;
//           bodyBox.expandByObject(obj);
//           hasBodyBox = true;
//         });
//         const bounds = hasBodyBox ? bodyBox : new THREE.Box3().setFromObject(root);
//         const px = placeholder.position.x;
//         const py = placeholder.position.y;
//         const pz = placeholder.position.z;
//         const localMinX = bounds.min.x - px;
//         const localMinY = bounds.min.y - py;
//         const localMaxY = bounds.max.y - py;
//         const localMinZ = bounds.min.z - pz;
//         const localMaxZ = bounds.max.z - pz;
//         const PLATE_FLUSH = 0.04;
//         const PLATE_X = localMinX - PLATE_FLUSH;
//         const PLATE_Y = (localMinY + localMaxY) * 0.5;
//         const PLATE_Z = (localMinZ + localMaxZ) * 0.5;
//         plate.position.set(PLATE_X, PLATE_Y, PLATE_Z);
//         plate.rotation.set(0, -Math.PI / 2, 0);
//         plate.renderOrder = 100;
//         placeholder.add(plate);
// 
//         console.log('[SCANNER NAMEPLATE] faceX=', PLATE_X.toFixed(2),
//           'centerY=', PLATE_Y.toFixed(2), 'centerZ=', PLATE_Z.toFixed(2));
//       })();
// 
//       if (onReady) onReady(placeholder);
//     },
//     undefined,
//     (err: any) => console.error('Scanner GLB failed:', err)
//   );
// 
//   return placeholder;
// }




// ===== GLB-REMOVED (buildChillPlateGLB - /Chill_plate.glb (dead)) - re-wire the new module here. See GLB_WIRING_CONTRACT.md =====
// function buildChillPlateGLB(
//   scene: THREE.Scene,
//   mod: ProcessStep,
//   onReady?: (group: THREE.Group) => void
// ): THREE.Group {
//   const placeholder = new THREE.Group();
//   placeholder.position.set(mod.x, 0, mod.z);
//   placeholder.userData.id = mod.id;
//   scene.add(placeholder);
// 
//   const loader = new GLTFLoader();
//   loader.load(
//     '/Chill_plate.glb',
//     (gltf: any) => {
//       const root = gltf.scene as THREE.Group;
// 
//       const tempBox = new THREE.Box3().setFromObject(root);
//       const size = new THREE.Vector3();
//       tempBox.getSize(size);
// 
//       const targetW = 6.0;
//       const currentMax = Math.max(size.x, size.z);
//       const scale = targetW / currentMax;
//       root.scale.setScalar(scale);
// 
//       const box = new THREE.Box3().setFromObject(root);
//       root.position.y = PLINTH_TOP_Y - box.min.y;
// 
//       const namedParts: Record<string, THREE.Object3D> = {};
//       root.traverse((obj) => {
//         namedParts[obj.name] = obj;
//         if ((obj as THREE.Mesh).isMesh) {
//           obj.castShadow = true;
//           obj.receiveShadow = true;
//         }
//       });
// 
//       console.log(`Chill plate GLB (${mod.id}) nodes:`, Object.keys(namedParts).slice(0, 30));
// 
//       // Try to find the cold plate surface
//       const plate =
//         namedParts['ChillPlate'] || namedParts['Chill_Plate'] ||
//         namedParts['ColdPlate'] || namedParts['Plate'] || namedParts['Top'];
// 
//       // Cooling fins (optional)
//       const fins =
//         namedParts['Fins'] || namedParts['CoolFins'] || namedParts['Cooler'];
// 
//       const lightGreen =
//         namedParts['LightGreen'] || namedParts['Light_Green'] || namedParts['LED_Green'];
//       const lightRed =
//         namedParts['LightRed'] || namedParts['Light_Red'] || namedParts['LED_Red'];
// 
//       // Cold blue scheme
//       const scheme = { base: 0x030d1c, emissive: 0x0099ff, light: 0x00ccff, pl: 0x00aaff };
// 
//       if (plate && (plate as THREE.Mesh).isMesh) {
//         const plateMat = new THREE.MeshStandardMaterial({
//           color: 0x0a1828,
//           emissive: scheme.emissive,
//           emissiveIntensity: 0.6,
//           roughness: 0.18,
//           metalness: 0.92,
//         });
//         (plate as THREE.Mesh).material = plateMat;
//         placeholder.userData.plateMaterial = plateMat;
//         placeholder.userData.colorScheme = scheme;
//       }
// 
//       if (fins && (fins as THREE.Mesh).isMesh) {
//         const finMat = new THREE.MeshStandardMaterial({
//           color: 0x1c2e44, roughness: 0.16, metalness: 0.97,
//           emissive: 0x0055cc, emissiveIntensity: 0.6,
//         });
//         (fins as THREE.Mesh).material = finMat;
//         placeholder.userData.finMaterial = finMat;
//       }
// 
//       if (lightGreen && (lightGreen as THREE.Mesh).isMesh) {
//         const greenMat = new THREE.MeshStandardMaterial({
//           color: 0x002200, emissive: 0x00ff44, emissiveIntensity: 4.0, roughness: 0.4,
//         });
//         (lightGreen as THREE.Mesh).material = greenMat;
//         placeholder.userData.greenLight = greenMat;
//       }
// 
//       if (lightRed && (lightRed as THREE.Mesh).isMesh) {
//         const redMat = new THREE.MeshStandardMaterial({
//           color: 0x220000, emissive: 0xff0033, emissiveIntensity: 1.0, roughness: 0.4,
//         });
//         (lightRed as THREE.Mesh).material = redMat;
//         placeholder.userData.redLight = redMat;
//       }
// 
//       const pl = new THREE.PointLight(scheme.pl, 0, 6);
//       pl.position.set(0, 1.2, 0);
//       root.add(pl);
//       placeholder.userData.processLight = pl;
// 
//       placeholder.add(root);
//       placeholder.userData.glbRoot = root;
//       placeholder.userData.loaded = true;
// 
// 
//       addModuleLabel(placeholder, mod);
//       addWaferChuck(placeholder, 'chill');
// 
//       positionWaferAnchorAboveChuck(placeholder, root);
// 
//       if (onReady) onReady(placeholder);
//     },
//     undefined,
//     (err: any) => console.error(`Chill plate GLB (${mod.id}) failed:`, err)
//   );
// 
//   return placeholder;
// }


// function buildHMDSGLB(
//   scene: THREE.Scene,
//   mod: ProcessStep,
//   onReady?: (group: THREE.Group) => void
// ): THREE.Group {
//   const placeholder = new THREE.Group();
//   placeholder.position.set(mod.x, 0, mod.z);
//   placeholder.userData.id = mod.id;
//   scene.add(placeholder);

//   const loader = new GLTFLoader();
//   loader.load(
//     '/HMDS Vapour.glb',
//     (gltf: any) => {
//       const root = gltf.scene as THREE.Group;

//      const tempBox  = new THREE.Box3().setFromObject(root);
//       const size = new THREE.Vector3();
//       tempBox.getSize(size);

//       const targetW = 2.5;
//       const currentMax = Math.max(size.x, size.z);
//       const scale = targetW / currentMax;
//       root.scale.setScalar(scale);

//       const box = new THREE.Box3().setFromObject(root);
//       // Place GLB so its base aligns with module floor
//       root.position.y = MODULE_FLOOR_Y - box.min.y;

//       const namedParts: Record<string, THREE.Object3D> = {};
//       root.traverse((obj) => {
//         namedParts[obj.name] = obj;
//         if ((obj as THREE.Mesh).isMesh) {
//           obj.castShadow = true;
//           obj.receiveShadow = true;
//         }
//       });

//       const chamber =
//         namedParts['Chamber'] || namedParts['Vessel'] ||
//         namedParts['Body']    || namedParts['Top']    || namedParts['Plate'];

//       const lightGreen =
//         namedParts['LightGreen'] || namedParts['Light_Green'] || namedParts['LED_Green'];
//       const lightRed =
//         namedParts['LightRed'] || namedParts['Light_Red'] || namedParts['LED_Red'];

//       const scheme = { base: 0x1a0a00, emissive: 0xff8800, light: 0xffaa33, pl: 0xff7700 };

//       if (chamber && (chamber as THREE.Mesh).isMesh) {
//         const chamberMat = new THREE.MeshStandardMaterial({
//           color: scheme.base,
//           emissive: scheme.emissive,
//           emissiveIntensity: 0.6,
//           roughness: 0.25,
//           metalness: 0.85,
//         });
//         (chamber as THREE.Mesh).material = chamberMat;
//         placeholder.userData.chamberMaterial = chamberMat;
//         placeholder.userData.colorScheme = scheme;
//       }

//       if (lightGreen && (lightGreen as THREE.Mesh).isMesh) {
//         const greenMat = new THREE.MeshStandardMaterial({
//           color: 0x002200, emissive: 0x00ff44, emissiveIntensity: 4.0, roughness: 0.4,
//         });
//         (lightGreen as THREE.Mesh).material = greenMat;
//         placeholder.userData.greenLight = greenMat;
//       }

//       if (lightRed && (lightRed as THREE.Mesh).isMesh) {
//         const redMat = new THREE.MeshStandardMaterial({
//           color: 0x220000, emissive: 0xff0033, emissiveIntensity: 1.0, roughness: 0.4,
//         });
//         (lightRed as THREE.Mesh).material = redMat;
//         placeholder.userData.redLight = redMat;
//       }

//       const pl = new THREE.PointLight(scheme.pl, 0, 7);
//       pl.position.set(0, 1.5, 0);
//       root.add(pl);
//       placeholder.userData.processLight = pl;

//       placeholder.add(root);
//       placeholder.userData.glbRoot = root;
//       placeholder.userData.loaded = true;

//       addModuleLabel(placeholder, mod);
//       // ── ADD VISIBLE SPIN CHUCK ──
//       addWaferChuck(placeholder, 'spin');
//       positionWaferAnchorAboveChuck(placeholder, root);

//       if (onReady) onReady(placeholder);
//     },
//     undefined,
//     (err: any) => console.error('HMDS GLB failed:', err)
//   );

//   return placeholder;
// }


// ===== GLB-REMOVED (buildHMDSGLB - /HMDS Vapour.glb (dead)) - re-wire the new module here. See GLB_WIRING_CONTRACT.md =====
// function buildHMDSGLB(
//   scene: THREE.Scene,
//   mod: ProcessStep,
//   onReady?: (group: THREE.Group) => void
// ): THREE.Group {
//   const placeholder = new THREE.Group();
//   placeholder.position.set(mod.x, 0, mod.z);
//   placeholder.userData.id = mod.id;
//   scene.add(placeholder);
// 
//   const loader = new GLTFLoader();
//   loader.load(
//     '/HMDS Vapour.glb',
//     (gltf: any) => {
//       const root = gltf.scene as THREE.Group;
// 
//       const tempBox = new THREE.Box3().setFromObject(root);
//       const size = new THREE.Vector3();
//       tempBox.getSize(size);
// 
//       const targetW = 2.5;
//       const currentMax = Math.max(size.x, size.z);
//       const scale = targetW / currentMax;
//       root.scale.setScalar(scale);
//       // root.scale.y = scale * 0.01;
// 
//       // ── ROTATE 180° to match other modules' orientation ──
//       root.rotation.y = Math.PI;
// 
//       const box = new THREE.Box3().setFromObject(root);
//       // Seat GLB flush on plinth top surface
//       root.position.y = PLINTH_TOP_Y - box.min.y;
// 
//       // ── Recenter X and Z after rotation (rotation shifts pivot) ──
//       const afterBox = new THREE.Box3().setFromObject(root);
//       const afterCenter = new THREE.Vector3();
//       afterBox.getCenter(afterCenter);
//       root.position.x -= afterCenter.x;
//       root.position.z -= afterCenter.z;
// 
//       const namedParts: Record<string, THREE.Object3D> = {};
//       root.traverse((obj) => {
//         namedParts[obj.name] = obj;
//         if ((obj as THREE.Mesh).isMesh) {
//           obj.castShadow = true;
//           obj.receiveShadow = true;
//         }
//       });
// 
//       const chamber =
//         namedParts['Chamber'] || namedParts['Vessel'] ||
//         namedParts['Body'] || namedParts['Top'] || namedParts['Plate'];
// 
//       const lightGreen =
//         namedParts['LightGreen'] || namedParts['Light_Green'] || namedParts['LED_Green'];
//       const lightRed =
//         namedParts['LightRed'] || namedParts['Light_Red'] || namedParts['LED_Red'];
// 
//       const scheme = { base: 0x1a0a00, emissive: 0xff8800, light: 0xffaa33, pl: 0xff7700 };
// 
//       if (chamber && (chamber as THREE.Mesh).isMesh) {
//         const chamberMat = new THREE.MeshStandardMaterial({
//           color: scheme.base,
//           emissive: scheme.emissive,
//           emissiveIntensity: 0.6,
//           roughness: 0.25,
//           metalness: 0.85,
//         });
//         (chamber as THREE.Mesh).material = chamberMat;
//         placeholder.userData.chamberMaterial = chamberMat;
//         placeholder.userData.colorScheme = scheme;
//       }
// 
//       if (lightGreen && (lightGreen as THREE.Mesh).isMesh) {
//         const greenMat = new THREE.MeshStandardMaterial({
//           color: 0x002200, emissive: 0x00ff44, emissiveIntensity: 4.0, roughness: 0.4,
//         });
//         (lightGreen as THREE.Mesh).material = greenMat;
//         placeholder.userData.greenLight = greenMat;
//       }
// 
//       if (lightRed && (lightRed as THREE.Mesh).isMesh) {
//         const redMat = new THREE.MeshStandardMaterial({
//           color: 0x220000, emissive: 0xff0033, emissiveIntensity: 1.0, roughness: 0.4,
//         });
//         (lightRed as THREE.Mesh).material = redMat;
//         placeholder.userData.redLight = redMat;
//       }
// 
//       const pl = new THREE.PointLight(scheme.pl, 0, 7);
//       pl.position.set(0, 1.5, 0);
//       root.add(pl);
//       placeholder.userData.processLight = pl;
// 
//       placeholder.add(root);
//       placeholder.userData.glbRoot = root;
//       placeholder.userData.loaded = true;
// 
//       addModuleLabel(placeholder, mod);
//       // ── ADD VISIBLE SPIN CHUCK ──
//       addWaferChuck(placeholder, 'spin');
//       positionWaferAnchorAboveChuck(placeholder, root);
// 
//       if (onReady) onReady(placeholder);
//     },
//     undefined,
//     (err: any) => console.error('HMDS GLB failed:', err)
//   );
// 
//   return placeholder;
// }


// ===== GLB-REMOVED (buildPostBakeGLB - /hardbakeglb.glb (dead)) - re-wire the new module here. See GLB_WIRING_CONTRACT.md =====
// function buildPostBakeGLB(
//   scene: THREE.Scene,
//   mod: ProcessStep,
//   onReady?: (group: THREE.Group) => void
// ): THREE.Group {
//   const placeholder = new THREE.Group();
//   placeholder.position.set(mod.x, 0, mod.z);
//   placeholder.userData.id = mod.id;
//   scene.add(placeholder);
// 
// (async () => { const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js'); const loader = new GLTFLoader();
//   loader.load(
//     '/hardbakeglb.glb',
//     (gltf: any) => {
//       const root = gltf.scene as THREE.Group;
// 
//       const tempBox = new THREE.Box3().setFromObject(root);
//       const size = new THREE.Vector3();
//       tempBox.getSize(size);
// 
//       const targetW = 3.5;
//       const currentMax = Math.max(size.x, size.z);
//       const scale = targetW / currentMax;
//       root.scale.setScalar(scale);
// 
//       const box = new THREE.Box3().setFromObject(root);
//       // Seat flush on plinth top
//       root.position.y = PLINTH_TOP_Y - box.min.y;
// 
//       // Center X only — no Z offset
//       const afterBox = new THREE.Box3().setFromObject(root);
//       const afterCenter = new THREE.Vector3();
//       afterBox.getCenter(afterCenter);
//       root.position.x -= afterCenter.x;
//       // Z intentionally NOT adjusted
// 
//       const namedParts: Record<string, THREE.Object3D> = {};
//       root.traverse((obj) => {
//         namedParts[obj.name] = obj;
//         if ((obj as THREE.Mesh).isMesh) {
//           obj.castShadow = true;
//           obj.receiveShadow = true;
//         }
//       });
// 
//       const hotPlate =
//         namedParts['HotPlate'] || namedParts['Hot_Plate'] ||
//         namedParts['Plate'] || namedParts['Heater'] || namedParts['Top'];
// 
//       const lightGreen =
//         namedParts['LightGreen'] || namedParts['Light_Green'] || namedParts['LED_Green'];
//       const lightRed =
//         namedParts['LightRed'] || namedParts['Light_Red'] || namedParts['LED_Red'];
// 
//       const scheme = { base: 0x200505, emissive: 0xff2200, light: 0xff3300, pl: 0xff2200 };
// 
//       if (hotPlate && (hotPlate as THREE.Mesh).isMesh) {
//         const heatMat = new THREE.MeshStandardMaterial({
//           color: scheme.base,
//           emissive: scheme.emissive,
//           emissiveIntensity: 1.0,
//           roughness: 0.55,
//           metalness: 0.3,
//         });
//         (hotPlate as THREE.Mesh).material = heatMat;
//         placeholder.userData.heatMaterial = heatMat;
//         placeholder.userData.colorScheme = scheme;
//       }
// 
//       if (lightGreen && (lightGreen as THREE.Mesh).isMesh) {
//         const greenMat = new THREE.MeshStandardMaterial({
//           color: 0x002200, emissive: 0x00ff44, emissiveIntensity: 4.0, roughness: 0.4,
//         });
//         (lightGreen as THREE.Mesh).material = greenMat;
//         placeholder.userData.greenLight = greenMat;
//       }
// 
//       if (lightRed && (lightRed as THREE.Mesh).isMesh) {
//         const redMat = new THREE.MeshStandardMaterial({
//           color: 0x220000, emissive: 0xff0033, emissiveIntensity: 1.0, roughness: 0.4,
//         });
//         (lightRed as THREE.Mesh).material = redMat;
//         placeholder.userData.redLight = redMat;
//       }
// 
//       const pl = new THREE.PointLight(scheme.pl, 0, 7);
//       pl.position.set(0, 1.2, 0);
//       root.add(pl);
//       placeholder.userData.processLight = pl;
// 
//       placeholder.add(root);
//       placeholder.userData.glbRoot = root;
//       placeholder.userData.loaded = true;
// 
//       addModuleLabel(placeholder, mod);
//       // ── ADD VISIBLE HOT PLATE CHUCK (PEB — post exposure bake) ──
//       addWaferChuck(placeholder, 'hotplate');
//       positionWaferAnchorAboveChuck(placeholder, root);
// 
//       if (onReady) onReady(placeholder);
//     },
//     undefined,
//     (err: any) => console.error('PostBake GLB failed:', err)
//   );})();
// 
//   return placeholder;
// }

// function positionInterfaceWaferAnchor(
//   placeholder: THREE.Group,
//   glbRoot: THREE.Object3D,
//   modId: string
// ): THREE.Object3D {
//   const existing = placeholder.userData.waferAnchor as THREE.Object3D | undefined;
//   if (existing) placeholder.remove(existing);

//   placeholder.updateWorldMatrix(true, true);
//   glbRoot.updateWorldMatrix(true, true);

//   const placeholderWorldPos = new THREE.Vector3();
//   placeholder.getWorldPosition(placeholderWorldPos);

//   const namedParts: Record<string, THREE.Object3D> = {};
//   glbRoot.traverse((obj) => {
//     namedParts[obj.name] = obj;
//   });

//   const faceNode =
//     (modId === 'iface_out'
//       ? namedParts['IF_out'] || namedParts['if_out'] || namedParts['IFout'] || namedParts['IF_in'] || namedParts['if_in'] || namedParts['IFin']
//       : namedParts['IF_in'] || namedParts['if_in'] || namedParts['IFin'] || namedParts['IF_out'] || namedParts['if_out'] || namedParts['IFout']);

//   const waferAnchor = new THREE.Group();
//   waferAnchor.name = 'ModuleWaferAnchor';

//   if (faceNode) {
//     const faceWorldPos = new THREE.Vector3();
//     faceNode.getWorldPosition(faceWorldPos);
//     const localPos = faceWorldPos.clone().sub(placeholderWorldPos);
//     waferAnchor.position.set(localPos.x, WAFER_TRANSFER_Y - placeholderWorldPos.y, localPos.z);
//   } else {
//     const faceZOffset = modId === 'iface_out' ? 1.25 : -1.25;
//     waferAnchor.position.set(0, WAFER_TRANSFER_Y - placeholderWorldPos.y, faceZOffset);
//   }

//   placeholder.add(waferAnchor);
//   placeholder.userData.waferAnchor = waferAnchor;
//   return waferAnchor;
// }

function positionInterfaceWaferAnchor(
  placeholder: THREE.Group,
  glbRoot: THREE.Object3D,
  modId: string
): THREE.Object3D {
  const existing = placeholder.userData.waferAnchor as THREE.Object3D | undefined;
  if (existing) placeholder.remove(existing);

  placeholder.updateWorldMatrix(true, true);
  glbRoot.updateWorldMatrix(true, true);

  const placeholderWorldPos = new THREE.Vector3();
  placeholder.getWorldPosition(placeholderWorldPos);

  // ── Measure the module's real bounding box (world space) and use its
  //    CENTER in X/Z so the wafer sits on the module's top-center, not the
  //    placeholder origin (which lands at the front edge). ──
  const box = new THREE.Box3().setFromObject(glbRoot);
  const center = new THREE.Vector3();
  box.getCenter(center);

  // Fine nudges if the top-center still needs a small shift (defaults 0)
  const ANCHOR_X = 0;          // ← sideways nudge on the module top
  const ANCHOR_Z = 0;          // ← forward/back nudge on the module top
  const IFACE_WAFER_LIFT = 0.5; // ← extra HEIGHT off the floor for IF wafers (raise this)

  const waferAnchor = new THREE.Group();
  waferAnchor.name = 'ModuleWaferAnchor';

  // Convert the world-space center into placeholder-LOCAL coords for X/Z,
  // keep the wafer at transfer height (+ IF lift) for Y.
  waferAnchor.position.set(
    center.x - placeholderWorldPos.x + ANCHOR_X,
    WAFER_TRANSFER_Y - placeholderWorldPos.y + IFACE_WAFER_LIFT,
    center.z - placeholderWorldPos.z + ANCHOR_Z
  );

  placeholder.add(waferAnchor);
  placeholder.userData.waferAnchor = waferAnchor;

  console.log('[IFACE-WAFER]', modId,
    'centerX=', center.x.toFixed(2),
    'centerZ=', center.z.toFixed(2),
    'localX=', (center.x - placeholderWorldPos.x).toFixed(2),
    'localZ=', (center.z - placeholderWorldPos.z).toFixed(2),
    'lift=', IFACE_WAFER_LIFT.toFixed(2));

  return waferAnchor;
}


// ===== GLB-REMOVED (buildInterfaceGLB - /hardbakeglb.glb (dead)) - re-wire the new module here. See GLB_WIRING_CONTRACT.md =====
// function buildInterfaceGLB(
//   scene: THREE.Scene,
//   mod: ProcessStep,
//   onReady?: (group: THREE.Group) => void
// ): THREE.Group {
//   const placeholder = new THREE.Group();
// 
//   // ── Match the plinth nudge so the GLB sits ON its plinth, not in front of it ──
//   const nudgeZ = IFACE_LOCAL_Z[mod.id] ?? 0;
//   placeholder.position.set(mod.x, 0, mod.z + nudgeZ);
//   placeholder.userData.id = mod.id;
//   scene.add(placeholder);
// 
//   const loader = new GLTFLoader();
//   loader.load(
//     '/hardbakeglb.glb',
//     (gltf: any) => {
//       const root = gltf.scene as THREE.Group;
// 
//       // ── Scale to module footprint ──
//       const tempBox = new THREE.Box3().setFromObject(root);
//       const size = new THREE.Vector3();
//       tempBox.getSize(size);
//       const targetW = 3.0;
//       const currentMax = Math.max(size.x, size.z);
//       const scale = targetW / currentMax;
//       root.scale.setScalar(scale);
// 
//       // ── Snap base to module floor ──
//       const box = new THREE.Box3().setFromObject(root);
//       root.position.y = MODULE_FLOOR_Y - box.min.y;
// 
//       // ── Recenter X and Z on the model's true center, THEN apply manual tune ──
//       const afterBox = new THREE.Box3().setFromObject(root);
//       const afterCenter = new THREE.Vector3();
//       afterBox.getCenter(afterCenter);
//       root.position.x -= afterCenter.x;
//       root.position.z -= afterCenter.z;
//       // Manual nudge to seat the body inside its plinth (fixes "came forward").
//       root.position.z += IFACE_GLB_Z_OFFSET[mod.id] ?? 0;
// 
//       // ── Index named nodes ──
//       const namedParts: Record<string, THREE.Object3D> = {};
//       root.traverse((obj) => {
//         namedParts[obj.name] = obj;
//         if ((obj as THREE.Mesh).isMesh) {
//           obj.castShadow = true;
//           obj.receiveShadow = true;
//           // ── Force all faces visible from every angle ──
//           const mesh = obj as THREE.Mesh;
//           const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
//           mats.forEach((mat, i) => {
//             if (mat && mat.side !== THREE.DoubleSide) {
//               const clone = (mat as THREE.Material).clone() as THREE.MeshStandardMaterial;
//               clone.side = THREE.DoubleSide;
//               clone.needsUpdate = true;
//               if (Array.isArray(mesh.material)) {
//                 (mesh.material as THREE.Material[])[i] = clone;
//               } else {
//                 mesh.material = clone;
//               }
//             }
//           });
//         }
//       });
// 
//       // ── Resolve IF_in / IF_out handoff nodes from the GLB (if present) ──
//       const ifIn = namedParts['IF_in'] || namedParts['IFin'] || namedParts['if_in'] || null;
//       const ifOut = namedParts['IF_out'] || namedParts['IFout'] || namedParts['if_out'] || null;
// 
//       const lightGreen =
//         namedParts['LightGreen'] || namedParts['Light_Green'] || namedParts['LED_Green'];
//       const lightRed =
//         namedParts['LightRed'] || namedParts['Light_Red'] || namedParts['LED_Red'];
// 
//       const scheme = { base: 0x2a2310, emissive: 0xffdd00, light: 0xffee33, pl: 0xffcc00 };
// 
//       if (lightGreen && (lightGreen as THREE.Mesh).isMesh) {
//         const greenMat = new THREE.MeshStandardMaterial({
//           color: 0x002200, emissive: 0x00ff44, emissiveIntensity: 4.0, roughness: 0.4,
//         });
//         (lightGreen as THREE.Mesh).material = greenMat;
//         placeholder.userData.greenLight = greenMat;
//       }
// 
//       if (lightRed && (lightRed as THREE.Mesh).isMesh) {
//         const redMat = new THREE.MeshStandardMaterial({
//           color: 0x220000, emissive: 0xff0033, emissiveIntensity: 1.0, roughness: 0.4,
//         });
//         (lightRed as THREE.Mesh).material = redMat;
//         placeholder.userData.redLight = redMat;
//       }
// 
//       if (ifIn) placeholder.userData.ifIn = ifIn;
//       if (ifOut) placeholder.userData.ifOut = ifOut;
// 
//       const pl = new THREE.PointLight(scheme.pl, 0, 6);
//       pl.position.set(0, 1.2, 0);
//       root.add(pl);
//       placeholder.userData.processLight = pl;
// 
//       placeholder.add(root);
//       placeholder.userData.glbRoot = root;
//       placeholder.userData.loaded = true;
// 
//       positionInterfaceWaferAnchor(placeholder, root, mod.id);
// 
//       if (onReady) onReady(placeholder);
//     },
//     undefined,
//     (err: any) => console.error('Interface GLB failed to load:', err)
//   );
// 
//   return placeholder;
// }


// ===== GLB-REMOVED (buildDIWaterRinseGLB - /Diwaterrinse.glb (dead)) - re-wire the new module here. See GLB_WIRING_CONTRACT.md =====
// function buildDIWaterRinseGLB(
//   scene: THREE.Scene,
//   mod: ProcessStep,
//   onReady?: (group: THREE.Group) => void
// ): THREE.Group {
//   const placeholder = new THREE.Group();
//   placeholder.position.set(mod.x, 0, mod.z);
//   placeholder.userData.id = mod.id;
//   scene.add(placeholder);
// 
//   const loader = new GLTFLoader();
//   loader.load(
//     '/Diwaterrinse.glb',
//     (gltf: any) => {
//       const root = gltf.scene as THREE.Group;
// 
//       const tempBox = new THREE.Box3().setFromObject(root);
//       const size = new THREE.Vector3();
//       tempBox.getSize(size);
// 
//       const targetW = 2.9;
//       const currentMax = Math.max(size.x, size.z);
//       const scale = targetW / currentMax;
//       root.scale.setScalar(scale);
// 
//       const box = new THREE.Box3().setFromObject(root);
//       // Seat flush on plinth top
//       root.position.y = PLINTH_TOP_Y - box.min.y;
// 
//       // Center X only — no Z offset
//       const afterBox = new THREE.Box3().setFromObject(root);
//       const afterCenter = new THREE.Vector3();
//       afterBox.getCenter(afterCenter);
//       root.position.x -= afterCenter.x;
//       // Z intentionally NOT adjusted
// 
//       const namedParts: Record<string, THREE.Object3D> = {};
//       root.traverse((obj) => {
//         namedParts[obj.name] = obj;
//         if ((obj as THREE.Mesh).isMesh) {
//           obj.castShadow = true;
//           obj.receiveShadow = true;
//         }
//       });
// 
//       const bowl =
//         namedParts['Bowl'] || namedParts['Basin'] ||
//         namedParts['Chuck'] || namedParts['Plate'] || namedParts['Top'];
// 
//       const nozzle =
//         namedParts['Nozzle'] || namedParts['Arm'] ||
//         namedParts['Spray'] || namedParts['Head'];
// 
//       const lightGreen =
//         namedParts['LightGreen'] || namedParts['Light_Green'] || namedParts['LED_Green'];
//       const lightRed =
//         namedParts['LightRed'] || namedParts['Light_Red'] || namedParts['LED_Red'];
// 
//       // ── REPOSITION STAND TO CORNER WITH ZERO GAP AND 45° ROTATION ──
//       const stand =
//         namedParts['Stand'] || namedParts['Post'] || namedParts['Support'] ||
//         namedParts['Pedestal'] || namedParts['Base'] || namedParts['Column'];
// 
//       if (stand) {
//         // Get base dimensions from the scaled GLB
//         const baseBox = new THREE.Box3().setFromObject(root);
//         const baseSize = new THREE.Vector3();
//         baseBox.getSize(baseSize);
// 
//         // Get stand dimensions
//         const standBox = new THREE.Box3().setFromObject(stand);
//         const standSize = new THREE.Vector3();
//         standBox.getSize(standSize);
// 
//         // Position stand at corner (back-right: +X, -Z) FLUSH with base edges (zero gap)
//         const cornerX = (baseSize.x / 2) - (standSize.x / 2);
//         const cornerZ = -(baseSize.z / 2) + (standSize.z / 2);
// 
//         stand.position.set(cornerX, stand.position.y, cornerZ);
//         
//         // Add 45-degree rotation for proper orientation
//         stand.rotation.y = Math.PI / 4;  // 45 degrees
//         
//         console.log(`[RINSE] Stand repositioned to corner: X=${cornerX.toFixed(2)}, Z=${cornerZ.toFixed(2)}, Rotation=45°`);
//       }
// 
//       const scheme = { base: 0x001428, emissive: 0x0088ff, light: 0x00aaff, pl: 0x0077ff };
// 
//       if (bowl && (bowl as THREE.Mesh).isMesh) {
//         const bowlMat = new THREE.MeshStandardMaterial({
//           color: scheme.base,
//           emissive: scheme.emissive,
//           emissiveIntensity: 0.5,
//           roughness: 0.18,
//           metalness: 0.85,
//         });
//         (bowl as THREE.Mesh).material = bowlMat;
//         placeholder.userData.bowlMaterial = bowlMat;
//         placeholder.userData.colorScheme = scheme;
//       }
// 
//       if (nozzle && (nozzle as THREE.Mesh).isMesh) {
//         const nozzleMat = new THREE.MeshStandardMaterial({
//           color: 0x223344,
//           emissive: 0x0055aa,
//           emissiveIntensity: 0.4,
//           roughness: 0.15,
//           metalness: 0.95,
//         });
//         (nozzle as THREE.Mesh).material = nozzleMat;
//         placeholder.userData.nozzleMaterial = nozzleMat;
//       }
// 
//       if (lightGreen && (lightGreen as THREE.Mesh).isMesh) {
//         const greenMat = new THREE.MeshStandardMaterial({
//           color: 0x002200, emissive: 0x00ff44, emissiveIntensity: 4.0, roughness: 0.4,
//         });
//         (lightGreen as THREE.Mesh).material = greenMat;
//         placeholder.userData.greenLight = greenMat;
//       }
// 
//       if (lightRed && (lightRed as THREE.Mesh).isMesh) {
//         const redMat = new THREE.MeshStandardMaterial({
//           color: 0x220000, emissive: 0xff0033, emissiveIntensity: 1.0, roughness: 0.4,
//         });
//         (lightRed as THREE.Mesh).material = redMat;
//         placeholder.userData.redLight = redMat;
//       }
// 
//       const pl = new THREE.PointLight(scheme.pl, 0, 7);
//       pl.position.set(0, 1.2, 0);
//       root.add(pl);
//       placeholder.userData.processLight = pl;
// 
//       placeholder.add(root);
//       placeholder.userData.glbRoot = root;
//       placeholder.userData.loaded = true;
// 
//       addModuleLabel(placeholder, mod);
//       // ── ADD VISIBLE SPIN CHUCK (rinse) ──
//       addWaferChuck(placeholder, 'spin');
//       positionWaferAnchorAboveChuck(placeholder, root);
// 
//       if (onReady) onReady(placeholder);
//     },
//     undefined,
//     (err: any) => console.error('DIWaterRinse GLB failed:', err)
//   );
// 
//   return placeholder;
// }

// ===== GLB-REMOVED (buildDeveloperModuleGLB - /Developermodule.glb (dead)) - re-wire the new module here. See GLB_WIRING_CONTRACT.md =====
// function buildDeveloperModuleGLB(
//   scene: THREE.Scene,
//   mod: ProcessStep,
//   onReady?: (group: THREE.Group) => void
// ): THREE.Group {
//   const placeholder = new THREE.Group();
//   placeholder.position.set(mod.x, 0, mod.z);
//   placeholder.userData.id = mod.id;
//   scene.add(placeholder);
// 
//   const loader = new GLTFLoader();
//   loader.load(
//     '/Developermodule.glb',
//     (gltf: any) => {
//       const root = gltf.scene as THREE.Group;
// 
//       const tempBox = new THREE.Box3().setFromObject(root);
//       const size = new THREE.Vector3();
//       tempBox.getSize(size);
// 
//       const targetW = 3;
//       const currentMax = Math.max(size.x, size.z);
//       const scale = targetW / currentMax;
//       root.scale.setScalar(scale);
// 
//       const box = new THREE.Box3().setFromObject(root);
//       // Seat flush on plinth top
//       root.position.y = PLINTH_TOP_Y - box.min.y;
// 
//       // Center X only — no Z offset
//       const afterBox = new THREE.Box3().setFromObject(root);
//       const afterCenter = new THREE.Vector3();
//       afterBox.getCenter(afterCenter);
//       root.position.x -= afterCenter.x;
//       // Z intentionally NOT adjusted
// 
//       const namedParts: Record<string, THREE.Object3D> = {};
//       root.traverse((obj) => {
//         namedParts[obj.name] = obj;
//         if ((obj as THREE.Mesh).isMesh) {
//           obj.castShadow = true;
//           obj.receiveShadow = true;
//         }
//       });
// 
//       const chuck =
//         namedParts['Chuck'] || namedParts['SpinChuck'] ||
//         namedParts['Plate'] || namedParts['Bowl'] || namedParts['Top'];
// 
//       const arm =
//         namedParts['Arm'] || namedParts['NozzleArm'] ||
//         namedParts['Nozzle'] || namedParts['Dispense'];
// 
//       const lightGreen =
//         namedParts['LightGreen'] || namedParts['Light_Green'] || namedParts['LED_Green'];
//       const lightRed =
//         namedParts['LightRed'] || namedParts['Light_Red'] || namedParts['LED_Red'];
// 
//       // ── REPOSITION STAND TO CORNER ──
//       const stand =
//         namedParts['Stand'] || namedParts['Post'] || namedParts['Support'] ||
//         namedParts['Pedestal'] || namedParts['Base'] || namedParts['Column'];
// 
//       if (stand) {
//         // Get base dimensions from the scaled GLB
//         const baseBox = new THREE.Box3().setFromObject(root);
//         const baseSize = new THREE.Vector3();
//         baseBox.getSize(baseSize);
// 
//         // Get stand dimensions
//         const standBox = new THREE.Box3().setFromObject(stand);
//         const standSize = new THREE.Vector3();
//         standBox.getSize(standSize);
// 
//         // Position stand at corner (back-right: +X, -Z) flush with base edges
//         // Using half dimensions to position from center
//         const cornerX = (baseSize.x / 2) - (standSize.x / 2);
//         const cornerZ = -(baseSize.z / 2) + (standSize.z / 2);
// 
//         stand.position.set(cornerX, stand.position.y, cornerZ);
//         console.log(`[DEVELOPER] Stand repositioned to corner: X=${cornerX.toFixed(2)}, Z=${cornerZ.toFixed(2)}`);
//       }
// 
//       const scheme = { base: 0x001a0a, emissive: 0x00ff88, light: 0x00dd66, pl: 0x00cc77 };
// 
//       if (chuck && (chuck as THREE.Mesh).isMesh) {
//         const chuckMat = new THREE.MeshStandardMaterial({
//           color: 0x112233,
//           emissive: scheme.emissive,
//           emissiveIntensity: 0.4,
//           roughness: 0.15,
//           metalness: 0.92,
//         });
//         (chuck as THREE.Mesh).material = chuckMat;
//         placeholder.userData.chuckMaterial = chuckMat;
//         placeholder.userData.spinChuck = chuck;
//         placeholder.userData.colorScheme = scheme;
//       }
// 
//       if (arm) {
//         placeholder.userData.dispenseArm = arm;
//         placeholder.userData.armRestY = (arm as THREE.Object3D).rotation.y;
//       }
// 
//       if (lightGreen && (lightGreen as THREE.Mesh).isMesh) {
//         const greenMat = new THREE.MeshStandardMaterial({
//           color: 0x002200, emissive: 0x00ff44, emissiveIntensity: 4.0, roughness: 0.4,
//         });
//         (lightGreen as THREE.Mesh).material = greenMat;
//         placeholder.userData.greenLight = greenMat;
//       }
// 
//       if (lightRed && (lightRed as THREE.Mesh).isMesh) {
//         const redMat = new THREE.MeshStandardMaterial({
//           color: 0x220000, emissive: 0xff0033, emissiveIntensity: 1.0, roughness: 0.4,
//         });
//         (lightRed as THREE.Mesh).material = redMat;
//         placeholder.userData.redLight = redMat;
//       }
// 
//       const pl = new THREE.PointLight(scheme.pl, 0, 7);
//       pl.position.set(0, 1.2, 0);
//       root.add(pl);
//       placeholder.userData.processLight = pl;
// 
//       placeholder.add(root);
//       placeholder.userData.glbRoot = root;
//       placeholder.userData.loaded = true;
// 
//       addModuleLabel(placeholder, mod);
//       // ── ADD VISIBLE SPIN CHUCK (developer) ──
//       addWaferChuck(placeholder, 'spin');
//       positionWaferAnchorAboveChuck(placeholder, root);
// 
//       if (onReady) onReady(placeholder);
//     },
//     undefined,
//     (err: any) => console.error('DeveloperModule GLB failed:', err)
//   );
// 
//   return placeholder;
// }

// Helper — extract label code from buildModule into reusable function



// function buildModulePlinth(scene: THREE.Scene, mod: ProcessStep): THREE.Mesh {
//   const W = 3.2, D = 3.2, H = 0.35;
//   // All plinths now use grey base (0x3a3a3a)
//   const baseColors: Record<string, number> = {
//     hot: 0x3a3a3a, cold: 0x3a3a3a, coat: 0x3a3a3a,
//     wet: 0x3a3a3a, dry: 0x3a3a3a, scan: 0x3a3a3a,
//     iface: 0x3a3a3a, foup: 0x3a3a3a,
//   };
//   const edgeColors: Record<string, number> = {
//     hot: 0xff3300, cold: 0x00ccff, coat: 0xcc00ff,
//     wet: 0x00ff88, dry: 0x00eeff, scan: 0xee00cc,
//     iface: 0xffdd00, foup: 0x4488ff,
//   };
//   const base = baseColors[mod.type] ?? 0x3a3a3a;
//   const edge = edgeColors[mod.type] ?? mod.color;
//   const plinth = new THREE.Mesh(
//     new THREE.BoxGeometry(W, H, D),
//     new THREE.MeshStandardMaterial({ color: base, roughness: 0.30, metalness: 0.85, emissive: edge, emissiveIntensity: 0.06 })
//   );
//   plinth.position.set(mod.x, -0.5 + H / 2, mod.z);
//   plinth.receiveShadow = true;
//   scene.add(plinth);
//   const strip = new THREE.Mesh(
//     new THREE.BoxGeometry(W, 0.025, 0.035),
//     new THREE.MeshStandardMaterial({ color: edge, emissive: edge, emissiveIntensity: 4.5, roughness: 0.2, transparent: true, opacity: 0.92 })
//   );
//   strip.position.set(mod.x, -0.5 + H - 0.012, mod.z + D / 2);
//   scene.add(strip);
//   const stripBack = strip.clone();
//   stripBack.position.z = mod.z - D / 2;
//   scene.add(stripBack);
//   const bevel = new THREE.Mesh(
//     new THREE.BoxGeometry(W + 0.04, 0.018, D + 0.04),
//     new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.12, metalness: 0.98, emissive: edge, emissiveIntensity: 0.12 })
//   );
//   bevel.position.set(mod.x, -0.5 + H, mod.z);
//   scene.add(bevel);
//   const dotMat = new THREE.MeshStandardMaterial({ color: edge, emissive: edge, emissiveIntensity: 3.0, roughness: 0.3 });
//   [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([sx,sz]) => {
//     const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10), dotMat);
//     dot.position.set(mod.x + sx! * (W/2 - 0.15), -0.5 + H + 0.02, mod.z + sz! * (D/2 - 0.15));
//     scene.add(dot);
//   });
//   return plinth;
// }
function placeWaferAnchorOnChuck(
  placeholder: THREE.Group,
  glbRoot: THREE.Object3D,
): THREE.Object3D {
  return positionWaferAnchorAboveChuck(placeholder, glbRoot);
}

// function buildModulePlinth(scene: THREE.Scene, mod: ProcessStep): THREE.Mesh {
//   // ── INCREASED HEIGHT: was H = 0.35, now H = 1.2 (taller pedestal) ──
//   // ── INCREASED FOOTPRINT slightly for better proportions ──
//   const W = 3.4, D = 3.4, H = 3.2;

//   // ── UNIFORM GREY for ALL module types (no per-type color) ──
//   const UNIFORM_GREY_BASE = 0x4a4a4a;      // medium grey body
//   const UNIFORM_GREY_TOP  = 0x5a5a5a;      // slightly lighter top bevel
//   const UNIFORM_GREY_DARK = 0x2e2e2e;      // dark grey accent strips

//   // ── MAIN PLINTH BODY (grey, taller) ──
//   const plinth = new THREE.Mesh(
//     new THREE.BoxGeometry(W, H, D),
//     new THREE.MeshStandardMaterial({
//       color: UNIFORM_GREY_BASE,
//       roughness: 0.45,
//       metalness: 0.72,
//       emissive: 0x000000,        // NO emissive bleed — pure grey
//       emissiveIntensity: 0,
//     })
//   );
//   plinth.position.set(mod.x, -0.5 + H / 2, mod.z);
//   plinth.castShadow = true;
//   plinth.receiveShadow = true;
//   scene.add(plinth);

//   // ── DARK GREY ACCENT STRIPS (front + back, instead of colored neon) ──
//   const stripMat = new THREE.MeshStandardMaterial({
//     color: UNIFORM_GREY_DARK,
//     roughness: 0.35,
//     metalness: 0.85,
//     emissive: 0x000000,
//     emissiveIntensity: 0,
//   });

//   const stripFront = new THREE.Mesh(
//     new THREE.BoxGeometry(W, 0.06, 0.04),
//     stripMat
//   );
//   stripFront.position.set(mod.x, -0.5 + H - 0.08, mod.z + D / 2);
//   scene.add(stripFront);

//   const stripBack = new THREE.Mesh(
//     new THREE.BoxGeometry(W, 0.06, 0.04),
//     stripMat.clone()
//   );
//   stripBack.position.set(mod.x, -0.5 + H - 0.08, mod.z - D / 2);
//   scene.add(stripBack);

//   // ── VERTICAL SIDE STRIPS (give the taller box visual rhythm) ──
//   [-1, 1].forEach((sx) => {
//     const sideStrip = new THREE.Mesh(
//       new THREE.BoxGeometry(0.04, H * 0.7, 0.06),
//       stripMat.clone()
//     );
//     sideStrip.position.set(
//       mod.x + sx * (W / 2),
//       -0.5 + H * 0.5,
//       mod.z
//     );
//     scene.add(sideStrip);
//   });

//   // ── TOP BEVEL (lighter grey, polished edge) ──
//   const bevel = new THREE.Mesh(
//     new THREE.BoxGeometry(W + 0.05, 0.04, D + 0.05),
//     new THREE.MeshStandardMaterial({
//       color: UNIFORM_GREY_TOP,
//       roughness: 0.22,
//       metalness: 0.92,
//       emissive: 0x000000,
//       emissiveIntensity: 0,
//     })
//   );
//   bevel.position.set(mod.x, -0.5 + H, mod.z);
//   scene.add(bevel);

//   // ── BOTTOM BEVEL (matches top, hides plinth–floor seam) ──
//   const bottomBevel = new THREE.Mesh(
//     new THREE.BoxGeometry(W + 0.05, 0.04, D + 0.05),
//     new THREE.MeshStandardMaterial({
//       color: UNIFORM_GREY_DARK,
//       roughness: 0.4,
//       metalness: 0.75,
//     })
//   );
//   bottomBevel.position.set(mod.x, -0.5 + 0.02, mod.z);
//   scene.add(bottomBevel);

//   // ── CORNER ACCENT DOTS (small dark grey, replace neon colored dots) ──
//   const dotMat = new THREE.MeshStandardMaterial({
//     color: UNIFORM_GREY_DARK,
//     roughness: 0.3,
//     metalness: 0.88,
//     emissive: 0x000000,
//     emissiveIntensity: 0,
//   });
//   [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
//     const dot = new THREE.Mesh(
//       new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10),
//       dotMat
//     );
//     dot.position.set(
//       mod.x + sx! * (W / 2 - 0.18),
//       -0.5 + H + 0.025,
//       mod.z + sz! * (D / 2 - 0.18)
//     );
//     scene.add(dot);
//   });

//   // ── OPTIONAL: subtle ID plate on the front face (still grey, just engraved look) ──
//   const idPlate = new THREE.Mesh(
//     new THREE.BoxGeometry(W * 0.35, 0.12, 0.02),
//     new THREE.MeshStandardMaterial({
//       color: 0x3a3a3a,
//       roughness: 0.55,
//       metalness: 0.6,
//     })
//   );
//   idPlate.position.set(mod.x, -0.5 + H * 0.35, mod.z + D / 2 + 0.012);
//   scene.add(idPlate);

//   return plinth;
// }


function buildModulePlinth(scene: THREE.Scene, mod: ProcessStep): THREE.Mesh {
  const W = 6.25, D = 3.4, H = 3.2;  // W increased by 25% (5 → 6.25)
  const nudgeZ = mod.type === "iface" ? IFACE_LOCAL_Z[mod.id] ?? 0 : 0;

  // ── BASE COLOR LOGIC ──
  // Dehydration Bake (dehy) and Post-Apply Bake (pab) get RED plinths (baking visual)
  // All others get MEDIUM GREY
  let baseColor: number;
  let topColor: number;
  let darkColor: number;
  let stripColor: number;
  let emissiveColor: number;
  let emissiveIntensity: number;

  if (mod.id === 'dehy' || mod.id === 'pab' || mod.id === 'hardbake') {
    // ── RED BAKING PLINTH (hot, baking something) ──
    baseColor = 0x6a6a6a;   // deep red body
    topColor = 0x7a7a7a;   // brighter red top bevel
    darkColor = 0x3e3e3e;   // dark red accents
    stripColor = 0x4a4a4a;   // bright orange-red strips (heating element look)
    emissiveColor = 0x000000;   // glowing red emissive
    emissiveIntensity = 0.35;   // visible glow like a hotplate
  } else {
    // ── MEDIUM GREY for all other modules ──
    baseColor = 0x6a6a6a;   // medium grey body (lighter than before)
    topColor = 0x7a7a7a;   // slightly lighter top bevel
    darkColor = 0x3e3e3e;   // dark grey accents
    stripColor = 0x4a4a4a;   // dark strip
    emissiveColor = 0x000000;   // no glow
    emissiveIntensity = 0.35;
  }

  // ── MAIN PLINTH BODY ──
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(W, H, D),
    new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.45,
      metalness: 0.60,
      emissive: emissiveColor,
      emissiveIntensity: emissiveIntensity,
    })
  );
  plinth.position.set(mod.x, -0.5 + H / 2, mod.z + nudgeZ);
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  scene.add(plinth);

  // Store reference for animation (red plinths pulse during processing)
  if (mod.id === 'dehy' || mod.id === 'pab' || mod.id === 'hardbake') {
    plinth.userData.isBakingPlinth = true;
    plinth.userData.moduleId = mod.id;
  }

  // ── ACCENT STRIPS ──
  const stripMat = new THREE.MeshStandardMaterial({
    color: stripColor,
    roughness: 0.35,
    metalness: 0.75,
    emissive: (mod.id === 'dehy' || mod.id === 'pab' || mod.id === 'hardbake') ? 0xff3300 : 0x000000,
    emissiveIntensity: (mod.id === 'dehy' || mod.id === 'pab' || mod.id === 'hardbake') ? 0.8 : 0,
  });

  const stripFront = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, 0.04), stripMat);
  stripFront.position.set(mod.x, -0.5 + H - 0.08, mod.z + nudgeZ + D / 2);
  scene.add(stripFront);

  const stripBack = new THREE.Mesh(new THREE.BoxGeometry(W, 0.06, 0.04), stripMat.clone());
  stripBack.position.set(mod.x, -0.5 + H - 0.08, mod.z + nudgeZ - D / 2);
  scene.add(stripBack);

  // ── VERTICAL SIDE STRIPS ──
  [-1, 1].forEach((sx) => {
    const sideStrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, H * 0.7, 0.06),
      stripMat.clone()
    );
    sideStrip.position.set(
      mod.x + sx * (W / 2),
      -0.5 + H * 0.5,
      mod.z + nudgeZ
    );
    scene.add(sideStrip);
  });

  // ── TOP BEVEL ──
  const bevel = new THREE.Mesh(
    new THREE.BoxGeometry(W + 0.05, 0.04, D + 0.05),
    new THREE.MeshStandardMaterial({
      color: topColor,
      roughness: 0.22,
      metalness: 0.85,
      emissive: emissiveColor,
      emissiveIntensity: emissiveIntensity * 0.5,
    })
  );
  bevel.position.set(mod.x, -0.5 + H, mod.z + nudgeZ);
  scene.add(bevel);

  // ── BOTTOM BEVEL ──
  const bottomBevel = new THREE.Mesh(
    new THREE.BoxGeometry(W + 0.05, 0.04, D + 0.05),
    new THREE.MeshStandardMaterial({
      color: darkColor,
      roughness: 0.4,
      metalness: 0.65,
    })
  );
  bottomBevel.position.set(mod.x, -0.5 + 0.02, mod.z + nudgeZ);
  scene.add(bottomBevel);

  // ── CORNER ACCENT DOTS ──
  const dotMat = new THREE.MeshStandardMaterial({
    color: (mod.id === 'dehy' || mod.id === 'pab' || mod.id === 'hardbake') ? 0xff4422 : darkColor,
    roughness: 0.3,
    metalness: 0.8,
    emissive: (mod.id === 'dehy' || mod.id === 'pab' || mod.id === 'hardbake') ? 0xff3300 : 0x000000,
    emissiveIntensity: (mod.id === 'dehy' || mod.id === 'pab' || mod.id === 'hardbake') ? 1.2 : 0,
  });
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
    const dot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10),
      dotMat
    );
    dot.position.set(
      mod.x + sx! * (W / 2 - 0.18),
      -0.5 + H + 0.025,
      mod.z + nudgeZ + sz! * (D / 2 - 0.18)
    );
    scene.add(dot);
  });

  // ── ID plate on front face ──
  const idPlate = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.35, 0.12, 0.02),
    new THREE.MeshStandardMaterial({
      color: (mod.id === 'dehy' || mod.id === 'pab' || mod.id === 'hardbake') ? 0x661100 : 0x4a4a4a,
      roughness: 0.55,
      metalness: 0.5,
      emissive: (mod.id === 'dehy' || mod.id === 'pab' || mod.id === 'hardbake') ? 0xff2200 : 0x000000,
      emissiveIntensity: (mod.id === 'dehy' || mod.id === 'pab' || mod.id === 'hardbake') ? 0.4 : 0,
    })
  );
  idPlate.position.set(mod.x, -0.5 + H * 0.35, mod.z + nudgeZ + D / 2 + 0.012);
  scene.add(idPlate);

  // ── HOT GLOW LIGHT for baking plinths (subtle red point light at base) ──
  if (mod.id === 'dehy' || mod.id === 'pab' || mod.id === 'hardbake') {
    const bakeGlow = new THREE.PointLight(0xff3300, 1.2, 4);
    bakeGlow.position.set(mod.x, -0.3, mod.z + nudgeZ);
    scene.add(bakeGlow);
    plinth.userData.bakeGlow = bakeGlow;
  }

  return plinth;
}

function buildCombinedPlatform(scene: THREE.Scene): void {
  const modules = ALL_STEPS.filter(m => m.id !== 'output' && m.id !== 'scanner');

  const topModules = modules.filter(m => m.z < 0);
  const botModules = modules.filter(m => m.z > 0);
  const centerModules = modules.filter(m => m.z === 0);

  // ── COMPUTE UNIFIED X-EXTENT for top + bottom (so both boxes match) ──
  const PAD = 1.8;  // ← change this single value to grow/shrink the side gap on BOTH boxes

  let unifiedMinX = Infinity;
  let unifiedMaxX = -Infinity;

  if (topModules.length > 0) {
    unifiedMinX = Math.min(unifiedMinX, ...topModules.map(m => m.x));
    unifiedMaxX = Math.max(unifiedMaxX, ...topModules.map(m => m.x));
  }
  if (botModules.length > 0) {
    unifiedMinX = Math.min(unifiedMinX, ...botModules.map(m => m.x));
    unifiedMaxX = Math.max(unifiedMaxX, ...botModules.map(m => m.x));
  }

  const unifiedLeft = unifiedMinX - PAD;
  const unifiedRight = unifiedMaxX + PAD;
  const unifiedWidth = unifiedRight - unifiedLeft;
  const unifiedCenter = (unifiedLeft + unifiedRight) / 2;

  // ── TOP ROW (coater side, z < 0) ──
  if (topModules.length > 0) {
    buildPlatform(scene, unifiedCenter, topModules[0].z, unifiedWidth, 4.5);
  }

  // ── BOTTOM ROW (developer side, z > 0) ──
  if (botModules.length > 0) {
    const botZ = botModules[0].z;
    const newBotZ = botZ + 1;  // push away from rail center
    buildPlatform(scene, unifiedCenter, newBotZ, unifiedWidth, 4.5);
  }

  // ── CENTER ROW (EFEM / interface, z === 0) ──
  if (centerModules.length > 0) {
    const centerMinX = Math.min(...centerModules.map(m => m.x)) - 1.8;
    const centerMaxX = Math.max(...centerModules.map(m => m.x)) + 1.8;
    const centerWidth = centerMaxX - centerMinX;
    buildPlatform(scene, (centerMinX + centerMaxX) / 2, 0, centerWidth, 4.5);
  }
}

function buildPlatform(
  scene: THREE.Scene,
  centerX: number,
  centerZ: number,
  width: number,
  depth: number
): void {
  const H = 3.2;

  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(width, H, depth),
    new THREE.MeshStandardMaterial({
      color: 0x6a6a6a,
      roughness: 0.45,
      metalness: 0.60,
      emissive: 0x000000,
      emissiveIntensity: 0.35,
    })
  );
  platform.position.set(centerX, -0.5 + H / 2, centerZ);
  platform.castShadow = false;
  platform.receiveShadow = false;
  scene.add(platform);

  const topBevel = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.05, 0.04, depth + 0.05),
    new THREE.MeshStandardMaterial({
      color: 0x7a7a7a,
      roughness: 0.22,
      metalness: 0.85,
    })
  );
  topBevel.position.set(centerX, -0.5 + H, centerZ);
  scene.add(topBevel);

  const bottomBevel = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.05, 0.04, depth + 0.05),
    new THREE.MeshStandardMaterial({
      color: 0x3e3e3e,
      roughness: 0.4,
      metalness: 0.65,
    })
  );
  bottomBevel.position.set(centerX, -0.5 + 0.02, centerZ);
  scene.add(bottomBevel);

  const stripMat = new THREE.MeshStandardMaterial({
    color: 0x4a4a4a,
    roughness: 0.35,
    metalness: 0.75,
  });

  const stripFront = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.06, 0.04),
    stripMat
  );
  stripFront.position.set(centerX, -0.5 + H - 0.08, centerZ + depth / 2);
  scene.add(stripFront);

  const stripBack = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.06, 0.04),
    stripMat.clone()
  );
  stripBack.position.set(centerX, -0.5 + H - 0.08, centerZ - depth / 2);
  scene.add(stripBack);

  const modules = ALL_STEPS.filter(m =>
    m.id !== 'output' &&
    m.id !== 'scanner' &&
    Math.abs(m.z - centerZ) < 0.5
  );

  modules.forEach((mod, i) => {
    if (i === 0) return;
    const dividerX = (modules[i].x + modules[i - 1].x) / 2;
    const divider = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, H * 0.7, depth + 0.06),
      stripMat.clone()
    );
    divider.position.set(dividerX, -0.5 + H * 0.5, centerZ);
    scene.add(divider);
  });

  const dotMat = new THREE.MeshStandardMaterial({
    color: 0x3e3e3e,
    roughness: 0.3,
    metalness: 0.8,
  });

  [
    [-width / 2 + 0.15, -depth / 2 + 0.15],
    [width / 2 - 0.15, -depth / 2 + 0.15],
    [-width / 2 + 0.15, depth / 2 - 0.15],
    [width / 2 - 0.15, depth / 2 - 0.15],
  ].forEach(([dx, dz]) => {
    const dot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10),
      dotMat
    );
    dot.position.set(centerX + dx, -0.5 + H + 0.025, centerZ + dz);
    scene.add(dot);
  });

  const hotModules = ['dehy', 'pab', 'hardbake'];
  ALL_STEPS.forEach((mod) => {
    if (!hotModules.includes(mod.id)) return;
    if (Math.abs(mod.z - centerZ) > 0.5) return;

    const hotStrip = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 0.04, depth - 0.2),
      new THREE.MeshStandardMaterial({
        color: 0x661100,
        emissive: 0xff2200,
        emissiveIntensity: 1.2,
        roughness: 0.5,
      })
    );
    hotStrip.position.set(mod.x, -0.5 + H + 0.045, centerZ);
    scene.add(hotStrip);

    const bakeGlow = new THREE.PointLight(0xff3300, 0.8, 3);
    bakeGlow.position.set(mod.x, -0.3, centerZ);
    scene.add(bakeGlow);
  });
}

// function addModuleLabel(grp: THREE.Group, mod: ProcessStep): void {
//   // ── SKIP labels for virtual / non-physical modules ──
//   const SKIP_LABEL_IDS = new Set(['spindry', 'iface_in', 'iface_out', 'scanner']);
//   if (SKIP_LABEL_IDS.has(mod.id)) {
//     console.log(`[LABEL] Skipping virtual module: ${mod.id}`);
//     return;
//   }

//   const CW = 512, CH = 160;

//   // ── BUILD LABEL CANVAS (reusable for all faces) ──
//   const buildLabelCanvas = (): HTMLCanvasElement => {
//     const nc = document.createElement("canvas");
//     nc.width = CW;
//     nc.height = CH;
//     const ctx = nc.getContext("2d")!;
//     ctx.clearRect(0, 0, CW, CH);

//     // Dark background pill
//     ctx.fillStyle = "rgba(10, 18, 32, 0.92)";
//     ctx.beginPath();
//     const pillX = 8, pillY = 8, pillW = CW - 16, pillH = CH - 16, pillR = 12;
//     ctx.moveTo(pillX + pillR, pillY);
//     ctx.lineTo(pillX + pillW - pillR, pillY);
//     ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + pillR);
//     ctx.lineTo(pillX + pillW, pillY + pillH - pillR);
//     ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - pillR, pillY + pillH);
//     ctx.lineTo(pillX + pillR, pillY + pillH);
//     ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - pillR);
//     ctx.lineTo(pillX, pillY + pillR);
//     ctx.quadraticCurveTo(pillX, pillY, pillX + pillR, pillY);
//     ctx.closePath();
//     ctx.fill();

//     ctx.strokeStyle = hex2css(mod.color);
//     ctx.lineWidth = 3;
//     ctx.stroke();

//     ctx.fillStyle = hex2css(mod.color);
//     ctx.font = "bold 52px 'Courier New', monospace";
//     ctx.textAlign = "center";
//     ctx.textBaseline = "middle";
//     ctx.shadowColor = hex2css(mod.color);
//     ctx.shadowBlur = 14;
//     ctx.fillText(mod.short, CW / 2, CH * 0.40);

//     ctx.shadowBlur = 4;
//     ctx.fillStyle = "#e8f0ff";
//     ctx.font = "bold 20px 'Inter', 'Arial', sans-serif";
//     ctx.fillText(mod.name, CW / 2, CH * 0.72);

//     if (mod.temp !== null) {
//       ctx.shadowBlur = 0;
//       ctx.fillStyle = mod.temp > 50 ? "#ff6633" : "#33aaff";
//       ctx.font = "bold 16px 'Courier New', monospace";
//       ctx.fillText(`${mod.temp}°C`, CW / 2, CH * 0.90);
//     }
//     return nc;
//   };

//   // ── LABEL DIMENSIONS ──
//   const LABEL_W = 3.0;
//   const LABEL_H = 1.0;
//   const SIDE_LABEL_W = LABEL_W * 0.75;
//   const SIDE_LABEL_H = LABEL_H * 0.75;

//   const boxH = 2.7;
//   const boxD = 2.9;
//   const boxW = 4.0;
//   const MODULE_BASE_Y = 0.5;
//   const labelY = MODULE_BASE_Y + boxH * 0.5;

//   // ── ROW DETECTION ──
//   const isTopRow    = mod.z < -0.5;
//   const isBotRow    = mod.z >  0.5;
//   const isCenterRow = !isTopRow && !isBotRow;
//   const isFoup      = mod.type === 'foup';
//   const isScanner   = mod.id   === 'scanner';

//   console.log(`[LABEL] ${mod.id} z=${mod.z.toFixed(2)} isTopRow=${isTopRow} isBotRow=${isBotRow}`);

//   // ══════════════════════════════════════════════════════════════════════
//   // CAMERA-FACING LABEL (the one user actually sees)
//   //
//   // Camera looks from positive Z toward negative Z direction.
//   // So the side of the module that faces the camera is the +Z side for
//   // EVERY row.
//   //
//   // - TOP ROW (z < 0): camera-facing side is +Z (i.e. toward z=0)
//   // - BOT ROW (z > 0): camera-facing side is -Z (i.e. toward z=0)
//   //
//   // Wait — let me reconsider. The camera orbits, but in the default 
//   // OVERVIEW preset, camera looks DOWN at an angle from +Z + +Y.
//   //
//   // For TOP row at z = -6, the camera (at z ≈ +20) is way on the +Z side.
//   // So the face of TOP row module facing camera is its +Z face.
//   // 
//   // For BOT row at z = +6, the camera is on the SAME +Z side, BUT looking
//   // back toward -Z. The face of BOT row facing camera is also its +Z face.
//   //
//   // BOTH ROWS should have labels on +Z face for the camera-facing label!
//   // ══════════════════════════════════════════════════════════════════════

//   // ──────────────────────────────────────────────────────────────────────
//   // LABEL 1: CAMERA-FACING (always +Z side for both rows)
//   // ──────────────────────────────────────────────────────────────────────
//   const tex1 = new THREE.CanvasTexture(buildLabelCanvas());
//   tex1.minFilter = THREE.LinearFilter;
//   tex1.magFilter = THREE.LinearFilter;

//   const cameraFacingPlane = new THREE.Mesh(
//     new THREE.PlaneGeometry(LABEL_W, LABEL_H),
//     new THREE.MeshBasicMaterial({
//       map: tex1,
//       transparent: true,
//       opacity: 0.97,
//       depthWrite: false,
//       depthTest: true,
//       side: THREE.DoubleSide,
//     })
//   );

//   // Place on +Z face for ALL modules — this is the camera-facing side
//   cameraFacingPlane.position.set(0, labelY, boxD / 2 + 0.05);
//   cameraFacingPlane.rotation.y = 0;          // faces +Z (toward camera)
//   cameraFacingPlane.renderOrder = 100;
//   grp.add(cameraFacingPlane);
//   grp.userData.nameLabel = cameraFacingPlane;

//   // ──────────────────────────────────────────────────────────────────────
//   // LABEL 2: BACK SIDE (-Z face) — visible from behind/opposite angle
//   // ──────────────────────────────────────────────────────────────────────
//   if (!isFoup && !isScanner) {
//     const tex2 = new THREE.CanvasTexture(buildLabelCanvas());
//     tex2.minFilter = THREE.LinearFilter;
//     tex2.magFilter = THREE.LinearFilter;

//     const backPlane = new THREE.Mesh(
//       new THREE.PlaneGeometry(LABEL_W, LABEL_H),
//       new THREE.MeshBasicMaterial({
//         map: tex2,
//         transparent: true,
//         opacity: 0.92,
//         depthWrite: false,
//         depthTest: true,
//         side: THREE.DoubleSide,
//       })
//     );
//     // Place on -Z face
//     backPlane.position.set(0, labelY, -(boxD / 2 + 0.05));
//     backPlane.rotation.y = Math.PI;             // faces -Z
//     backPlane.renderOrder = 100;
//     grp.add(backPlane);
//     grp.userData.outerSideLabel = backPlane;
//   }

//   // ──────────────────────────────────────────────────────────────────────
//   // LABEL 3: +X SIDE LABEL (small, side-on view)
//   // ──────────────────────────────────────────────────────────────────────
//   if (!isScanner && !isFoup) {
//     const tex3 = new THREE.CanvasTexture(buildLabelCanvas());
//     tex3.minFilter = THREE.LinearFilter;
//     tex3.magFilter = THREE.LinearFilter;

//     const sidePlaneX = new THREE.Mesh(
//       new THREE.PlaneGeometry(SIDE_LABEL_W, SIDE_LABEL_H),
//       new THREE.MeshBasicMaterial({
//         map: tex3,
//         transparent: true,
//         opacity: 0.80,
//         depthWrite: false,
//         depthTest: true,
//         side: THREE.DoubleSide,
//       })
//     );
//     sidePlaneX.position.set(boxW / 2 + 0.05, labelY, 0);
//     sidePlaneX.rotation.y = -Math.PI / 2;
//     sidePlaneX.renderOrder = 100;
//     grp.add(sidePlaneX);
//     grp.userData.sideLabelX = sidePlaneX;
//   }

//   // ──────────────────────────────────────────────────────────────────────
//   // LABEL 4: TOP-DOWN ROOF LABEL
//   // ──────────────────────────────────────────────────────────────────────
//   if (!isScanner) {
//     const tex4 = new THREE.CanvasTexture(buildLabelCanvas());
//     tex4.minFilter = THREE.LinearFilter;
//     tex4.magFilter = THREE.LinearFilter;

//     const roofPlane = new THREE.Mesh(
//       new THREE.PlaneGeometry(LABEL_W * 0.85, LABEL_H * 0.85),
//       new THREE.MeshBasicMaterial({
//         map: tex4,
//         transparent: true,
//         opacity: 0.75,
//         depthWrite: false,
//         depthTest: true,
//         side: THREE.DoubleSide,
//       })
//     );
//     roofPlane.position.set(0, MODULE_BASE_Y + boxH + 0.05, 0);
//     roofPlane.rotation.x = -Math.PI / 2;
//     roofPlane.renderOrder = 100;
//     grp.add(roofPlane);
//     grp.userData.roofLabel = roofPlane;
//   }
// }






// function addPlinthNameplates(scene: THREE.Scene): void {
//   ALL_STEPS.forEach((mod) => {
//     if (mod.id === 'foup' || mod.id === 'scanner' || mod.id === 'iface_in' || mod.id === 'iface_out') return;

//     const makeNameplateMesh = (flipY = false): THREE.Mesh => {
//       const CW = 512, CH = 80;
//       const canvas = document.createElement('canvas');
//       canvas.width = CW;
//       canvas.height = CH;
//       const ctx = canvas.getContext('2d')!;

//       ctx.fillStyle = '#0a1020';
//       ctx.fillRect(0, 0, CW, CH);

//       const r = (mod.color >> 16) & 255;
//       const g = (mod.color >> 8) & 255;
//       const b = mod.color & 255;
//       const css = `rgb(${r},${g},${b})`;

//       ctx.fillStyle = css;
//       ctx.fillRect(0, 0, CW, 8);
//       ctx.fillStyle = `rgba(${r},${g},${b},0.8)`;
//       ctx.fillRect(0, CH - 6, CW, 6);

//       ctx.font = 'bold 42px "Courier New", monospace';
//       ctx.fillStyle = css;
//       ctx.shadowColor = css;
//       ctx.shadowBlur = 14;
//       ctx.textAlign = 'left';
//       ctx.fillText(mod.short, 12, 56);

//       ctx.shadowBlur = 0;
//       ctx.font = 'bold 18px Arial, sans-serif';
//       ctx.fillStyle = '#ffffff';
//       ctx.textAlign = 'right';
//       ctx.fillText(
//         mod.name.length > 20 ? mod.name.slice(0, 20) + '…' : mod.name,
//         CW - 10, 36
//       );

//       if (mod.temp !== null) {
//         ctx.font = 'bold 16px "Courier New", monospace';
//         ctx.fillStyle = mod.temp > 50 ? '#ff5522' : '#22aaff';
//         ctx.textAlign = 'right';
//         ctx.fillText(`${mod.temp}°C`, CW - 10, 62);
//       }

//       const tex = new THREE.CanvasTexture(canvas);
//       tex.minFilter = THREE.LinearFilter;
//       tex.magFilter = THREE.LinearFilter;

//       const plate = new THREE.Mesh(
//         new THREE.PlaneGeometry(4.2, 0.65),
//         new THREE.MeshBasicMaterial({
//           map: tex,
//           transparent: false,
//           depthTest: true,
//           depthWrite: true,
//           side: THREE.FrontSide,
//         })
//       );

//       if (flipY) plate.rotation.y = Math.PI;
//       plate.renderOrder = 10;
//       return plate;
//     };

//     // ── Side nameplate (smaller, for left/right X faces) ──
//     const makeSideNameplateMesh = (flipY = false): THREE.Mesh => {
//       const CW = 512, CH = 80;
//       const canvas = document.createElement('canvas');
//       canvas.width = CW;
//       canvas.height = CH;
//       const ctx = canvas.getContext('2d')!;

//       ctx.fillStyle = '#0a1020';
//       ctx.fillRect(0, 0, CW, CH);

//       const r = (mod.color >> 16) & 255;
//       const g = (mod.color >> 8) & 255;
//       const b = mod.color & 255;
//       const css = `rgb(${r},${g},${b})`;

//       ctx.fillStyle = css;
//       ctx.fillRect(0, 0, CW, 8);
//       ctx.fillStyle = `rgba(${r},${g},${b},0.8)`;
//       ctx.fillRect(0, CH - 6, CW, 6);

//       // Short code only on side plate (less space)
//       ctx.font = 'bold 48px "Courier New", monospace';
//       ctx.fillStyle = css;
//       ctx.shadowColor = css;
//       ctx.shadowBlur = 14;
//       ctx.textAlign = 'center';
//       ctx.fillText(mod.short, CW / 2, 58);

//       const tex = new THREE.CanvasTexture(canvas);
//       tex.minFilter = THREE.LinearFilter;
//       tex.magFilter = THREE.LinearFilter;

//       const plate = new THREE.Mesh(
//         new THREE.PlaneGeometry(2.8, 0.65),   // narrower for side face
//         new THREE.MeshBasicMaterial({
//           map: tex,
//           transparent: false,
//           depthTest: true,
//           depthWrite: true,
//           side: THREE.FrontSide,
//         })
//       );

//       if (flipY) plate.rotation.y = Math.PI;
//       plate.renderOrder = 10;
//       return plate;
//     };

//     const PLINTH_H     = 3.2;
//     const PLINTH_Y0    = -0.5;
//     const PLATE_Y      = PLINTH_Y0 + PLINTH_H * 0.40;
//     const FACE_OFFSET  = 2.5;   // Z offset — front/back face
//     const SIDE_OFFSET  = 2.6;   // X offset — left/right face (plinth W=5, half=2.5)

//     const isTopRow = mod.z < 0;
//     const isBotRow = mod.z > 0;

//     if (isTopRow) {
//       // ── FRONT face (+Z, toward camera) ──
//       const front = makeNameplateMesh(false);
//       front.position.set(mod.x, PLATE_Y, mod.z + FACE_OFFSET);
//       front.rotation.y = 0;
//       scene.add(front);

//       // ── LEFT side face (-X) ──
//       const sideLeft = makeSideNameplateMesh(false);
//       sideLeft.position.set(mod.x - SIDE_OFFSET, PLATE_Y, mod.z);
//       sideLeft.rotation.y = Math.PI / 2;   // face -X direction
//       scene.add(sideLeft);

//       // ── RIGHT side face (+X) ──
//       const sideRight = makeSideNameplateMesh(true);
//       sideRight.position.set(mod.x + SIDE_OFFSET, PLATE_Y, mod.z);
//       sideRight.rotation.y = -Math.PI / 2;  // face +X direction
//       scene.add(sideRight);

//     } else if (isBotRow) {
//       // ── FRONT face (-Z, toward camera) ──
//       const front = makeNameplateMesh(true);
//       front.position.set(mod.x, PLATE_Y, mod.z - FACE_OFFSET);
//       front.rotation.y = Math.PI;
//       scene.add(front);

//       // ── LEFT side face (-X) ──
//       const sideLeft = makeSideNameplateMesh(false);
//       sideLeft.position.set(mod.x - SIDE_OFFSET, PLATE_Y, mod.z);
//       sideLeft.rotation.y = Math.PI / 2;
//       scene.add(sideLeft);

//       // ── RIGHT side face (+X) ──
//       const sideRight = makeSideNameplateMesh(true);
//       sideRight.position.set(mod.x + SIDE_OFFSET, PLATE_Y, mod.z);
//       sideRight.rotation.y = -Math.PI / 2;
//       scene.add(sideRight);
//     }
//   });
// }

function addModuleLabel(grp: THREE.Group, mod: ProcessStep): void {
  const SKIP_LABEL_IDS = new Set(['spindry', 'scanner', 'foup', 'iface_in', 'iface_out']);
  if (SKIP_LABEL_IDS.has(mod.id)) {
    console.log(`[LABEL] Skipping virtual/special module: ${mod.id}`);
    return;
  }

  const CW = 512, CH = 140;

  // ── METAL NAMEPLATE CANVAS (replaces dark pill style) ──
  const buildLabelCanvas = (overrideName?: string): HTMLCanvasElement => {
    const nc = document.createElement("canvas");
    nc.width = CW; nc.height = CH;
    const ctx = nc.getContext("2d")!;

    // Base metal gradient
    const metalGrad = ctx.createLinearGradient(0, 0, 0, CH);
    metalGrad.addColorStop(0, "#e2e6ea");
    metalGrad.addColorStop(0.15, "#f5f7f9");
    metalGrad.addColorStop(0.5, "#d0d5da");
    metalGrad.addColorStop(0.85, "#eaedf0");
    metalGrad.addColorStop(1, "#b8bec4");
    ctx.fillStyle = metalGrad;
    ctx.fillRect(0, 0, CW, CH);

    // Brush lines
    ctx.globalAlpha = 0.055;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    for (let y = 2; y < CH; y += 3) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Outer bevel
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CW, 5);
    ctx.fillRect(0, 0, 5, CH);
    ctx.fillStyle = "#6a7078";
    ctx.fillRect(0, CH - 5, CW, 5);
    ctx.fillRect(CW - 5, 0, 5, CH);

    // Inner bevel
    ctx.fillStyle = "#c8cdd2";
    ctx.fillRect(5, 5, CW - 10, 3);
    ctx.fillRect(5, 5, 3, CH - 10);
    ctx.fillStyle = "#90969c";
    ctx.fillRect(5, CH - 8, CW - 10, 3);
    ctx.fillRect(CW - 8, 5, 3, CH - 10);

    // Inner panel gradient
    const innerGrad = ctx.createLinearGradient(0, 10, 0, CH - 10);
    innerGrad.addColorStop(0, "#b8bec4");
    innerGrad.addColorStop(0.3, "#d8dde2");
    innerGrad.addColorStop(0.7, "#cdd2d7");
    innerGrad.addColorStop(1, "#a8adb2");
    ctx.fillStyle = innerGrad;
    ctx.fillRect(8, 8, CW - 16, CH - 16);

    // Color accent stripe (from mod.color)
    const r = (mod.color >> 16) & 255;
    const g = (mod.color >> 8) & 255;
    const b = mod.color & 255;
    ctx.fillStyle = `rgba(${r},${g},${b},0.25)`;
    ctx.fillRect(8, 8, 16, CH - 16);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(8, 8, 10, CH - 16);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect(8, 8, 4, CH - 16);

    // Short code — embossed 3-layer trick
    ctx.font = "bold 56px 'Arial Black', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillText(mod.short, CW / 2 + 1, CH * 0.52 + 1);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(mod.short, CW / 2 - 1, CH * 0.52 - 1);
    ctx.fillStyle = "#1e2328";
    ctx.fillText(mod.short, CW / 2, CH * 0.52);

    // Full name — bold, centered
    const displayName = overrideName ?? (mod.name.length > 24 ? mod.name.slice(0, 24) + "…" : mod.name);
    ctx.font = "bold 22px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillText(displayName, CW / 2 + 1, CH * 0.82 + 1);
    ctx.fillStyle = "#1a2030";
    ctx.fillText(displayName, CW / 2, CH * 0.82);

    // Temperature (from original buildLabelCanvas — kept)
    if (mod.temp !== null) {
      ctx.font = "bold 16px 'Courier New', monospace";
      ctx.fillStyle = mod.temp > 50 ? "#cc3300" : "#0055aa";
      ctx.fillText(`${mod.temp}°C`, CW / 2, CH * 0.96);
    }

    // Corner rivets
    const drawRivet = (rx: number, ry: number) => {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath(); ctx.arc(rx + 1, ry + 1, 7, 0, Math.PI * 2); ctx.fill();
      const rg = ctx.createRadialGradient(rx - 2, ry - 2, 0, rx, ry, 7);
      rg.addColorStop(0, "#e8ecf0");
      rg.addColorStop(0.4, "#a8adb2");
      rg.addColorStop(1, "#787e84");
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(rx, ry, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#555a60";
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(rx - 4, ry); ctx.lineTo(rx + 4, ry); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.beginPath(); ctx.arc(rx - 2, ry - 2, 2.5, 0, Math.PI * 2); ctx.fill();
    };
    drawRivet(22, 22);
    drawRivet(CW - 22, 22);
    drawRivet(22, CH - 22);
    drawRivet(CW - 22, CH - 22);

    return nc;
  };

  // ── LABEL DIMENSIONS ──
  const LABEL_W = 3.0;
  const LABEL_H = 0.85;           // slightly shorter — metal plate is 140px tall not 160px
  const SIDE_LABEL_W = LABEL_W * 0.75;
  const SIDE_LABEL_H = LABEL_H * 0.75;

  const boxH = 2.7;
  const boxD = 2.9;
  const boxW = 4.0;
  const MODULE_BASE_Y = 0.5;
  const labelY = MODULE_BASE_Y + boxH * 0.5;

  const isFoup = mod.type === 'foup';
  const isScanner = mod.id === 'scanner';

  console.log(`[LABEL] ${mod.id} z=${mod.z.toFixed(2)}`);

  // Helper — makes a texture from the metal canvas
  const makeTex = () => {
    const t = new THREE.CanvasTexture(buildLabelCanvas());
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  };

  // Helper — makes a label plane mesh
  const makePlane = (w: number, h: number, opacity: number) =>
    new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        map: makeTex(),
        transparent: true,
        opacity,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
      })
    );

  // ── LABEL 1: CAMERA-FACING (+Z face) ──
  const front = makePlane(LABEL_W, LABEL_H, 0.97);
  front.position.set(0, labelY, boxD / 2 + 0.05);
  front.rotation.y = 0;
  front.renderOrder = 100;
  grp.add(front);
  grp.userData.nameLabel = front;

  // ── LABEL 2: BACK FACE (-Z) ──
  if (!isFoup && !isScanner) {
    const back = makePlane(LABEL_W, LABEL_H, 0.92);
    back.position.set(0, labelY, -(boxD / 2 + 0.05));
    back.rotation.y = Math.PI;
    back.renderOrder = 100;
    grp.add(back);
    grp.userData.outerSideLabel = back;
  }

  // ── LABEL 3: +X SIDE FACE ──
  if (!isScanner && !isFoup) {
    const side = makePlane(SIDE_LABEL_W, SIDE_LABEL_H, 0.80);
    side.position.set(boxW / 2 + 0.05, labelY, 0);
    side.rotation.y = Math.PI / 2;
    side.renderOrder = 100;
    grp.add(side);
    grp.userData.sideLabelX = side;
  }

  // ── ROOF LABEL REMOVED ── No top-down labels
}






// function addPlinthNameplates(scene: THREE.Scene): void {
//   ALL_STEPS.forEach((mod) => {
//     const SKIP_PLINTH_IDS = new Set([
//       'scanner',  // No floating SCAN plinth plates at scanner row
//     ]);
//     if (SKIP_PLINTH_IDS.has(mod.id)) return;

//     const makeNameplateMesh = (): THREE.Mesh => {
//       const CW = 1024, CH = 300;
//       const canvas = document.createElement('canvas');
//       canvas.width = CW;
//       canvas.height = CH;
//       const ctx = canvas.getContext('2d')!;

//       const metalGrad = ctx.createLinearGradient(0, 0, 0, CH);
//       metalGrad.addColorStop(0,    '#dde2e8');
//       metalGrad.addColorStop(0.12, '#f0f4f7');
//       metalGrad.addColorStop(0.45, '#c8ced4');
//       metalGrad.addColorStop(0.88, '#e4e8ec');
//       metalGrad.addColorStop(1,    '#adb4bc');
//       ctx.fillStyle = metalGrad;
//       ctx.fillRect(0, 0, CW, CH);

//       ctx.globalAlpha = 0.045;
//       ctx.strokeStyle = '#ffffff';
//       ctx.lineWidth = 1;
//       for (let y = 2; y < CH; y += 3) {
//         ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke();
//       }
//       ctx.globalAlpha = 1;

//       ctx.fillStyle = '#ffffff';
//       ctx.fillRect(0, 0, CW, 7);
//       ctx.fillRect(0, 0, 7, CH);
//       ctx.fillStyle = '#555c64';
//       ctx.fillRect(0, CH - 7, CW, 7);
//       ctx.fillRect(CW - 7, 0, 7, CH);

//       ctx.fillStyle = '#bcc2c8';
//       ctx.fillRect(7, 7, CW - 14, 4);
//       ctx.fillRect(7, 7, 4, CH - 14);
//       ctx.fillStyle = '#888e94';
//       ctx.fillRect(7, CH - 11, CW - 14, 4);
//       ctx.fillRect(CW - 11, 7, 4, CH - 14);

//       const innerGrad = ctx.createLinearGradient(0, 12, 0, CH - 12);
//       innerGrad.addColorStop(0,   '#b0b8c0');
//       innerGrad.addColorStop(0.25,'#d0d8de');
//       innerGrad.addColorStop(0.75,'#c8d0d6');
//       innerGrad.addColorStop(1,   '#a0a8b0');
//       ctx.fillStyle = innerGrad;
//       ctx.fillRect(11, 11, CW - 22, CH - 22);

//       const shadowGrad = ctx.createLinearGradient(11, 11, 60, 60);
//       shadowGrad.addColorStop(0, 'rgba(0,0,0,0.18)');
//       shadowGrad.addColorStop(1, 'rgba(0,0,0,0)');
//       ctx.fillStyle = shadowGrad;
//       ctx.fillRect(11, 11, CW - 22, CH - 22);

//       const r = (mod.color >> 16) & 255;
//       const g = (mod.color >> 8)  & 255;
//       const b =  mod.color        & 255;
//       ctx.fillStyle = `rgba(${r},${g},${b},0.22)`;
//       ctx.fillRect(11, 11, 24, CH - 22);
//       ctx.fillStyle = `rgb(${r},${g},${b})`;
//       ctx.fillRect(11, 11, 14, CH - 22);
//       ctx.fillStyle = 'rgba(255,255,255,0.5)';
//       ctx.fillRect(11, 11, 5, CH - 22);

//       const sheenGrad = ctx.createLinearGradient(0, 11, 0, 11 + CH * 0.35);
//       sheenGrad.addColorStop(0, 'rgba(255,255,255,0.28)');
//       sheenGrad.addColorStop(1, 'rgba(255,255,255,0)');
//       ctx.fillStyle = sheenGrad;
//       ctx.fillRect(11, 11, CW - 22, CH * 0.35);

//       ctx.font = "bold 120px 'Arial Black', Arial, sans-serif";
//       ctx.textAlign = 'left';
//       ctx.textBaseline = 'alphabetic';
//       ctx.fillStyle = 'rgba(0,0,0,0.45)';
//       ctx.fillText(mod.short, 48, 168);
//       ctx.fillStyle = 'rgba(255,255,255,0.65)';
//       ctx.fillText(mod.short, 46, 166);
//       ctx.fillStyle = '#1a2028';
//       ctx.fillText(mod.short, 47, 167);

//       const displayName = mod.name.length > 26 ? mod.name.slice(0, 26) + '…' : mod.name;
//       ctx.font = "bold 44px 'Arial', sans-serif";
//       ctx.textAlign = 'left';
//       ctx.fillStyle = 'rgba(0,0,0,0.4)';
//       ctx.fillText(displayName, 48, 234);
//       ctx.fillStyle = '#1a2030';
//       ctx.fillText(displayName, 47, 233);

//       if (mod.temp !== null) {
//         const isHot = mod.temp > 50;
//         const tempColor = isHot ? '#cc3300' : '#0055bb';
//         const tempBg    = isHot ? 'rgba(180,40,0,0.13)' : 'rgba(0,60,180,0.13)';
//         ctx.fillStyle = tempBg;
//         ctx.beginPath();
//         ctx.roundRect(CW - 240, 30, 210, 100, 10);
//         ctx.fill();
//         ctx.strokeStyle = tempColor;
//         ctx.lineWidth = 3;
//         ctx.stroke();
//         ctx.font = "bold 72px 'Courier New', monospace";
//         ctx.textAlign = 'center';
//         ctx.fillStyle = 'rgba(0,0,0,0.35)';
//         ctx.fillText(`${mod.temp}°C`, CW - 135 + 2, 108);
//         ctx.fillStyle = 'rgba(255,255,255,0.5)';
//         ctx.fillText(`${mod.temp}°C`, CW - 135 - 1, 106);
//         ctx.fillStyle = tempColor;
//         ctx.fillText(`${mod.temp}°C`, CW - 135, 107);
//       }

//       const drawRivet = (rx: number, ry: number) => {
//         ctx.fillStyle = 'rgba(0,0,0,0.3)';
//         ctx.beginPath(); ctx.arc(rx + 2, ry + 2, 10, 0, Math.PI * 2); ctx.fill();
//         const rg = ctx.createRadialGradient(rx - 3, ry - 3, 0, rx, ry, 10);
//         rg.addColorStop(0,   '#eef2f6');
//         rg.addColorStop(0.4, '#a8b0b8');
//         rg.addColorStop(1,   '#707880');
//         ctx.fillStyle = rg;
//         ctx.beginPath(); ctx.arc(rx, ry, 10, 0, Math.PI * 2); ctx.fill();
//         ctx.strokeStyle = '#505860';
//         ctx.lineWidth = 2;
//         ctx.beginPath(); ctx.moveTo(rx - 5, ry); ctx.lineTo(rx + 5, ry); ctx.stroke();
//         ctx.fillStyle = 'rgba(255,255,255,0.7)';
//         ctx.beginPath(); ctx.arc(rx - 3, ry - 3, 3.5, 0, Math.PI * 2); ctx.fill();
//       };
//       drawRivet(28, 28);
//       drawRivet(CW - 28, 28);
//       drawRivet(28, CH - 28);
//       drawRivet(CW - 28, CH - 28);

//       ctx.fillStyle = `rgba(${r},${g},${b},0.18)`;
//       ctx.fillRect(11, CH - 38, CW - 22, 27);
//       ctx.fillStyle = `rgba(${r},${g},${b},0.7)`;
//       ctx.font = "bold 16px 'Courier New', monospace";
//       ctx.textAlign = 'center';
//       ctx.fillText('SMaRT SIMULATOR — PROCESS MODULE', CW / 2, CH - 18);

//       const tex = new THREE.CanvasTexture(canvas);
//       tex.minFilter = THREE.LinearFilter;
//       tex.magFilter = THREE.LinearFilter;
//       tex.anisotropy = 8;

//       const plate = new THREE.Mesh(
//         new THREE.PlaneGeometry(3.4, 1.4),
//         new THREE.MeshBasicMaterial({
//           map: tex,
//           transparent: false,
//           depthTest: true,
//           depthWrite: true,
//           side: THREE.FrontSide,
//         })
//       );
//       plate.renderOrder = 10;
//       return plate;
//     };

//     // ── POSITIONS ──
//     const PLINTH_H          = 3.2;
//     const PLINTH_Y0         = -0.5;
//     const PLATE_Y           = PLINTH_Y0 + PLINTH_H * 0.50;
//     const FACE_OFFSET       = 2.5;

//     // Interface modules should use the actual module/plinth face offset,
//     // not the generic step spacing used by the row plates.
//     const IFACE_FACE_OFFSET = 1.2; // ~half plinth depth (1.7) + clearance

//     const isIface = mod.id === 'iface_in' || mod.id === 'iface_out';

//     // Two FrontSide plates, back-to-back, each facing outward.
//     const addBackToBack = (centerZ: number) => {
//       // Plate A: faces +Z direction (readable from +Z side)
//       const a = makeNameplateMesh();
//       a.position.set(mod.x, PLATE_Y, centerZ);
//       a.rotation.y = 0;
//       scene.add(a);

//       // Plate B: faces -Z direction (readable from -Z side)
//       const b = makeNameplateMesh();
//       b.position.set(mod.x, PLATE_Y, centerZ);
//       b.rotation.y = Math.PI;
//       scene.add(b);
//     };

//     if (isIface) {
//       addBackToBack(mod.z - IFACE_FACE_OFFSET);
//       addBackToBack(mod.z + IFACE_FACE_OFFSET);
//     } else if (mod.z < 0) {
//       // top row
//       addBackToBack(mod.z + FACE_OFFSET);
//       addBackToBack(mod.z - FACE_OFFSET);
//     } else {
//       // bottom row + center
//       addBackToBack(mod.z - FACE_OFFSET);
//       addBackToBack(mod.z + FACE_OFFSET);
//     }
//   });}






// 



// function addPlinthNameplates(scene: THREE.Scene): void {
//   ALL_STEPS.forEach((mod) => {
//     const SKIP_PLINTH_IDS = new Set([
//       'scanner',  // No floating SCAN plinth plates at scanner row
//     ]);
//     if (SKIP_PLINTH_IDS.has(mod.id)) return;

//     const makeNameplateMesh = (): THREE.Mesh => {
//       const CW = 1024, CH = 300;
//       const canvas = document.createElement('canvas');
//       canvas.width = CW;
//       canvas.height = CH;
//       const ctx = canvas.getContext('2d')!;

//       const metalGrad = ctx.createLinearGradient(0, 0, 0, CH);
//       metalGrad.addColorStop(0,    '#dde2e8');
//       metalGrad.addColorStop(0.12, '#f0f4f7');
//       metalGrad.addColorStop(0.45, '#c8ced4');
//       metalGrad.addColorStop(0.88, '#e4e8ec');
//       metalGrad.addColorStop(1,    '#adb4bc');
//       ctx.fillStyle = metalGrad;
//       ctx.fillRect(0, 0, CW, CH);

//       ctx.globalAlpha = 0.045;
//       ctx.strokeStyle = '#ffffff';
//       ctx.lineWidth = 1;
//       for (let y = 2; y < CH; y += 3) {
//         ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke();
//       }
//       ctx.globalAlpha = 1;

//       ctx.fillStyle = '#ffffff';
//       ctx.fillRect(0, 0, CW, 7);
//       ctx.fillRect(0, 0, 7, CH);
//       ctx.fillStyle = '#555c64';
//       ctx.fillRect(0, CH - 7, CW, 7);
//       ctx.fillRect(CW - 7, 0, 7, CH);

//       ctx.fillStyle = '#bcc2c8';
//       ctx.fillRect(7, 7, CW - 14, 4);
//       ctx.fillRect(7, 7, 4, CH - 14);
//       ctx.fillStyle = '#888e94';
//       ctx.fillRect(7, CH - 11, CW - 14, 4);
//       ctx.fillRect(CW - 11, 7, 4, CH - 14);

//       const innerGrad = ctx.createLinearGradient(0, 12, 0, CH - 12);
//       innerGrad.addColorStop(0,   '#b0b8c0');
//       innerGrad.addColorStop(0.25,'#d0d8de');
//       innerGrad.addColorStop(0.75,'#c8d0d6');
//       innerGrad.addColorStop(1,   '#a0a8b0');
//       ctx.fillStyle = innerGrad;
//       ctx.fillRect(11, 11, CW - 22, CH - 22);

//       const shadowGrad = ctx.createLinearGradient(11, 11, 60, 60);
//       shadowGrad.addColorStop(0, 'rgba(0,0,0,0.18)');
//       shadowGrad.addColorStop(1, 'rgba(0,0,0,0)');
//       ctx.fillStyle = shadowGrad;
//       ctx.fillRect(11, 11, CW - 22, CH - 22);

//       const r = (mod.color >> 16) & 255;
//       const g = (mod.color >> 8)  & 255;
//       const b =  mod.color        & 255;
//       ctx.fillStyle = `rgba(${r},${g},${b},0.22)`;
//       ctx.fillRect(11, 11, 24, CH - 22);
//       ctx.fillStyle = `rgb(${r},${g},${b})`;
//       ctx.fillRect(11, 11, 14, CH - 22);
//       ctx.fillStyle = 'rgba(255,255,255,0.5)';
//       ctx.fillRect(11, 11, 5, CH - 22);

//       const sheenGrad = ctx.createLinearGradient(0, 11, 0, 11 + CH * 0.35);
//       sheenGrad.addColorStop(0, 'rgba(255,255,255,0.28)');
//       sheenGrad.addColorStop(1, 'rgba(255,255,255,0)');
//       ctx.fillStyle = sheenGrad;
//       ctx.fillRect(11, 11, CW - 22, CH * 0.35);

//       ctx.font = "bold 120px 'Arial Black', Arial, sans-serif";
//       ctx.textAlign = 'left';
//       ctx.textBaseline = 'alphabetic';
//       ctx.fillStyle = 'rgba(0,0,0,0.45)';
//       ctx.fillText(mod.short, 48, 168);
//       ctx.fillStyle = 'rgba(255,255,255,0.65)';
//       ctx.fillText(mod.short, 46, 166);
//       ctx.fillStyle = '#1a2028';
//       ctx.fillText(mod.short, 47, 167);

//       const displayName = (mod.name.length > 26 ? mod.name.slice(0, 26) + '…' : mod.name)
//         .replace(/\s+\d+\s*°\s*C/gi, '')
//         .replace(/\s+\d+°C/gi, '')
//         .trim();
//       ctx.font = "bold 44px 'Arial', sans-serif";
//       ctx.textAlign = 'left';
//       ctx.fillStyle = 'rgba(0,0,0,0.4)';
//       ctx.fillText(displayName, 48, 234);
//       ctx.fillStyle = '#1a2030';
//       ctx.fillText(displayName, 47, 233);

//       const drawRivet = (rx: number, ry: number) => {
//         ctx.fillStyle = 'rgba(0,0,0,0.3)';
//         ctx.beginPath(); ctx.arc(rx + 2, ry + 2, 10, 0, Math.PI * 2); ctx.fill();
//         const rg = ctx.createRadialGradient(rx - 3, ry - 3, 0, rx, ry, 10);
//         rg.addColorStop(0,   '#eef2f6');
//         rg.addColorStop(0.4, '#a8b0b8');
//         rg.addColorStop(1,   '#707880');
//         ctx.fillStyle = rg;
//         ctx.beginPath(); ctx.arc(rx, ry, 10, 0, Math.PI * 2); ctx.fill();
//         ctx.strokeStyle = '#505860';
//         ctx.lineWidth = 2;
//         ctx.beginPath(); ctx.moveTo(rx - 5, ry); ctx.lineTo(rx + 5, ry); ctx.stroke();
//         ctx.fillStyle = 'rgba(255,255,255,0.7)';
//         ctx.beginPath(); ctx.arc(rx - 3, ry - 3, 3.5, 0, Math.PI * 2); ctx.fill();
//       };
//       drawRivet(28, 28);
//       drawRivet(CW - 28, 28);
//       drawRivet(28, CH - 28);
//       drawRivet(CW - 28, CH - 28);

//       ctx.fillStyle = `rgba(${r},${g},${b},0.18)`;
//       ctx.fillRect(11, CH - 38, CW - 22, 27);
//       ctx.fillStyle = `rgba(${r},${g},${b},0.7)`;
//       ctx.font = "bold 16px 'Courier New', monospace";
//       ctx.textAlign = 'center';
//       ctx.fillText('SMaRT SIMULATOR — PROCESS MODULE', CW / 2, CH - 18);

//       const tex = new THREE.CanvasTexture(canvas);
//       tex.minFilter = THREE.LinearFilter;
//       tex.magFilter = THREE.LinearFilter;
//       tex.anisotropy = 8;

//       const plate = new THREE.Mesh(
//         new THREE.PlaneGeometry(3.4, 1.4),
//         new THREE.MeshBasicMaterial({
//           map: tex,
//           transparent: false,
//           depthTest: true,
//           depthWrite: true,
//           side: THREE.FrontSide,
//         })
//       );
//       plate.renderOrder = 10;
//       return plate;
//     };

//     // ── POSITIONS ──
//     const PLINTH_H          = 3.2;
//     const PLINTH_Y0         = -0.5;
//     const PLATE_Y           = PLINTH_Y0 + PLINTH_H * 0.50;
//     const FACE_OFFSET       = 2.5;

//     // Interface modules should use the actual module/plinth face offset,
//     // not the generic step spacing used by the row plates.
//     const IFACE_FACE_OFFSET = 1.2; // ~half plinth depth (1.7) + clearance

//     const isIface = mod.id === 'iface_in' || mod.id === 'iface_out';

//     // For iface: nameplates on the ±X side faces (facing along the process line).
//     const addIfaceFrontBack = () => {
//       const SIDE_OFFSET = 3.0;  // ← LINE 32472 — push plates off the ±X faces. Increase if inside box, decrease if floating too far.

//       // Left side plate — faces -X direction
//       const left = makeNameplateMesh();
//       left.position.set(mod.x - SIDE_OFFSET, PLATE_Y, mod.z);
//       left.rotation.y = Math.PI / 2;   // face -X
//       scene.add(left);

//       // Right side plate — faces +X direction
//       const right = makeNameplateMesh();
//       right.position.set(mod.x + SIDE_OFFSET, PLATE_Y, mod.z);
//       right.rotation.y = -Math.PI / 2; // face +X
//       scene.add(right);
//     };

//     // Two FrontSide plates, back-to-back, each facing outward.
//     // FRONT_BACK_OFFSET controls how far off the ±Z faces the plates sit.
//     // Increase if plates are inside the box, decrease if floating too far out.
//     const addBackToBack = (centerZ: number) => {
//       // Plate A: faces +Z direction (readable from +Z side)
//       const a = makeNameplateMesh();
//       a.position.set(mod.x, PLATE_Y, centerZ);
//       a.rotation.y = 0;
//       scene.add(a);

//       // Plate B: faces -Z direction (readable from -Z side)
//       const b = makeNameplateMesh();
//       b.position.set(mod.x, PLATE_Y, centerZ);
//       b.rotation.y = Math.PI;
//       scene.add(b);
//     };

//     if (isIface) {
//       addIfaceFrontBack();
//     } else if (mod.z < 0) {
//       // top row
//       addBackToBack(mod.z + FACE_OFFSET);
//       addBackToBack(mod.z - FACE_OFFSET);
//     } else {
//       // bottom row + center
//       addBackToBack(mod.z - FACE_OFFSET);
//       addBackToBack(mod.z + FACE_OFFSET);
//     }
//   });
// }

function addPlinthNameplates(scene: THREE.Scene): void {
  ALL_STEPS.forEach((mod) => {
    console.log('[PLATE-DBG]', mod.id, 'z=', mod.z,
      'skip?', mod.id === 'scanner',
      'iface?', (mod.id === 'iface_in' || mod.id === 'iface_out'));

   const SKIP_PLINTH_IDS = new Set([
      'scanner',    // No floating SCAN plinth plates at scanner row
      'iface_in',   // IF plates handled in buildNamePlate.attachAllNamePlates
      'iface_out',  // IF plates handled in buildNamePlate.attachAllNamePlates
    ]);
    if (SKIP_PLINTH_IDS.has(mod.id)) return;
    if (SKIP_PLINTH_IDS.has(mod.id)) return;

    const isIface = mod.id === 'iface_in' || mod.id === 'iface_out';

    const makeNameplateMesh = (width = 2.6, height = 1.4): THREE.Mesh => {
      const CW = 1024, CH = 300;
      const canvas = document.createElement('canvas');
      canvas.width = CW;
      canvas.height = CH;
      const ctx = canvas.getContext('2d')!;

      const metalGrad = ctx.createLinearGradient(0, 0, 0, CH);
      metalGrad.addColorStop(0, '#dde2e8');
      metalGrad.addColorStop(0.12, '#f0f4f7');
      metalGrad.addColorStop(0.45, '#c8ced4');
      metalGrad.addColorStop(0.88, '#e4e8ec');
      metalGrad.addColorStop(1, '#adb4bc');
      ctx.fillStyle = metalGrad;
      ctx.fillRect(0, 0, CW, CH);

      ctx.globalAlpha = 0.045;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      for (let y = 2; y < CH; y += 3) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, CW, 7);
      ctx.fillRect(0, 0, 7, CH);
      ctx.fillStyle = '#555c64';
      ctx.fillRect(0, CH - 7, CW, 7);
      ctx.fillRect(CW - 7, 0, 7, CH);

      ctx.fillStyle = '#bcc2c8';
      ctx.fillRect(7, 7, CW - 14, 4);
      ctx.fillRect(7, 7, 4, CH - 14);
      ctx.fillStyle = '#888e94';
      ctx.fillRect(7, CH - 11, CW - 14, 4);
      ctx.fillRect(CW - 11, 7, 4, CH - 14);

      const innerGrad = ctx.createLinearGradient(0, 12, 0, CH - 12);
      innerGrad.addColorStop(0, '#b0b8c0');
      innerGrad.addColorStop(0.25, '#d0d8de');
      innerGrad.addColorStop(0.75, '#c8d0d6');
      innerGrad.addColorStop(1, '#a0a8b0');
      ctx.fillStyle = innerGrad;
      ctx.fillRect(11, 11, CW - 22, CH - 22);

      const shadowGrad = ctx.createLinearGradient(11, 11, 60, 60);
      shadowGrad.addColorStop(0, 'rgba(0,0,0,0.18)');
      shadowGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = shadowGrad;
      ctx.fillRect(11, 11, CW - 22, CH - 22);

      const r = (mod.color >> 16) & 255;
      const g = (mod.color >> 8) & 255;
      const b = mod.color & 255;
      ctx.fillStyle = `rgba(${r},${g},${b},0.22)`;
      ctx.fillRect(11, 11, 24, CH - 22);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(11, 11, 14, CH - 22);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(11, 11, 5, CH - 22);

      const sheenGrad = ctx.createLinearGradient(0, 11, 0, 11 + CH * 0.35);
      sheenGrad.addColorStop(0, 'rgba(255,255,255,0.28)');
      sheenGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheenGrad;
      ctx.fillRect(11, 11, CW - 22, CH * 0.35);

      ctx.font = "bold 120px 'Arial Black', Arial, sans-serif";
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillText(mod.short, 48, 168);
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillText(mod.short, 46, 166);
      ctx.fillStyle = '#1a2028';
      ctx.fillText(mod.short, 47, 167);

      const displayName = (mod.name.length > 26 ? mod.name.slice(0, 26) + '…' : mod.name)
        .replace(/\s+\d+\s*°\s*C/gi, '')
        .replace(/\s+\d+°C/gi, '')
        .trim();
      ctx.font = "bold 44px 'Arial', sans-serif";
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillText(displayName, 48, 234);
      ctx.fillStyle = '#1a2030';
      ctx.fillText(displayName, 47, 233);

      const drawRivet = (rx: number, ry: number) => {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.arc(rx + 2, ry + 2, 10, 0, Math.PI * 2); ctx.fill();
        const rg = ctx.createRadialGradient(rx - 3, ry - 3, 0, rx, ry, 10);
        rg.addColorStop(0, '#eef2f6');
        rg.addColorStop(0.4, '#a8b0b8');
        rg.addColorStop(1, '#707880');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(rx, ry, 10, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#505860';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(rx - 5, ry); ctx.lineTo(rx + 5, ry); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.arc(rx - 3, ry - 3, 3.5, 0, Math.PI * 2); ctx.fill();
      };
      drawRivet(28, 28);
      drawRivet(CW - 28, 28);
      drawRivet(28, CH - 28);
      drawRivet(CW - 28, CH - 28);

      ctx.fillStyle = `rgba(${r},${g},${b},0.18)`;
      ctx.fillRect(11, CH - 38, CW - 22, 27);
      ctx.fillStyle = `rgba(${r},${g},${b},0.7)`;
      ctx.font = "bold 16px 'Courier New', monospace";
      ctx.textAlign = 'center';
      ctx.fillText('SMaRT SIMULATOR — PROCESS MODULE', CW / 2, CH - 18);

      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 8;

      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({
          map: tex,
          transparent: false,
          depthTest: true,
          depthWrite: true,
          side: THREE.DoubleSide,
        })
      );
      plate.renderOrder = 10;
      return plate;
    };

    // ── POSITIONS ──
    const PLINTH_H = 3.2;
    const PLINTH_Y0 = -0.5;
    const PLATE_Y = PLINTH_Y0 + PLINTH_H * 0.50;

    // ── REGULAR MODULE FACE OFFSETS (front vs back, independent) ──
    // FRONT = camera-facing plate (looks correct in your screenshot).
    // BACK  = inner plate — RAISE THIS if it sits inside the box.
    const FRONT_FACE_OFFSET = 2.3;   // ← outward (camera-facing) plate
    const BACK_FACE_ALLOWANCE = 0.3; // ← extra clearance the back gets over the front
    const BACK_FACE_OFFSET = FRONT_FACE_OFFSET + BACK_FACE_ALLOWANCE; // back always sits one allowance further out

    // ── INTERFACE PLATE OFFSETS — independent per face, like regular modules ──
    const IFACE_FRONT_OFFSET = 1.75;                                  // ← +Z (outward/camera-facing) plate
    const IFACE_BACK_ALLOWANCE = 0.45;                                // ← extra clearance the -Z side gets
    const IFACE_BACK_OFFSET = IFACE_FRONT_OFFSET + IFACE_BACK_ALLOWANCE; // back always sits one allowance further out

    // ── Account for iface module Z nudge (plinth is offset, nameplate must match) ──
    const ifaceNudgeZ = isIface ? (IFACE_LOCAL_Z[mod.id] ?? 0) : 0;
    const effectiveZ = mod.z + ifaceNudgeZ;

    // ── INTERFACE: nameplates positioned on process-facing side only ──
    // iface_out bridges TOP row → scanner (sits at z ≈ -3, faces +Z toward scanner)
    // iface_in bridges scanner → BOTTOM row (sits at z ≈ +3, faces -Z from scanner)
    const addIfaceFrontBack = () => {
      // Interface plinths are wide in X, thin in Z. Put a plate on EACH Z face,
      // each rotated to face outward. Narrow IF-only width.
      const IFACE_PLATE_W = 4.2;
      const IFACE_PLATE_H = 1.6;

      // +Z face — plate faces +Z (rotation 0)
      const plusZ = makeNameplateMesh(IFACE_PLATE_W, IFACE_PLATE_H);
      plusZ.position.set(mod.x, PLATE_Y, effectiveZ + IFACE_FRONT_OFFSET);
      plusZ.rotation.y = 0;
      scene.add(plusZ);

      // -Z face — plate faces -Z (rotation π), pushed out by the extra allowance
      const minusZ = makeNameplateMesh(IFACE_PLATE_W, IFACE_PLATE_H);
      minusZ.position.set(mod.x, PLATE_Y, effectiveZ - IFACE_BACK_OFFSET);
      minusZ.rotation.y = Math.PI;
      scene.add(minusZ);

      console.log('[IFACE-PLATE]', mod.id, 'effectiveZ=', effectiveZ,
        'frontOff=', IFACE_FRONT_OFFSET, 'backOff=', IFACE_BACK_OFFSET);
    };

    // ── REGULAR MODULE: front + back with SEPARATE offsets ──
    // outwardSign = +1 if camera-facing plate is on +Z, -1 if on -Z.
    const addBackToBack = (outwardSign: number) => {
      console.log('[PLATE-POS]', mod.id, 'outwardSign=', outwardSign, 'FRONT_OFFSET=', FRONT_FACE_OFFSET, 'BACK_OFFSET=', BACK_FACE_OFFSET);

      // Outward (camera-facing) plate — uses FRONT offset
      const front = makeNameplateMesh();
      front.position.set(mod.x, PLATE_Y, mod.z + outwardSign * FRONT_FACE_OFFSET);
      front.rotation.y = outwardSign > 0 ? 0 : Math.PI;   // face outward
      console.log('[PLATE-FRONT]', mod.id, 'frontZ=', front.position.z, 'frontY=', front.position.y);
      scene.add(front);

      // Inner (back) plate — wider so it reads from behind
      const back = makeNameplateMesh(3.4, 1.45);
      back.position.set(mod.x, PLATE_Y, mod.z - outwardSign * BACK_FACE_OFFSET);
      back.rotation.y = outwardSign > 0 ? Math.PI : 0;    // face the other way
      scene.add(back);
    };

    if (isIface) {
      addIfaceFrontBack();
    } else if (mod.z < 0) {
      // top row — camera-facing side is +Z
      addBackToBack(+1);
    } else {
      // bottom row + center — camera-facing side is -Z
      addBackToBack(-1);
    }
  });
}







function addRowLabelBars(scene: THREE.Scene): void {
  const rowLabels = [
    { z: TOP_Z - 1.8, text: "TOP ROW: DEHY → HMDS → CP-1 → COT → PAB → CP-2", color: 0xffcc55 },
    { z: BOT_Z + 1.8, text: "BOTTOM ROW: PEB → DEV → RINSE → DRY → CP-3 → HBAK", color: 0x55ccff },
  ];

  rowLabels.forEach(({ z, text, color }) => {
    const CW = 1024;
    const CH = 92;
    const nc = document.createElement("canvas");
    nc.width = CW;
    nc.height = CH;
    const ctx = nc.getContext("2d")!;
    ctx.fillStyle = "rgba(4, 12, 24, 0.88)";
    ctx.fillRect(0, 0, CW, CH);
    ctx.strokeStyle = `#${color.toString(16).padStart(6, "0")}`;
    ctx.lineWidth = 14;
    ctx.strokeRect(10, 10, CW - 20, CH - 20);
    ctx.fillStyle = "#d8e8ff";
    ctx.font = "bold 32px 'Inter', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, CW / 2, CH / 2);

    const tex = new THREE.CanvasTexture(nc);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 1.0),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.94, depthWrite: false, side: THREE.DoubleSide })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(4, -0.48, z);
    plane.renderOrder = 2;
    scene.add(plane);
  });
}

// ── Scanner front-face nameplate ─────────────────────────────────────────────
function addScannerNameplate(modObjs: Record<string, THREE.Group>): void {
  const mod = ALL_STEPS.find((s) => s.id === 'scanner');
  if (!mod) return;
  const grp = modObjs['scanner'];
  if (!grp) return;

  // Keep this idempotent for repeated re-tries.
  grp.children.filter((c) => c.userData?.__scannerPlate).forEach((c) => grp.remove(c));

  const sBox = new THREE.Box3().setFromObject(grp);
  if (sBox.isEmpty()) {
    console.warn('[SCAN-PLATE] scanner group bounds empty, retry later');
    return;
  }

  const sMin = grp.worldToLocal(sBox.min.clone());
  const sMax = grp.worldToLocal(sBox.max.clone());
  const localMinZ = Math.min(sMin.z, sMax.z);
  const localMaxZ = Math.max(sMin.z, sMax.z);
  const localMidY = (sMin.y + sMax.y) / 2;

  const CW = 1024, CH = 300;
  const canvas = document.createElement('canvas');
  canvas.width = CW;
  canvas.height = CH;
  const ctx = canvas.getContext('2d')!;

  // ── Metal plate background ──
  const metalGrad = ctx.createLinearGradient(0, 0, 0, CH);
  metalGrad.addColorStop(0, '#dde2e8');
  metalGrad.addColorStop(0.12, '#f0f4f7');
  metalGrad.addColorStop(0.45, '#c8ced4');
  metalGrad.addColorStop(0.88, '#e4e8ec');
  metalGrad.addColorStop(1, '#adb4bc');
  ctx.fillStyle = metalGrad;
  ctx.fillRect(0, 0, CW, CH);

  ctx.globalAlpha = 0.045;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for (let y = 2; y < CH; y += 3) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Bevels
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CW, 7);
  ctx.fillRect(0, 0, 7, CH);
  ctx.fillStyle = '#555c64';
  ctx.fillRect(0, CH - 7, CW, 7);
  ctx.fillRect(CW - 7, 0, 7, CH);

  const innerGrad = ctx.createLinearGradient(0, 12, 0, CH - 12);
  innerGrad.addColorStop(0, '#b0b8c0');
  innerGrad.addColorStop(0.25, '#d0d8de');
  innerGrad.addColorStop(0.75, '#c8d0d6');
  innerGrad.addColorStop(1, '#a0a8b0');
  ctx.fillStyle = innerGrad;
  ctx.fillRect(11, 11, CW - 22, CH - 22);

  // Color accent stripe
  const r = (mod.color >> 16) & 255;
  const g = (mod.color >> 8) & 255;
  const b = mod.color & 255;
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(11, 11, 14, CH - 22);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(11, 11, 5, CH - 22);

  // Short code
  ctx.font = "bold 120px 'Arial Black', Arial, sans-serif";
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillText(mod.short, 48, 168);
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText(mod.short, 46, 166);
  ctx.fillStyle = '#1a2028';
  ctx.fillText(mod.short, 47, 167);

  // Full name
  const displayName = (mod.name.length > 26 ? mod.name.slice(0, 26) + '…' : mod.name)
    .replace(/\s+\d+\s*°\s*C/gi, '')
    .replace(/\s+\d+°C/gi, '')
    .trim();
  ctx.font = "bold 44px 'Arial', sans-serif";
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillText(displayName, 48, 234);
  ctx.fillStyle = '#1a2030';
  ctx.fillText(displayName, 47, 233);

  // Rivets
  const drawRivet = (rx: number, ry: number) => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.arc(rx + 2, ry + 2, 10, 0, Math.PI * 2); ctx.fill();
    const rg = ctx.createRadialGradient(rx - 3, ry - 3, 0, rx, ry, 10);
    rg.addColorStop(0, '#eef2f6');
    rg.addColorStop(0.4, '#a8b0b8');
    rg.addColorStop(1, '#707880');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(rx, ry, 10, 0, Math.PI * 2); ctx.fill();
  };
  drawRivet(28, 28);
  drawRivet(CW - 28, 28);
  drawRivet(28, CH - 28);
  drawRivet(CW - 28, CH - 28);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 1.0),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: false,
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    })
  );

  const FACE_CLEARANCE = 0.05;
  const Y_NUDGE = 0.0;
  plate.position.set(0, localMidY + Y_NUDGE, localMinZ - FACE_CLEARANCE);
  plate.rotation.y = Math.PI; // face −Z toward camera/front
  plate.renderOrder = 50;
  plate.userData.__scannerPlate = true;
  grp.add(plate);

  console.log('[SCAN-PLATE] minZ=', localMinZ.toFixed(2),
    'maxZ=', localMaxZ.toFixed(2), 'midY=', localMidY.toFixed(2),
    'scale=', grp.scale.x.toFixed(3));
}

// ── tiny helper — canvas rounded-rect path ──────────────────────────────────
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
// ─── WAFER STATE MACHINE ─────────────────────────────────────────────────────

// Replace WaferState type:
// ─── WAFER STATE MACHINE ─────────────────────────────────────────────────────
type WaferState =
  | "idle"
  | "conveyor_move"
  | "belt_to_module"
  | "processing"
  | "module_to_belt"
  | "track_approach"
  | "track_pick"
  | "track_carry"
  | "track_place"
  | "done";
class WaferStateMachine {
  wi: number;
  mesh: THREE.Group;
  scene: THREE.Scene;
  stepIdx: number;
  state: WaferState;
  timer: number;
  processTimer: number;
  launched: boolean;
  done: boolean;
  spin: number;
  spinning: boolean;
  carrierRobot: RobotObject | null;
  owner: "none" | "robot" | "conveyor";
  arcStart = new THREE.Vector3();
  arcEnd = new THREE.Vector3();
  arcH = 2.5;
  moveDur = 1;
  moveEl = 0;
  targetPos = new THREE.Vector3();
  conveyorStart = new THREE.Vector3();
  conveyorEnd = new THREE.Vector3();
  conveyorDur = 1;
  conveyorEl = 0;
  onConveyor = false;
  entryStart = new THREE.Vector3();
  entryEnd = new THREE.Vector3();
  entryEl = 0;
  entryDur = 0.55;
  exitStart = new THREE.Vector3();
  exitEnd = new THREE.Vector3();
  exitEl = 0;
  exitDur = 0.55;

  constructor(wi: number, mesh: THREE.Group, scene: THREE.Scene) {
    this.wi = wi;
    this.mesh = mesh;
    this.scene = scene;
    this.stepIdx = 0;
    this.state = "idle";
    this.timer = 0;
    this.processTimer = 0;
    this.launched = false;
    this.done = false;
    this.spin = 0;
    this.spinning = false;
    this.carrierRobot = null;
    this.owner = "none";
  }

  startConveyorMove(from: THREE.Vector3, to: THREE.Vector3, speed: number) {
    this.conveyorEl = 0;
    this.conveyorStart.copy(from);
    this.conveyorEnd.copy(to);
    const dist = from.distanceTo(to);
    this.conveyorDur = Math.max(0.8, dist * 0.055) / speed;
    this.onConveyor = true;
  }

  tickConveyor(dt: number): boolean {
    this.conveyorEl += dt;
    const t = Math.min(this.conveyorEl / this.conveyorDur, 1);
    const e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    this.mesh.position.x = lerp(this.conveyorStart.x, this.conveyorEnd.x, e);
    this.mesh.position.z = this.conveyorStart.z;
    this.mesh.position.y = this.conveyorStart.y;
    this.mesh.rotation.y += dt * 1.2;
    return t >= 1;
  }

  // attachTo(robot: RobotObject): void {
  //   this.carrierRobot = robot;
  //   this.onConveyor = false;
  //   this.owner = "robot";
  //   this.mesh.visible = true;
  //   this.mesh.scale.setScalar(1);

  //   const fork = robot.fork ?? robot.gripper;
  //   robot.group.updateWorldMatrix(true, true);
  //   fork.updateWorldMatrix(true, false);

  //   const worldPos = new THREE.Vector3();
  //   const worldQuat = new THREE.Quaternion();
  //   fork.getWorldPosition(worldPos);
  //   fork.getWorldQuaternion(worldQuat);
  // const offset = new THREE.Vector3(0.8, 0.05, 0);
  // offset.applyQuaternion(worldQuat);
  // worldPos.add(offset);
  //   worldPos.y += 0.003;

  //   this.scene.attach(this.mesh);
  //   this.mesh.position.copy(worldPos);
  //   this.mesh.quaternion.copy(worldQuat);
  //   fork.attach(this.mesh);

  //   const pr = this.mesh.userData.prLayer as THREE.Mesh | undefined;
  //   if (pr) {
  //     const mat = pr.material as THREE.MeshStandardMaterial;
  //     mat.emissive.setHex(0xffffff);
  //     mat.emissiveIntensity = 3.5;
  //     setTimeout(() => {
  //       mat.emissive.setHex(WAFER_COLORS[this.wi]);
  //       mat.emissiveIntensity = 0.9;
  //     }, 180);
  //   }
  //   robot.statusPL.intensity = 3.0;
  //   setTimeout(() => { if (robot.statusPL) robot.statusPL.intensity = 1.2; }, 300);
  // }


  attachTo(robot: RobotObject): void {
    this.carrierRobot = robot;
    this.onConveyor = false;
    this.owner = "robot";
    this.mesh.visible = true;
    this.mesh.scale.setScalar(1);

    const fork = robot.fork ?? robot.gripper;
    robot.group.updateWorldMatrix(true, true);
    fork.updateWorldMatrix(true, false);

    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    fork.getWorldPosition(worldPos);
    fork.getWorldQuaternion(worldQuat);

    // Keep one authoritative attachment point on the end effector. Derive it
    // from the actual fork and wafer bounds so the wafer sits on the blade.
    let attachmentPoint = robot.group.userData.waferAttachmentPoint as THREE.Object3D | undefined;
    if (!attachmentPoint) {
      const forkBoxWorld = new THREE.Box3().setFromObject(fork);
      const forkInverse = new THREE.Matrix4().copy(fork.matrixWorld).invert();
      const forkMin = new THREE.Vector3(Infinity, Infinity, Infinity);
      const forkMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      for (let x = 0; x <= 1; x += 1) for (let y = 0; y <= 1; y += 1) for (let z = 0; z <= 1; z += 1) {
        const corner = new THREE.Vector3(
          x ? forkBoxWorld.max.x : forkBoxWorld.min.x,
          y ? forkBoxWorld.max.y : forkBoxWorld.min.y,
          z ? forkBoxWorld.max.z : forkBoxWorld.min.z,
        ).applyMatrix4(forkInverse);
        forkMin.min(corner);
        forkMax.max(corner);
      }
      const waferBox = new THREE.Box3().setFromObject(this.mesh);
      const waferSize = waferBox.getSize(new THREE.Vector3());
      attachmentPoint = new THREE.Object3D();
      attachmentPoint.name = 'WAFER_ATTACHMENT_POINT';
      attachmentPoint.position.set(
        forkMax.x + waferSize.x * 0.5,
        forkMax.y + waferSize.y * 0.5,
        (forkMin.z + forkMax.z) * 0.5,
      );
      fork.add(attachmentPoint);
      robot.group.userData.waferAttachmentPoint = attachmentPoint;
    }
    attachmentPoint.updateWorldMatrix(true, false);
    attachmentPoint.getWorldPosition(worldPos);
    attachmentPoint.getWorldQuaternion(worldQuat);
    const offset = new THREE.Vector3(0, 0.04, 0);
    offset.applyQuaternion(worldQuat);
    worldPos.add(offset);

    this.scene.attach(this.mesh);
    this.mesh.position.copy(worldPos);
    this.mesh.quaternion.copy(worldQuat);
    fork.attach(this.mesh);

    // ── NO color flash anymore. Only flash the robot's status LED briefly
    //    so the pick is visible without touching the wafer's appearance.
    robot.statusPL.intensity = 3.0;
    setTimeout(() => { if (robot.statusPL) robot.statusPL.intensity = 1.2; }, 300);
  }


  detachAt(worldPos: THREE.Vector3): void {
    if (!this.carrierRobot) return;

    // Preserve world transform by reattaching to scene
    this.scene.attach(this.mesh);
    // Ensure correct visual scale
    this.mesh.scale.setScalar(1);

    // Use the provided anchor world position directly — robot delivered wafer to anchor
    this.mesh.position.set(worldPos.x, worldPos.y, worldPos.z);
    this.mesh.quaternion.identity();

    this.mesh.renderOrder = 999;
    this.mesh.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.renderOrder = 999;
        mesh.frustumCulled = false;
        mesh.visible = true;
      }
    });

    this.carrierRobot = null;
    this.owner = "none";
    this.mesh.visible = true;

    console.log(
      `[DETACH] wafer ${this.wi} placed at`,
      this.mesh.position.toArray().map((v) => v.toFixed(3))
    );
  }
}


class Sim {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  speed: number; paused: boolean; simTime: number; fps: number;
  onUI: (ui: UIState) => void; onLog: (entry: LogEntry) => void; onTooltip: (tt: TooltipState) => void;
  private _frm = 0; private _lastFpsT = 0; private _lastT = 0; private _animId = 0; private _logSeq = 0;
  orbit = { theta: Math.PI * 0.11, phi: 0.36, radius: 48, tT: Math.PI * 0.11, tP: 0.36, tR: 48, cx: 4, cy: 0.2, cz: 0, tcx: 4, tcy: 0.2, tcz: 0, drag: false, btn: -1, sx: 0, sy: 0 };
  modObjs: Record<string, THREE.Group> = {}; busy: Record<string, number> = {};
  robotA!: RobotObject; robotEFEM!: RobotObject; robotB!: RobotObject; robotC!: RobotObject; robotD!: RobotObject;
  gantryRail!: THREE.Group;
  prCoatOverlay!: PrCoatOverlay;
  devOverlay!: DevPuddleOverlay;
  wafers: THREE.Group[] = []; wSMs: WaferStateMachine[] = [];
  spinCoat!: SpinCoatAnimator; devLiquid!: DevLiquidAnimator;
  conveyorTop!: ConveyorBelt;
  conveyorBot!: ConveyorBelt;
  conveyorSegments: ConveyorBelt[] = [];

  // Enhanced loading state machine
  loadingState: string = "IDLE"; // IDLE, MOVE_TO_FOUP, ALIGN_TO_WAFER, APPROACH_WAFER, PICK_WAFER, LIFT_WAFER, RETRACT_FROM_FOUP, TRANSFER_TO_MACHINE, ALIGN_TO_PLACEMENT, LOWER_WAFER, PLACE_WAFER, RELEASE_WAFER, ROBOT_RETRACT, VERIFY_PLACEMENT, LOADING_COMPLETE
  loadingPhaseTime: number = 0;
  waferContact: boolean = false;
  placementVerified: boolean = false;
  processStarted: boolean = false;
  linkConveyors: ConveyorBelt[] = [];
  private _linkShuttles: THREE.Group[] = [];
  private _linkDirs: number[] = [];
  n2Particles!: Particles; waterParticles!: Particles;
  hmdsFog!: HMDSFog;
  heatVapors: Record<string, HeatVapor> = {};
  private _blockBoxes: Record<string, THREE.Box3> = {};
  private _shadowFixApplied = false;
  private _md!: (e: MouseEvent) => void; private _mu!: () => void;
  private _mm!: (e: MouseEvent) => void; private _wh!: (e: WheelEvent) => void;
  private _activeCoatWI = -1; private _activeDevWI = -1;
  private _raycaster = new THREE.Raycaster();
  private _lastRaycastT = 0;
  private _waferPlacementTimer: number | null = null;
  private navStepIndex = 0;
  processState = "IDLE";
  processReady = false;
  waferPlacementCompleted = false;
  waferIsOnFlipFlop = false;
  robotHoldingWafer = false;
  robotIsClearOfPlacementArea = true;

  // ── Narration system ──
  narration: any;
  // Resolves once the NarrationManager module + instance are ready. The manager
  // is created via a dynamic import (SSR-safe), which races against the first
  // start() call. We keep the promise so start()/reset() can reliably announce
  // instead of silently dropping the message when narration is not ready yet.
  private _narrationInit: Promise<any> | null = null;
  /** Flip-chip robot controller; assigned once its GLB finishes loading. */
  flipChipRobot?: FlipChipRobot;
  private _narratedSteps = new Set<string>();
  bonderController: BonderController | null = null;
  bondTransfer: WaferBonderTransfer | null = null;

  private _buildFoup(): THREE.Group {
    const FOUP_WIDTH = 3.2;
    const FOUP_HEIGHT = 3.0;
    const FOUP_LENGTH = 2.8;
    const FOUP_FLOOR_CLEARANCE = 1.2; // raise the first wafer rack off the floor
    const foup = new THREE.Group();
    const step = ALL_STEPS[0];
    foup.name = "foup";
    // Move FOUP CONSERVATIVELY forward - keep completely outside machine
    // Machine boundary: X = 3.2 (Bonder center at 13.2, width 20)
    // FOUP must stay at X < 0 with safe clearance
    const foupForwardX = step.x + INPUT_STATION_CONFIG.foupForwardOffset;  // From -20 to -18
    // ── RELOCATED: was BEHIND the wafer module, now BESIDE it ──
    // Previously (foupForwardX, 0, step.z + FIRST_RACK_OFFSET_Z) = (-18, 0, 6.5),
    // which put the rack directly behind the circular wafer and overlapped the
    // working area. It now sits on the wafer's -X side, sharing the wafer's Z so
    // the two line up as one station. Y stays 0: the model is raised
    // FOUP_FLOOR_CLEARANCE inside the group, so its base already rests on the
    // same work surface as the wafer. The whole group moves as one unit, so
    // every anchor and the GLB child follow automatically.
    // Uniform enlargement of the WHOLE group, so the GLB and every anchor
    // (pickup, approach, the 6 slots) scale together and stay consistent.
    foup.scale.setScalar(RACK_SCALE);
    // Y compensates for that scale: the model is lifted FOUP_FLOOR_CLEARANCE
    // inside the group, and scaling multiplies that lift by RACK_SCALE. Setting
    // y = WORK_SURFACE_Y - FOUP_FLOOR_CLEARANCE * RACK_SCALE puts the rack's
    // base back exactly on the work surface, level with the wafer module.
    foup.position.set(
      RACK_RELOCATED_X,
      WORK_SURFACE_Y - FOUP_FLOOR_CLEARANCE * RACK_SCALE,
      WAFER_MODULE_Z
    );
    foup.userData.originalX = step.x;  // Store original position
    foup.userData.currentForwardOffset = INPUT_STATION_CONFIG.foupForwardOffset;
    foup.userData.pendingBoundingBox = true;  // Mark for collision check after GLB loads
    // Orientation: the rack's own base orientation PLUS a quarter turn about the
    // vertical axis, applied relative to what it already had rather than reset.
    // Y is world-up here, so the rack stays upright - no tilt, no flip.
    foup.rotation.y = WAFER_RACK_ROTATION_Y + RACK_QUARTER_TURN;
    foup.userData.rackRoot = foup;
    foup.userData.rackRotationY = foup.rotation.y;

    // ── PICKUP TARGET: Align with actual first wafer slot inside FOUP ──
    // First slot is at: Y=0.55, Z=0.35 (deep inside, not at front edge)
    // Add +0.12 offset in Z for gripper tool clearance to reach wafer center
    const pickupAnchor = new THREE.Group();
    pickupAnchor.name = "FoupPickupPoint";
    pickupAnchor.position.set(0, 0.55, 0.47);  // Actual wafer slot position + tool offset
    foup.add(pickupAnchor);
    foup.userData.pickupAnchor = pickupAnchor;  

    // ── APPROACH TARGET: Safe entry point for robot to approach FOUP ──
    // Position behind the pickup to give robot room to enter
    const rackApproachTarget = new THREE.Object3D();
    rackApproachTarget.name = "RackApproachTarget";
    rackApproachTarget.position.set(0, 0.55, 0.75);  // Approach from further back
    foup.add(rackApproachTarget);
    foup.userData.rackApproachTarget = rackApproachTarget;
    foup.userData.rackPickTarget = pickupAnchor;
    // WORLD-space front direction. It bakes in the group's actual rotation
    // because the consumer at _startWaferTransfer() uses it directly, without
    // applying the group quaternion:
    //     source.addScaledVector(foupFrontDir, 0.15)
    // Baking WAFER_RACK_ROTATION_Y alone was correct only while the group's
    // rotation equalled it. Now that the rack carries an extra quarter turn,
    // this must follow foup.rotation.y or the gripper offset points 90 degrees
    // off the rack's opening.
    foup.userData.rackFrontDirection = new THREE.Vector3(0, 0, 1)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), foup.rotation.y);

    const slotAnchors: THREE.Object3D[] = [];
    for (let index = 0; index < 6; index += 1) {
      const slotAnchor = new THREE.Group();
      slotAnchor.name = `FoupSlot_${index + 1}`;
      slotAnchor.position.set(0, 0.55 + index * 0.42, 0.35);
      foup.add(slotAnchor);
      slotAnchors.push(slotAnchor);
    }
    foup.userData.slotAnchors = slotAnchors;
    foup.userData.slotCount = slotAnchors.length;
    foup.updateMatrixWorld(true);

    loader.load(
      "/wafer_rack_module.glb",
      (gltf: any) => {
        const model = gltf.scene as THREE.Group;
        const bounds = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        bounds.getSize(size);
        bounds.getCenter(center);
        if (size.x > 0 && size.y > 0 && size.z > 0) {
          model.scale.set(
            FOUP_WIDTH / size.x,
            FOUP_HEIGHT / size.y,
            FOUP_LENGTH / size.z
          );
        }
        model.rotation.y = 0;
        model.position.y = -bounds.min.y * model.scale.y + FOUP_FLOOR_CLEARANCE;
        model.updateMatrixWorld(true);

        const modelBounds = new THREE.Box3().setFromObject(model);
        const sidePanel = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, FOUP_HEIGHT, FOUP_LENGTH),
          new THREE.MeshStandardMaterial({ color: 0x0a0a0c, metalness: 0.25, roughness: 0.55 })
        );
        sidePanel.position.set(
          modelBounds.min.x - 0.06,
          (modelBounds.min.y + modelBounds.max.y) / 2,
          (modelBounds.min.z + modelBounds.max.z) / 2
        );
        sidePanel.castShadow = true;
        sidePanel.receiveShadow = true;
        foup.add(sidePanel);

        const rearPanel = new THREE.Mesh(
          new THREE.BoxGeometry(FOUP_WIDTH, FOUP_HEIGHT, 0.12),
          new THREE.MeshStandardMaterial({ color: 0x0a0a0c, metalness: 0.25, roughness: 0.55 })
        );
        rearPanel.position.set(
          (modelBounds.min.x + modelBounds.max.x) / 2,
          (modelBounds.min.y + modelBounds.max.y) / 2,
          modelBounds.min.z - 0.06
        );
        rearPanel.castShadow = true;
        rearPanel.receiveShadow = true;
        foup.add(rearPanel);
        model.traverse((child: THREE.Object3D) => {
          if ((child as THREE.Mesh).isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        model.name = "wafer_rack_module";
        foup.userData.glbRoot = model;
        foup.add(model);
        foup.updateMatrixWorld(true);
        const rackWorldPosition = new THREE.Vector3();
        const rackWorldQuaternion = new THREE.Quaternion();
        foup.getWorldPosition(rackWorldPosition);
        foup.getWorldQuaternion(rackWorldQuaternion);
        // Collision validation: ensure FOUP stays outside machine
        const foupBox = new THREE.Box3().setFromObject(foup);
        foup.userData.boundingBox = foupBox;
        const machineStartX = 3.2;  // Bonder starts at X=3.2
        const clearance = machineStartX - foupBox.max.x;
        console.log('[FOUP] Position X=' + rackWorldPosition.x.toFixed(2) + ', Clearance to machine=' + clearance.toFixed(2));
      },
      undefined,
      (error: unknown) => console.error("[FOUP] GLB load error:", error)
    );

    return foup;
  }

  private _buildFlipChipBonder(): THREE.Group {
    const FOUP_WIDTH = 3.2;
    const FLIP_CHIP_DISTANCE = 30;
    const FLIP_CHIP_TARGET_WIDTH = 20;
    const wrapper = new THREE.Group();
    const foupStep = ALL_STEPS[0];
    wrapper.name = "flip_chip_bonder";
    wrapper.position.set(foupStep.x + FOUP_WIDTH + FLIP_CHIP_DISTANCE, 0, foupStep.z);

    const bonderController = new BonderController(wrapper);
    this.bonderController = bonderController;
    // ===== GLB-REMOVED (BonderController.load() - /flip_chip_bonder.glb) - re-wire the new module here. See GLB_WIRING_CONTRACT.md =====
//     bonderController.load().then(({ clips }) => {
//         // Shadow setup is handled inside the orchestrator's _fitModel().
//         console.log("[FLIP-CHIP] Animation controller ready", clips);
//       }).catch((error: unknown) => console.error("[FLIP-CHIP] GLB load error:", error));

    return wrapper;
  }

  /**
   * Second wafer module (/waferrxk.glb), placed BESIDE the Input Wafer (FOUP).
   *
   * Owns nothing but this model: its own group, its own transform. The FOUP and
   * the output rack are read but never modified. Everything is derived from the
   * FOUP's live world bounds rather than hard-coded, so if the input station
   * moves, this follows it and stays beside it.
   */
  private _buildSecondWaferModule(foup: THREE.Group): THREE.Group {
    const group = new THREE.Group();
    group.name = 'second_wafer_module';

    // Match the Input Wafer's orientation exactly so they read as one station.
    group.rotation.y = WAFER_RACK_ROTATION_Y;

    // ── Where the FOUP is ──
    // ── FIXED world position - this module does not move ──
    // Pinned to explicit constants rather than derived from the FOUP. Two
    // reasons:
    //   1. The rack is relocated beside this wafer, so deriving the wafer from
    //      the rack would drag the wafer along with it.
    //   2. _buildFoup() loads its model asynchronously, so at this moment the
    //      FOUP holds only empty anchor Object3Ds with no geometry, and
    //      Box3().setFromObject(foup) returns an EMPTY box (min = +Infinity).
    //      Deriving from that put this group at Infinity and it rendered
    //      nowhere at all.
    // The model is centred on X/Z inside the group below, so the group's
    // position IS the wafer's centre.
    group.position.set(WAFER_MODULE_X, WORK_SURFACE_Y, WAFER_MODULE_Z);

    // Guard: never let a non-finite transform through again. If it ever does,
    // say so loudly rather than letting the model vanish silently.
    if (!Number.isFinite(group.position.x) || !Number.isFinite(group.position.z)) {
      console.error(
        '[WAFER-2] non-finite placement computed',
        group.position.toArray(), '- falling back to the pinned position.'
      );
      group.position.set(-18, WORK_SURFACE_Y, 1.2165);
    }

    // NO placeholder geometry here, deliberately. This group renders ONLY
    // /waferrxk.glb. Nothing else is ever added to it, so anything visible at
    // this station is that file and nothing else - if the load fails the spot
    // stays empty and the console says so, rather than showing a stand-in that
    // could be mistaken for the model.

    loadOptimizedGLB(SECOND_RACK_URL, {
      label: 'second wafer module',
      instanceThreshold: 8,
    })
      .then((result) => {
        if (!result) {
          console.error(
            `[WAFER-2] FAILED to load ${SECOND_RACK_URL} - station left empty. ` +
            `Check the Network tab for that URL.`
          );
          return;
        }

        const model = result.scene;

        // ── Uniform scale: preserve aspect ratio, never stretch ──
        // Natural size is ~0.1835 x 0.0160 x 0.1825, so drive the scale off the
        // widest horizontal axis and let height follow.
        model.updateMatrixWorld(true);
        const raw = new THREE.Box3().setFromObject(model);
        const rawSize = new THREE.Vector3();
        raw.getSize(rawSize);
        const widest = Math.max(rawSize.x, rawSize.z);
        if (widest > 0 && Number.isFinite(widest)) {
          model.scale.setScalar(SECOND_MODULE_TARGET_WIDTH / widest);
        }

        // ── Re-measure AFTER scaling, then seat it ──
        // Centre on X/Z and drop min.y to 0 (the group already sits at the work
        // surface), so the base touches the plane exactly: no sink, no float.
        model.position.set(0, 0, 0);
        model.updateMatrixWorld(true);
        const fitted = new THREE.Box3().setFromObject(model);
        const fittedCentre = new THREE.Vector3();
        const fittedSize = new THREE.Vector3();
        fitted.getCenter(fittedCentre);
        fitted.getSize(fittedSize);
        model.position.x -= fittedCentre.x;
        model.position.z -= fittedCentre.z;
        model.position.y -= fitted.min.y;

        model.name = 'second_wafer_model';
        model.traverse((child: THREE.Object3D) => {
          if ((child as THREE.Mesh).isMesh || (child as any).isInstancedMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        group.add(model);

        // Position stays pinned - the model is centred inside the group, so no
        // post-load correction is needed and the wafer never shifts.

        group.updateMatrixWorld(true);
        group.userData.glbRoot = model;
        group.userData.boundingBox = new THREE.Box3().setFromObject(group);

        if (result.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(model);
          result.animations.forEach((clip) => mixer.clipAction(clip).play());
          group.userData.mixer = mixer;
        }

        const finalBox = group.userData.boundingBox as THREE.Box3;
        console.log(
          `[WAFER-2] rendering ${SECOND_RACK_URL} (and nothing else): ` +
          `${result.stats.meshesAfter} meshes, ${result.stats.instancedGroups} instanced groups, ` +
          `nodes ${result.stats.nodesBefore} -> ${result.stats.nodesAfter}`
        );
        console.log(
          `[WAFER-2] seated beside FOUP: size ${fittedSize.x.toFixed(2)} x ` +
          `${fittedSize.y.toFixed(2)} x ${fittedSize.z.toFixed(2)}, ` +
          `base Y=${finalBox.min.y.toFixed(3)} (surface ${WORK_SURFACE_Y}), ` +
          `gap to rack=${(finalBox.min.x - RACK_RELOCATED_MAX_X).toFixed(2)}, ` +
          `centre=[${group.position.x.toFixed(2)}, ${group.position.y.toFixed(2)}, ${group.position.z.toFixed(2)}]`
        );
      })
      .catch((error: unknown) => {
        console.error(
          `[WAFER-2] post-load setup failed for ${SECOND_RACK_URL} - station left empty.`,
          error
        );
      });

    return group;
  }

  /**
   * Flux fixture station (/flux_fixture.glb).
   *
   * Sits on the production axis (X) one RACK_CLEARANCE beyond the wafer rack's
   * +X edge, so the gap between them IS the robot working corridor. Reuses
   * loadOptimizedGLB - no second loader, no second animation loop: its clip is
   * driven by the shared render loop via userData.mixer.
   */
  /**
   * Bounding-box validation of the station layout (spec section 12).
   *
   * Every model loads asynchronously, so this retries until each station has
   * real geometry, then reports the MEASURED world-space clearance and any
   * unintended intersection. Nothing here moves anything - it only reports.
   */
  private _validateLayout(attempt = 0): void {
    const want = ['foup', 'second_wafer_module', 'flux_fixture', 'substage_align'];
    const boxes: Record<string, THREE.Box3> = {};
    for (const key of want) {
      const obj = this.modObjs[key];
      if (!obj) continue;
      const box = new THREE.Box3().setFromObject(obj);
      if (!box.isEmpty()) boxes[key] = box;
    }

    if (Object.keys(boxes).length < want.length) {
      if (attempt < 40) {
        setTimeout(() => this._validateLayout(attempt + 1), 250);
      } else {
        console.warn('[LAYOUT] validation gave up - stations still without geometry:',
          want.filter((k) => !boxes[k]));
      }
      return;
    }

    const rack = boxes.foup;
    const wafer = boxes.second_wafer_module;
    const flux = boxes.flux_fixture;
    const substage = boxes.substage_align;

    // Straight-line check: every station must share one Z on the X flow axis.
    const cz = (b: THREE.Box3) => (b.min.z + b.max.z) / 2;
    const collinear = Object.values(boxes).every(
      (b) => Math.abs(cz(b) - PRODUCTION_AXIS_Z) < 0.01
    );

    // The required clearance, measured from real geometry rather than assumed.
    const clearance = flux.min.x - wafer.max.x;
    const EPS = 1e-6;   // float tolerance; the constants give exactly 30.0

    console.log(
      `[LAYOUT] axis=X  rack X[${rack.min.x.toFixed(2)}, ${rack.max.x.toFixed(2)}]  ` +
      `wafer X[${wafer.min.x.toFixed(2)}, ${wafer.max.x.toFixed(2)}]  ` +
      `flux X[${flux.min.x.toFixed(2)}, ${flux.max.x.toFixed(2)}]  ` +
      `substage X[${substage.min.x.toFixed(2)}, ${substage.max.x.toFixed(2)}]`
    );
    console.log(
      `[LAYOUT] rack->flux clearance = ${clearance.toFixed(3)} ` +
      `(required ${RACK_CLEARANCE}) ` +
      (clearance + EPS >= RACK_CLEARANCE ? 'PASS' : 'FAIL')
    );
    console.log(`[LAYOUT] straight line (shared Z): ${collinear ? 'PASS' : 'FAIL'}`);
    console.log(
      `[LAYOUT] flux->substage gap = ${(substage.min.x - flux.max.x).toFixed(3)} ` +
      `(required ${SUBSTAGE_GAP}) ` +
      (substage.min.x - flux.max.x + EPS >= SUBSTAGE_GAP ? 'PASS' : 'FAIL')
    );
    console.log(
      `[LAYOUT] station order on X: ` +
      (rack.max.x <= wafer.min.x && wafer.max.x <= flux.min.x && flux.max.x <= substage.min.x
        ? 'rack -> wafer -> flux -> substage  PASS'
        : 'OUT OF ORDER  FAIL')
    );

    const surface = WORK_SURFACE_Y;
    for (const [name, box] of Object.entries(boxes)) {
      const seated = Math.abs(box.min.y - surface) < 1e-3;
      if (!seated) {
        console.warn(
          `[LAYOUT] ${name} base Y=${box.min.y.toFixed(3)} is not on the work surface ${surface}`
        );
      }
    }

    const pairs: Array<[string, THREE.Box3, THREE.Box3]> = [
      ['foup <-> wafer', rack, wafer],
      ['foup <-> flux', rack, flux],
      ['wafer <-> flux', wafer, flux],
      ['flux <-> substage', flux, substage],
      ['wafer <-> substage', wafer, substage],
    ];
    for (const [label, a, b] of pairs) {
      if (a.intersectsBox(b)) console.error(`[LAYOUT] OVERLAP: ${label}`);
    }
    console.log('[LAYOUT] collision check complete');
  }

  /**
   * Flip-chip robot station (/FlipChip_Robotfinal.glb), standing in the robot
   * working corridor between the wafer rack and the flux fixture.
   *
   * Uses the asset author's FlipChipRobot controller rather than the generic
   * loader: the rig is skinned, bone-driven, and its Rotary_Actuator rest
   * quaternion is (0.5, 0.5, 0.5, 0.5), so node lookup and rest-pose capture
   * have to happen before the mixer ever runs. It is ticked from the shared
   * render loop - no second RAF, no second animation system.
   */
  private _buildFlipChipRobot(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'flip_chip_robot';
    group.position.set(
      FLIP_ROBOT_POSITION.x,
      FLIP_ROBOT_POSITION.y,
      FLIP_ROBOT_POSITION.z
    );

    const robot = new FlipChipRobot();
    robot
      .load(FLIP_ROBOT_URL)
      .then(() => {
        // Normalise metres -> scene units, once, at load.
        robot.root.scale.setScalar(FLIP_ROBOT_SCALE);
        robot.root.updateMatrixWorld(true);

        // Seat it: centre on X/Z and drop its feet to y = 0 in group space, so
        // the base rests on the same work surface as the other stations.
        const fitted = new THREE.Box3().setFromObject(robot.root);
        const centre = new THREE.Vector3();
        const size = new THREE.Vector3();
        fitted.getCenter(centre);
        fitted.getSize(size);
        robot.root.position.x -= centre.x;
        robot.root.position.z -= centre.z;
        robot.root.position.y -= fitted.min.y;

        group.add(robot.root);
        group.updateMatrixWorld(true);

        this.flipChipRobot = robot;
        group.userData.robot = robot;
        group.userData.boundingBox = new THREE.Box3().setFromObject(group);

        // Run the 7.5 s cycle, looping, driven by the shared loop.
        robot.play();
        robot.onPhaseChange((phase) => {
          this._addLog(`[FLIP ROBOT] ${phase}`, 'move');
        });

        const box = group.userData.boundingBox as THREE.Box3;
        console.log(
          `[FLIP-ROBOT] ${FLIP_ROBOT_URL} seated: size ` +
          `${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}, ` +
          `base Y=${box.min.y.toFixed(3)} (surface ${WORK_SURFACE_Y}), ` +
          `centre=[${group.position.x.toFixed(2)}, ${group.position.y.toFixed(2)}, ${group.position.z.toFixed(2)}], ` +
          `clips=${robot.actions.length}`
        );
      })
      .catch((error: unknown) => {
        console.error(`[FLIP-ROBOT] FAILED to load ${FLIP_ROBOT_URL}.`, error);
      });

    return group;
  }

  /**
   * Substrate align stage (/SUBSTAGE_Align.glb) - the station AFTER the flux
   * fixture on the production axis. Same loader, same seating rules, same
   * shared render loop as every other station.
   */
  private _buildSubstageAlign(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'substage_align';
    group.position.set(SUBSTAGE_POSITION.x, SUBSTAGE_POSITION.y, SUBSTAGE_POSITION.z);

    loadOptimizedGLB(SUBSTAGE_URL, { label: 'substrate align stage' })
      .then((result) => {
        if (!result) {
          console.error(`[SUBSTAGE] FAILED to load ${SUBSTAGE_URL} - station left empty.`);
          return;
        }

        const model = result.scene;
        model.scale.setScalar(SUBSTAGE_SCALE);
        model.updateMatrixWorld(true);

        // Measure AFTER scaling, then seat: centre on X/Z, base to y = 0 in
        // group space so it rests on the shared work surface.
        const fitted = new THREE.Box3().setFromObject(model);
        const centre = new THREE.Vector3();
        const size = new THREE.Vector3();
        fitted.getCenter(centre);
        fitted.getSize(size);
        model.position.x -= centre.x;
        model.position.z -= centre.z;
        model.position.y -= fitted.min.y;

        model.name = 'substage_align_model';
        model.traverse((child: THREE.Object3D) => {
          if ((child as THREE.Mesh).isMesh || (child as any).isInstancedMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        group.add(model);
        group.updateMatrixWorld(true);

        // Placement height, measured not guessed: the top of SUBSTAGE_ActiveSite
        // is where the flipped chip is set down.
        const activeSite = model.getObjectByName('SUBSTAGE_ActiveSite');
        const siteBox = new THREE.Box3().setFromObject(activeSite ?? model);
        group.userData.glbRoot = model;
        group.userData.boundingBox = new THREE.Box3().setFromObject(group);
        group.userData.placeSurfaceY = siteBox.max.y;
        group.userData.activeSiteNode = activeSite ?? null;

        const placeTarget = new THREE.Object3D();
        placeTarget.name = 'SubstagePlaceTarget';
        placeTarget.position.set(0, siteBox.max.y - group.position.y, 0);
        group.add(placeTarget);
        group.userData.placeTarget = placeTarget;

        const box = group.userData.boundingBox as THREE.Box3;
        console.log(
          `[SUBSTAGE] ${SUBSTAGE_URL} seated: size ` +
          `${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}, ` +
          `base Y=${box.min.y.toFixed(3)} (surface ${WORK_SURFACE_Y}), ` +
          `placeSurfaceY=${siteBox.max.y.toFixed(3)}, ` +
          `centre=[${group.position.x.toFixed(2)}, ${group.position.y.toFixed(2)}, ${group.position.z.toFixed(2)}]`
        );
      })
      .catch((error: unknown) => {
        console.error(`[SUBSTAGE] post-load setup failed for ${SUBSTAGE_URL}.`, error);
      });

    return group;
  }

  private _buildFluxFixture(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'flux_fixture';
    group.position.set(
      FLUX_FIXTURE_POSITION.x,
      FLUX_FIXTURE_POSITION.y,
      FLUX_FIXTURE_POSITION.z
    );

    loadOptimizedGLB(FLUX_FIXTURE_URL, { label: 'flux fixture' })
      .then((result) => {
        if (!result) {
          console.error(
            `[FLUX] FAILED to load ${FLUX_FIXTURE_URL} - station left empty.`
          );
          return;
        }

        const model = result.scene;

        // Single normalisation factor, applied once at load.
        model.scale.setScalar(FLUX_FIXTURE_SCALE);
        model.updateMatrixWorld(true);

        // Measure AFTER scaling, then seat: centre on X/Z and drop the base to
        // y = 0 in group space (the group already sits at the work surface), so
        // the fixture rests on the surface exactly - no sinking, no floating.
        const fitted = new THREE.Box3().setFromObject(model);
        const centre = new THREE.Vector3();
        const size = new THREE.Vector3();
        fitted.getCenter(centre);
        fitted.getSize(size);
        model.position.x -= centre.x;
        model.position.z -= centre.z;
        model.position.y -= fitted.min.y;

        model.name = 'flux_fixture_model';
        model.traverse((child: THREE.Object3D) => {
          if ((child as THREE.Mesh).isMesh || (child as any).isInstancedMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        group.add(model);
        group.updateMatrixWorld(true);

        // ── Contact height, measured not guessed ──
        // The chip must touch the flux gel, not hover over it or sink through
        // it. Take the world-space top of the FluxSurface node when the model
        // provides one, else fall back to the whole fixture's top.
        const fluxSurface = model.getObjectByName('FluxSurface');
        const surfaceBox = new THREE.Box3().setFromObject(fluxSurface ?? model);
        const fixtureBox = new THREE.Box3().setFromObject(group);
        group.userData.glbRoot = model;
        group.userData.boundingBox = fixtureBox;
        group.userData.fluxSurfaceY = surfaceBox.max.y;
        group.userData.fluxSurfaceNode = fluxSurface ?? null;

        // Dip target: directly above the flux surface, on the production axis.
        const dipTarget = new THREE.Object3D();
        dipTarget.name = 'FluxDipTarget';
        dipTarget.position.set(0, surfaceBox.max.y - group.position.y, 0);
        group.add(dipTarget);
        group.userData.dipTarget = dipTarget;

        if (result.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(model);
          result.animations.forEach((clip) => mixer.clipAction(clip).play());
          group.userData.mixer = mixer;
        }

        console.log(
          `[FLUX] ${FLUX_FIXTURE_URL} seated: size ` +
          `${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}, ` +
          `base Y=${fixtureBox.min.y.toFixed(3)} (surface ${WORK_SURFACE_Y}), ` +
          `fluxSurfaceY=${surfaceBox.max.y.toFixed(3)}, ` +
          `centre=[${group.position.x.toFixed(2)}, ${group.position.y.toFixed(2)}, ${group.position.z.toFixed(2)}], ` +
          `clips=[${result.animations.map((a) => a.name).join(', ')}]`
        );
      })
      .catch((error: unknown) => {
        console.error(`[FLUX] post-load setup failed for ${FLUX_FIXTURE_URL}.`, error);
      });

    return group;
  }

  private _buildFinalWaferRack(): THREE.Group {
    const RACK_WIDTH = 3.2;
    const RACK_HEIGHT = 8;
    const RACK_LENGTH = 2.8;
    const BONDER_WIDTH = 20;
    const RACK_DISTANCE = 16;
    const foupStep = ALL_STEPS[0];
    const bonderCenterX = foupStep.x + 3.2 + 30;
    const wrapper = new THREE.Group();
    wrapper.name = "final_wafer_rack";
    // Rotate the complete output rack 180° around Y axis so front faces robot
    wrapper.rotation.y = OUTPUT_RACK_ROTATION_Y;
    wrapper.userData.rackRoot = wrapper;
    wrapper.userData.rackRotationY = OUTPUT_RACK_ROTATION_Y;

    // Front (opening) of the rack is local +Z; after 180° rotation, it faces
    // the robot from the opposite side. The robot approaches from the new front.
    // Adjust pickup anchor position to account for 180° rotation
    const pickupAnchor = new THREE.Group();
    pickupAnchor.name = "FinalRackPickupPoint";
    pickupAnchor.position.set(0, 1.15, -2.2); // Adjusted for 180° rotation (front is now at -Z)
    wrapper.add(pickupAnchor);
    wrapper.userData.pickupAnchor = pickupAnchor;

    const rackApproachTarget = new THREE.Object3D();
    rackApproachTarget.name = "FinalRackApproachTarget";
    rackApproachTarget.position.set(0, 1.15, -2.7); // Adjusted for 180° rotation
    wrapper.add(rackApproachTarget);
    wrapper.userData.rackApproachTarget = rackApproachTarget;
    wrapper.userData.rackPickTarget = pickupAnchor;
    wrapper.userData.rackFrontDirection = new THREE.Vector3(0, 0, -1) // Front direction after 180° rotation
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), OUTPUT_RACK_ROTATION_Y);
    wrapper.position.set(
      bonderCenterX,
      0,
      foupStep.z + BONDER_WIDTH / 2 + RACK_DISTANCE + RACK_WIDTH / 2
    );


    // ===== GLB-REMOVED (final OUTPUT wafer rack - /wafer_rack_module.glb) - re-wire the new module here. See GLB_WIRING_CONTRACT.md =====
//     loader.load(
//       "/wafer_rack_module.glb",
//       (gltf: any) => {
//         const model = gltf.scene as THREE.Group;
//         const bounds = new THREE.Box3().setFromObject(model);
//         const size = new THREE.Vector3();
//         bounds.getSize(size);
//         if (size.x > 0 && size.y > 0 && size.z > 0) {
//           model.scale.set(
//             RACK_WIDTH / size.x,
//             RACK_HEIGHT / size.y,
//             RACK_LENGTH / size.z
//           );
//         }
// 
//         model.updateMatrixWorld(true);
//         const scaledBounds = new THREE.Box3().setFromObject(model);
//         const center = new THREE.Vector3();
//         scaledBounds.getCenter(center);
//         model.position.x -= center.x;
//         model.position.z -= center.z;
//         model.position.y -= scaledBounds.min.y;
//         model.name = "final_wafer_rack_model";
//         model.traverse((child: THREE.Object3D) => {
//           if ((child as THREE.Mesh).isMesh) {
//             child.castShadow = true;
//             child.receiveShadow = true;
//           }
//         });
// 
//         // ── Add solid back panel to close the rear side ──
//         // After 180° rotation, the back panel should be at local +Z (originally front)
//         // The front opening is now at local -Z after 180° rotation
//         const backPanelGeometry = new THREE.BoxGeometry(RACK_WIDTH, RACK_HEIGHT, 0.08);
//         const backPanelMaterial = new THREE.MeshStandardMaterial({
//           color: 0x4a5568,
//           metalness: 0.6,
//           roughness: 0.4,
//         });
//         const backPanel = new THREE.Mesh(backPanelGeometry, backPanelMaterial);
//         // Back panel at local +Z (the side opposite to front opening after 180° rotation)
//         backPanel.position.set(0, RACK_HEIGHT / 2, RACK_LENGTH / 2 + 0.04);
//         backPanel.castShadow = true;
//         backPanel.receiveShadow = true;
//         backPanel.name = "FinalRackBackPanel";
//         wrapper.add(backPanel);
// 
//         // Add stiffening ribs to back panel for realism
//         const ribMaterial = new THREE.MeshStandardMaterial({
//           color: 0x3a4558,
//           metalness: 0.7,
//           roughness: 0.3,
//         });
//         for (let i = 0; i < 5; i++) {
//           const rib = new THREE.Mesh(
//             new THREE.BoxGeometry(RACK_WIDTH, 0.06, 0.06),
//             ribMaterial
//           );
//           rib.position.set(0, (i + 1) * (RACK_HEIGHT / 6), RACK_LENGTH / 2 + 0.08);
//           rib.castShadow = true;
//           rib.receiveShadow = true;
//           wrapper.add(rib);
//         }
// 
//         wrapper.userData.glbRoot = model;
//         wrapper.userData.isFinalRack = true;
//         wrapper.userData.hasBackPanel = true;
//         wrapper.add(model);
//       },
//       undefined,
//       (error: unknown) => console.error("[FINAL-RACK] GLB load error:", error)
//     );

    return wrapper;
  }

  constructor(renderer: THREE.WebGLRenderer, onUI: (ui: UIState) => void, onLog: (e: LogEntry) => void, onTooltip: (tt: TooltipState) => void) {
    try {
      console.log('[SIM] Constructor starting...');
      this.renderer = renderer; this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(44, renderer.domElement.clientWidth / renderer.domElement.clientHeight, 0.08, 350);
      this.speed = 1; this.paused = false; this.simTime = 0; this.fps = 60;
      this.onUI = onUI; this.onLog = onLog; this.onTooltip = onTooltip;

      // ── Initialize narration ──
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        const init = import('../lib/NarrationManager').then((module) => {
          const NarrationManager = module.NarrationManager || module.default;
          if (NarrationManager) {
            this.narration = new NarrationManager({
              rate: 0.95,
              pitch: 1.0,
              volume: 0.85,
            });
            console.log('[SIM] Narration system initialized');
            return this.narration;
          }
          return null;
        }).catch(err => {
          console.warn('[SIM] Narration failed to load:', err);
          return null;
        });
        this._narrationInit = init;
      }

      console.log('[SIM] Calling _build()...');
      this._build();
      console.log('[SIM] Calling _bindEvents()...');
      this._bindEvents();
      console.log('[SIM] Constructor completed successfully');
    } catch (error) {
      console.error('[SIM] Constructor error:', error);
      throw error;
    }
  }

  // Signal that a video modal is open so the render loop can throttle/skip frames
  setVideoOpen(open: boolean) {
    (this as any)._videoOpen = open;
    console.log("[PERF] Video open state:", open);
  }

  private _addLog(msg: string, cls: LogEntry["cls"] = "") { this.onLog({ id: ++this._logSeq, msg, cls }); }

  private _build() {
    try {
      console.log('[SIM] _build() starting...');
      setupLighting(this.scene);
      console.log('[SIM] Lighting setup complete');
      buildEnv(this.scene);
      console.log('[SIM] Environment build complete');
      const foup = this._buildFoup();
      this.modObjs.foup = foup;
      this.scene.add(foup);
      console.log('[SIM] FOUP build complete');

      // Second wafer module, parked beside the Input Wafer. Built after the
      // FOUP so it can measure the FOUP's real world bounds; it reads them but
      // never modifies the FOUP itself.
      const secondWafer = this._buildSecondWaferModule(foup);
      this.modObjs.second_wafer_module = secondWafer;
      this.scene.add(secondWafer);
      console.log('[SIM] Second wafer module build complete');

      // Flux fixture, one robot corridor (RACK_CLEARANCE) downstream on X.
      // Flip-chip robot, standing in the corridor between rack and fixture.
      const flipChipRobot = this._buildFlipChipRobot();
      this.modObjs.flip_chip_robot = flipChipRobot;
      this.scene.add(flipChipRobot);
      console.log('[SIM] Flip chip robot build complete');

      const fluxFixture = this._buildFluxFixture();
      this.modObjs.flux_fixture = fluxFixture;
      this.scene.add(fluxFixture);
      console.log('[SIM] Flux fixture build complete');

      // Substrate align stage - the station after the flux fixture.
      const substageAlign = this._buildSubstageAlign();
      this.modObjs.substage_align = substageAlign;
      this.scene.add(substageAlign);
      console.log('[SIM] Substrate align stage build complete');

      // Reports measured clearance / collinearity / overlaps once every model
      // has landed. Report-only: it never repositions anything.
      this._validateLayout();
      const flipChipBonder = this._buildFlipChipBonder();
      this.modObjs.flip_chip_bonder = flipChipBonder;
      this.scene.add(flipChipBonder);
      console.log('[SIM] Flip chip bonder build complete');
    const finalWaferRack = this._buildFinalWaferRack();
    this.modObjs.final_wafer_rack = finalWaferRack;
    this.scene.add(finalWaferRack);
    console.log('[SIM] Final wafer rack build complete');

    // Use the existing articulated GLB as the single EFEM carrier. The
    // animation loop below owns its motion and prevents duplicate controllers.
    const rackApproachTarget = foup.userData.rackApproachTarget as THREE.Object3D | undefined;
    const robotStart = new THREE.Vector3(EFEM_X, 0, EFEM_Z + ROBOT_OFFSET_Z);
    if (rackApproachTarget) {
      foup.updateMatrixWorld(true);
      rackApproachTarget.getWorldPosition(robotStart);
      robotStart.y = 0;
      robotStart.z += ROBOT_OFFSET_Z;
    }
    // ===== GLB-REMOVED (buildRobotGLB() call site - EFEM robot wiring) - re-wire the new module here. See GLB_WIRING_CONTRACT.md =====
//     buildRobotGLB(
//       this.scene,
//       robotStart,
//       0x00d8ff,
//       3.5,
//       (robot) => {
//         this.robotEFEM = robot;
//         robot.group.userData.railX = robotStart.x;
//         robot.group.userData.armPhase = 'idle';
//         robot.group.userData.phaseT = 0;
//         robot.group.userData.gripperState = 0;
//         console.log('[SIM] roboticarm.glb connected to EFEM wafer process');
//       }
//     );
    console.log('[SIM] Robot GLB build complete');

    // Only the EFEM wafer-loading robot remains in the scene. The final rack is
    // used as a placement target only; no second robot is created here.

    // ── Wafer rack (FOUP) → Flip Chip Bonder pedestal transfer controller ──
    // The EFEM robot loads asynchronously (GLB), so pass a getter that the
    // controller resolves at call time.
    this.bondTransfer = new WaferBonderTransfer({
      scene: this.scene,
      robot: this.robotEFEM,
      getRobot: () => this.robotEFEM,
      onPlacementComplete: () => this._onWaferPlacementComplete(),
      onNarrate: (text) => {
        if (this.narration?.isEnabled()) {
          this.narration.speak(text, 'normal');
        }
      },
      modObjs: this.modObjs, // Pass modObjs for collision detection
    });

    // ── Configure output transfer references in BonderController ──
    if (this.bonderController) {
      this.bonderController.setOutputTransferReferences({
        robot: this.robotEFEM,
        outputRack: finalWaferRack,
        modObjs: this.modObjs,
      });

      // Listen for chip sequence completion to trigger output transfer
      this.bonderController.on('CHIP_SEQUENCE_COMPLETE', () => {
        this._onChipSequenceComplete();
      });
    }
    console.log('[SIM] Wafer bond transfer controller initialized');
    console.log('[SIM] _build() completed successfully');
    } catch (error) {
      console.error('[SIM] _build() error:', error);
      throw error;
    }
  }

  /** Conveyor-belt links connecting the Blender modules: FOUP ↔ Flip Chip Bonder ↔ Final Wafer Rack. */
  private _buildModuleLink(): void {
    const foupStep = ALL_STEPS[0];
    // Same constants as _buildFoup / _buildFlipChipBonder / _buildFinalWaferRack
    const FOUP_LENGTH = 2.8;          // foup is rotated 90°, so its X footprint is FOUP_LENGTH
    const FLIP_CHIP_DISTANCE = 30;
    const BONDER_WIDTH = 20;

    const bonderCenterX = foupStep.x + 3.2 + FLIP_CHIP_DISTANCE;

    // Link 1: FOUP output edge → bonder input face
    const spans: Array<{ startX: number; endX: number; color: number }> = [
      {
        startX: foupStep.x + FOUP_LENGTH / 2 + 0.7,
        endX: bonderCenterX - BONDER_WIDTH / 2 + 1.0,
        color: 0x00d8ff,
      },
    ];

    for (const sp of spans) this._buildLinkBelt(sp.startX, sp.endX, foupStep.z, sp.color);
    console.log(`[LINK] ${spans.length} module-link belts built @ z=${foupStep.z}`);
  }

  /** Build one link belt plus its wafer-carrying shuttle pod. */
  private _buildLinkBelt(startX: number, endX: number, z: number, color: number): void {
    this.linkConveyors.push(new ConveyorBelt(this.scene, startX, endX, z, color));

    const BELT_TOP = 0.22; // matches ConveyorBelt default surface height

    // Carrier pod that shuttles a wafer between the two modules
    const shuttle = new THREE.Group();
    shuttle.name = "ModuleLinkShuttle";

    const podMat = new THREE.MeshStandardMaterial({ color: 0x9fb2c8, roughness: 0.3, metalness: 0.85 });
    const pod = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 1.9), podMat);
    pod.position.y = BELT_TOP + 0.06;
    pod.castShadow = true;
    pod.receiveShadow = true;
    shuttle.add(pod);

    const wafer = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.06, perfSegments(48)),
      new THREE.MeshPhysicalMaterial({
        color: 0x8899cc,
        roughness: 0.05,
        metalness: 0.6,
        clearcoat: 0.4,
        clearcoatRoughness: 0.2,
        emissive: 0x112244,
        emissiveIntensity: 0.15,
      })
    );
    wafer.position.y = BELT_TOP + 0.15;
    wafer.castShadow = true;
    shuttle.add(wafer);

    shuttle.userData.linkMinX = startX + 0.75;
    shuttle.userData.linkMaxX = endX - 0.75;
    shuttle.userData.linkSpeed = 2.2;

    shuttle.position.set(startX + 0.75, 0, z);
    this._linkShuttles.push(shuttle);
    this._linkDirs.push(1);
    this.scene.add(shuttle);

    console.log(`[LINK] Module link belt built: x ${startX.toFixed(1)} → ${endX.toFixed(1)} @ z=${z}`);
  }

  /** Animate the module-link belts and their shuttle pods (ping-pong between modules). */
  private _tickModuleLinks(dt: number): void {
    if (dt <= 0) return;
    this._linkShuttles.forEach((s, i) => {
      const minX = s.userData.linkMinX as number;
      const maxX = s.userData.linkMaxX as number;
      const speed = s.userData.linkSpeed as number;

      let dir = this._linkDirs[i];
      let nx = s.position.x + speed * dt * dir;
      if (nx >= maxX) { nx = maxX; dir = -1; }
      else if (nx <= minX) { nx = minX; dir = 1; }
      s.position.x = nx;
      this._linkDirs[i] = dir;

      this.linkConveyors[i]?.tick(dt, 0.5, dir);
    });
  }

  private _preloadVideos() {
    const videos = [
      '/pr_coat_anim.mp4',
      '/developeranimation.mp4',
    ];
    videos.forEach((src) => {
      const v = document.createElement('video');
      v.src = src;
      v.preload = 'auto';
      v.muted = true;
      v.load();
      (this as any)['_preloaded_' + src] = v;
    });
    console.log('[VIDEO] Preloaded', videos.length, 'micro-videos');
  }

  private _buildRailTrack(): void {
    // A thin flat beam along the floor connecting FOUP to end of track
    const TRACK_MIN_X = -20;
    const TRACK_MAX_X = 26;
    const trackLen = TRACK_MAX_X - TRACK_MIN_X;

    // Main rail beam — sits flush on the floor
    const railGeo = new THREE.BoxGeometry(trackLen, 0.08, 0.32);
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x223344,
      metalness: 0.85,
      roughness: 0.25,
    });
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(TRACK_MIN_X + trackLen / 2, 0.04, 0);   // sits on Y=0 floor
    rail.castShadow = true;
    rail.receiveShadow = true;
    this.scene.add(rail);

    // Two thin guide rails (top edges)
    const guideGeo = new THREE.BoxGeometry(trackLen, 0.04, 0.04);
    const guideMat = new THREE.MeshStandardMaterial({
      color: 0x00d8ff,
      metalness: 0.9,
      roughness: 0.1,
      emissive: new THREE.Color(0x00d8ff),
      emissiveIntensity: 0.4,
    });
    [-0.13, 0.13].forEach(zOff => {
      const guide = new THREE.Mesh(guideGeo, guideMat);
      guide.position.set(TRACK_MIN_X + trackLen / 2, 0.10, zOff);
      guide.castShadow = false;
      guide.receiveShadow = false;
      this.scene.add(guide);
    });

    // Tick marks every 2 units so it reads as a machined rail
    for (let x = TRACK_MIN_X; x <= TRACK_MAX_X; x += 2) {
      const tickGeo = new THREE.BoxGeometry(0.04, 0.06, 0.32);
      const tick = new THREE.Mesh(tickGeo, railMat);
      tick.position.set(x, 0.07, 0);
      tick.castShadow = false;
      tick.receiveShadow = true;
      this.scene.add(tick);
    }
  }

  private _reconnectPrCoatNozzle(prCoatGroup: THREE.Group): void {
    // Find or create nozzle assembly group
    let nozzleGroup = prCoatGroup.userData.nozzleGroup as THREE.Group;
    if (!nozzleGroup) {
      nozzleGroup = new THREE.Group();
      nozzleGroup.name = "NozzleAssembly";
      prCoatGroup.add(nozzleGroup);
      prCoatGroup.userData.nozzleGroup = nozzleGroup;
    }

    // Clear existing nozzle parts to rebuild properly
    while (nozzleGroup.children.length) {
      nozzleGroup.remove(nozzleGroup.children[0]);
    }

    // Materials
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x778899, roughness: 0.12, metalness: 0.94 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.15, metalness: 0.92 });
    const tipMat = new THREE.MeshStandardMaterial({ color: 0xbb9966, metalness: 0.88, roughness: 0.1 });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0xff44cc, emissive: 0xff22aa, emissiveIntensity: 2.2 });

    // === CONTINUOUS PIPE FROM SOURCE TO TIP (NO GAPS) ===

    // 1. Vertical supply pipe (from overhead)
    const supplyPipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.085, 1.5, 12),
      metalMat
    );
    supplyPipe.position.set(0.8, 1.25, 0.6);
    supplyPipe.castShadow = true;
    nozzleGroup.add(supplyPipe);

    // 2. First elbow - connects vertical to horizontal (continuous)
    const elbow1 = new THREE.Mesh(
      new THREE.SphereGeometry(0.105, 16, 12),
      metalMat
    );
    elbow1.position.set(0.8, 0.5, 0.6);
    nozzleGroup.add(elbow1);

    // 3. Horizontal pipe (touches elbow1 exactly)
    const horizPipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 1.2, 12),
      metalMat
    );
    horizPipe.rotation.z = Math.PI / 2;
    horizPipe.position.set(1.4, 0.5, 0.6);
    nozzleGroup.add(horizPipe);

    // 4. Second elbow - connects horizontal to vertical down
    const elbow2 = new THREE.Mesh(
      new THREE.SphereGeometry(0.105, 16, 12),
      metalMat
    );
    elbow2.position.set(2.0, 0.5, 0.6);
    nozzleGroup.add(elbow2);

    // 5. Downward pipe (touches elbow2 exactly)
    const downPipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.075, 0.48, 12),
      metalMat
    );
    downPipe.position.set(2.0, 0.26, 0.6);
    nozzleGroup.add(downPipe);

    // 6. Nozzle valve body (directly connected, NO GAP)
    const valveBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.11, 0.32, 16),
      darkMat
    );
    valveBody.position.set(2.0, 0.05, 0.6);
    nozzleGroup.add(valveBody);

    // 7. Nozzle tip (directly connected to valve body)
    const nozzleTip = new THREE.Mesh(
      new THREE.ConeGeometry(0.048, 0.13, 12),
      tipMat
    );
    nozzleTip.position.set(2.0, -0.08, 0.6);
    nozzleGroup.add(nozzleTip);

    // 8. Glow tip (at nozzle exit)
    const tipGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 8, 8),
      glowMat
    );
    tipGlow.position.set(2.0, -0.15, 0.6);
    tipGlow.userData.isTipGlow = true;
    nozzleGroup.add(tipGlow);

    // 9. Connection coupler - hides any remaining seam
    const coupler = new THREE.Mesh(
      new THREE.TorusGeometry(0.095, 0.025, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0xaa8866, metalness: 0.85, roughness: 0.2 })
    );
    coupler.rotation.x = Math.PI / 2;
    coupler.position.set(2.0, 0.21, 0.6);
    nozzleGroup.add(coupler);

    // 10. Second coupler at elbow junction
    const coupler2 = new THREE.Mesh(
      new THREE.TorusGeometry(0.095, 0.02, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0xaa8866, metalness: 0.85, roughness: 0.2 })
    );
    coupler2.rotation.z = Math.PI / 2;
    coupler2.position.set(1.4, 0.5, 0.6);
    nozzleGroup.add(coupler2);

    // Store references for animation
    prCoatGroup.userData.nozzleTipGlow = tipGlow;
    prCoatGroup.userData.nozzleTip = nozzleTip;

    console.log('[FIX] Nozzle pipe gap closed - continuous connection established');
  }

  private _driveRobotTo(rob: RobotObject, tgt: THREE.Vector3, dt: number, mult: number) {
    rob.runIK(tgt);
    const we = new THREE.Euler().setFromQuaternion(rob.wrist.quaternion, "XYZ");
    we.z = Math.sin(this.simTime * 1.05 * mult) * 0.04;
    rob.wrist.quaternion.setFromEuler(we);
  }

  /** Temporarily disable HMDS + helper collision meshes during pick sequence */
  private _maskCollisions(mask: boolean) {
    const hmds = this.modObjs['hmds'];
    if (!hmds) return;
    hmds.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh && obj.userData.collidable !== false) {
        // Store original raycast behavior, then disable
        if (mask) {
          obj.userData._origRaycast = obj.raycast;
          obj.raycast = () => { };   // no-op disables ghost collisions
        } else if (obj.userData._origRaycast) {
          obj.raycast = obj.userData._origRaycast;
          delete obj.userData._origRaycast;
        }
      }
    });
  }

  private _disableAllShadows() {
    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
      if ((obj as any).castShadow !== undefined) {
        (obj as any).castShadow = false;
      }
      if ((obj as any).receiveShadow !== undefined) {
        (obj as any).receiveShadow = false;
      }
    });
  }

  // private _setGripperState(robot: RobotObject, targetState: number, dt: number) {
  //   const ud = robot.group.userData;
  //   const current = (ud.gripperState as number) ?? 0;
  //   const blend = 0.18;
  //   ud.gripperState = lerp(current, targetState, blend);
  //   const g = ud.gripperState as number;
  //   ud.vacuumEngaged = g > 0.7;

  //   // Visual feedback on the blade meshes (Blade_Top / Blade_Bot / Blade_Mount).
  //   // We pulse the emissive of any mesh under the gripper / fork that has a
  //   // standard material — gives a clean "vacuum locked" indicator without
  //   // depending on bone names that may or may not exist.
  //   if (!ud._bladeMats) {
  //     const mats: THREE.MeshStandardMaterial[] = [];
  //     const collect = (node: THREE.Object3D) => {
  //       if ((node as THREE.Mesh).isMesh) {
  //         const m = (node as THREE.Mesh).material as THREE.MeshStandardMaterial;
  //         if (m && (m as any).isMeshStandardMaterial) mats.push(m);
  //       }
  //     };
  //     robot.fork.traverse(collect);
  //     if (robot.gripper && robot.gripper !== robot.fork) robot.gripper.traverse(collect);
  //     ud._bladeMats = mats;
  //     // Cache the original emissive so we can restore on release
  //     ud._bladeEmissiveBase = mats.map(m => ({
  //       hex: m.emissive.getHex(),
  //       intensity: m.emissiveIntensity,
  //     }));
  //   }

  //   const mats        = ud._bladeMats as THREE.MeshStandardMaterial[];
  //   const base        = ud._bladeEmissiveBase as { hex: number; intensity: number }[];
  //   const t           = this.simTime;
  //   const engagedHex  = 0x00ddff;
  //   const engagedAmp  = 1.8 + 1.2 * Math.abs(Math.sin(t * 8));

  //   mats.forEach((m, i) => {
  //     if (g > 0.05) {
  //       // Blend toward cyan emissive when vacuum is on
  //       const tgt = new THREE.Color(engagedHex);
  //       m.emissive.lerp(tgt, 0.15);
  //       m.emissiveIntensity = lerp(m.emissiveIntensity, engagedAmp * g, 0.18);
  //     } else {
  //       // Restore original
  //       const b = base[i];
  //       m.emissive.lerp(new THREE.Color(b.hex), 0.10);
  //       m.emissiveIntensity = lerp(m.emissiveIntensity, b.intensity, 0.10);
  //     }
  //   });
  // }


  // private _animRobots(dt: number) {
  //   const t = this.simTime;
  //   const r = this.robotEFEM;
  //   if (!r || !r.runIK) return;
  //   if (!r.turret || !r.shoulder || !r.elbow || !r.wrist || !r.gripper) return;

  //   // ── One-time init ──
  //   if (!r.group.userData.railInit) {
  //     r.group.userData.railX        = r.basePos.x;
  //     r.group.userData.armPhase     = 'idle';
  //     r.group.userData.phaseT       = 0;
  //     r.group.userData.railInit     = true;
  //     r.group.userData.gripperState = 0;
  //     r.group.userData.turretRestY  = r.turret.rotation.y;
  //     r.group.userData._ikYaw      = new THREE.Euler().setFromQuaternion(r.turret.quaternion, "YXZ").y;
  //     r.group.userData.bezierT      = 0;
  //     r.group.userData.bezierStart  = new THREE.Vector3();
  //     r.group.userData.bezierEnd    = new THREE.Vector3();
  //     r.group.userData.bezierCP1    = new THREE.Vector3();
  //     r.group.userData.bezierCP2    = new THREE.Vector3();
  //     r.group.userData.dwellTimer   = 0;
  //   }

  //   // ── Compute finger-to-gripper offset (in gripper local space) ──
  //   // This tells us how far forward the wafer sits relative to the gripper origin
  //   const computeFingerOffset = (): THREE.Vector3 => {
  //     const ud = r.group.userData;
  //     const t1 = ud.fingerTop1  as THREE.Object3D | undefined;
  //     const d1 = ud.fingerDown1 as THREE.Object3D | undefined;
  //     const t2 = ud.fingerTop2  as THREE.Object3D | undefined;
  //     const d2 = ud.fingerDown2 as THREE.Object3D | undefined;

  //     if (!t1 || !d1) return new THREE.Vector3();

  //     // Finger world midpoint
  //     const fingerMid = new THREE.Vector3();
  //     const tmp = new THREE.Vector3();
  //     t1.getWorldPosition(tmp); fingerMid.add(tmp);
  //     d1.getWorldPosition(tmp); fingerMid.add(tmp);
  //     if (t2 && d2) {
  //       t2.getWorldPosition(tmp); fingerMid.add(tmp);
  //       d2.getWorldPosition(tmp); fingerMid.add(tmp);
  //       fingerMid.multiplyScalar(0.25);
  //     } else {
  //       fingerMid.multiplyScalar(0.5);
  //     }

  //     // Gripper world position
  //     const gripWP = new THREE.Vector3();
  //     r.gripper.getWorldPosition(gripWP);

  //     // Offset = how far fingers extend past gripper origin
  //     return fingerMid.clone().sub(gripWP);
  //   };

  //   // ── Helper: convert "where wafer should be" → "where gripper should be" ──
  //   const targetForGripper = (waferTarget: THREE.Vector3): THREE.Vector3 => {
  //     const fingerOffset = computeFingerOffset();
  //     // Subtract finger offset so fingers (not gripper) end up at waferTarget
  //     return waferTarget.clone().sub(fingerOffset);
  //   };

  //   // ── Keep-out collision clamp (FOUP / scanner) ────────────────────────────
  //   const APPROACH_OFFSET = 0.25;
  //   const RETRACT_DIST = 0.3;
  //   const TRANSFER_MIN_Y = 0.18;
  //   const keepOut = (id: "foup" | "scanner", desired: THREE.Vector3, from: THREE.Vector3): THREE.Vector3 => {
  //     const box = this._blockBoxes[id];
  //     if (!box) return desired;
  //     // If desired point is inside the box, pull it out along the approach ray.
  //     if (!box.containsPoint(desired)) return desired;
  //     const dir = desired.clone().sub(from);
  //     if (dir.lengthSq() < 1e-6) return desired;
  //     dir.normalize();
  //     // Walk out of the box by stepping backwards.
  //     const out = desired.clone();
  //     for (let i = 0; i < 20 && box.containsPoint(out); i++) {
  //       out.addScaledVector(dir, -0.08);
  //     }
  //     return out;
  //   };

  //   // ── Carried wafers: transform owned by gripper.attach(); no world-space lerp ──

  //   // ── Find target wafer ──
  //   const carried = this.wSMs.find(
  //     (w) => w.launched && !w.done && w.carrierRobot === r
  //   );
  //   const waiting = this.wSMs.find(
  //     (w) => w.launched && !w.done && !w.carrierRobot &&
  //            w.state === 'track_approach' && !(w as any)._picked
  //   );
  //   const target = carried ?? waiting ?? null;

  //   const ud = r.group.userData;

  //   // Smooth easing
  //   const sCurve = (x: number) => {
  //     x = Math.max(0, Math.min(1, x));
  //     return x * x * (3 - 2 * x);
  //   };

  //   // Bezier evaluator
  //   const evalBezier = (out: THREE.Vector3, t01: number) => {
  //     const p0 = ud.bezierStart as THREE.Vector3;
  //     const p1 = ud.bezierCP1   as THREE.Vector3;
  //     const p2 = ud.bezierCP2   as THREE.Vector3;
  //     const p3 = ud.bezierEnd   as THREE.Vector3;
  //     const u = 1 - t01, u2 = u * u, u3 = u2 * u;
  //     const tt = t01 * t01, ttt = tt * t01;
  //     out.set(
  //       u3 * p0.x + 3 * u2 * t01 * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
  //       u3 * p0.y + 3 * u2 * t01 * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  //       u3 * p0.z + 3 * u2 * t01 * p1.z + 3 * u * tt * p2.z + ttt * p3.z,
  //     );
  //   };

  //   // Rail target + integration BEFORE runIK.
  //   // DISABLED: full-track robot travel. EFEM only handles FOUP -> DEHY handoff.
  //  // Rail target + integration BEFORE runIK.
  //   // Robot travels the full track to service all 4 handoff zones.
  //   const RAIL_MIN = -22;
  //   const RAIL_MAX = 32;
  //   let dropStep = ALL_STEPS[0];
  //   let prevStep = ALL_STEPS[0];
  //   let pickupX = r.basePos.x;
  //   let pickupZ = 0;
  //   let isPicked = false;
  //   let railTargetX = ud.railX as number;

  //   if (target) {
  //     dropStep = ALL_STEPS[Math.min(target.stepIdx, ALL_STEPS.length - 1)];
  //     const prevStepIdx = Math.max(target.stepIdx - 1, 0);
  //     prevStep = ALL_STEPS[prevStepIdx];
  //     pickupX = (target as any)._pickupX as number ?? prevStep.x;
  //     pickupZ = (target as any)._pickupZ as number ?? prevStep.z;
  //     isPicked = !!(target as any)._picked;
  //     railTargetX = clamp(isPicked ? dropStep.x : pickupX, RAIL_MIN, RAIL_MAX);
  //   }

  //   // Smooth rail movement
  //   const railSpeed = 6.0;
  //   const currentRailX = ud.railX as number;
  //   const dxRail = railTargetX - currentRailX;
  //   const railStep = Math.sign(dxRail) * Math.min(Math.abs(dxRail), railSpeed * dt * this.speed);
  //   ud.railX = currentRailX + railStep;
  //   r.group.position.x = ud.railX as number;

  //   if (!target) {
  //     ud.armPhase = 'idle';
  //     ud.phaseT = 0;
  //     const idleTgt = new THREE.Vector3(
  //       r.group.position.x,
  //       1.8,
  //       Math.sin(t * 0.22) * 1.5
  //     );
  //     r.runIK(targetForGripper(idleTgt));
  //     this._setGripperState(r, 0, dt);

  //   } else {
  //     // if (target.stepIdx > 1 && !target.carrierRobot) {
  //     //   // DISABLED:
  //     //   // Robot should only transfer FOUP → Dehydration Bake.
  //     //   // Downstream handling is conveyor-owned.
  //     //   ud.armPhase = 'idle';
  //     //   ud.phaseT = 0;
  //     //   return;
  //     // }
  //     const railX = ud.railX as number;
  //     const distPick = Math.abs(railX - pickupX);
  //     const distDrop = Math.abs(railX - dropStep.x);

  //     ud.phaseT = (ud.phaseT as number) + dt * this.speed;
  //     const phaseT = ud.phaseT as number;
  //     const phase  = ud.armPhase as string;

  //     const pickWorld = new THREE.Vector3();
  //     if (prevStep.type === "foup") {
  //       const foupGrp = this.modObjs["foup"];
  //       const anchors = foupGrp?.userData?.slotAnchors as THREE.Object3D[] | undefined;
  //       const slotIx = Math.min(target.wi, Math.max(0, (anchors?.length ?? 1) - 1));
  //       if (anchors?.[slotIx]) anchors[slotIx].getWorldPosition(pickWorld);
  //       else pickWorld.set(pickupX, 1.55, pickupZ);
  //     } else {
  //       const modGrp = this.modObjs[prevStep.id];
  //       const wa = modGrp?.userData?.waferAnchor as THREE.Object3D | undefined;
  //       if (wa) wa.getWorldPosition(pickWorld);
  //       else pickWorld.set(pickupX, 0.93, pickupZ);
  //     }

  //     const dropWorld = new THREE.Vector3();
  //     // Step 16 = return wafer to FOUP after hardbake
  //     const returnToFoup = target.stepIdx >= ALL_STEPS.length;
  //     if (dropStep.type === "foup" || returnToFoup) {
  //       const foupGrp = this.modObjs["foup"];
  //       const anchors = foupGrp?.userData?.slotAnchors as THREE.Object3D[] | undefined;
  //       const slotIx = Math.min(target.wi, Math.max(0, (anchors?.length ?? 1) - 1));
  //       if (anchors?.[slotIx]) anchors[slotIx].getWorldPosition(dropWorld);
  //       else dropWorld.set(ALL_STEPS[0].x, 1.55, ALL_STEPS[0].z);
  //     } else {
  //       const modGrp = this.modObjs[dropStep.id];
  //       const wa = modGrp?.userData?.waferAnchor as THREE.Object3D | undefined;
  //       if (wa) wa.getWorldPosition(dropWorld);
  //       else dropWorld.set(dropStep.x, 0.93, dropStep.z);
  //     }

  //     // ── Safe approach / collision rules ────────────────────────────────────
  //     const APPROACH_OFFSET = 0.4;      // vertical approach height above port
  //     const APPROACH_BACKOFF = 0.25;    // stop short of equipment opening
  //     const RETRACT_DIST = 0.3;         // pull out before lifting/turning
  //     const TRANSFER_MIN_Y = 0.18;      // never dip into floor/under-plinth plane
  //     // Wafer geometry from buildWafer(): thickness H=0.035 so half=0.0175.
  //     const WAFER_HALF_T = 0.0175;
  //     // Fork should sit slightly under wafer bottom before vacuum (mm-level clearance).
  //     const PICK_CLEARANCE = 0.003;
  //     const SAFE_HEIGHT     = 2.4;

  //     if (!isPicked) {
  //       // Approach direction: from TCP toward the port (used for backoff + retract).
  //       const tcpNow = new THREE.Vector3();
  //       r.gripper.getWorldPosition(tcpNow);
  //       const approachDir = pickWorld.clone().sub(tcpNow);
  //       if (approachDir.lengthSq() > 1e-6) approachDir.normalize();

  //       // Back off along approach ray so TCP never enters FOUP/scanner volume.
  //       const backoffBase = pickWorld.clone().addScaledVector(approachDir, -APPROACH_BACKOFF);
  //       const backoffSafe = prevStep.type === "foup"
  //         ? keepOut("foup", backoffBase, tcpNow)
  //         : (prevStep.id === "scanner" ? keepOut("scanner", backoffBase, tcpNow) : backoffBase);

  //       const approachPos = new THREE.Vector3(backoffSafe.x, pickWorld.y + APPROACH_OFFSET + 0.4, backoffSafe.z);
  //       const insertPos   = new THREE.Vector3(backoffSafe.x, pickWorld.y + APPROACH_OFFSET,       backoffSafe.z);
  //       const contactPos  = new THREE.Vector3(
  //         pickWorld.x,
  //         // Align fork surface just below wafer bottom.
  //         pickWorld.y - WAFER_HALF_T + PICK_CLEARANCE,
  //         pickWorld.z
  //       );
  //       contactPos.y = Math.max(contactPos.y, TRANSFER_MIN_Y);

  //       switch (phase) {
  //         case 'idle':
  //         case 'retract':
  //           ud.armPhase = 'approach';
  //           ud.phaseT = 0;
  //           break;

  //         case 'approach':
  //           r.runIK(targetForGripper(approachPos));
  //           this._setGripperState(r, 0, dt);
  //           if (distPick < 1.0 && phaseT > 0.6) {
  //             ud.armPhase = 'insert';
  //             ud.phaseT = 0;
  //           }
  //           break;

  //         case 'insert': {
  //           const p = sCurve(Math.min(phaseT / 0.9, 1));
  //           const tgt = new THREE.Vector3().lerpVectors(approachPos, insertPos, p);
  //           r.runIK(targetForGripper(tgt));
  //           this._setGripperState(r, 0, dt);
  //           if (p >= 1) {
  //             ud.armPhase = 'contact';
  //             ud.phaseT = 0;
  //           }
  //           break;
  //         }

  //         case 'contact': {
  //           const p = sCurve(Math.min(phaseT / 0.5, 1));
  //           const tgt = new THREE.Vector3().lerpVectors(insertPos, contactPos, p);
  //           r.runIK(targetForGripper(tgt));
  //           this._setGripperState(r, 0.3, dt);
  //           if (p >= 1) {
  //             ud.armPhase = 'vacuum_dwell';
  //             ud.phaseT = 0;
  //             ud.dwellTimer = 0;
  //           }
  //           break;
  //         }

  //         case 'vacuum_dwell': {
  //           ud.dwellTimer = (ud.dwellTimer as number) + dt * this.speed;
  //           const dwellP = (ud.dwellTimer as number) / 0.5;
  //           const settleY = Math.sin(dwellP * Math.PI) * 0.008;
  //           const settledPos = contactPos.clone();
  //           settledPos.y -= settleY;
  //           r.runIK(targetForGripper(settledPos));
  //           this._setGripperState(r, 1, dt);

  //           r.group.updateWorldMatrix(true, true);
  //           // TCP = gripper origin + finger midpoint offset (same basis as targetForGripper / runIK).
  //           const gripWP = new THREE.Vector3();
  //           r.gripper.getWorldPosition(gripWP);
  //           const tcpWorld = gripWP.clone().add(computeFingerOffset());
  //           // Did the arm reach the commanded contact point (not wafer mesh pivot — that can be metres away)?
  //           const ikErr = tcpWorld.distanceTo(settledPos);
  //           const waferWp = new THREE.Vector3();
  //           target.mesh.getWorldPosition(waferWp);
  //           const waferToTcp = tcpWorld.distanceTo(waferWp);
  //           const sx = Math.max(Math.abs(r.group.scale.x), 0.35);
  //           const PICK_IK_TOL = Math.max(0.12, 0.06 * sx);
  //           const PICK_WAFER_TOL = Math.max(0.22, 0.1 * sx);
  //           const ALIGN_TIMEOUT = 1.2;
  //           const dwell = ud.dwellTimer as number;
  //           const aligned = ikErr < PICK_IK_TOL || waferToTcp < PICK_WAFER_TOL;
  //           const canAttach = dwell >= 0.45 && (aligned || dwell >= ALIGN_TIMEOUT);

  //           if (canAttach) {
  //             if (!aligned && dwell >= ALIGN_TIMEOUT) {
  //               console.warn('[PICK] alignment timeout — attach anyway', {
  //                 wi: target.wi,
  //                 ikErr: +ikErr.toFixed(3),
  //                 waferToTcp: +waferToTcp.toFixed(3),
  //                 tolIk: +PICK_IK_TOL.toFixed(3),
  //               });
  //             } else {
  //               console.log('[PICK] aligned', {
  //                 wi: target.wi,
  //                 ikErr: +ikErr.toFixed(3),
  //                 waferToTcp: +waferToTcp.toFixed(3),
  //               });
  //             }
  //             target.attachTo(r);
  //             (target as any)._picked = true;
  //             this._addLog(`[${WAFER_NAMES[target.wi]}] VACUUM ENGAGED → ${prevStep.short}`, 'pick');

  //             const startW = contactPos.clone();
  //             const endW   = new THREE.Vector3(dropWorld.x, dropWorld.y + APPROACH_OFFSET + 0.4, dropWorld.z);
  //             (ud.bezierStart as THREE.Vector3).copy(startW);
  //             (ud.bezierEnd as THREE.Vector3).copy(endW);
  //             (ud.bezierCP1 as THREE.Vector3).set(startW.x, SAFE_HEIGHT, startW.z);
  //             (ud.bezierCP2 as THREE.Vector3).set(endW.x, SAFE_HEIGHT, endW.z);
  //             ud.bezierT = 0;

  //             ud.postAttachHold = 0;
  //             ud.armPhase = 'lift';
  //             ud.phaseT = 0;
  //           }
  //           break;
  //         }

  //         case 'lift': {
  //           const hold = (ud.postAttachHold as number) ?? 0;
  //           ud.postAttachHold = hold + dt * this.speed;
  //           // 0–0.2s: settle at contact
  //           if (hold < 0.2) {
  //             r.runIK(targetForGripper(contactPos));
  //             this._setGripperState(r, 1, dt);
  //             break;
  //           }
  //           // 0.2–0.4s: retract out of port before lifting/turning (prevents collisions)
  //           if (hold < 0.4) {
  //             const retractPos = contactPos.clone().addScaledVector(approachDir, -RETRACT_DIST);
  //             retractPos.y = Math.max(retractPos.y, TRANSFER_MIN_Y);
  //             r.runIK(targetForGripper(retractPos));
  //             this._setGripperState(r, 1, dt);
  //             break;
  //           }
  //           const liftPos = new THREE.Vector3(pickWorld.x, SAFE_HEIGHT, pickWorld.z);
  //           const p = sCurve(Math.min(phaseT / 0.7, 1));
  //           const tgt = new THREE.Vector3().lerpVectors(contactPos, liftPos, p);
  //           r.runIK(targetForGripper(tgt));
  //           this._setGripperState(r, 1, dt);
  //           if (p >= 1) {
  //             delete ud.postAttachHold;
  //             ud.armPhase = 'transport';
  //             ud.phaseT = 0;
  //             ud.bezierT = 0;
  //           }
  //           break;
  //         }

  //         default:
  //           ud.armPhase = 'approach';
  //           ud.phaseT = 0;
  //           break;
  //       }

  //     } else {
  //       // Place target uses module waferAnchor (chuck top reference). Drop world pos is anchor.
  //       // Wafer should sit on chuck: wafer center = chuckTop + waferHalfThickness.
  //       const tcpNow = new THREE.Vector3();
  //       r.gripper.getWorldPosition(tcpNow);
  //       const approachDir = dropWorld.clone().sub(tcpNow);
  //       if (approachDir.lengthSq() > 1e-6) approachDir.normalize();
  //       const backoffBase = dropWorld.clone().addScaledVector(approachDir, -APPROACH_BACKOFF);
  //       const backoffSafe = dropStep.id === "scanner"
  //         ? keepOut("scanner", backoffBase, tcpNow)
  //         : backoffBase;

  //       const approachDrop = new THREE.Vector3(backoffSafe.x, dropWorld.y + APPROACH_OFFSET + 0.4, backoffSafe.z);
  //       const insertDrop   = new THREE.Vector3(backoffSafe.x, dropWorld.y + APPROACH_OFFSET,       backoffSafe.z);
  //       const placePos     = new THREE.Vector3(dropWorld.x, dropWorld.y + WAFER_HALF_T, dropWorld.z);
  //       placePos.y = Math.max(placePos.y, TRANSFER_MIN_Y);

  //       switch (phase) {
  //         case 'lift':
  //         case 'transport':
  //         case 'carry':
  //         case 'rise': {
  //           ud.bezierT = Math.min((ud.bezierT as number) + dt * this.speed * 0.45, 1);
  //           const tBz = sCurve(ud.bezierT as number);
  //           const tgt = new THREE.Vector3();
  //           evalBezier(tgt, tBz);
  //           r.runIK(targetForGripper(tgt));
  //           this._setGripperState(r, 1, dt);
  //           if ((ud.bezierT as number) >= 1) {
  //             ud.armPhase = 'lower';
  //             ud.phaseT = 0;
  //           }
  //           break;
  //         }

  //         case 'lower': {
  //           const p = sCurve(Math.min(phaseT / 0.8, 1));
  //           const tgt = new THREE.Vector3().lerpVectors(approachDrop, insertDrop, p);
  //           r.runIK(targetForGripper(tgt));
  //           this._setGripperState(r, 1, dt);
  //           if (p >= 1) {
  //             ud.armPhase = 'place_contact';
  //             ud.phaseT = 0;
  //           }
  //           break;
  //         }

  //         case 'place_contact': {
  //           const p = sCurve(Math.min(phaseT / 0.5, 1));
  //           const tgt = new THREE.Vector3().lerpVectors(insertDrop, placePos, p);
  //           r.runIK(targetForGripper(tgt));
  //           this._setGripperState(r, 1, dt);
  //           if (p >= 1) {
  //             ud.armPhase = 'release';
  //             ud.phaseT = 0;
  //           }
  //           break;
  //         }

  //         case 'release': {
  //           // Validate finger midpoint vs target
  //           const fingerMid = new THREE.Vector3();
  //           const tmp = new THREE.Vector3();
  //           const fT1 = ud.fingerTop1 as THREE.Object3D | undefined;
  //           const fD1 = ud.fingerDown1 as THREE.Object3D | undefined;
  //           if (fT1 && fD1) {
  //             fT1.getWorldPosition(tmp); fingerMid.add(tmp);
  //             fD1.getWorldPosition(tmp); fingerMid.add(tmp);
  //             fingerMid.multiplyScalar(0.5);
  //           }
  //           const targetPos = dropWorld.clone();
  //           const posError = fingerMid.distanceTo(targetPos);

  //           r.runIK(targetForGripper(placePos));
  //           this._setGripperState(r, 0, dt);

  //           const POS_TOL = 0.12;
  //           const timeoutFallback = phaseT > 1.5;

  //           if ((posError <= POS_TOL && phaseT > 0.4) || timeoutFallback) {
  //             target.detachAt(targetPos);
  //             this._addLog(`[${WAFER_NAMES[target.wi]}] RELEASE @ ${dropStep.short}`, 'place');
  //             target.state = 'processing';
  //             target.processTimer = 0;
  //             this._onProcessStart(target, dropStep);
  //             this.busy[dropStep.id] = target.wi;
  //             (target as any)._picked = false;
  //             (target as any)._pickupX = undefined;
  //             (target as any)._pickupZ = undefined;
  //             ud.armPhase = 'retractUp';
  //             ud.phaseT = 0;
  //           }
  //           break;
  //         }

  //         case 'retractUp': {
  //           const p = sCurve(Math.min(phaseT / 0.6, 1));
  //           const tgt = new THREE.Vector3().lerpVectors(placePos, approachDrop, p);
  //           r.runIK(targetForGripper(tgt));
  //           this._setGripperState(r, 0, dt);
  //           if (p >= 1) {
  //             ud.armPhase = 'retract';
  //             ud.phaseT = 0;
  //           }
  //           break;
  //         }

  //         case 'retract':
  //           r.runIK(targetForGripper(approachDrop));
  //           this._setGripperState(r, 0, dt);
  //           if (phaseT > 0.5) {
  //             ud.armPhase = 'idle';
  //             ud.phaseT = 0;
  //           }
  //           break;

  //         default:
  //           ud.armPhase = 'transport';
  //           ud.phaseT = 0;
  //           break;
  //       }
  //     }
  //   }

  //   // ── Status LED ──
  //   if (ud.gripperState as number > 0.7) {
  //     r.statusPL.color.setHex(0x00ffff);
  //     r.statusPL.intensity = 2.5 + 0.5 * Math.sin(t * 8);
  //   } else if (carried) {
  //     r.statusPL.color.setHex(0x00ff88);
  //     r.statusPL.intensity = 1.8;
  //   } else {
  //     r.statusPL.color.setHex(0x00d8ff);
  //     r.statusPL.intensity = 1.2 + 0.5 * Math.sin(t * 2.8);
  //   }
  // }


  private _setGripperState(robot: RobotObject, targetState: number, dt: number) {
    const ud = robot.group.userData;
    const current = (ud.gripperState as number) ?? 0;
    ud.gripperState = lerp(current, targetState, 0.18);
    ud.vacuumEngaged = (ud.gripperState as number) > 0.7;
    // No material changes — robot keeps its natural colors.
  }



  private _animRobots(dt: number) {
    const isHardBakeStep = (stepId: string): boolean => stepId === 'hardbake';
    const t = this.simTime;
    const r = this.robotEFEM;
    if (!r || !r.runIK) return;
    if (!r.turret || !r.shoulder || !r.elbow || !r.wrist || !r.gripper) return;

    // ── One-time init ──
    if (!r.group.userData.railInit) {
      r.group.userData.railX = r.group.position.x;
      r.group.userData.baseY = 0;        // ← force floor, not GLB baked Y
      r.group.userData.zLiftY = 0;
      r.group.userData.armPhase = 'idle';
      r.group.userData.phaseT = 0;
      r.group.userData.railInit = true;
      r.group.userData.gripperState = 0;
      r.group.userData._ikYaw = new THREE.Euler().setFromQuaternion(r.turret.quaternion, "YXZ").y;
      r.group.userData.bezierT = 0;
      r.group.userData.bezierStart = new THREE.Vector3();
      r.group.userData.bezierEnd = new THREE.Vector3();
      r.group.userData.bezierCP1 = new THREE.Vector3();
      r.group.userData.bezierCP2 = new THREE.Vector3();
      r.group.userData.dwellTimer = 0;
    }

    const ud = r.group.userData;

    // ── Finger-to-gripper offset helper ──
    const computeFingerOffset = (): THREE.Vector3 => {
      const t1 = ud.fingerTop1 as THREE.Object3D | undefined;
      const d1 = ud.fingerDown1 as THREE.Object3D | undefined;
      if (!t1 || !d1) return new THREE.Vector3();
      const fingerMid = new THREE.Vector3();
      const tmp = new THREE.Vector3();
      t1.getWorldPosition(tmp); fingerMid.add(tmp);
      d1.getWorldPosition(tmp); fingerMid.add(tmp);
      fingerMid.multiplyScalar(0.5);
      const gripWP = new THREE.Vector3();
      r.gripper.getWorldPosition(gripWP);
      return fingerMid.clone().sub(gripWP);
    };

    const getKeepOutBox = (id: string): THREE.Box3 | null => {
      const grp = this.modObjs[id];
      if (!grp) return null;
      const glbRoot = (grp.userData.glbRoot as THREE.Object3D | undefined) ?? grp;
      glbRoot.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(glbRoot);

      let expansion = 1.5;
      if (id === 'foup') expansion = 4.5;
      else if (id === 'scanner') expansion = 4.5;
      else if (id === 'hmds') expansion = 2.0;
      else if (id === 'prcoat' || id === 'develop') expansion = 1.8;

      box.expandByScalar(expansion);
      this._blockBoxes[id] = box;
      return box;
    };
    

    const avoidCollisions = (desired: THREE.Vector3): THREE.Vector3 => {
      const safe = desired.clone();
      const hazardModules = ['hmds', 'prcoat', 'develop', 'scanner', 'hardbake'];
      const center = new THREE.Vector3();
      const half = new THREE.Vector3();

      for (const modId of hazardModules) {
        const box = getKeepOutBox(modId);
        if (!box || !box.containsPoint(safe)) continue;
        box.getCenter(center);
        box.getSize(half).multiplyScalar(0.5);
        const local = safe.clone().sub(center);
        const ratios = [
          Math.abs(local.x) / half.x,
          Math.abs(local.y) / half.y,
          Math.abs(local.z) / half.z,
        ];
        const maxRatio = Math.max(...ratios);
        if (maxRatio <= 0) continue;
        local.divideScalar(maxRatio);
        safe.copy(center).add(local);
        const outDir = safe.clone().sub(center).normalize();
        safe.addScaledVector(outDir, 0.3);
      }

      return safe;
    };

    const targetForGripper = (waferTarget: THREE.Vector3): THREE.Vector3 => {
      const fingerOffset = computeFingerOffset();
      const raw = waferTarget.clone().sub(fingerOffset);
      return avoidCollisions(raw);
    };

    // ── Motion params ──
    const APPROACH_OFFSET = 0.3;
    const TRANSFER_MIN_Y = 0.8;
    const WAFER_HALF_T = 0.0175;
    const PICK_CLEARANCE = 0.003;
    const SAFE_HEIGHT = WAFER_TRANSFER_Y + 3.0; 
    const SAFE_TRAVEL_Y = WAFER_TRANSFER_Y + 1.2;
    const Z_LIFT_HIGH = 0.8;
    const Z_LIFT_LOW = 0.0;
    const FOUP_MAX_Y = 3.2;   // ← FOUP top height — arm never goes above this near FOUP
    const FOUP_MIN_X = ALL_STEPS[0].x + 1.5;  // ALL_STEPS[0] is always FOUP
    
    // ════════════════════════════════════════════════════════════════════════════
    // VERTICAL LIFT CLEARANCE RULES
    // Only HMDS and DI Water Rinse require the higher clearance arc.
    // All other stations should keep transfers low and direct.
    // ════════════════════════════════════════════════════════════════════════════
    const needsVerticalLift = (stepId: string): boolean => {
  return stepId === 'hmds' || stepId === 'rinse' || stepId === 'hardbake' || stepId === 'prcoat';  // ← added prcoat
};
    const isCoatStationStep = (stepId: string): boolean => {
      return stepId === 'prcoat';
    };
    // Direct transfer height (minimal lift, no arc) for most stations
    const DIRECT_TRANSFER_HEIGHT = WAFER_TRANSFER_Y + 0.4;

    // Safe arc height only for stations that need clearance
    const ARC_TRANSFER_HEIGHT = SAFE_HEIGHT;
    // ← front face of FOUP

    const clampForFoup = (pos: THREE.Vector3): THREE.Vector3 => {
      if (!target || prevStep.type !== "foup") return pos;
      const clamped = pos.clone();
      clamped.x = Math.max(clamped.x, FOUP_MIN_X);   // never go behind FOUP front
      clamped.y = Math.min(clamped.y, FOUP_MAX_Y);    // never go above FOUP top
      return clamped;
    };
    // ── Find target wafer ──
    const carried = this.wSMs.find((w) => w.launched && !w.done && w.carrierRobot === r);
    const waiting = this.wSMs.find(
      (w) => w.launched && !w.done && !w.carrierRobot &&
        w.state === 'track_approach' && !(w as any)._picked
    );
    const target = carried ?? waiting ?? null;

    const evalBezier = (out: THREE.Vector3, t01: number) => {
      const p0 = ud.bezierStart as THREE.Vector3;
      const p1 = ud.bezierCP1 as THREE.Vector3;
      const p2 = ud.bezierCP2 as THREE.Vector3;
      const p3 = ud.bezierEnd as THREE.Vector3;
      const u = 1 - t01, u2 = u * u, u3 = u2 * u;
      const tt = t01 * t01, ttt = tt * t01;
      out.set(
        u3 * p0.x + 3 * u2 * t01 * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
        u3 * p0.y + 3 * u2 * t01 * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
        u3 * p0.z + 3 * u2 * t01 * p1.z + 3 * u * tt * p2.z + ttt * p3.z,
      );
    };

    const sCurve = (x: number) => {
      x = Math.max(0, Math.min(1, x));
      return x * x * (3 - 2 * x);
    };

    // ── Determine pickup / drop positions FIRST ──
    let dropStep = ALL_STEPS[0];
    let prevStep = ALL_STEPS[0];
    let isPicked = false;
    let isScannerDrop = false;
    let isInterfaceDrop = false;
    const pickWorld = new THREE.Vector3();
    const dropWorld = new THREE.Vector3();

    if (target) {
      dropStep = ALL_STEPS[Math.min(target.stepIdx, ALL_STEPS.length - 1)];
      const prevStepIdx = Math.max(target.stepIdx - 1, 0);
      prevStep = ALL_STEPS[prevStepIdx];
      isPicked = !!(target as any)._picked;
      isScannerDrop = dropStep.id === 'scanner';
      isInterfaceDrop = dropStep.type === 'iface';

      // ── PICK WORLD: get actual wafer mesh position (works for ANY module) ──
      target.mesh.getWorldPosition(pickWorld);
      // CRITICAL: wafer pickup height is always the transfer height.
      pickWorld.y = WAFER_TRANSFER_Y;
      if (!isPicked && prevStep.type === 'foup') {
        const foupGrp = this.modObjs['foup'];
        const anchors = foupGrp?.userData?.slotAnchors as THREE.Object3D[] | undefined;
        const slotAnchor = anchors?.[Math.min(target.wi, Math.max(0, (anchors?.length ?? 1) - 1))];
        if (slotAnchor) {
          slotAnchor.getWorldPosition(pickWorld);
          pickWorld.y = WAFER_TRANSFER_Y;
        }
      }
      // Scanner wafer is at the front slot, not the body center
      if (prevStep.id === 'scanner') {
        // ── Pick from the scanner's outgoing transfer port, not the internal chuck.
        const scannerGrp = this.modObjs['scanner'];
        const pickAnchor = scannerGrp?.userData?.pickupAnchor as THREE.Object3D | undefined
          ?? scannerGrp?.userData?.waferAnchor as THREE.Object3D | undefined;
        if (pickAnchor) {
          pickAnchor.getWorldPosition(pickWorld);
          // Ensure pickup height is at transfer height
          pickWorld.y = WAFER_TRANSFER_Y;
        } else {
          pickWorld.x = prevStep.x;
          pickWorld.z = prevStep.z + 0.35;
        }
      }

      // ── DROP WORLD: get target module's wafer anchor ──
      const isReturning = (target as any)._returnToFoup === true;

      if (dropStep.type === 'foup' || isReturning) {
        const foupGrp = this.modObjs['foup'];
        const anchors = foupGrp?.userData?.slotAnchors as THREE.Object3D[] | undefined;
        const slotIx = Math.min(target.wi, Math.max(0, (anchors?.length ?? 1) - 1));
        if (anchors?.[slotIx]) {
          anchors[slotIx].getWorldPosition(dropWorld);
          // CRITICAL: clamp Y to prevent going above FOUP top
          dropWorld.y = Math.min(dropWorld.y, 2.5);
        } else {
          // Fallback: place at FOUP front face at safe height
          dropWorld.set(ALL_STEPS[0].x + 4.0, 2.0, ALL_STEPS[0].z);
        }
      } else if (dropStep.id === 'scanner') {
        // ── SCANNER: place wafer at the scanner slot anchor inside the front opening.
        const scannerGrp = this.modObjs['scanner'];
        const slotAnchor = scannerGrp?.userData?.slotAnchor as THREE.Object3D | undefined;
        const wa = slotAnchor ?? (scannerGrp?.userData?.waferAnchor as THREE.Object3D | undefined);
        if (wa) {
          wa.getWorldPosition(dropWorld);
          // Clamp Y to a safe visible range — never let it go behind the machine
          dropWorld.y = Math.max(dropWorld.y, WAFER_TRANSFER_Y - 0.5);
          dropWorld.y = Math.min(dropWorld.y, WAFER_TRANSFER_Y + 0.5);
          console.log('[SCANNER] wafer drop at slot:', dropWorld.toArray());
        } else {
          // Fallback: position the wafer near the scanner input slot on the negative Z side.
          dropWorld.set(dropStep.x, WAFER_TRANSFER_Y, dropStep.z - 4.15);
        }
      } else {
        const modGrp = this.modObjs[dropStep.id];
        const wa = modGrp?.userData?.waferAnchor as THREE.Object3D | undefined;
        if (wa) {
          // Use exact anchor world position (do not override Y)
          wa.getWorldPosition(dropWorld);
        } else {
          dropWorld.set(dropStep.x, WAFER_TRANSFER_Y + 0.02, dropStep.z);
        }
      }
    }

    const isCrossRow = target ? Math.abs(pickWorld.z - dropWorld.z) > 5.0 : false;

    // ── Compute rail target: position robot near the relevant module ──
    // CRITICAL: rail follows the X of pickup (before pick) or drop (after pick)
    const TRACK_MIN = -14;   // can't go past FOUP enclosure
    const TRACK_MAX = 22;   // extended to reach scanner at x=36
    let railTargetX = ud.railX as number;

    if (target) {
      // Position robot rail X near where the action is
      // For scanner: rail needs to position robot at scanner.x so arm can reach the slot
      let targetX = isPicked ? dropStep.x : pickWorld.x;

      // Special handling: scanner is far out, but robot reaches with extended arm
      if (isPicked && dropStep.id === 'scanner') {
        targetX = dropStep.x - 4;  // stand 4 units back from scanner center
      }
      if (!isPicked && prevStep.id === 'scanner') {
        targetX = prevStep.x - 4;  // same when picking from scanner
      }

      railTargetX = clamp(targetX, TRACK_MIN, TRACK_MAX);
    }

    // ── Smooth rail movement ──
    const railSpeed = 8.0;
    const isPathToScanner = isInterfaceDrop || isScannerDrop;
    const actionSpeed = isPathToScanner ? Math.max(this.speed, 10) : this.speed;
    const actionDt = dt * actionSpeed;
    const currentRailX = ud.railX as number;
    const dxRail = railTargetX - currentRailX;
    const railStep = Math.sign(dxRail) * Math.min(Math.abs(dxRail), railSpeed * actionDt);
    ud.railX = currentRailX + railStep;
    r.group.position.x = ud.railX as number;

    // ── Z-Lift: REMOVED from robot body ──
    // Base stays at floor. Arm reaches up/down via IK only.
    r.group.position.y = 0;   // always floor-locked

    // ── Rail still moves on X ──
    r.group.position.x = ud.railX as number;

    // ── Carriage block follows robot X, stays glued to rail ──
    if (!ud._carriage) {
      const cGeo = new THREE.BoxGeometry(0.55, 0.12, 0.40);
      const cMat = new THREE.MeshStandardMaterial({
        color: 0x1a2a3a,
        metalness: 0.9,
        roughness: 0.2,
      });
      const carriage = new THREE.Mesh(cGeo, cMat);
      carriage.name = '__robotCarriage__';
      carriage.castShadow = true;
      carriage.receiveShadow = true;
      this.scene.add(carriage);
      ud._carriage = carriage;
    }
    const carriage = ud._carriage as THREE.Mesh;
    carriage.position.set(
      r.group.position.x,   // tracks robot X exactly
      0.06,                 // sits on top of the rail beam
      0
    );

    // ── NO TARGET: idle hover ──
    if (!target) {
      ud.armPhase = 'idle';
      ud.phaseT = 0;
      const idleTgt = new THREE.Vector3(
        r.group.position.x + 1.5,
        r.group.position.y + 2.5,
        Math.sin(t * 0.22) * 0.5
      );
      r.runIK(targetForGripper(idleTgt));
      this._setGripperState(r, 0, dt);
      r.statusPL.color.setHex(0x00d8ff);
      r.statusPL.intensity = 1.2 + 0.5 * Math.sin(t * 2.8);
      return;
    }

    const railX = ud.railX as number;
    const targetRailX = isPicked ? dropStep.x : pickWorld.x;
    const railDist = Math.abs(railX - clamp(targetRailX, TRACK_MIN, TRACK_MAX));
    const railArrived = railDist < 0.5;

    ud.phaseT = (ud.phaseT as number) + actionDt;
    const phaseT = ud.phaseT as number;
    const phase = ud.armPhase as string;
    if (dropStep.id === 'hardbake' || prevStep.id === 'hardbake') {              // ← ADD THIS BLOCK
  console.log('[HARDBAKE-DEBUG]', {
    phase,
    gripperWorldY: (() => { const v = new THREE.Vector3(); r.gripper.getWorldPosition(v); return v.y; })(),
  });
}

    // ══════════════════════════════════════════════════════════════════════════
    // PICK SEQUENCE
    // ══════════════════════════════════════════════════════════════════════════
    // ══════════════════════════════════════════════════════
    // REPLACE the entire PICK SEQUENCE section (if (!isPicked))
    // in _animRobots with this:
    // ══════════════════════════════════════════════════════

    if (!isPicked) {

      // ── FOUP-specific safe zone ──
      const isFoupPick = prevStep.type === "foup";
      const FOUP_FRONT_X = (ALL_STEPS[0].x + 5.5); // safe front face of FOUP
      const FOUP_MAX_Y = 2.8;                        // FOUP ceiling — never go above
      // ── Safe pickup world position ──
      // For FOUP: pick from staging point IN FRONT of door, not inside
      const safePickX = isFoupPick
        ? Math.max(pickWorld.x, FOUP_FRONT_X)   // clamp to front face
        : pickWorld.x;
      const safePickY = isFoupPick
        ? Math.min(pickWorld.y, FOUP_MAX_Y)      // clamp to below FOUP ceiling
        : pickWorld.y;

      // ════════════════════════════════════════════════════════════════════════════
      // COLLISION AVOIDANCE: Extra clearance for coater cup and nozzle
      // Coater has tall cup and dispense nozzle that extend above wafer plane
      // Add extra vertical clearance when approaching coat stations
      // ════════════════════════════════════════════════════════════════════════════
      const isCoatStation = prevStep.type === "coat";
      const coatClearance = isCoatStation ? 0.8 : 0;  // Extra 0.8 units clearance for coater

      // Approach: come from the side at wafer height — NO upward arc into FOUP
      const approachPos = new THREE.Vector3(
        isFoupPick ? FOUP_FRONT_X + 2.0 : pickWorld.x,  // stand away from FOUP
        isFoupPick ? safePickY : safePickY + APPROACH_OFFSET + 0.3 + coatClearance,
        pickWorld.z
      );
      const isRinseStep = (stepId: string): boolean => stepId === 'rinse';

      // Insert: move toward FOUP door horizontally
      const insertPos = new THREE.Vector3(
        isFoupPick ? FOUP_FRONT_X + 0.5 : pickWorld.x,
        safePickY,
        pickWorld.z
      );

      // Contact: exactly at wafer, clamped to front of FOUP
      const contactPos = new THREE.Vector3(
        Math.max(safePickX, isFoupPick ? FOUP_FRONT_X : -999),
        Math.max(safePickY - WAFER_HALF_T + PICK_CLEARANCE, TRANSFER_MIN_Y),
        pickWorld.z
      );

      switch (phase) {
        case 'idle':
        case 'retract':
          ud.armPhase = 'approach';
          ud.phaseT = 0;
          break;

        case 'approach': {
  r.runIK(targetForGripper(approachPos), {
    approachHeight: 0.18,
    safetyMargin: 0.10
  });
          this._setGripperState(r, 0, dt);
          if (railArrived && phaseT > 0.5) {
            ud.armPhase = 'insert';
            ud.phaseT = 0;
          }
          break;
        }

        case 'insert': {
          const p = sCurve(Math.min(phaseT / 0.8, 1));
  const tgt = new THREE.Vector3(
    lerp(approachPos.x, insertPos.x, p),
    isFoupPick ? safePickY : lerp(approachPos.y, insertPos.y, p),
    pickWorld.z
  );
          r.runIK(targetForGripper(tgt), {
            safetyMargin: 0.08
          });
          this._setGripperState(r, 0, dt);
          if (p >= 1) {
            ud.armPhase = 'contact';
            ud.phaseT = 0;
          }
          break;
        }

        case 'contact': {
          const p = sCurve(Math.min(phaseT / 0.6, 1));
          const tgt = new THREE.Vector3(
            lerp(insertPos.x, contactPos.x, p),
            Math.min(  // always enforce FOUP ceiling
              lerp(insertPos.y, contactPos.y, p),
              isFoupPick ? FOUP_MAX_Y : 999
            ),
            pickWorld.z
          );
          r.runIK(targetForGripper(tgt), {
            safetyMargin: 0.05
          });
          this._setGripperState(r, 0.3, dt);
          if (p >= 1) {
            ud.armPhase = 'vacuum_dwell';
            ud.phaseT = 0;
            ud.dwellTimer = 0;
          }
          break;
        }

        case 'vacuum_dwell': {
          ud.dwellTimer = (ud.dwellTimer as number) + actionDt;
          // Stay at contact — enforce FOUP ceiling
          const dwellPos = contactPos.clone();
          dwellPos.y = Math.min(dwellPos.y, isFoupPick ? FOUP_MAX_Y : 999);
          r.runIK(targetForGripper(dwellPos), {
            safetyMargin: 0.05
          });
          this._setGripperState(r, 1, dt);

          if ((ud.dwellTimer as number) >= 0.4) {
            target.attachTo(r);
            (target as any)._picked = true;
            this._addLog(`[${WAFER_NAMES[target.wi]}] PICK ↑ ${prevStep.short}`, 'pick');

            // ════════════════════════════════════════════════════════════════════════
            // OPTIMIZED TRANSFER PATH
            // Use direct horizontal transfer for most stations (no excessive Z lift)
            // Only lift for HMDS/DI Rinse stations where collision clearance is needed
            // ════════════════════════════════════════════════════════════════════════
            const startW = contactPos.clone();
            const endW = new THREE.Vector3(
              dropWorld.x,
              dropWorld.y + APPROACH_OFFSET + 0.3,
              dropWorld.z
            );

            // Determine transfer height and extra clearance for coater handling.
            const isCoatPick = isCoatStationStep(prevStep.id);
            const isCoatDrop = isCoatStationStep(dropStep.id);
            const coatTransferBoost = (isCoatPick || isCoatDrop) ? 0.5 : 0;
            const pickNeedsLift = needsVerticalLift(prevStep.id);
            const dropNeedsLift = needsVerticalLift(dropStep.id);
            const transferHeight = (pickNeedsLift || dropNeedsLift)
              ? ARC_TRANSFER_HEIGHT  // High arc for HMDS/Rinse stations
              : DIRECT_TRANSFER_HEIGHT + coatTransferBoost;  // Low but cleared for coater

            // For FOUP: exit horizontally before going up
            const cp1 = isFoupPick
              ? new THREE.Vector3(FOUP_FRONT_X + 3.0, safePickY + 1.0, startW.z)  // exit sideways first
              : new THREE.Vector3(startW.x, transferHeight, startW.z);

            const cp2 = new THREE.Vector3(endW.x, transferHeight, endW.z);

            (ud.bezierStart as THREE.Vector3).copy(startW);
            (ud.bezierEnd as THREE.Vector3).copy(endW);
            (ud.bezierCP1 as THREE.Vector3).copy(cp1);
            (ud.bezierCP2 as THREE.Vector3).copy(cp2);
            ud.bezierT = 0;
            ud.postAttachHold = 0;
            ud.armPhase = 'lift';
            ud.phaseT = 0;
          }
          break;
        }

        case 'lift': {
  const hold = (ud.postAttachHold as number) ?? 0;
  ud.postAttachHold = hold + actionDt;
  if (hold < 0.15) {
    r.runIK(targetForGripper(contactPos), { safetyMargin: 0.05 });
    this._setGripperState(r, 1, dt);
  } else if (hold < 0.45 && isFoupPick) {
    // ...existing FOUP retreat (unchanged)
  } else if (hold < 0.45 && isRinseStep(prevStep.id)) {          // ← ADD THIS BRANCH
    // RINSE: retreat away from the bowl/box center before lifting, so the
    // arm doesn't clip the corner directly above the pickup point.
    const moduleCenter = new THREE.Vector3(prevStep.x, contactPos.y, prevStep.z);
    const retreatDir = contactPos.clone().sub(moduleCenter);
    if (retreatDir.lengthSq() < 1e-6) retreatDir.set(0, 0, 1); // fallback if centered exactly
    retreatDir.normalize();
    const RINSE_RETREAT_DIST = 0.5; // tune against your bowl radius
    const retreatTarget = contactPos.clone().addScaledVector(retreatDir, RINSE_RETREAT_DIST);
    const p = sCurve((hold - 0.15) / 0.3);
    const tgt = new THREE.Vector3().lerpVectors(contactPos, retreatTarget, p);
    r.runIK(targetForGripper(tgt), { safetyMargin: 0.08 });
    this._setGripperState(r, 1, dt);
  } else {
    // Now lift straight up
    const liftBase = isFoupPick
      ? new THREE.Vector3(FOUP_FRONT_X + 3.5, safePickY, pickWorld.z)
      : (isRinseStep(prevStep.id)
          ? (() => {
              const moduleCenter = new THREE.Vector3(prevStep.x, contactPos.y, prevStep.z);
              const dir = contactPos.clone().sub(moduleCenter);
              if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
              dir.normalize();
              return contactPos.clone().addScaledVector(dir, 0.5);
            })()
          : contactPos.clone());
    const liftPos = liftBase.clone();
    liftPos.y = SAFE_HEIGHT;
    const liftP = sCurve(Math.min((hold - (isFoupPick || isRinseStep(prevStep.id) ? 0.45 : 0.15)) / 0.5, 1));
    const tgt = new THREE.Vector3().lerpVectors(liftBase, liftPos, liftP);
    r.runIK(targetForGripper(tgt), { isTravel: true, safetyMargin: 0.10 });
    this._setGripperState(r, 1, dt);
    if (liftP >= 1) {
      delete ud.postAttachHold;
      ud.armPhase = 'transport';
      ud.phaseT = 0;
      ud.bezierT = 0;
    }
  }
  break;
}

        default:
          ud.armPhase = 'approach';
          ud.phaseT = 0;
          break;
      }

    } else {
      // ══════════════════════════════════════════════════════════════════════════
      // PLACE SEQUENCE
      // ══════════════════════════════════════════════════════════════════════════
      const isScannerDrop = dropStep.id === 'scanner';
      const isFoupDrop = dropStep.type === 'foup' || (target as any)._returnToFoup;
      const isInterfaceDrop = dropStep.type === 'iface';

      // FOUP-specific safe zone (same as pick)
      const FOUP_FRONT_X = (ALL_STEPS[0].x + 5.5);
      const FOUP_MAX_Y = 2.8;

      // Compute safe approach based on destination type
      let approachDrop: THREE.Vector3;
      let insertDrop: THREE.Vector3;
      let placePos: THREE.Vector3;

      if (isFoupDrop) {
        // FOUP RETURN: approach horizontally, never go above FOUP top
        approachDrop = new THREE.Vector3(
          FOUP_FRONT_X + 2.0,        // stand in front of FOUP
          Math.min(dropWorld.y, FOUP_MAX_Y),
          dropWorld.z
        );
        insertDrop = new THREE.Vector3(
          FOUP_FRONT_X + 0.5,         // approach door
          Math.min(dropWorld.y, FOUP_MAX_Y),
          dropWorld.z
        );
        placePos = new THREE.Vector3(
          Math.max(dropWorld.x, FOUP_FRONT_X),  // never go behind front
          Math.min(dropWorld.y + 0.05, FOUP_MAX_Y),
          dropWorld.z
        );
      } else if (isScannerDrop) {
        // ── SCANNER: drop into TOP chuck — vertical approach/drop sequence
        const chuckY = dropWorld.y;     // actual chuck top height (from waferAnchor)

        approachDrop = new THREE.Vector3(
          dropWorld.x,                  // directly above chuck (X)
          chuckY + 1.8,                 // ← rise WELL ABOVE the chuck
          dropWorld.z                   // directly above chuck (Z)
        );
        insertDrop = new THREE.Vector3(
          dropWorld.x,
          chuckY + 0.5,                 // ← hovering just above chuck
          dropWorld.z
        );
        placePos = new THREE.Vector3(
          dropWorld.x,
          chuckY + 0.02,                // ← on chuck (tiny gap for seating)
          dropWorld.z
        );
        } else if (isHardBakeStep(dropStep.id)) {                          // ← ADD THIS BLOCK
  const topY = dropWorld.y + 1.6;
  approachDrop = new THREE.Vector3(dropWorld.x, topY, dropWorld.z);
  insertDrop   = new THREE.Vector3(dropWorld.x, dropWorld.y + 0.5, dropWorld.z);
  placePos     = new THREE.Vector3(dropWorld.x, dropWorld.y + 0.05, dropWorld.z);
  } else if (isCoatStationStep(dropStep.id)) {
  const topY = dropWorld.y + 1.8;   // clear above the dispense arm's swing radius — tune against your nozzle height
  approachDrop = new THREE.Vector3(dropWorld.x, topY, dropWorld.z);
  insertDrop   = new THREE.Vector3(dropWorld.x, dropWorld.y + 0.5, dropWorld.z);
  placePos     = new THREE.Vector3(dropWorld.x, dropWorld.y + 0.05, dropWorld.z);
      } else {
        // STANDARD MODULE PLACE
        approachDrop = new THREE.Vector3(
          dropWorld.x,
          WAFER_TRANSFER_Y + APPROACH_OFFSET + 0.3,
          dropWorld.z
        );
        insertDrop = new THREE.Vector3(
          dropWorld.x,
          WAFER_TRANSFER_Y + 0.1,
          dropWorld.z
        );
        placePos = new THREE.Vector3(
          dropWorld.x,
          WAFER_TRANSFER_Y + 0.05,
          dropWorld.z
        );
      }

      switch (phase) {
        case 'lift':
        case 'transport':
        case 'carry':
        case 'rise': {
          ud.bezierT = Math.min((ud.bezierT as number) + actionDt * 0.5, 1);
          const tBz = sCurve(ud.bezierT as number);
          const tgt = new THREE.Vector3();
          evalBezier(tgt, tBz);

          // Force travel arc above all modules for cross-row motion.
          tgt.y = Math.max(tgt.y, SAFE_TRAVEL_Y + (isCrossRow ? 0.3 : 0));

          // For FOUP destination: clamp arc height so we never go above FOUP top
          if (isFoupDrop) {
            tgt.y = Math.min(tgt.y, FOUP_MAX_Y + 1.5);
          }

          r.runIK(targetForGripper(tgt), {
            isTravel: true,
            isScanner: isScannerDrop,
            safetyMargin: 0.12,
          });
          this._setGripperState(r, 1, dt);
          if ((ud.bezierT as number) >= 1 && railArrived) {
            ud.armPhase = 'approach_drop';
            ud.phaseT = 0;
          }
          break;
        }

        case 'approach_drop': {
          // Move to approach position — for scanner, rise high above body first
          const p = sCurve(Math.min(phaseT / 0.6, 1));
          const tgt = new THREE.Vector3().lerpVectors(
            new THREE.Vector3(approachDrop.x, SAFE_HEIGHT, approachDrop.z),
            approachDrop,
            p
          );
          r.runIK(targetForGripper(tgt), {
            isScanner: isScannerDrop,
            approachHeight: 0.16,
            safetyMargin: 0.10
          });
          this._setGripperState(r, 1, dt);
          if (p >= 1) {
           ud.armPhase = isFoupDrop ? 'foup_insert'
  : (isScannerDrop ? 'scanner_insert'
  : (isHardBakeStep(dropStep.id) ? 'hardbake_insert'
  : (isCoatStationStep(dropStep.id) ? 'coat_insert' : 'place_contact')));
            ud.phaseT = 0;
          }
          break;
        }

        case 'foup_insert': {
          // Move horizontally into FOUP at constant height
          const p = sCurve(Math.min(phaseT / 0.8, 1));
          const tgt = new THREE.Vector3(
            lerp(approachDrop.x, insertDrop.x, p),
            Math.min(approachDrop.y, FOUP_MAX_Y),
            dropWorld.z
          );
          r.runIK(targetForGripper(tgt), {
            safetyMargin: 0.08
          });
          this._setGripperState(r, 1, dt);
          if (p >= 1) {
            ud.armPhase = 'place_contact';
            ud.phaseT = 0;
          }
          break;
        }

        case 'scanner_insert': {
          // Phase 1: move horizontally over the slot (X/Z align) while staying high
          const p = sCurve(Math.min(phaseT / 0.55, 1));
          const tgt = new THREE.Vector3(
            lerp(approachDrop.x, insertDrop.x, p),
            approachDrop.y,                          // stay at rise height during align
            lerp(approachDrop.z, insertDrop.z, p)
          );
          r.runIK(targetForGripper(tgt), {
            isScanner: true,
            safetyMargin: 0.06
          });
          this._setGripperState(r, 1, dt);
          if (p >= 1) {
            ud.armPhase = 'scanner_lower';
            ud.phaseT = 0;
          }
          break;
        }

        case 'scanner_lower': {
          // Phase 2: lower straight down into the slot from above
          const p = sCurve(Math.min(phaseT / 0.55, 1));
          const tgt = new THREE.Vector3(
            insertDrop.x,
            lerp(insertDrop.y, placePos.y, p),       // descend into slot
            insertDrop.z
          );
          r.runIK(targetForGripper(tgt), {
            isScanner: true,
            safetyMargin: 0.04
          });
          this._setGripperState(r, 1, dt);
          if (p >= 1) {
            ud.armPhase = 'place_contact';
            ud.phaseT = 0;
          }
          break;
        }
        case 'hardbake_insert': {                                            // ← ADD THIS CASE
  const p = sCurve(Math.min(phaseT / 0.55, 1));
  const tgt = new THREE.Vector3(
    lerp(approachDrop.x, insertDrop.x, p),
    approachDrop.y,
    lerp(approachDrop.z, insertDrop.z, p)
  );
  r.runIK(targetForGripper(tgt), { safetyMargin: 0.06 });
  this._setGripperState(r, 1, dt);
  if (p >= 1) { ud.armPhase = 'hardbake_lower'; ud.phaseT = 0; }
  break;
}

case 'hardbake_lower': {                                             // ← ADD THIS CASE
  const p = sCurve(Math.min(phaseT / 0.55, 1));
  const tgt = new THREE.Vector3(
    insertDrop.x,
    lerp(insertDrop.y, placePos.y, p),
    insertDrop.z
  );
  r.runIK(targetForGripper(tgt), { safetyMargin: 0.04 });
  this._setGripperState(r, 1, dt);
  if (p >= 1) { ud.armPhase = 'place_contact'; ud.phaseT = 0; }
  break;
}
case 'coat_insert': {
  const p = sCurve(Math.min(phaseT / 0.55, 1));
  const tgt = new THREE.Vector3(
    lerp(approachDrop.x, insertDrop.x, p),
    approachDrop.y,
    lerp(approachDrop.z, insertDrop.z, p)
  );
  r.runIK(targetForGripper(tgt), { safetyMargin: 0.06 });
  this._setGripperState(r, 1, dt);
  if (p >= 1) { ud.armPhase = 'coat_lower'; ud.phaseT = 0; }
  break;
}

case 'coat_lower': {
  const p = sCurve(Math.min(phaseT / 0.55, 1));
  const tgt = new THREE.Vector3(
    insertDrop.x,
    lerp(insertDrop.y, placePos.y, p),
    insertDrop.z
  );
  r.runIK(targetForGripper(tgt), { safetyMargin: 0.04 });
  this._setGripperState(r, 1, dt);
  if (p >= 1) { ud.armPhase = 'place_contact'; ud.phaseT = 0; }
  break;
}
        case 'place_contact': {
          const p = sCurve(Math.min(phaseT / 0.6, 1));
          const tgt = new THREE.Vector3().lerpVectors(insertDrop, placePos, p);

          // Safety clamps
          if (isFoupDrop) {
            tgt.y = Math.min(tgt.y, FOUP_MAX_Y);
            tgt.x = Math.max(tgt.x, FOUP_FRONT_X);
          }

          r.runIK(targetForGripper(tgt), {
            isScanner: isScannerDrop,
            safetyMargin: 0.04
          });
          this._setGripperState(r, 1, dt);
          if (p >= 1) {
            ud.armPhase = 'release';
            ud.phaseT = 0;
          }
          break;
        }

        case 'release': {
          r.runIK(targetForGripper(placePos), {
            isScanner: isScannerDrop,
            safetyMargin: 0.04
          });
          this._setGripperState(r, 0, dt);

          if (phaseT > 0.4) {
            // Detach wafer at the final place position for scanner drops.
            if (isScannerDrop) {
              target.detachAt(placePos);
            } else {
              target.detachAt(dropWorld);
            }
            (target as any)._picked = false;
            (target as any)._pickupX = undefined;
            (target as any)._pickupZ = undefined;

            // Handle FOUP return completion
            if ((target as any)._returnToFoup) {
              (target as any)._returnToFoup = false;
              (target as any)._returning = false;
              target.done = true;
              target.state = 'done';
              target.mesh.visible = true;
              this._addLog(`[${WAFER_NAMES[target.wi]}] RETURNED TO FOUP ✓`, 'place');

              // Place wafer at the FOUP slot position
              const foupGrp = this.modObjs['foup'];
              const anchors = foupGrp?.userData?.slotAnchors as THREE.Object3D[] | undefined;
              if (anchors?.[target.wi]) {
                const slotPos = new THREE.Vector3();
                anchors[target.wi].getWorldPosition(slotPos);
                target.mesh.position.copy(slotPos);
              }
            } else {
              this._addLog(`[${WAFER_NAMES[target.wi]}] PLACE @ ${dropStep.short}`, 'place');
              target.state = 'processing';
              target.processTimer = 0;
              this._onProcessStart(target, dropStep);
              this.busy[dropStep.id] = target.wi;
            }

            // Choose retract phase based on destination
            if (isInterfaceDrop) {
              ud.armPhase = 'place_hold';
            } else {
              ud.armPhase = isScannerDrop ? 'scanner_retract' : (isFoupDrop ? 'foup_retract' : 'retract');
            }
            ud.phaseT = 0;
          }
          break;
        }

        case 'place_hold': {
          r.runIK(targetForGripper(placePos), {
            isScanner: isScannerDrop,
            safetyMargin: 0.04
          });
          this._setGripperState(r, 0, dt);
          if (phaseT > 0.8) {
            ud.armPhase = 'retract';
            ud.phaseT = 0;
          }
          break;
        }

        case 'scanner_retract': {
          // Move out of the scanner slot and then lift away.
          const p = sCurve(Math.min(phaseT / 0.65, 1));
          const exitPos = new THREE.Vector3(
            placePos.x,
            approachDrop.y,            // rise to the slot clearance height
            placePos.z + 3.5           // step out in front of the scanner
          );
          const tgt = new THREE.Vector3().lerpVectors(placePos, exitPos, p);
          r.runIK(targetForGripper(tgt), {
            isScanner: true,
            safetyMargin: 0.06
          });
          this._setGripperState(r, 0, dt);
          if (p >= 1) {
            ud.armPhase = 'retract';
            ud.phaseT = 0;
          }
          break;
        }

        case 'foup_retract': {
          // Pull straight out of FOUP horizontally before lifting
          const p = sCurve(Math.min(phaseT / 0.7, 1));
          const retractedPos = new THREE.Vector3(
            FOUP_FRONT_X + 3.5,
            Math.min(placePos.y, FOUP_MAX_Y),
            placePos.z
          );
          const tgt = new THREE.Vector3(
            lerp(placePos.x, retractedPos.x, p),
            Math.min(lerp(placePos.y, retractedPos.y, p), FOUP_MAX_Y),
            placePos.z
          );
          r.runIK(targetForGripper(tgt), {
            safetyMargin: 0.08
          });
          this._setGripperState(r, 0, dt);
          if (p >= 1) {
            ud.armPhase = 'retract';
            ud.phaseT = 0;
          }
          break;
        }

        case 'retract': {
          // Lift up to safe height
          const liftedPos = new THREE.Vector3(
            r.group.position.x,
            SAFE_HEIGHT,
            0
          );
          const p = sCurve(Math.min(phaseT / 0.5, 1));
          const startPos = isFoupDrop
            ? new THREE.Vector3(FOUP_FRONT_X + 3.5, Math.min(placePos.y, FOUP_MAX_Y), placePos.z)
            : (isScannerDrop ? new THREE.Vector3(placePos.x, approachDrop.y, placePos.z) : placePos);
          const tgt = new THREE.Vector3().lerpVectors(startPos, liftedPos, p);
          r.runIK(targetForGripper(tgt), {
            safetyMargin: 0.10
          });
          this._setGripperState(r, 0, dt);
          if (p >= 1) {
            ud.armPhase = 'idle';
            ud.phaseT = 0;
          }
          break;
        }

        default:
          ud.armPhase = 'transport';
          ud.phaseT = 0;
          break;
      }
    }

    // ── Status LED ──
    if ((ud.gripperState as number) > 0.7) {
      r.statusPL.color.setHex(0x00ffff);
      r.statusPL.intensity = 2.5 + 0.5 * Math.sin(t * 8);
    } else if (carried) {
      r.statusPL.color.setHex(0x00ff88);
      r.statusPL.intensity = 1.8;
    } else {
      r.statusPL.color.setHex(0x00d8ff);
      r.statusPL.intensity = 1.2 + 0.5 * Math.sin(t * 2.8);
    }
  }
  private _getCarrierForStep(si: number): RobotObject | null {
    // Single robot handles every step-to-step transfer in the no-belt layout.
    return this.robotEFEM ?? null;
  }
  //   private _useConveyor(fromIdx: number, toIdx: number): boolean {
  //     const topRange = (i: number) => i >= 1 && i <= 7;
  //     const botRange = (i: number) => i >= 10 && i <= 16;
  //     return (topRange(fromIdx) && topRange(toIdx)) || (botRange(fromIdx) && botRange(toIdx));
  //   }
  private _useConveyor(fromIdx: number, toIdx: number): boolean {
    // No conveyor belts in this single-robot flow.
    return false;
  }
  private _tickWafer(sm: WaferStateMachine, dt: number) {
    if (sm.done || !sm.launched) return;

    // Already returning to FOUP and being carried by robot — let robot finish
    if ((sm as any)._returning && sm.carrierRobot) {
      // Wafer transform owned by gripper.attach() — nothing to do here
      return;
    }
    const w = sm.mesh;
    const currentStep = ALL_STEPS[sm.stepIdx];
    const isScannerStage = currentStep?.id === 'scanner' || currentStep?.type === 'iface';
    const waferSpeed = isScannerStage ? Math.max(this.speed, 10) : this.speed;
    if (sm.spinning && !this.paused) { sm.spin += dt * waferSpeed * 8; w.rotation.y = sm.spin; }

    const sDt = dt * waferSpeed;

    switch (sm.state) {

      // ── IDLE: decide next move ──────────────────────────────────────────────
      case "idle": {
        // After all steps done, return wafer to FOUP
        if (sm.stepIdx >= ALL_STEPS.length) {
          // Don't mark done yet — return wafer to FOUP first
          if (!(sm as any)._returning) {
            (sm as any)._returning = true;
            (sm as any)._returnToFoup = true;
            (sm as any)._picked = false;

            // Set pickup point as the last processed module (hardbake)
            const lastMod = ALL_STEPS[ALL_STEPS.length - 1];
            (sm as any)._pickupX = lastMod.x;
            (sm as any)._pickupZ = lastMod.z;

            sm.state = "track_approach";
            sm.timer = 0;
            this._addLog(`[${WAFER_NAMES[sm.wi]}] RETURNING → FOUP`, "move");
            return;
          }

          // Already returning — wait for robot to complete
          return;
        }

        const mod = ALL_STEPS[sm.stepIdx];

        // Don't reserve if another wafer owns this module
        if (this.busy[mod.id] !== undefined && this.busy[mod.id] !== sm.wi) return;

        // Wait for robot to be ready
        if (!this.robotEFEM || !this.robotEFEM.gripper) return;

        // Don't start if robot is busy carrying another wafer
        const robotBusy = this.wSMs.some(
          (o) => o !== sm && o.carrierRobot === this.robotEFEM
        );
        if (robotBusy) return;

        // Reserve the module and hand off to the robot
        this.busy[mod.id] = sm.wi;
        (sm as any)._picked = false;

        // Set pickup point as the previous module
        const prevStepIdx = Math.max(sm.stepIdx - 1, 0);
        const prevMod = ALL_STEPS[prevStepIdx];
        (sm as any)._pickupX = prevMod.x;
        (sm as any)._pickupZ = prevMod.z;

        sm.state = "track_approach";
        sm.timer = 0;
        sm.owner = "robot";
        sm.mesh.visible = true;
        this._addLog(`[${WAFER_NAMES[sm.wi]}] REQUEST → ${mod.short}`, "move");
        break;
      }
      // ── CONVEYOR MOVE: slide along belt surface ─────────────────────────────
      case "conveyor_move": {
        const done = sm.tickConveyor(sDt);
        if (done) {
          sm.onConveyor = false;
          const mod = ALL_STEPS[sm.stepIdx];
          const isTop = mod.z < 0;
          const beltZ = isTop ? TOP_TRACK_BELT_Z : BOT_TRACK_BELT_Z;

          // Begin entry animation: belt → module chuck
          sm.entryEl = 0;
          sm.entryDur = 0.6 / Math.max(this.speed, 1);
          sm.entryStart.set(mod.x, CONVEYOR_WAFER_Y, beltZ);

          // FIX 5: Use actual waferAnchor world position if available
          const modGrp = this.modObjs[mod.id];
          const wa = modGrp?.userData?.waferAnchor as THREE.Object3D | undefined;
          const endPos = new THREE.Vector3();
          if (wa) {
            wa.getWorldPosition(endPos);
          } else {
            endPos.set(mod.x, 0.93, mod.z);
          }
          sm.entryEnd.copy(endPos);
          sm.state = "belt_to_module";
          this._addLog(`[${WAFER_NAMES[sm.wi]}] ENTER → ${mod.short}`, "pick");
        }
        break;
      }

      // ── BELT TO MODULE: glide from belt into module ─────────────────────────
     case "belt_to_module": {
  sm.entryEl += sDt;
  const t = Math.min(sm.entryEl / sm.entryDur, 1);
  const e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);

  const LIFT_HEIGHT = 1.2; // ← tune this until it clears the box walls

  w.position.x = lerp(sm.entryStart.x, sm.entryEnd.x, e);
  w.position.z = lerp(sm.entryStart.z, sm.entryEnd.z, e);
  // Base height still interpolates normally, but we add an arc on top —
  // Math.sin(π * t) is 0 at t=0 and t=1, and peaks at t=0.5 (mid-transit)
  w.position.y = lerp(sm.entryStart.y, sm.entryEnd.y, e) + LIFT_HEIGHT * Math.sin(Math.PI * t);

  if (t >= 1) {
    w.position.copy(sm.entryEnd);
    const mod = ALL_STEPS[sm.stepIdx];
    sm.state = "processing";
    sm.processTimer = 0;
    this._onProcessStart(sm, mod);
    this._addLog(`[${WAFER_NAMES[sm.wi]}] PLACE @ ${mod.short}`, "place");
  }
  break;
}

      // ── PROCESSING: wafer sits on chuck being processed ─────────────────────
      case "processing": {
        sm.processTimer += sDt;
        const mod = ALL_STEPS[sm.stepIdx];
        const mo = this.modObjs[mod.id];

        if (mo?.userData.processLight) {
          const li: Record<string, number> = { hot: 4.0, cold: 3.2, scan: 6.0, coat: 3.5, wet: 3.0, dry: 3.0, iface: 2.5, foup: 1.5 };
          (mo.userData.processLight as THREE.PointLight).intensity =
            (li[mod.type] ?? 2.5) + 0.6 * Math.sin(this.simTime * 4);
        }
        if (mo?.userData.innerRing) {
          const mat = (mo.userData.innerRing as THREE.Mesh).material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = 2.5 + 1.5 * Math.sin(this.simTime * 6);
        }
        if (mod.type === "hot" && mo?.userData.coils) {
          (mo.userData.coils as THREE.Mesh[]).forEach((coil, idx) => {
            const cm = coil.material as THREE.MeshStandardMaterial;
            cm.emissiveIntensity = 1.5 + 1.0 * Math.sin(this.simTime * 4 + idx);
          });
        }
        if (mod.id === "prcoat" && this._activeCoatWI === sm.wi) {
          this.spinCoat.tick(dt, this.speed);
          const prLayer = w.userData.prLayer as THREE.Mesh | undefined;
          if (prLayer) {
            const mat = prLayer.material as THREE.MeshStandardMaterial;
            const pink = new THREE.Color(0xcc1177);
            if (["dispense", "spinup", "coating"].includes(this.spinCoat.phase)) {
              mat.color.lerp(pink, 0.12);
              mat.emissive.lerp(pink, 0.08);
              mat.opacity = lerp(mat.opacity, 0.95, 0.06);
              const glowRing = w.userData.glowRing as THREE.Mesh | undefined;
              if (glowRing) {
                (glowRing.material as THREE.MeshStandardMaterial).color.lerp(pink, 0.1);
                (glowRing.material as THREE.MeshStandardMaterial).emissive.lerp(pink, 0.06);
              }
            }
          }
        }
        if (mod.id === "develop" && this._activeDevWI === sm.wi) {
          this.devLiquid.tick(dt, this.speed);
          const prLayer = w.userData.prLayer as THREE.Mesh | undefined;
          if (prLayer) {
            const mat = prLayer.material as THREE.MeshStandardMaterial;
            const baseCol = new THREE.Color(WAFER_COLORS[sm.wi]);
            const green = new THREE.Color(0x33cc88);
            const grey = new THREE.Color(0x8899cc);
            if (["spray", "puddle"].includes(this.devLiquid.phase)) {
              mat.color.lerp(green, 0.12);
              mat.emissive.lerp(new THREE.Color(0x22aa66), 0.08);
              mat.opacity = lerp(mat.opacity, 0.95, 0.06);
            } else if (["rinse", "drain"].includes(this.devLiquid.phase)) {
              mat.color.lerp(grey, 0.10);
              mat.emissive.lerp(new THREE.Color(0x112244), 0.06);
              mat.opacity = lerp(mat.opacity, 0.9, 0.08);
            } else {
              mat.color.lerp(baseCol, 0.06);
              mat.emissive.lerp(new THREE.Color(0x000000), 0.04);
              mat.opacity = lerp(mat.opacity, 0.0, 0.06);
            }
          }
        }
        if (mod.id === "scanner") {
          this._animateScannerEntry(sm, dt);
        }
        if (mod.id === "scanner" && mo?.userData.uvBeam) {
          const beam = mo.userData.uvBeam as THREE.Mesh;
          const bmat = beam.material as THREE.MeshStandardMaterial;
          bmat.emissiveIntensity = 1.5 + 1.2 * Math.abs(Math.sin(this.simTime * 8));
          bmat.opacity = 0.08 + 0.08 * Math.abs(Math.sin(this.simTime * 8));
          const pr = w.userData.prLayer as THREE.Mesh;
          if (pr) {
            (pr.material as THREE.MeshStandardMaterial).emissiveIntensity =
              0.7 + 0.5 * Math.abs(Math.sin(this.simTime * 8));
          }
        }

        if (sm.processTimer >= mod.time) {
          if (mod.id === "scanner" && !sm.mesh.visible) sm.mesh.visible = true;
          this._onProcessEnd(sm, mod, mo);
          if (this.busy[mod.id] === sm.wi) delete this.busy[mod.id];

          // Check if NEXT step is also on conveyor → exit back to belt first
          const nextIdx = sm.stepIdx + 1;
          const nextOnConv = nextIdx < ALL_STEPS.length &&
            this._useConveyor(sm.stepIdx, nextIdx);

          if (nextOnConv) {
            const isTop = mod.z < 0;
            const beltZ = isTop ? TOP_TRACK_BELT_Z : BOT_TRACK_BELT_Z;

            // Exit animation: chuck → belt
            sm.exitEl = 0;
            sm.exitDur = 0.6 / Math.max(this.speed, 1);
            sm.exitStart.set(mod.x, 0.93, mod.z);
            sm.exitEnd.set(mod.x, CONVEYOR_WAFER_Y, beltZ);
            sm.state = "module_to_belt";
            this._addLog(`[${WAFER_NAMES[sm.wi]}] EXIT ← ${mod.short}`, "move");
          } else {
            // Robot picks up — advance to next step normally
            sm.stepIdx++; sm.state = "idle"; sm.timer = 0; sm.processTimer = 0;

            if (sm.wi === 0 && this.narration) {
              this.narration.updateProcessPosition(sm.stepIdx);
            }
            if (sm.wi === 0 && sm.stepIdx >= ALL_STEPS.length && this.narration?.isEnabled()) {
              const doneKey = 'process-complete';
              if (!this._narratedSteps.has(doneKey)) {
                this._narratedSteps.add(doneKey);
                this.narration.speak('All process steps completed. Wafer returning to FOUP for unload.', 'high');
              }
            }
          }
        }
        break;
      }

      // ── MODULE TO BELT: glide from chuck back out to belt ───────────────────
      case "module_to_belt": {
        sm.exitEl += sDt;
        const t = Math.min(sm.exitEl / sm.exitDur, 1);
        const e = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
        w.position.x = lerp(sm.exitStart.x, sm.exitEnd.x, e);
        w.position.y = lerp(sm.exitStart.y, sm.exitEnd.y, e);
        w.position.z = lerp(sm.exitStart.z, sm.exitEnd.z, e);
        if (t >= 1) {
          w.position.copy(sm.exitEnd);
          sm.stepIdx++;
          sm.state = "idle";
          sm.timer = 0;
          sm.processTimer = 0;

          if (sm.wi === 0 && this.narration) {
            this.narration.updateProcessPosition(sm.stepIdx);
          }
        }
        break;
      }

      // ── ROBOT STATES ────────────────────────────────────────────────────────
      //  case "track_approach": {
      //   sm.timer += sDt;
      //   const robot = this._getCarrierForStep(sm.stepIdx);
      //   if (!robot) { sm.state = "idle"; return; }

      //   const railX = robot.group.userData.railX ?? robot.basePos.x;
      //   const picked = (sm as any)._picked;
      //   const pickupX = (sm as any)._pickupX;

      //   if (!picked) {
      //     // PHASE 1: slide to pickup location, then attach
      //     const distToPickup = Math.abs(railX - pickupX);
      //     if (distToPickup < 0.5 && sm.timer > 0.3) {
      //       sm.attachTo(robot);
      //       (sm as any)._picked = true;
      //       sm.timer = 0;
      //       this._addLog(`[${WAFER_NAMES[sm.wi]}] PICK ↑ ${ALL_STEPS[Math.max(sm.stepIdx-1,0)].short}`, "pick");
      //     }
      //   } else {
      //     // PHASE 2: slide to drop location, then place
      //     const mod = ALL_STEPS[sm.stepIdx];
      //     const distToDrop = Math.abs(railX - mod.x);
      //     if (distToDrop < 0.5 && sm.timer > 0.3) {
      //       sm.state = "track_place";
      //       sm.timer = 0;
      //     }
      //   }
      //   break;
      // }
      //     case "track_place": {
      //       sm.timer += sDt;
      //       if (sm.timer >= PLACE_DELAY) {
      //         const mod = ALL_STEPS[sm.stepIdx];
      //         sm.detachAt(sm.targetPos);
      //         this._addLog(`[${WAFER_NAMES[sm.wi]}] PLACE @ ${mod.short}`, "place");
      //         sm.state = "processing"; sm.processTimer = 0;
      //         this._onProcessStart(sm, mod);
      //       }
      //       break;
      //     }

      case "track_approach": {
        // Wafer sits at pickup location until robot grabs it.
        // Once _animRobots calls attachTo(), wafer moves with robot automatically.
        // Once _animRobots calls detachAt() + sets state='processing', we're done.
        sm.timer += sDt;
        // Safety timeout — if stuck for 60 sim-seconds, reset to idle
        if (sm.timer > 60) {
          sm.state = "idle";
          sm.timer = 0;
          (sm as any)._picked = false;
          (sm as any)._pickupX = undefined;
          (sm as any)._pickupZ = undefined;
        }
        break;
      }

      // case "track_place": {
      //   sm.state        = "processing";
      //   sm.processTimer = 0;
      //   break;
      // }

      case "track_place": {
        // No-op: handled by _animRobots now. Skip straight to processing if reached.
        sm.state = "processing";
        sm.processTimer = 0;
        break;
      }
    }
  }
  /** Speak step narration when the wafer is placed on the module chuck (not on step exit). */
  private _narrateStepArrival(sm: WaferStateMachine, mod: ProcessStep) {
    if (sm.wi !== 0 || !this.narration?.isEnabled()) return;
    const stepKey = `${mod.id}-arrive`;
    if (this._narratedSteps.has(stepKey)) return;
    this._narratedSteps.add(stepKey);
    this.narration.updateProcessPosition(sm.stepIdx);
    import('../lib/narrationScripts').then(({ getStepNarration }) => {
      const script = getStepNarration(mod.id);
      this.narration.speak(script.starting, 'normal');
    });
  }

  private _onProcessStart(sm: WaferStateMachine, mod: ProcessStep) {
  this._narrateStepArrival(sm, mod);
  const w = sm.mesh;

  // ── TEMP DEBUG ──
  if (mod.id === 'peb') {
    const wp = new THREE.Vector3();
    w.getWorldPosition(wp);
    // Safely extract a representative opacity value from the first mesh material
    const mesh = w.getObjectByProperty('isMesh', true) as THREE.Mesh | undefined;
    let opacityVal: number | undefined = undefined;
    if (mesh) {
      const mat: any = mesh.material;
      opacityVal = Array.isArray(mat) ? (mat[0]?.opacity ?? undefined) : (mat?.opacity ?? undefined);
    }
    console.log('[PEB-DEBUG]', {
      visible: w.visible,
      scale: w.scale.toArray(),
      worldPos: wp.toArray(),
      opacity: opacityVal,
    });
  }
    if (mod.id === "prcoat") {
      sm.spinning = true;
      this.prCoatOverlay.start();
      if (this._activeCoatWI < 0) {
        this._activeCoatWI = sm.wi;
        const prS = ALL_STEPS.find(s => s.id === 'prcoat')!;
        // Position is already set in _build — just start the animation
        this.spinCoat.startCoat(prS.x, prS.z, 0xcc1177);
        this.spinCoat.group.visible = true;
      }
    }
    if (mod.id === "develop") {
      if (this._activeDevWI < 0) {
        this._activeDevWI = sm.wi;
        this.devLiquid.startDev(mod.x, mod.z);
        this.devOverlay.start();
      }
    }
    if (mod.id === "spindry" || mod.id === "rinse" || mod.id === "develop") sm.spinning = true;
    if (mod.id === "hmds") this.hmdsFog.on();
    if (mod.id === "spindry") this.n2Particles.on();
    if (mod.id === "rinse") this.waterParticles.on();
    if (mod.type === "hot" && this.heatVapors[mod.id]) this.heatVapors[mod.id].on();
  }

  private _openProcessPage(htmlFile: string, title: string): void {
    // Map old html names to MP4 files in /public/
    const videoMap: Record<string, string> = {
      'pr_coat_process.html': 'pr_coat_anim.mp4',
      'developer_process.html': 'developeranimation.mp4',
      'pr_coat_animation.html': 'pr_coat_anim.mp4',
      'developer_animation.html': 'developeranimation.mp4',
    };
    const videoFile = videoMap[htmlFile] || htmlFile.replace('.html', '.mp4');
    this.openAnimVideo(`/${videoFile}`, title);
  }

  /** Inline video popup — preloads, instant play, minimal controls */
  public openAnimVideo(videoSrc: string, title: string): void {
    this.setVideoOpen(true);
    this.paused = true;

    const existing = document.getElementById('__animVideoPopup');
    if (existing) existing.remove();

    // ── Inject shared styles (reuse smart-video-styles if already present) ──
    if (!document.getElementById('smart-video-styles')) {
      const s = document.createElement('style');
      s.id = 'smart-video-styles';
      s.textContent = `
        @keyframes smartFadeIn  { from { opacity:0 } to { opacity:1 } }
        @keyframes smartSlideUp { from { transform:translateY(16px);opacity:0 } to { transform:translateY(0);opacity:1 } }
        .smart-speed-btn {
          padding:4px 10px; border-radius:4px; font-size:11px; font-weight:700;
          cursor:pointer; border:1px solid rgba(51,221,255,0.3);
          background:rgba(51,221,255,0.08); color:#66ddff;
          transition:background 0.15s,border-color 0.15s; font-family:'Inter',sans-serif;
        }
        .smart-speed-btn:hover  { background:rgba(51,221,255,0.22); border-color:#33ddff; }
        .smart-speed-btn.active { background:rgba(51,221,255,0.30); border-color:#33ddff; color:#fff; }
        .smart-scrubber {
          -webkit-appearance:none; appearance:none; width:100%; height:3px;
          background:rgba(255,255,255,0.15); border-radius:2px; outline:none; cursor:pointer;
        }
        .smart-scrubber::-webkit-slider-thumb {
          -webkit-appearance:none; width:12px; height:12px; border-radius:50%;
          background:#33ddff; cursor:pointer; margin-top:-4px;
        }
      `;
      document.head.appendChild(s);
    }

    const isPR = videoSrc.includes('pr_coat');
    const accent = isPR ? '#ff44aa' : '#33ddff';
    const caption = isPR
      ? 'PR Coat — resist dispense, spin-up, edge bead removal'
      : 'Developer — puddle dispense, develop reaction, DI rinse & spin-dry';

    // ── Backdrop ──
    const backdrop = document.createElement('div');
    backdrop.id = '__animVideoPopup';
    Object.assign(backdrop.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100vw', height: '100vh',
      background: 'rgba(0,5,12,0.93)',
      backdropFilter: 'blur(5px)',
      zIndex: '9999',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'smartFadeIn 0.18s ease-out',
    });

    // ── Container ──
    const container = document.createElement('div');
    Object.assign(container.style, {
      width: 'min(72%,860px)', maxHeight: '90vh',
      background: '#070b11',
      border: `2px solid ${accent}`,
      borderRadius: '12px',
      boxShadow: `0 0 60px ${accent}55, 0 20px 80px rgba(0,0,0,0.9)`,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      animation: 'smartSlideUp 0.25s ease-out',
    });

    // ── Header ──
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '11px 18px',
      background: 'rgba(0,0,0,0.5)',
      borderBottom: `1px solid ${accent}55`,
      gap: '10px',
    });

    const titleEl = document.createElement('div');
    titleEl.textContent = title.toUpperCase();
    Object.assign(titleEl.style, {
      color: accent, fontSize: '13px', fontWeight: 'bold',
      letterSpacing: '2px', fontFamily: '"Inter","Segoe UI",sans-serif',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    });

    // Speed buttons
    const speedGroup = document.createElement('div');
    Object.assign(speedGroup.style, { display: 'flex', gap: '5px', alignItems: 'center', flexShrink: '0' });
    [1, 1.5, 2].forEach(spd => {
      const btn = document.createElement('button');
      btn.className = 'smart-speed-btn' + (spd === 1 ? ' active' : '');
      btn.textContent = spd + '×';
      btn.onclick = () => {
        video.playbackRate = spd;
        speedGroup.querySelectorAll('.smart-speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      };
      speedGroup.appendChild(btn);
    });

    const ctrlGroup = document.createElement('div');
    Object.assign(ctrlGroup.style, { display: 'flex', gap: '6px', alignItems: 'center', flexShrink: '0' });

    const playBtn = document.createElement('button');
    playBtn.className = 'smart-speed-btn';
    playBtn.style.minWidth = '74px';
    playBtn.textContent = '❚❚ Pause';

    const closeBtn = document.createElement('button');
    Object.assign(closeBtn.style, {
      padding: '6px 14px',
      background: 'linear-gradient(135deg,#cc2244,#882233)',
      color: '#fff', border: '1px solid #ff5577', borderRadius: '4px',
      cursor: 'pointer', fontSize: '12px', fontWeight: 'bold',
      fontFamily: '"Inter",sans-serif',
    });
    closeBtn.textContent = '✕ CLOSE';

    ctrlGroup.append(speedGroup, playBtn, closeBtn);
    header.append(titleEl, ctrlGroup);

    // ── Video ──
    const preloadKey = '_preloaded_' + videoSrc;
    const preloaded = (this as any)[preloadKey] as HTMLVideoElement | undefined;
    const video = (preloaded && preloaded.readyState >= 2) ? preloaded : document.createElement('video');
    if (!preloaded || preloaded.readyState < 2) { video.src = videoSrc; }
    video.autoplay = true;
    video.muted = false;
    video.controls = false;
    video.playsInline = true;
    video.playbackRate = 1;
    video.setAttribute('controlslist', 'nodownload nofullscreen noremoteplayback');
    video.setAttribute('disablepictureinpicture', '');
    video.oncontextmenu = (e) => { e.preventDefault(); return false; };
    Object.assign(video.style, {
      width: '100%', maxHeight: '68vh', display: 'block',
      background: '#000', objectFit: 'contain',
    });

    // Show first frame immediately
    video.addEventListener('loadedmetadata', () => { video.currentTime = 0; }, { once: true });

    // ── Loading indicator (shown until data ready) ──
    const loader = document.createElement('div');
    Object.assign(loader.style, {
      position: 'absolute', color: accent,
      fontSize: '13px', letterSpacing: '2px', fontWeight: 'bold',
      fontFamily: '"Inter",sans-serif',
    });
    loader.textContent = 'LOADING…';
    video.addEventListener('loadeddata', () => {
      loader.style.display = 'none';
      video.play().catch(e => console.warn('[VIDEO] Autoplay blocked:', e));
    }, { once: true });

    // ── Caption ──
    const captionEl = document.createElement('div');
    Object.assign(captionEl.style, {
      padding: '5px 18px', fontSize: '10px',
      color: 'rgba(255,255,255,0.4)',
      fontFamily: '"Inter",sans-serif', letterSpacing: '0.3px',
      background: 'rgba(0,0,0,0.3)',
      borderTop: '1px solid rgba(255,255,255,0.05)',
    });
    captionEl.textContent = caption;

    // ── Scrubber ──
    const scrubWrap = document.createElement('div');
    Object.assign(scrubWrap.style, {
      padding: '7px 18px 6px', background: 'rgba(0,0,0,0.35)',
      borderTop: '1px solid rgba(255,255,255,0.05)',
      display: 'flex', alignItems: 'center', gap: '10px',
    });
    const timeLbl = document.createElement('span');
    Object.assign(timeLbl.style, {
      color: 'rgba(255,255,255,0.4)', fontSize: '10px',
      fontFamily: 'monospace', minWidth: '36px',
    });
    timeLbl.textContent = '0:00';
    const scrubber = document.createElement('input');
    scrubber.type = 'range'; scrubber.className = 'smart-scrubber';
    scrubber.min = '0'; scrubber.max = '100'; scrubber.value = '0';
    scrubber.oninput = () => {
      if (video.duration) video.currentTime = (parseFloat(scrubber.value) / 100) * video.duration;
    };
    video.ontimeupdate = () => {
      if (!video.duration) return;
      const pct = (video.currentTime / video.duration) * 100;
      scrubber.value = String(pct);
      const s = Math.floor(video.currentTime);
      timeLbl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      scrubber.style.background =
        `linear-gradient(to right, ${accent} ${pct}%, rgba(255,255,255,0.15) ${pct}%)`;
    };
    scrubWrap.append(scrubber, timeLbl);

    // ── Play/Pause events ──
    const updatePP = () => { playBtn.textContent = video.paused ? '▶ Play' : '❚❚ Pause'; };
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      video.paused ? video.play() : video.pause();
    });
    video.addEventListener('play', updatePP);
    video.addEventListener('pause', updatePP);

    // ── Close ──
    const closeVideo = () => {
      video.pause();
      if (!(preloaded && video === preloaded)) video.src = '';
      backdrop.style.animation = 'smartFadeIn 0.15s ease-out reverse';
      setTimeout(() => {
        backdrop.remove();
        this.setVideoOpen(false);
        this.paused = false;
      }, 150);
    };

    closeBtn.addEventListener('click', closeVideo);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeVideo(); });
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeVideo(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    // ── Assemble ──
    const videoWrap = document.createElement('div');
    Object.assign(videoWrap.style, {
      position: 'relative', display: 'flex',
      alignItems: 'center', justifyContent: 'center', background: '#000',
    });
    videoWrap.append(video, loader);

    container.append(header, videoWrap, captionEl, scrubWrap);
    backdrop.appendChild(container);
    document.body.appendChild(backdrop);

    video.play().catch(() => {/* blocked */ });
    this._addLog(`[VIDEO] Playing ${title}`, '');
  }

  // Scanner stage animation: ease in, step-and-scan, ease out — anchored to the
  // REAL slot position so the wafer never pops outside the scanner.
  private _animateScannerEntry(sm: WaferStateMachine, dt: number) {
    const phase = sm.processTimer;
    const wafer = sm.mesh;
    const scannerMod = ALL_STEPS.find(s => s.id === 'scanner')!;
    const scannerGrp = this.modObjs['scanner'];

    // ── Resolve the actual slot world position ONCE (single source of truth) ──
    if (!wafer.userData.scannerOrigPos) {
      const slotAnchor = (scannerGrp?.userData?.slotAnchor
        ?? scannerGrp?.userData?.waferAnchor) as THREE.Object3D | undefined;
      const slotPos = new THREE.Vector3();
      if (slotAnchor) {
        slotAnchor.getWorldPosition(slotPos);   // ← exactly where the slot frame is
      } else {
        slotPos.set(scannerMod.x, WAFER_TRANSFER_Y, scannerMod.z);
      }
      wafer.userData.scannerOrigPos = slotPos;
      wafer.userData.scannerStartTime = sm.processTimer;
    }

    const slotPos = wafer.userData.scannerOrigPos as THREE.Vector3;
    const TOTAL_DUR = scannerMod.time;
    const t = Math.min(phase / TOTAL_DUR, 1);

    // Keep the wafer INSIDE the body. The "entry" travel is small and clamped
    // so the wafer never crosses the front face.
    const SLIDE = 0.25;   // tiny in/out nudge — never crosses the body face
    const SCAN  = 0.30;   // step-and-scan travel along X (kept inside slot width)

    if (t < 0.15) {
      // Phase 1: ease IN from the opening (outside → slot)
      const p = t / 0.15;
      const ease = p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);
      wafer.position.x = slotPos.x;
      wafer.position.y = slotPos.y;
      wafer.position.z = lerp(slotPos.z + SLIDE, slotPos.z, ease);
    } else if (t < 0.45) {
      // Phase 2: step-and-scan in X (inside slot)
      const p = (t - 0.15) / 0.30;
      const stepCycle = (p * 4) % 1;
      const scanOffset = (stepCycle < 0.8)
        ? -SCAN + stepCycle * (SCAN * 2.5)
        : -SCAN + (SCAN * 2) * (1 - (stepCycle - 0.8) / 0.2);
      wafer.position.x = slotPos.x + scanOffset;
      wafer.position.y = slotPos.y;
      wafer.position.z = slotPos.z;
    } else if (t < 0.55) {
      // Phase 3: pause at center
      wafer.position.x = slotPos.x;
      wafer.position.y = slotPos.y;
      wafer.position.z = slotPos.z;
    } else if (t < 0.85) {
      // Phase 4: step-and-scan back
      const p = (t - 0.55) / 0.30;
      const stepCycle = (p * 4) % 1;
      const scanOffset = (stepCycle < 0.8)
        ? SCAN - stepCycle * (SCAN * 2.5)
        : SCAN - (SCAN * 2) * (1 - (stepCycle - 0.8) / 0.2);
      wafer.position.x = slotPos.x + scanOffset;
      wafer.position.y = slotPos.y;
      wafer.position.z = slotPos.z;
    } else {
      // Phase 5: ease OUT toward the opening (slot → outside)
      const p = (t - 0.85) / 0.15;
      const ease = p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);
      wafer.position.x = slotPos.x;
      wafer.position.y = slotPos.y;
      wafer.position.z = lerp(slotPos.z, slotPos.z + SLIDE, ease);
    }

    // Tiny vibration during scan
    wafer.position.y = slotPos.y + Math.sin(phase * 8) * 0.005;
  }

  private _onProcessEnd(sm: WaferStateMachine, mod: ProcessStep, mo?: THREE.Group) {
    const w = sm.mesh;
    // Reset scanner animation markers when exiting scanner
    if (mod.id === "scanner") {
      w.userData.scannerOrigPos = undefined;
      w.userData.scannerStartTime = undefined;
    }
    if (mo?.userData.processLight) (mo.userData.processLight as THREE.PointLight).intensity = 0;
    if (mo?.userData.innerRing) {
      const mat = (mo.userData.innerRing as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 2.5;
    }
    sm.spinning = false;
    if (mod.id === "prcoat") {
      const PINK = 0xcc1177;
      const pr = w.userData.prLayer as THREE.Mesh | undefined;
      if (pr) {
        const mat = pr.material as THREE.MeshStandardMaterial;
        mat.color.setHex(PINK);
        mat.emissive.setHex(PINK);
        mat.emissiveIntensity = 1.0;
        mat.opacity = 0.98;
      }
      const glowRing = w.userData.glowRing as THREE.Mesh | undefined;
      if (glowRing) {
        const gmat = glowRing.material as THREE.MeshStandardMaterial;
        gmat.color.setHex(PINK);
        gmat.emissive.setHex(PINK);
      }
    }
    if (mod.id === "develop" && this._activeDevWI === sm.wi) {
      this.devLiquid.stopDev(); this._activeDevWI = -1;
      this.devOverlay.stop();
      // leave wafer color handling to the processing-phase animator
      const glowRing = sm.mesh.userData.glowRing as THREE.Mesh | undefined;
      if (glowRing) {
        const orig = WAFER_COLORS[sm.wi];
        (glowRing.material as THREE.MeshStandardMaterial).color.setHex(orig);
        (glowRing.material as THREE.MeshStandardMaterial).emissive.setHex(orig);
      }
    }
    if (mod.id === "prcoat") { this.prCoatOverlay.stop(); }
    if (mod.id === "hmds") this.hmdsFog.off();
    if (mod.id === "spindry") this.n2Particles.off();
    if (mod.id === "rinse") this.waterParticles.off();
    if (mod.type === "hot" && this.heatVapors[mod.id]) this.heatVapors[mod.id].off();
    // Reset liquid overlay
    if (mod.type === "wet") {
      const liq = w.userData.liquid as THREE.Mesh;
      if (liq) (liq.material as THREE.MeshStandardMaterial).opacity = 0;
    }
    // Reset PR layer emissive after scanner
    if (mod.id === "scanner") {
      const pr = w.userData.prLayer as THREE.Mesh;
      if (pr) (pr.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7;
    }
  }

  // REPLACE _launchWafer with:
  private _launchWafer(wi: number) {
    const sm = this.wSMs[wi];
    if (sm.launched) return;
    sm.launched = true;
    sm.mesh.visible = true;
    sm.mesh.scale.setScalar(1);

    // ── Reset wafer to GREY silicon at launch ──
    const prLayer = sm.mesh.userData.prLayer as THREE.Mesh | undefined;
    if (prLayer) {
      const mat = prLayer.material as THREE.MeshPhysicalMaterial;
      mat.color.setHex(0xc0c8d0);
      mat.emissive.setHex(0x222428);
      mat.emissiveIntensity = 0.15;
      mat.opacity = 0.0;          // resist not applied yet
      mat.needsUpdate = true;
    }

    // ── Place wafer EXACTLY at FOUP slot anchor (world position) ──
    const foupStep = ALL_STEPS[0];
    const foupGrp = this.modObjs["foup"];

    // Force-update the FOUP world matrix so anchor world position is correct
    if (foupGrp) foupGrp.updateWorldMatrix(true, true);

    const anchors = foupGrp?.userData?.slotAnchors as THREE.Object3D[] | undefined;
    const slotIx = Math.min(wi, Math.max(0, (anchors?.length ?? 1) - 1));

    if (anchors?.[slotIx]) {
      const p = new THREE.Vector3();
      anchors[slotIx].getWorldPosition(p);
      sm.mesh.position.copy(p);
      console.log(`[LAUNCH] ${WAFER_NAMES[wi]} → FOUP slot ${slotIx}`, p.toArray());
    } else {
      // Fallback only if anchors missing
      sm.mesh.position.set(foupStep.x, WAFER_TRANSFER_Y, foupStep.z);
      console.warn(`[LAUNCH] No FOUP anchors — fallback position`);
    }

    // Wafer must lie FLAT (FOUP is rotated, but wafer stays horizontal)
    sm.mesh.rotation.set(0, 0, 0);
    sm.mesh.quaternion.identity();

    sm.state = "idle";
    sm.stepIdx = 1;  // First destination is DEHY (step 1)
    sm.owner = "none";

    this._addLog(`[${WAFER_NAMES[wi]}] LAUNCHED from FOUP`, "pick");
  }

  private _updateCamera() {
    const o = this.orbit;
    o.theta = lerp(o.theta, o.tT, 0.075); o.phi = lerp(o.phi, o.tP, 0.075);
    o.radius = lerp(o.radius, o.tR, 0.075);
    o.cx = lerp(o.cx, o.tcx, 0.075); o.cy = lerp(o.cy, o.tcy, 0.075); o.cz = lerp(o.cz, o.tcz, 0.075);
    this.camera.position.set(
      o.cx + o.radius * Math.sin(o.phi) * Math.sin(o.theta),
      o.cy + o.radius * Math.cos(o.phi),
      o.cz + o.radius * Math.sin(o.phi) * Math.cos(o.theta)
    );
    this.camera.lookAt(o.cx, o.cy, o.cz); this.camera.updateProjectionMatrix();
  }

  setPreset(p: CameraPreset) { this.orbit.tT = p.theta; this.orbit.tP = p.phi; this.orbit.tR = p.radius; this.orbit.tcx = p.cx; this.orbit.tcy = p.cy; this.orbit.tcz = p.cz; }

  private _buildUI(): UIState {
    let active = 0, completed = 0;
    const wafers = this.wSMs.map((sm, i) => {
      if (sm.launched && !sm.done) active++;
      if (sm.done) completed++;
      return { wi: sm.wi, name: WAFER_NAMES[i], state: sm.state, stepIdx: sm.stepIdx, stepName: sm.stepIdx < ALL_STEPS.length ? ALL_STEPS[sm.stepIdx].name : "Complete", processTimer: sm.processTimer, stepTime: sm.stepIdx < ALL_STEPS.length ? ALL_STEPS[sm.stepIdx].time : 1, done: sm.done, launched: sm.launched };
    });
    const bonderStatus = this.bonderController?.getStatus?.();
    const chipStatus = bonderStatus?.chip;
    return {
      wafers, simTime: this.simTime, fps: this.fps, active, completed,
      jointsEFEM: this.robotEFEM ? this.robotEFEM.getJoints() : null,
      bonder: bonderStatus ? {
        stageId: bonderStatus.stageId,
        stageLabel: bonderStatus.stageLabel,
        phase: bonderStatus.phase,
        status: bonderStatus.status,
        progress: bonderStatus.progress,
        temperature: bonderStatus.temperature,
        chipState: chipStatus?.state ?? 'IN_TRAY',
        vacuum: chipStatus?.vacuum ?? false,
        flipped: chipStatus?.flipped ?? false,
        fluxed: chipStatus?.fluxed ?? false,
        aligned: chipStatus?.aligned ?? false,
        bonded: chipStatus?.bonded ?? false,
      } : null,
    };
  }

  private _loop = () => {
    this._animId = requestAnimationFrame(this._loop);
    const now = performance.now();
    const rawDt = Math.min((now - this._lastT) / 1000, 0.05); this._lastT = now;

    this._frm++;
    if (now - this._lastFpsT > 1000) { this.fps = Math.round(this._frm * 1000 / (now - this._lastFpsT)); this._frm = 0; this._lastFpsT = now; }

    this.simTime += rawDt * this.speed;

    // Module links (FOUP ↔ Bonder ↔ Final Rack): animate belts + shuttle pods
    this._tickModuleLinks(rawDt * this.speed);

    const simDt = rawDt * this.speed;
    this.wSMs.forEach((sm) => this._tickWafer(sm, rawDt));
    this._animRobots(simDt);

    this._updateCamera();
    if (this.bondTransfer) this.bondTransfer.update(simDt);
    this.bonderController?.update(rawDt * this.speed);

    // Drive any station GLB clip from the SHARED loop - one place, no second
    // animation system. Any modObjs entry that parked a mixer in userData
    // (second wafer module, flux fixture, ...) is ticked here.
    for (const obj of Object.values(this.modObjs)) {
      const mixer = obj?.userData?.mixer as THREE.AnimationMixer | undefined;
      if (mixer) mixer.update(simDt);
    }
    // Flip-chip robot: its controller owns its own mixer and phase tracking.
    this.flipChipRobot?.update(simDt);

    this.renderer.render(this.scene, this.camera);
    this.onUI(this._buildUI());
  };

  private _canStartProcessStages(): boolean {
    const gateOk = this.waferPlacementCompleted && this.waferIsOnFlipFlop && !this.robotHoldingWafer && this.robotIsClearOfPlacementArea;
    if (!gateOk) {
      console.warn('[SIM] Cannot start process: wafer placement incomplete', {
        waferPlacementCompleted: this.waferPlacementCompleted,
        waferIsOnFlipFlop: this.waferIsOnFlipFlop,
        robotHoldingWafer: this.robotHoldingWafer,
        robotIsClearOfPlacementArea: this.robotIsClearOfPlacementArea,
      });
      this._addLog('[SIM] Cannot start process: wafer placement incomplete', 'move');
    }
    return gateOk;
  }

  private _onWaferPlacementComplete(): void {
    console.log('[SIM] Wafer placement complete, verifying...');
    this._addLog('[SIM] Wafer placement complete. Verifying...', 'place');

    // Update placement state
    this.waferPlacementCompleted = true;
    this.waferIsOnFlipFlop = true;
    this.robotHoldingWafer = false;
    this.robotIsClearOfPlacementArea = true;
    this.loadingState = 'LOADING_COMPLETE';
    this.placementVerified = true;

    // Narration for placement completion
    if (this.narration?.isEnabled()) {
      this.narration.speak('Wafer placement complete. Starting flip-chip bonding process.', 'normal');
    }

    // Add a small delay before auto-starting the process
    setTimeout(() => {
      this._autoStartProcess();
    }, 1500);
  }

  private _onChipSequenceComplete(): void {
    console.log('[SIM] All 6 chips placed, starting output wafer transfer...');
    this._addLog('[SIM] All 6 chips placed. Starting output wafer transfer...', 'move');

    // Calculate source and destination for output transfer
    const sourceWorld = new THREE.Vector3(13.2, 0.5, 2.5); // Bonder pedestal position
    const destWorld = new THREE.Vector3();

    // Get output rack pickup position after 180° rotation
    const outputRack = this.modObjs.final_wafer_rack;
    if (outputRack?.userData.pickupAnchor) {
      outputRack.updateMatrixWorld(true);
      outputRack.userData.pickupAnchor.getWorldPosition(destWorld);
      console.log('[OUTPUT TRANSFER] Using rotated rack pickup position:', destWorld);
    } else {
      // Fallback position (adjusted for 180° rotation)
      destWorld.set(55, 1.15, 12);
      console.log('[OUTPUT TRANSFER] Using fallback position');
    }

    // Start output transfer
    if (this.bonderController) {
      this.bonderController.startOutputTransfer(sourceWorld, destWorld);
    }
  }

  private _autoStartProcess(): void {
    console.log('[SIM] Auto-starting Flip Chip Bonder process...');
    this._addLog('[SIM] Auto-starting Flip Chip Bonder process...', 'move');

    this.processStarted = true;
    this.processReady = true;
    this.processState = 'PROCESS_READY';

    // Start the BonderController process
    if (this.bonderController) {
      this.bonderController.start();
    }

    // Start the main process stages
    this._startProcessStages();
  }

  private _startProcessStages(): void {
    this._lastT = performance.now();
    this._loop();

    this._narratedSteps.clear();
    if (this.narration) {
      this.narration.announceProcessStart();
    } else if (this._narrationInit) {
      this._narrationInit.then(() => {
        if (this.narration) this.narration.announceProcessStart();
      });
    }
  }

  start() {
    if (this.processState === 'WAFER_LOADING' || this.processState === 'PROCESS_READY' || this.processState === 'STAGE_01_RUNNING') {
      return;
    }

    this.processState = 'START_REQUESTED';
    console.log('[SIM] START clicked');
    this._addLog('[SIM] START clicked', 'move');

    const requiresWaferPlacement = !this.waferPlacementCompleted || !this.waferIsOnFlipFlop || this.robotHoldingWafer || !this.robotIsClearOfPlacementArea;

    if (requiresWaferPlacement) {
      this.processState = 'WAFER_LOADING';
      this.loadingState = 'MOVE_TO_FOUP';
      this.loadingPhaseTime = 0;
      this.waferContact = false;
      this.placementVerified = false;
      this.processStarted = false;

      this._addLog('[SIM] Starting wafer placement sequence before process stages begin', 'move');
      this._addLog('[SIM] Loading wafer onto the bonder pedestal...', 'place');

      if (this._waferPlacementTimer) {
        window.clearTimeout(this._waferPlacementTimer);
        this._waferPlacementTimer = null;
      }

      // Narration for loading sequence
      if (this.narration?.isEnabled()) {
        this.narration.speak('Robot moving to wafer rack for pickup.', 'normal');
      }

      // Start the render loop even during wafer loading
      this._lastT = performance.now();
      this._loop();

      this.startBonderWaferTransfer();
      return;
    }

    // Wafer already placed, directly start process
    this.processReady = true;
    this.processState = 'PROCESS_READY';
    this._lastT = performance.now();
    this._loop();

    this._narratedSteps.clear();
    if (this.narration) {
      this.narration.announceProcessStart();
    } else if (this._narrationInit) {
      this._narrationInit.then(() => {
        if (this.narration) this.narration.announceProcessStart();
      });
    }
  }

  // ── Process Flow Panel Methods ──
  getProcessFlowState() {
    return {
      currentStep: this.navStepIndex,
      loading: this.processState === 'WAFER_LOADING',
      loadingState: this.loadingState,
      placementComplete: this.waferPlacementCompleted,
      bonderStage: this.bonderController?.stateMachine?.currentStage || 0,
      bonderLabel: this.bonderController?.stateMachine?.phase || 'IDLE',
    };
  }

  // ── Step navigation (rewind / forward / jump) ───────────────────────────────
  getCurrentStep(): number { return this.navStepIndex; }
  getTotalSteps(): number { return ALL_STEPS.length; }
  getCurrentStepInfo(): ProcessStep | null { return ALL_STEPS[this.navStepIndex] ?? null; }

  /** Live primary-wafer process step (simulation), not UI nav index */
  getActiveProcessStepIndex(): number {
    const sm = this.wSMs?.length > 0 ? this.wSMs[0] : null;
    if (!sm) return 0;
    return Math.min(Math.max(sm.stepIdx, 0), ALL_STEPS.length - 1);
  }

  getActiveProcessStepInfo(): ProcessStep | null {
    return ALL_STEPS[this.getActiveProcessStepIndex()] ?? null;
  }

  /** Return progress (0-1) through the current active step for the primary wafer */
  getCurrentStepProgress(): number {
    const sm = this.wSMs && this.wSMs.length > 0 ? this.wSMs[0] : null;
    if (!sm) return 0;
    const idx = sm.stepIdx;
    const step = ALL_STEPS[idx];
    if (!step || !step.time || step.time <= 0) return 0;
    return Math.min(sm.timer / step.time, 1);
  }

  rewindStep(): void {
    if (this.navStepIndex > 0) this.jumpToStep(this.navStepIndex - 1);
  }

  forwardStep(): void {
    if (this.navStepIndex < ALL_STEPS.length - 1) this.jumpToStep(this.navStepIndex + 1);
  }

  jumpToStart(): void { this.jumpToStep(0); }
  jumpToEnd(): void { this.jumpToStep(ALL_STEPS.length - 1); }

  jumpToStepId(stepId: string): void {
    const idx = ALL_STEPS.findIndex((s) => s.id === stepId);
    if (idx >= 0) this.jumpToStep(idx);
  }

  // ── Bonder controls ──────────────────────────────────────────────────────────
  startBonder(): void {
    if (!this._canStartProcessStages()) {
      return;
    }
    this.processState = 'STAGE_01_RUNNING';
    this.bonderController?.start();
  }

  pauseBonder(): void {
    this.bonderController?.pause();
  }

  resumeBonder(): void {
    this.bonderController?.resume();
  }

  resetBonder(): void {
    this.bonderController?.reset();
  }

  // Two-robot chip process: COLRIGHT picks/flips, SKING handoffs + flux + place.
  runTwoRobotRecipe(): void {
    const bc = this.bonderController;
    if (!bc) return;
    void bc.runTwoRobotRecipe();
  }

  resetTwoRobot(): void {
    void this.bonderController?.resetTwoRobot();
  }

  setBonderSpeed(k: number): void {
    this.bonderController?.setSpeed(k);
  }

  /**
   * Wafer rack (FOUP input) → actual left-side circular wafer stage on the
   * flip-chip bonder. The machine already exposes the real work surface as a
   * WAFER_STAGE node, so we bind the transfer there instead of the abstract
   * bond target in the center of the machine.
   */
  private _resolveWaferLoadingTarget(): THREE.Vector3 {
    const modelRoot = this.bonderController?.model;
    const stageNode = modelRoot?.getObjectByName('WAFER_STAGE')
      ?? modelRoot?.getObjectByName('waferStage')
      ?? this.scene.getObjectByName('WAFER_STAGE')
      ?? this.scene.getObjectByName('waferStage');

    const target = new THREE.Vector3();
    if (stageNode) {
      stageNode.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(stageNode);
      const worldPos = new THREE.Vector3();
      stageNode.getWorldPosition(worldPos);
      const topY = Number.isFinite(box.max.y) ? box.max.y : worldPos.y;
      target.set(worldPos.x, topY + 0.04, worldPos.z);
      return target;
    }

    if (modelRoot && this.bonderController?.bondTarget) {
      modelRoot.updateMatrixWorld(true);
      target.copy(this.bonderController.bondTarget).applyMatrix4(modelRoot.matrixWorld);
      target.y = Math.max(target.y, 0.8);

      // Center the target on the pedestal using Box3
      const pedestal = modelRoot.getObjectByName('PEDESTAL') ||
                       modelRoot.getObjectByName('RING_VACUUM_PEDESTAL') ||
                       modelRoot.getObjectByName('SKING_PEDESTAL') ||
                       modelRoot.getObjectByName('SUBSTRATE_STAGE');

      if (pedestal) {
        pedestal.updateMatrixWorld(true);
        const pedestalBox = new THREE.Box3().setFromObject(pedestal);
        const pedestalCenter = pedestalBox.getCenter(new THREE.Vector3());
        // Use centered X/Z but keep original Y
        target.x = pedestalCenter.x;
        target.z = pedestalCenter.z;
        console.log('[CENTERING] Wafer loading target centered on pedestal:', target);
      }

      return target;
    }

    const wrap = this.modObjs['flip_chip_bonder'];
    if (wrap) {
      wrap.updateMatrixWorld(true);
      target.set(1.1, 0.8, 0).applyMatrix4(wrap.matrixWorld);
      return target;
    }

    target.set(ALL_STEPS[0].x + 34.0, 0.8, ALL_STEPS[0].z);
    return target;
  }

  startBonderWaferTransfer(): void {
    const bc = this.bonderController;
    const bt = this.bondTransfer;
    if (!bc || !bt || !this.robotEFEM) return;
    if (bt.isRunning()) return;

    // ── Source: ACTUAL SELECTED WAFER INSIDE FOUP ──
    // Calculate pickup target from actual wafer world position (not from pre-calculated anchor)
    const foupGrp = this.modObjs['foup'];
    const slotAnchors = foupGrp?.userData?.slotAnchors as THREE.Object3D[] | undefined;
    
    const source = new THREE.Vector3();
    let selectedWaferWorld = new THREE.Vector3();
    let selectedSlotIndex = 0;
    
    if (slotAnchors && slotAnchors.length > 0) {
      // Use first slot (slot 0) for pickup
      slotAnchors[selectedSlotIndex].getWorldPosition(selectedWaferWorld);
      
      // Compute forward direction from FOUP's orientation
      const foupFrontDir = foupGrp?.userData?.rackFrontDirection as THREE.Vector3 | undefined || new THREE.Vector3(0, 0, 1);
      
      // Position robot end-effector at wafer center with tool offset (0.12m forward for gripper reach)
      source.copy(selectedWaferWorld);
      source.addScaledVector(foupFrontDir, 0.15);  // 150mm forward for gripper contact point
      
      // Debug output showing actual geometry-based positions
      const robotTcp = this.robotEFEM?.gripper?.getWorldPosition(new THREE.Vector3()) || new THREE.Vector3();
      const foupWorld = new THREE.Vector3();
      foupGrp.getWorldPosition(foupWorld);
      
      this._addLog(
        `[LAYOUT] FOUP=${foupWorld.toArray().map((v:number) => v.toFixed(1)).join(',')} WAFER=${selectedWaferWorld.toArray().map((v:number) => v.toFixed(1)).join(',')} PICKUP=${source.toArray().map((v:number) => v.toFixed(1)).join(',')}`,
        'debug'
      );
    } else {
      // Fallback: use configured forward position
      source.set(
        (foupGrp?.position.x ?? -8) + 0.3,
        0.55,
        (foupGrp?.position.z ?? 2.5) + 0.15
      );
      this._addLog(`[WAFER PICK] Using fallback position (no slot anchors found)`, 'warning');
    }

    // ── Destination: actual circular wafer work surface on the left side of the machine ──
    const dest = this._resolveWaferLoadingTarget();
    dest.y = Math.max(dest.y, 0.5);
    source.y = Math.max(source.y, dest.y + 1.0);

    console.log('[FOUP] Source position:', source);
    console.log('[FOUP] Destination position:', dest);

    bt.createWafer();
    bt.start(source, dest);

    // DO NOT immediately set completion flags - let the transfer complete naturally
    // The callback will handle this when the transfer is actually done
    this.robotHoldingWafer = true; // Robot now holds wafer during transfer
    this._addLog('[BOND] Wafer transfer initiated: FOUP rack → bonder pedestal', 'move');
  }

  resetBonderWaferTransfer(): void {
    this.bondTransfer?.reset();
  }


  jumpToStep(stepIndex: number): void {
    if (stepIndex < 0 || stepIndex >= ALL_STEPS.length) return;

    this.navStepIndex = stepIndex;
    const step = ALL_STEPS[stepIndex];
    this.paused = true;
    this._pauseAllAnimators();
    this._cancelActiveTransfers();

    // ── Narration: announce jump to step ──
    if (this.narration) {
      this._narratedSteps.clear(); // Clear tracking so it'll narrate next arrival
      import('../lib/narrationScripts').then(({ getStepNarration }) => {
        const script = getStepNarration(step.id);
        this.narration.speak(`Jumping to ${step.name}. ${script.starting}`, 'high');
      });
    }

    this.wSMs.forEach((sm, wi) => {
      sm.launched = true;
      sm.done = false;
      sm.stepIdx = stepIndex;
      sm.state = "processing";
      sm.processTimer = step.time * 0.5;
      sm.timer = 0;
      sm.spinning = false;
      sm.mesh.visible = true;
      sm.mesh.userData.scannerOrigPos = undefined;
      sm.mesh.userData.scannerStartTime = undefined;

      const pos = this._getStepWaferWorldPos(step, wi);
      this.scene.attach(sm.mesh);
      sm.mesh.position.copy(pos);
      sm.mesh.rotation.set(0, 0, 0);
      sm.mesh.quaternion.identity();
      sm.mesh.updateMatrixWorld(true);
    });

    Object.keys(this.busy).forEach((k) => delete this.busy[k]);
    if (this.wSMs.length > 0) this.busy[step.id] = this.wSMs[0].wi;

    this._updateWaferVisualForStep(stepIndex);
    this._parkRobotNearStep(stepIndex);
    this._notifyStepChange(stepIndex);
    this._addLog(`[NAV] Jump → ${step.short} · ${step.name}`, "move");
  }

  private _getStepWaferWorldPos(step: ProcessStep, wi: number): THREE.Vector3 {
    const out = new THREE.Vector3();
    if (step.type === "foup" || step.id === "foup") {
      const foupGrp = this.modObjs["foup"];
      const anchors = foupGrp?.userData?.slotAnchors as THREE.Object3D[] | undefined;
      const slotIx = Math.min(wi, Math.max(0, (anchors?.length ?? 1) - 1));
      if (anchors?.[slotIx]) anchors[slotIx].getWorldPosition(out);
      else out.set(step.x + 5.0, 3.0, step.z);
    } else if (step.id === "scanner") {
      // ── Use the real slot anchor position (same as animation) ──
      const scannerGrp = this.modObjs["scanner"];
      const slotAnchor = (scannerGrp?.userData?.slotAnchor
        ?? scannerGrp?.userData?.waferAnchor
        ?? scannerGrp?.userData?.pickupAnchor) as THREE.Object3D | undefined;
      if (slotAnchor) {
        slotAnchor.getWorldPosition(out);
      } else {
        // Fallback only if anchors are missing
        out.set(step.x, WAFER_TRANSFER_Y, step.z);
      }
    } else {
      const modGrp = this.modObjs[step.id];
      const wa = modGrp?.userData?.waferAnchor as THREE.Object3D | undefined;
      if (wa) wa.getWorldPosition(out);
      else out.set(step.x, WAFER_TRANSFER_Y + 0.02, step.z);
    }
    return out;
  }

  private _cancelActiveTransfers(): void {
    this.wSMs.forEach((sm) => {
      if (sm.carrierRobot) {
        const pos = new THREE.Vector3();
        sm.mesh.getWorldPosition(pos);
        sm.detachAt(pos);
      }
      (sm as any)._picked = false;
      (sm as any)._pickupX = undefined;
      (sm as any)._pickupZ = undefined;
      (sm as any)._returning = false;
      (sm as any)._returnToFoup = false;
      sm.carrierRobot = null;
      sm.owner = "none";
      sm.onConveyor = false;
    });
    const r = this.robotEFEM;
    if (r?.group?.userData) {
      r.group.userData.armPhase = "idle";
      r.group.userData.phaseT = 0;
      r.group.userData.bezierT = 0;
    }
    Object.keys(this.busy).forEach((k) => delete this.busy[k]);
  }

  private _pauseAllAnimators(): void {
    this.spinCoat?.stopCoat();
    this._activeCoatWI = -1;
    this.devLiquid?.stopDev();
    this._activeDevWI = -1;
    this.prCoatOverlay?.stop();
    this.devOverlay?.stop();
    this.n2Particles?.off();
    this.waterParticles?.off();
    this.hmdsFog?.off();
    Object.values(this.heatVapors ?? {}).forEach((v) => v.off());
  }

  private _parkRobotNearStep(stepIndex: number): void {
    const r = this.robotEFEM;
    if (!r?.runIK) return;
    const step = ALL_STEPS[stepIndex];
    const TRACK_MIN = -14;
    const TRACK_MAX = 22;
    let targetX = step.x;
    if (step.id === "scanner") targetX = step.x - 4;
    const railX = clamp(targetX, TRACK_MIN, TRACK_MAX);
    if (r.group.userData) {
      r.group.userData.railX = railX;
      r.group.userData.armPhase = "idle";
      r.group.userData.phaseT = 0;
    }
    r.group.position.set(railX, 0, 0);
    const idleTgt = new THREE.Vector3(railX + 1.5, 2.5, step.z);
    r.runIK(idleTgt);
    if (r.statusPL) {
      r.statusPL.color.setHex(0x00d8ff);
      r.statusPL.intensity = 1.2;
    }
  }

  private _updateWaferVisualForStep(stepIndex: number): void {
    const prcoatIdx = ALL_STEPS.findIndex((s) => s.id === "prcoat");
    const developIdx = ALL_STEPS.findIndex((s) => s.id === "develop");
    this.wSMs.forEach((sm) => {
      const pr = sm.mesh.userData.prLayer as THREE.Mesh | undefined;
      if (!pr) return;
      const mat = pr.material as THREE.MeshPhysicalMaterial;
      if (prcoatIdx >= 0 && stepIndex < prcoatIdx) {
        mat.opacity = 0;
        mat.emissiveIntensity = 0.15;
      } else if (developIdx >= 0 && stepIndex < developIdx) {
        mat.opacity = 0.98;
        mat.color.setHex(0xcc1177);
        mat.emissive.setHex(0xcc1177);
        mat.emissiveIntensity = 1.0;
      } else {
        mat.opacity = 0.85;
        mat.color.setHex(0x4477aa);
        mat.emissive.setHex(0x224466);
        mat.emissiveIntensity = 0.7;
      }
      mat.needsUpdate = true;
    });
  }

  private _notifyStepChange(stepIndex: number): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("sim:stepchange", {
        detail: { index: stepIndex, step: ALL_STEPS[stepIndex], total: ALL_STEPS.length },
      })
    );
  }

  reset() {
    this.spinCoat?.stopCoat(); this._activeCoatWI = -1;
    this.devLiquid?.stopDev(); this._activeDevWI = -1;
    this.prCoatOverlay?.stop();
    this.devOverlay?.stop();
    this.n2Particles?.off(); this.waterParticles?.off(); this.hmdsFog?.off();
    Object.values(this.heatVapors ?? {}).forEach(v => v.off());
    this.wSMs.forEach((sm) => {
      if (sm.carrierRobot) sm.detachAt(new THREE.Vector3(ALL_STEPS[0].x, 0.38, ALL_STEPS[0].z));
      sm.stepIdx = 0; sm.state = "idle"; sm.timer = 0; sm.processTimer = 0;
      sm.spin = 0; sm.spinning = false; sm.launched = false; sm.done = false; sm.carrierRobot = null;
      sm.owner = "none";
      sm.onConveyor = false; sm.mesh.visible = false; sm.mesh.rotation.y = 0;
      sm.mesh.position.set(ALL_STEPS[0].x, 0.38, ALL_STEPS[0].z);
      const liq = sm.mesh.userData.liquid as THREE.Mesh;
      if (liq) (liq.material as THREE.MeshStandardMaterial).opacity = 0;
    });
    Object.keys(this.busy).forEach((k) => delete this.busy[k]);
    Object.values(this.modObjs).forEach((m) => {
      if (m.userData.processLight) (m.userData.processLight as THREE.PointLight).intensity = 0;
      if (m.userData.innerRing) ((m.userData.innerRing as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 2.5;
    });
    this.navStepIndex = 0;
    this.processState = 'IDLE';
    this.processReady = false;
    this.waferPlacementCompleted = false;
    this.waferIsOnFlipFlop = false;
    this.robotHoldingWafer = false;
    this.robotIsClearOfPlacementArea = true;

    // Reset loading state
    this.loadingState = 'IDLE';
    this.loadingPhaseTime = 0;
    this.waferContact = false;
    this.placementVerified = false;
    this.processStarted = false;

    if (this._waferPlacementTimer) {
      window.clearTimeout(this._waferPlacementTimer);
      this._waferPlacementTimer = null;
    }
    this.simTime = 0; this.paused = false; this.speed = 1;
    // move robot to home (near step 0) to ensure canonical start pose
    try { this._parkRobotNearStep(0); } catch (e) { /* ignore */ }
    // reset the FOUP → bonder pedestal transfer if it was mid-flight
    try { this.bondTransfer?.reset(); } catch (e) { /* ignore */ }

    // clear any resume-related caches that could allow resuming mid-flow
    try { delete (this as any).resumePosition; } catch (e) { }
    try { delete (this as any).savedTimelinePosition; } catch (e) { }
    try { delete (this as any).processHistory; } catch (e) { }
    this._notifyStepChange(0);
    this._addLog("--- SIMULATION RESET ---", "");

    // ── Narration: announce reset ──
    if (this.narration) {
      this.narration.reset(); // Clear queued audio and reset step tracking
      this._narratedSteps.clear(); // Reset tracking

      try {
        import('../lib/narrationScripts').then(({ getStepNarration }) => {
          const s0 = ALL_STEPS[0];
          if (s0) {
            const script = getStepNarration(s0.id);
            const text = `Wafer cassette returned to FOUP and EFEM is reset. Simulation reset. Ready to start. ${script?.starting ?? ''}`;
            if (text.trim()) {
              this.narration.speak(text, 'high');
              return;
            }
          }
          this.narration.announceReset();
        }).catch(() => {
          this.narration.announceReset();
        });
      } catch (e) {
        this.narration.announceReset();
      }
    }

    // Notify UI components that a full reset occurred so they can clear any cached resume state
    if (typeof window !== 'undefined') {
      try { window.dispatchEvent(new CustomEvent('sim:reset', { detail: {} })); } catch (e) { }
    }
  }

  setBoundingBox(visible: boolean) {
    const existing = this.scene.getObjectByName("__boundingBox__");
    if (existing) this.scene.remove(existing);
    if (!visible) return;
    const box = new THREE.Box3();
    Object.entries(this.modObjs).forEach(([id, grp]) => { if (id !== "foup") { const b = new THREE.Box3().setFromObject(grp); box.union(b); } });
    box.expandByScalar(0.55);
    const grp = new THREE.Group(); grp.name = "__boundingBox__";
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.2, metalness: 0.9 });
    const T2 = 0.045;
    const addEdge = (sx: number, sy: number, sz: number, px: number, py: number, pz: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), edgeMat);
      m.position.set(center.x + px, center.y + py, center.z + pz); grp.add(m);
    };
    const hw = size.x / 2, hh = size.y / 2, hd = size.z / 2;
    [[hh, hd], [hh, -hd], [-hh, hd], [-hh, -hd]].forEach(([y, z]) => addEdge(size.x, T2, T2, 0, y as number, z as number));
    [[hh, hw], [hh, -hw], [-hh, hw], [-hh, -hw]].forEach(([y, x]) => addEdge(T2, T2, size.z, x as number, y as number, 0));
    [[hw, hd], [hw, -hd], [-hw, hd], [-hw, -hd]].forEach(([x, z]) => addEdge(T2, size.y, T2, x as number, 0, z as number));
    this.scene.add(grp);
  }

  toggleLabels(show: boolean) {
    toggleNamePlates(this.modObjs, show);
  }

  _bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener("mousedown", this._md = (e) => { this.orbit.drag = true; this.orbit.btn = e.button; this.orbit.sx = e.clientX; this.orbit.sy = e.clientY; });
    window.addEventListener("mouseup", this._mu = () => { this.orbit.drag = false; });
    window.addEventListener("mousemove", this._mm = (e) => {
      if (this.orbit.drag) {
        const dx = (e.clientX - this.orbit.sx) * 0.005, dy = (e.clientY - this.orbit.sy) * 0.005;
        this.orbit.sx = e.clientX; this.orbit.sy = e.clientY;
        if (this.orbit.btn === 0) { this.orbit.tT -= dx; this.orbit.tP = clamp(this.orbit.tP - dy, 0.04, Math.PI * 0.46); }
        else if (this.orbit.btn === 2) { this.orbit.tcx -= Math.cos(this.orbit.theta) * dx * 40; this.orbit.tcz += Math.sin(this.orbit.theta) * dx * 40; }
      }
      if (this.orbit.drag) {
        this.onTooltip({ visible: false, x: 0, y: 0, name: "", temp: "", meta: "", tempColor: "" });
        return;
      }
      const now = performance.now();
      if (now - this._lastRaycastT < 100) return;
      this._lastRaycastT = now;

      // Tooltip raycasting
      const rect = el.getBoundingClientRect();
      const mouse = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this._raycaster.setFromCamera(mouse, this.camera);
      const allMeshes: THREE.Object3D[] = [];
      Object.values(this.modObjs).forEach((grp) => grp.traverse((c) => { if ((c as THREE.Mesh).isMesh) allMeshes.push(c); }));
      const hits = this._raycaster.intersectObjects(allMeshes);
      if (hits.length) {
        let obj: THREE.Object3D | null = hits[0].object;
        while (obj && !obj.userData.id) obj = obj.parent;
        const mod = obj ? ALL_STEPS.find((m) => m.id === obj!.userData.id) : null;
        if (mod) {
          this.onTooltip({ visible: true, x: e.clientX, y: e.clientY, name: mod.name, temp: mod.temp ? mod.temp + "°C" : "—", tempColor: mod.temp ? (mod.temp > 50 ? "#ff6030" : "#0099ff") : "#445566", meta: `TYPE: ${mod.type.toUpperCase()} · DURATION: ${mod.time}s` });
          return;
        }
      }
      this.onTooltip({ visible: false, x: 0, y: 0, name: "", temp: "", meta: "", tempColor: "" });
    });
    el.addEventListener("wheel", this._wh = (e) => { this.orbit.tR = clamp(this.orbit.tR + e.deltaY * 0.022, 4, 85); e.preventDefault(); }, { passive: false });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  destroy() {
    cancelAnimationFrame(this._animId);
    this.bonderController?.dispose();
    // Releases the robot's geometry, materials and mixer (spec section 6).
    this.flipChipRobot?.dispose();
    this.flipChipRobot = undefined;
    this.renderer.domElement.removeEventListener("mousedown", this._md);
    window.removeEventListener("mouseup", this._mu);
    window.removeEventListener("mousemove", this._mm);
    this.renderer.domElement.removeEventListener("wheel", this._wh);
  }
}

// ─── UI HELPERS ──────────────────────────────────────────────────────────────

const T = {
  bg: "rgba(2,6,18,.97)",
  border: "rgba(0,180,255,.10)",
  title: "#00d8ff",
  text: "#c8eeff",
  textDim: "rgba(140,200,255,.38)",
  textBright: "#e8f8ff",
  accent: "#00d8ff",
  green: "#00ff88",
  orange: "#ffcc00",
};

const fmtClock = (s: number) =>
  [s / 3600, (s % 3600) / 60, s % 60]
    .map((v) => Math.floor(v).toString().padStart(2, "0"))
    .join(":");

function showInlineVideo(videoPath: string, title: string, simRef: any): void {
  const existing = document.getElementById('inline-video-container');
  if (existing) existing.remove();

  const wasPaused = simRef?.paused ?? false;
  if (simRef && !wasPaused) simRef.paused = true;
  if (simRef?.setVideoOpen) simRef.setVideoOpen(true);

  const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
  if (!canvas) { console.error('[INLINE VIDEO] Canvas not found'); return; }
  const prevVis = canvas.style.visibility;
  canvas.style.visibility = 'hidden';

  const parent = canvas.parentElement;
  if (!parent) { canvas.style.visibility = prevVis; return; }
  const prevPos = window.getComputedStyle(parent).position;
  if (prevPos === 'static') parent.style.position = 'relative';

  if (!document.getElementById('smart-video-styles')) {
    const s = document.createElement('style');
    s.id = 'smart-video-styles';
    s.textContent = `
      @keyframes smartFadeIn  { from { opacity:0 } to { opacity:1 } }
      @keyframes smartSlideUp { from { transform:translateY(16px);opacity:0 } to { transform:translateY(0);opacity:1 } }
      .smart-speed-btn {
        padding:4px 10px; border-radius:4px; font-size:11px; font-weight:700;
        cursor:pointer; border:1px solid rgba(51,221,255,0.3);
        background:rgba(51,221,255,0.08); color:#66ddff;
        transition:background 0.15s,border-color 0.15s; font-family:'Inter',sans-serif;
      }
      .smart-speed-btn:hover  { background:rgba(51,221,255,0.22); border-color:#33ddff; }
      .smart-speed-btn.active { background:rgba(51,221,255,0.30); border-color:#33ddff; color:#fff; }
      .smart-scrubber {
        -webkit-appearance:none; appearance:none; width:100%; height:3px;
        background:rgba(255,255,255,0.15); border-radius:2px; outline:none; cursor:pointer;
      }
      .smart-scrubber::-webkit-slider-thumb {
        -webkit-appearance:none; width:12px; height:12px; border-radius:50%;
        background:#33ddff; cursor:pointer; margin-top:-4px;
      }
      .smart-scrubber::-webkit-slider-runnable-track { height:3px; border-radius:2px; }
    `;
    document.head.appendChild(s);
  }

  const isPR = videoPath.includes('pr_coat');
  const accent = isPR ? '#ff44aa' : '#33ddff';
  const caption = isPR
    ? 'PR Coat — resist dispense, spin-up, edge bead removal'
    : 'Developer — puddle dispense, develop reaction, DI rinse & spin-dry';

  const container = document.createElement('div');
  container.id = 'inline-video-container';
  container.style.cssText = `
    position:absolute; top:0; left:0; width:100%; height:100%;
    background:rgba(4,7,12,0.96);
    display:flex; align-items:center; justify-content:center;
    z-index:10; padding:16px; box-sizing:border-box;
    animation:smartFadeIn 0.22s ease-out;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    width:min(68%,740px); max-height:92%;
    background:#080c12; border-radius:10px;
    border:1.5px solid ${accent};
    box-shadow:0 0 40px ${accent}44, 0 20px 60px rgba(0,0,0,0.8);
    overflow:hidden; display:flex; flex-direction:column;
    animation:smartSlideUp 0.25s ease-out;
  `;

  const header = document.createElement('div');
  header.style.cssText = `
    display:flex; align-items:center; justify-content:space-between;
    padding:9px 14px; background:rgba(0,0,0,0.5);
    border-bottom:1px solid ${accent}55; flex-shrink:0; gap:8px;
  `;

  const titleEl = document.createElement('div');
  titleEl.style.cssText = `
    color:${accent}; font-family:'Inter',system-ui,sans-serif;
    font-size:11px; font-weight:700; letter-spacing:1.5px;
    text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  `;
  titleEl.textContent = title;

  const speedGroup = document.createElement('div');
  speedGroup.style.cssText = 'display:flex; gap:4px; align-items:center; flex-shrink:0;';
  const speeds = [1, 1.5, 2];
  speeds.forEach(spd => {
    const btn = document.createElement('button');
    btn.className = 'smart-speed-btn' + (spd === 1 ? ' active' : '');
    btn.textContent = spd + '×';
    btn.onclick = () => {
      video.playbackRate = spd;
      speedGroup.querySelectorAll('.smart-speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
    speedGroup.appendChild(btn);
  });

  const headerRight = document.createElement('div');
  headerRight.style.cssText = 'display:flex; align-items:center; gap:6px; flex-shrink:0;';

  const playPauseBtn = document.createElement('button');
  playPauseBtn.className = 'smart-speed-btn';
  playPauseBtn.style.minWidth = '66px';
  playPauseBtn.textContent = '❚❚ Pause';

  const closeBtn = document.createElement('button');
  closeBtn.style.cssText = `
    width:26px; height:26px; border-radius:5px; border:none;
    background:rgba(255,255,255,0.07); color:#ccc; font-size:14px;
    font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center;
    transition:background 0.15s;
  `;
  closeBtn.textContent = '✕';
  closeBtn.onmouseenter = () => { closeBtn.style.background = 'rgba(255,60,60,0.35)'; };
  closeBtn.onmouseleave = () => { closeBtn.style.background = 'rgba(255,255,255,0.07)'; };

  headerRight.append(speedGroup, playPauseBtn, closeBtn);
  header.append(titleEl, headerRight);

  const preloadKey = '_preloaded_' + videoPath;
  const preloaded = simRef?.[preloadKey] as HTMLVideoElement | undefined;
  const video = (preloaded && preloaded.readyState >= 2) ? preloaded : document.createElement('video');
  if (!preloaded || preloaded.readyState < 2) {
    (video as HTMLVideoElement).src = videoPath;
  }
  video.controls = false;
  video.autoplay = true;
  video.loop = true;
  video.playsInline = true;
  video.playbackRate = 1;
  video.setAttribute('controlslist', 'nodownload nofullscreen noremoteplayback');
  video.setAttribute('disablepictureinpicture', '');
  video.oncontextmenu = (e) => { e.preventDefault(); return false; };
  video.style.cssText = `
    width:100%; height:auto; max-height:65vh; background:#000;
    object-fit:contain; display:block;
  `;

  video.addEventListener('loadedmetadata', () => { video.currentTime = 0; }, { once: true });
  video.addEventListener('loadeddata', () => {
    video.play().catch(e => console.warn('[VIDEO] Autoplay blocked:', e));
  }, { once: true });

  const captionEl = document.createElement('div');
  captionEl.style.cssText = `
    padding:5px 14px; font-size:10px; color:rgba(255,255,255,0.45);
    font-family:'Inter',sans-serif; letter-spacing:0.3px; flex-shrink:0;
    border-top:1px solid rgba(255,255,255,0.06); background:rgba(0,0,0,0.3);
  `;
  captionEl.textContent = caption;

  const scrubWrap = document.createElement('div');
  scrubWrap.style.cssText = `
    padding:6px 14px 4px; background:rgba(0,0,0,0.3);
    border-top:1px solid rgba(255,255,255,0.05); flex-shrink:0;
    display:flex; align-items:center; gap:8px;
  `;
  const timeLbl = document.createElement('span');
  timeLbl.style.cssText = 'color:rgba(255,255,255,0.4); font-size:10px; font-family:monospace; min-width:36px;';
  timeLbl.textContent = '0:00';
  const scrubber = document.createElement('input');
  scrubber.type = 'range'; scrubber.className = 'smart-scrubber';
  scrubber.min = '0'; scrubber.max = '100'; scrubber.value = '0';
  scrubber.oninput = () => {
    if (video.duration) video.currentTime = (parseFloat(scrubber.value) / 100) * video.duration;
  };
  video.ontimeupdate = () => {
    if (!video.duration) return;
    const pct = (video.currentTime / video.duration) * 100;
    scrubber.value = String(pct);
    const s = Math.floor(video.currentTime);
    timeLbl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    scrubber.style.background =
      `linear-gradient(to right, ${accent} ${pct}%, rgba(255,255,255,0.15) ${pct}%)`;
  };
  scrubWrap.append(scrubber, timeLbl);

  card.append(header, video, captionEl, scrubWrap);
  container.appendChild(card);
  parent.appendChild(container);

  const updatePPBtn = () => { playPauseBtn.textContent = video.paused ? '▶ Play' : '❚❚ Pause'; };
  playPauseBtn.onclick = () => { video.paused ? video.play() : video.pause(); updatePPBtn(); };
  video.onplay = updatePPBtn;
  video.onpause = updatePPBtn;

  const closeInlineVideo = () => {
    video.pause();
    container.style.animation = 'smartFadeIn 0.18s ease-in reverse';
    setTimeout(() => {
      container.remove();
      canvas.style.visibility = prevVis;
      if (prevPos === 'static') parent.style.position = '';
      if (simRef && !wasPaused) simRef.paused = false;
      if (simRef?.setVideoOpen) simRef.setVideoOpen(false);
    }, 180);
  };

  closeBtn.onclick = closeInlineVideo;
  container.onclick = (e) => { if (e.target === container) closeInlineVideo(); };
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { closeInlineVideo(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);

  video.play().catch(() => {});
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function EFEMSimulator() {
  const router = useRouter();
  const mountRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Sim | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadPct, setLoadPct] = useState(0);
  const [loadMsg, setLoadMsg] = useState("INITIALIZING...");
  const [speed, setSpeed] = useState(1);
  const [showComponentInfo, setShowComponentInfo] = useState(false);
  const [tcbActiveStep, setTcbActiveStep] = useState(0);
  const [ui, setUI] = useState<UIState>({ wafers: [], simTime: 0, fps: 60, active: 0, completed: 0, jointsEFEM: null, bonder: null });

  const addLog = useCallback(() => {}, []);
  const handleTooltip = useCallback(() => {}, []);

  useEffect(() => {
    if (!mountRef.current) return;
    const el = mountRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: false });
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;
    renderer.shadowMap.enabled = false;
    el.appendChild(renderer.domElement);

    const sim = new Sim(renderer, setUI, addLog, handleTooltip);
    simRef.current = sim;

    const resize = () => {
      if (!mountRef.current) return;
      renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
      sim.camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
      sim.camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", resize);

    const MSGS = [
      "INITIALIZING RENDER ENGINE", "BUILDING PBR MATERIALS",
      "LOADING CLEANROOM ENVIRONMENT", "CONFIGURING FLOOR TEXTURE",
      "SETTING UP LIGHTING", "CALIBRATING CAMERA",
      "BUILDING FLOOR GEOMETRY", "CONFIGURING SHADERS",
      "PREPARING SIMULATION", "LAUNCHING"
    ];
    let pct = 0;
    const iv = setInterval(() => {
      pct += 10;
      setLoadPct(Math.min(pct, 100));
      setLoadMsg(MSGS[Math.min(Math.floor(pct / 10), MSGS.length - 1)] + "...");
      if (pct >= 100) {
        clearInterval(iv);
        setTimeout(() => {
          setLoading(false);
          sim.start();
        }, 50);
      }
    }, 20);

    return () => {
      clearInterval(iv);
      window.removeEventListener("resize", resize);
      sim.destroy(); renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [addLog, handleTooltip]);

  useEffect(() => { if (simRef.current) simRef.current.speed = speed; }, [speed]);

  // Poll Sim class to keep TCB panels in sync with the active process step
  useEffect(() => {
    const poll = setInterval(() => {
      if (!simRef.current) return;
      try {
        const simStep = simRef.current.getActiveProcessStepIndex?.();
        if (typeof simStep === 'number' && simStep >= 0) {
          const mapped = Math.min(simStep, TCB_STEPS.length - 1);
          setTcbActiveStep(mapped);
        }
      } catch (_) {}
    }, 200);
    return () => clearInterval(poll);
  }, []);

  const handleSetSpeed = (ns: number) => {
    setSpeed(ns);
    if (!simRef.current) return;
    simRef.current.speed = ns;
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#d8e8f0", fontFamily: "'Inter', sans-serif", color: T.text, overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        button:hover { filter: brightness(1.08) !important; }
      `}</style>

      <div
        ref={mountRef}
        style={{
          position: "absolute",
          inset: 0,
        }}
      />

      {loading && (
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg,#e8f2fa,#f0f5ff 50%,#e4f0e8)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ fontSize: 46, letterSpacing: 14, color: "#0055cc", fontWeight: "bold", textShadow: "0 2px 24px rgba(0,80,200,0.2)", marginBottom: 6 }}>SMaRT Simulator</div>
          <div style={{ fontSize: 12, color: "#3a6ea8", letterSpacing: 5, marginBottom: 2 }}>SEMICONDUCTOR MANUFACTURING READINESS TRAINING</div>
          <div style={{ fontSize: 7.5, color: "#8aaccc", letterSpacing: 4, marginBottom: 36 }}>300mm PHOTOLITHOGRAPHY · EFEM + COATER/DEVELOPER · v13.0</div>
          <div style={{ width: 440 }}>
            <div style={{ height: 2, background: "rgba(0,100,200,0.10)", borderRadius: 2, overflow: "hidden", marginBottom: 9 }}>
              <div style={{ height: "100%", width: `${Math.min(loadPct, 100)}%`, background: "linear-gradient(90deg,#0066ee,#8844ff,#00cc88)", borderRadius: 2, boxShadow: "0 0 12px #0066ee", transition: "width .05s" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7.5, color: "#8aaccc", letterSpacing: 2 }}>
              <span>{loadMsg}</span><span>{Math.min(Math.round(loadPct), 100)}%</span>
            </div>
          </div>
          <div style={{ position: "absolute", bottom: 22, fontSize: 7.5, letterSpacing: 6, color: "#b0c8dc" }}>ISO-5 CLEANROOM · GENESIS EDUCATIONAL VISUALIZATION · v13.0</div>
        </div>
      )}

      {!loading && (
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 10 }}>

          {/* TOP BAR */}
          <div style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 54,
            background: "rgba(255,255,255,0.97)",
            borderBottom: "1px solid rgba(0,0,0,0.06)",
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "0 24px",
            backdropFilter: "blur(20px)",
            pointerEvents: "auto",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.03)",
          }}>
            {/* Logo / Brand */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 2px 8px rgba(37,99,235,0.25)",
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="4" />
                  <line x1="12" y1="2" x2="12" y2="6" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="6" y2="12" />
                  <line x1="18" y1="12" x2="22" y2="12" />
                </svg>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                <span style={{
                  fontSize: 14,
                  letterSpacing: 3,
                  color: "#111827",
                  fontWeight: 800,
                  lineHeight: 1.1,
                }}>SMaRT</span>
                <span style={{
                  fontSize: 8,
                  letterSpacing: 2,
                  color: "#9ca3af",
                  fontWeight: 500,
                  textTransform: "uppercase",
                }}>Simulator</span>
              </div>
            </div>

            {/* Divider */}
            <div style={{ width: 1, height: 24, background: "#e5e7eb" }} />

            {/* Status dot */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#22c55e",
                boxShadow: "0 0 0 3px rgba(34,197,94,0.15)",
              }} />
              <span style={{ fontSize: 10, color: "#6b7280", letterSpacing: 1, fontWeight: 600, textTransform: "uppercase" }}>Live</span>
            </div>

            <div style={{ flex: 1 }} />

            {/* Controls */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <NarrationControls simRef={simRef} />

              <ComponentInfoToggle
                enabled={showComponentInfo}
                onToggle={() => setShowComponentInfo(!showComponentInfo)}
              />

              {/* ALARM */}
              <button
                onClick={() => router.push("/Failure")}
                style={{
                  padding: "7px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 1.2,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  textTransform: "uppercase",
                  boxShadow: "0 2px 8px rgba(239,68,68,0.3)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = "0 4px 14px rgba(239,68,68,0.4)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 2px 8px rgba(239,68,68,0.3)";
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                ALARM
              </button>

              {/* RECIPE */}
              <button
                onClick={() => router.push("/Recipe")}
                style={{
                  padding: "7px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 1.2,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  textTransform: "uppercase",
                  boxShadow: "0 2px 8px rgba(59,130,246,0.3)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = "0 4px 14px rgba(59,130,246,0.4)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 2px 8px rgba(59,130,246,0.3)";
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                RECIPE
              </button>

              {/* BONDER CONTROLS */}
              {ui.bonder && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 12, paddingLeft: 12, borderLeft: "1px solid #e5e7eb" }}>
                  <button
                    onClick={() => simRef.current?.startBonder()}
                    disabled={ui.bonder.status === 'running'}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "none",
                      background: ui.bonder.status === 'running' ? "#e5e7eb" : "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
                      color: "#fff",
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 1,
                      cursor: ui.bonder.status === 'running' ? "not-allowed" : "pointer",
                      opacity: ui.bonder.status === 'running' ? 0.5 : 1,
                      textTransform: "uppercase",
                    }}
                  >
                    ▶ START
                  </button>
                  <button
                    onClick={() => simRef.current?.pauseBonder()}
                    disabled={ui.bonder.status !== 'running'}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "none",
                      background: ui.bonder.status !== 'running' ? "#e5e7eb" : "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
                      color: "#fff",
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 1,
                      cursor: ui.bonder.status !== 'running' ? "not-allowed" : "pointer",
                      opacity: ui.bonder.status !== 'running' ? 0.5 : 1,
                      textTransform: "uppercase",
                    }}
                  >
                    ⏸ PAUSE
                  </button>
                  <button
                    onClick={() => simRef.current?.resumeBonder()}
                    disabled={ui.bonder.status !== 'paused'}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "none",
                      background: ui.bonder.status !== 'paused' ? "#e5e7eb" : "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                      color: "#fff",
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 1,
                      cursor: ui.bonder.status !== 'paused' ? "not-allowed" : "pointer",
                      opacity: ui.bonder.status !== 'paused' ? 0.5 : 1,
                      textTransform: "uppercase",
                    }}
                  >
                    ▶ RESUME
                  </button>
                  <button
                    onClick={() => simRef.current?.resetBonder()}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "1px solid #d1d5db",
                      background: "white",
                      color: "#374151",
                      fontSize: 9,
                      fontWeight: 600,
                      letterSpacing: 1,
                      cursor: "pointer",
                      textTransform: "uppercase",
                    }}
                  >
                    ↺ RESET
                  </button>

                  {/* TWO-ROBOT CHIP PROCESS (COLRIGHT pick/flip -> SKING handoff/flux/place) */}
                  <button
                    onClick={() => simRef.current?.runTwoRobotRecipe()}
                    disabled={ui.bonder.status === 'running'}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "none",
                      background: ui.bonder.status === 'running' ? "#e5e7eb" : "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
                      color: ui.bonder.status === 'running' ? "#9ca3af" : "#fff",
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 1,
                      cursor: ui.bonder.status === 'running' ? "not-allowed" : "pointer",
                      opacity: ui.bonder.status === 'running' ? 0.5 : 1,
                      textTransform: "uppercase",
                    }}
                  >
                    2-ROBOT PROCESS
                  </button>
                  <button
                    onClick={() => simRef.current?.resetTwoRobot()}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "1px solid #e9d5ff",
                      background: "#faf5ff",
                      color: "#6b21a8",
                      fontSize: 9,
                      fontWeight: 600,
                      letterSpacing: 1,
                      cursor: "pointer",
                      textTransform: "uppercase",
                    }}
                    title="Return both robots to home and chips to the tray"
                  >
                    RESET 2-ROBOT
                  </button>
                  <button
                    onClick={() => simRef.current?.startBonderWaferTransfer()}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "none",
                      background: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
                      color: "#fff",
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 1,
                      cursor: "pointer",
                      textTransform: "uppercase",
                    }}
                    title="EFEM robot transfers the 300mm wafer from the input rack (FOUP) to the bonder Ring Vacuum Pedestal"
                  >
                    WAFER → PEDESTAL
                  </button>
                  <button
                    onClick={() => simRef.current?.resetBonderWaferTransfer()}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "1px solid #bae6fd",
                      background: "#f0f9ff",
                      color: "#0369a1",
                      fontSize: 9,
                      fontWeight: 600,
                      letterSpacing: 1,
                      cursor: "pointer",
                      textTransform: "uppercase",
                    }}
                    title="Reset the wafer rack → pedestal transfer"
                  >
                    ↺ RESET TRANSFER
                  </button>
                  <div style={{ marginLeft: 8, padding: "4px 8px", background: "#f3f4f6", borderRadius: 4, fontSize: 8, color: "#374151", fontFamily: "monospace" }}>
                    {ui.bonder.stageLabel} ({Math.round(ui.bonder.progress)}%)
                    <span style={{ marginLeft: 8, color: ui.bonder.temperature >= 240 ? "#dc2626" : "#374151" }}>
                      {Math.round(ui.bonder.temperature)}°C
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Right section */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {/* Clock */}
              <div style={{
                padding: "5px 12px",
                borderRadius: 6,
                background: "#f9fafb",
                border: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span style={{ fontSize: 12, color: "#111827", letterSpacing: 1, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                  {fmtClock(ui.simTime)}
                </span>
              </div>

              {/* FPS */}
              <span style={{ fontSize: 9, color: "#9ca3af", letterSpacing: 1, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
                {ui.fps} FPS
              </span>

              <ProfileMenu />
            </div>
          </div>

        </div>
      )}

      {/* ── TCB PROCESS FLOW PANEL (left sidebar) ── */}
      {!loading && (
        <div style={{
          position: "fixed",
          top: 56,
          left: 12,
          zIndex: 15,
          pointerEvents: "auto",
        }}>
          <ProcessFlowPanel
            currentStep={tcbActiveStep}
            onStepClick={(i) => {
              setTcbActiveStep(i);
              setShowComponentInfo(true);
            }}
          />
        </div>
      )}

      {/* ── TCB COMPONENT INFO PANEL (right overlay, toggle-controlled) ── */}
      {!loading && showComponentInfo && (
        <TcbComponentInfoPanel
          step={TCB_STEPS[tcbActiveStep]}
          onClose={() => setShowComponentInfo(false)}
        />
      )}

      {/* SPEED CONTROLS — bottom-right */}
      {!loading && (
        <div style={{
          position: "fixed",
          bottom: 32,
          right: 32,
          display: "flex",
          alignItems: "center",
          gap: 6,
          pointerEvents: "auto",
          zIndex: 50,
        }}>
          {[1, 2, 5, 10].map((s) => (
            <button
              key={s}
              onClick={() => handleSetSpeed(s)}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: speed === s ? "1px solid rgba(0,80,200,0.5)" : "1px solid rgba(0,80,200,0.15)",
                background: speed === s
                  ? "linear-gradient(135deg, rgba(0,100,220,0.25) 0%, rgba(0,80,200,0.15) 100%)"
                  : "rgba(255,255,255,0.92)",
                color: speed === s ? "#0044aa" : "#3a6ea8",
                fontSize: 13,
                fontWeight: speed === s ? 800 : 600,
                cursor: "pointer",
                letterSpacing: 0.5,
                transition: "all .2s ease",
                backdropFilter: "blur(16px)",
                boxShadow: speed === s
                  ? "0 2px 12px rgba(0,80,200,0.25), inset 0 1px 0 rgba(255,255,255,0.4)"
                  : "0 2px 8px rgba(0,80,180,0.10)",
                transform: speed === s ? "scale(1.05)" : "scale(1)",
                minWidth: 44,
                textAlign: "center" as const,
                fontFamily: "'Inter', sans-serif",
              }}
            >
              {s}×
            </button>
          ))}
        </div>
      )}
    </div>
  );
}