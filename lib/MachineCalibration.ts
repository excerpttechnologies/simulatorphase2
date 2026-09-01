/**
 * MachineCalibration.ts
 * 
 * Defines physical machine dimensions, station positions, and calibration constants.
 * All mechanical motion references these coordinates.
 */

import * as THREE from 'three';

// ═══════════════════════════════════════════════════════════════
// MACHINE COORDINATE SYSTEM
// ═══════════════════════════════════════════════════════════════

export interface StationCoordinate {
  name: string;
  x: number;
  y: number;
  z: number;
  description: string;
}

export class MachineCalibration {
  /**
   * World-space station positions
   * All coordinates are in Three.js units (typically mm scaled)
   */
  static readonly STATIONS = {
    // Wafer/substrate loading zone
    WAFER_ENTRY: { x: 0.0, y: 0.0, z: 0.5, description: 'Wafer entry point' } as StationCoordinate,
    WAFER_STAGE: { x: 0.0, y: 0.0, z: 0.0, description: 'Main heated stage' } as StationCoordinate,

    // Pick & Flip module
    PEDESTAL_CENTER: { x: -0.3, y: 0.0, z: 0.0, description: 'Vacuum pedestal center' } as StationCoordinate,
    PICK_HOME: { x: 0.5, y: 0.8, z: 0.5, description: 'Pick arm home position' } as StationCoordinate,

    // Flux station
    FLUX_PLATE_CENTER: { x: 0.3, y: 0.0, z: 0.0, description: 'Flux film center' } as StationCoordinate,

    // Bonding zone
    BOND_SITE: { x: -0.1, y: 0.0, z: 0.0, description: 'Substrate bonding site' } as StationCoordinate,
    BONDHEAD_HOME: { x: 0.0, y: 0.8, z: 0.5, description: 'Bonding head home' } as StationCoordinate,

    // Optics reference
    OPTICS_PARK: { x: 0.0, y: 0.5, z: 0.8, description: 'Optics parked position' } as StationCoordinate,
  };

  /**
   * Bonding head calibration
   */
  static readonly BONDHEAD = {
    // Z positions (vertical)
    HOME_Z: 0.5,              // Home position height
    SAFE_Z: 0.2,              // Safe height above substrate
    CONTACT_Z: -0.04,         // Contact position (into substrate)
    RETREAT_Z: 0.3,           // Retreat position after bonding

    // X positions (horizontal)
    HOME_X: 0.0,
    PEDESTAL_X: -0.3,
    FLUX_X: 0.3,
    BOND_X: -0.1,

    // Vacuum
    VACUUM_PRESSURE: -85,     // kPa
    RELEASE_PRESSURE: 10,     // kPa

    // Force
    MAX_FORCE: 45,            // Newtons
    TOUCH_FORCE: 2.0,         // N
    GRIP_FORCE: 3.5,          // N
  };

  /**
   * Pedestal calibration
   */
  static readonly PEDESTAL = {
    CENTER: new THREE.Vector3(-0.3, 0.0, 0.0),
    RADIUS: 0.15,
    ROTATION_SPEED: 720,      // °/s
    MAX_ROTATION: 180,        // degrees

    // Vacuum
    VACUUM_PRESSURE: -85,     // kPa
  };

  /**
   * Pick arm calibration
   */
  static readonly PICK_ARM = {
    HOME_X: 0.5,
    HOME_Z: 0.5,
    WAFER_X: 0.0,
    WAFER_Z: 0.02,            // Just above wafer surface
    PEDESTAL_X: -0.3,
    PEDESTAL_Z: 0.02,

    // Vacuum
    VACUUM_PRESSURE: -85,     // kPa
    GRIP_FORCE: 3.5,          // Newtons

    // Motion
    APPROACH_SPEED: 100,      // mm/s
    RETRACT_SPEED: 80,        // mm/s
  };

  /**
   * Ejector pin calibration
   */
  static readonly EJECTOR = {
    MAX_STROKE: 0.8,          // mm
    SPEED: 15,                // mm/s
    RETRACT_SPEED: 10,        // mm/s
  };

  /**
   * Flux station calibration
   */
  static readonly FLUX = {
    CENTER: new THREE.Vector3(0.3, 0.0, 0.0),
    DIP_DEPTH: 5,             // micrometers
    DIP_Z_OFFSET: -0.005,     // Three.js units
    FILM_THICKNESS: 7,        // micrometers
    DWELL_TIME: 200,          // milliseconds
    ROTATION_SPEED: 60,       // °/s during dip
  };

  /**
   * Optics system calibration
   */
  static readonly OPTICS = {
    PARK_POSITION: 0.0,       // 0 = parked
    INSERTED_POSITION: 1.0,   // 1 = fully inserted
    INSERTION_SPEED: 100,     // mm/s

    // Alignment reference
    MAX_ERROR_X: 12,          // µm
    MAX_ERROR_Y: 8,           // µm
    MAX_ERROR_THETA: 0.12,    // degrees

    // Beam properties
    LOOKUP_BEAM_COLOR: 0x00ffff,  // Cyan
    LOOKDOWN_BEAM_COLOR: 0xff00ff, // Magenta
    BEAM_RADIUS: 0.002,       // Three.js units
  };

  /**
   * Temperature calibration
   */
  static readonly TEMPERATURE = {
    // Process setpoints
    AMBIENT: 25,              // °C
    STAGE_PREHEAT: 80,        // °C
    BONDHEAD_PREHEAT: 150,    // °C
    PEAK_REFLOW: 260,         // °C
    COOL_TARGET: 190,         // °C
    RELEASE_TEMP: 120,        // °C

    // Critical temperatures
    SOLDER_MELT: 217,         // °C (Sn-Ag solder)
    SOLDER_SOLID: 210,        // °C

    // Ramp rates
    HEATING_RATE: 150,        // °C/s (during reflow pulse)
    COOLING_RATE: 50,         // °C/s (during cooldown)
    PREHEAT_RATE: 10,         // °C/s (slow preheat)
  };

  /**
   * Die handling calibration
   */
  static readonly DIE = {
    // Dimensions (approximate)
    WIDTH: 0.08,              // mm (3D units)
    LENGTH: 0.08,
    THICKNESS: 0.004,         // typical die thickness

    // Bump array
    BUMP_DIAMETER: 0.008,     // 8µm typical
    BUMP_HEIGHT: 0.003,       // 3µm typical
    BUMP_ARRAY: [
      [-0.025, -0.025],
      [0.025, -0.025],
      [-0.025, 0.025],
      [0.025, 0.025],
    ],

    // Contact clearance
    SAFE_CLEARANCE: 0.005,    // Stay above substrate when gripped
  };

  /**
   * Substrate calibration
   */
  static readonly SUBSTRATE = {
    WIDTH: 0.3,               // 300mm in scaled units
    LENGTH: 0.3,
    THICKNESS: 0.005,

    // Pad array (typical 4x4 grid)
    PAD_SIZE: 0.008,
    PAD_PITCH: 0.08,
    NUM_PADS: 16,
    ACTIVE_PAD_INDEX: 14,     // Bonding pad #14 by default

    // Bond site depth
    PAD_HEIGHT: 0.001,
  };

  /**
   * Scene/environmental calibration
   */
  static readonly SCENE = {
    // Camera defaults
    CAMERA_FOV: 75,
    CAMERA_NEAR: 0.001,
    CAMERA_FAR: 100,

    // Lighting
    AMBIENT_LIGHT_INTENSITY: 0.6,
    KEY_LIGHT_INTENSITY: 1.2,
    FILL_LIGHT_INTENSITY: 0.4,

    // Shadows
    SHADOW_MAP_SIZE: 2048,
    SHADOW_BIAS: -0.0001,
  };

  /**
   * Motion profiles (easing & timing)
   */
  static readonly MOTION = {
    // Industrial motion profile: accel -> coast -> decel
    ACCEL_TIME: 0.2,          // % of travel time for acceleration
    COAST_TIME: 0.6,          // % of travel time at constant speed
    DECEL_TIME: 0.2,          // % of travel time for deceleration

    // Settling time (mechanical overshoot damping)
    SETTLING_TIME: 0.1,       // seconds

    // Speed profiles
    FAST_SPEED: 500,          // mm/s (Z rapid)
    NORMAL_SPEED: 100,        // mm/s (XY transport)
    SLOW_SPEED: 20,           // mm/s (precision approach)
  };

  /**
   * Convert a world station to Three.js Vector3
   */
  static getStationVector(station: StationCoordinate): THREE.Vector3 {
    return new THREE.Vector3(station.x, station.y, station.z);
  }

  /**
   * Calculate interpolated position between two stations
   */
  static interpolateStations(
    from: THREE.Vector3,
    to: THREE.Vector3,
    t: number,
    easeFunction?: (t: number) => number
  ): THREE.Vector3 {
    const eased = easeFunction ? easeFunction(t) : t;
    return from.clone().lerp(to, eased);
  }

  /**
   * Calculate motion time between two points
   */
  static calculateMotionTime(
    fromPos: THREE.Vector3,
    toPos: THREE.Vector3,
    speed: number = this.MOTION.NORMAL_SPEED
  ): number {
    const distance = fromPos.distanceTo(toPos);
    return (distance / speed) * 1000; // Convert to milliseconds
  }

  /**
   * Get temperature color based on setpoint
   */
  static getTemperatureColor(temp: number): string {
    if (temp <= 80) return '#7C8A9A';   // Grey - idle
    if (temp <= 150) return '#E8A33D';  // Amber - preheat
    if (temp <= 190) return '#FF9800';  // Orange - medium heat
    if (temp >= 220) return '#FF4B4B';  // Red - peak reflow
    if (temp <= 200) return '#4FA8FF';  // Blue - cooling
    return '#E8A33D';
  }

  /**
   * Get temperature label
   */
  static getTemperatureLabel(temp: number): string {
    if (temp < 100) return `${Math.round(temp)}°C (Ambient)`;
    if (temp < 150) return `${Math.round(temp)}°C (Preheat)`;
    if (temp < 200) return `${Math.round(temp)}°C (Reflow)`;
    if (temp >= 260) return `${Math.round(temp)}°C (PEAK)`;
    return `${Math.round(temp)}°C`;
  }
}

export default MachineCalibration;
