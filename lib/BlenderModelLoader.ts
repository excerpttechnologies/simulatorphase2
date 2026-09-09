/**
 * BlenderModelLoader.ts
 * 
 * Loads Blender GLB models and manages the model registry.
 * Inspects model hierarchies, creates node maps, and handles model scaling.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ═══════════════════════════════════════════════════════════════
// MODEL REGISTRY
// ═══════════════════════════════════════════════════════════════

export interface ModelNode {
  name: string;
  object3D: THREE.Object3D;
  children: Map<string, ModelNode>;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  scale: THREE.Vector3;
}

export class ModelRegistry {
  // Main machine components
  machineRoot: THREE.Group | null = null;
  waferStage: THREE.Object3D | null = null;
  waferRack: THREE.Object3D | null = null;
  substrate: THREE.Object3D | null = null;

  // Pick & Flip module
  pickRobot: THREE.Object3D | null = null;
  pickRobotBase: THREE.Object3D | null = null;
  pickArm: THREE.Object3D | null = null;
  pickCollet: THREE.Object3D | null = null;
  ejectorPins: THREE.Group | null = null;
  pedestalRing: THREE.Object3D | null = null;
  pedestalRotaryBase: THREE.Object3D | null = null;

  // Bonding head
  bondingHead: THREE.Group | null = null;
  bondHeadNozzle: THREE.Object3D | null = null;
  bondHeadHeater: THREE.Object3D | null = null;
  coolingNozzles: THREE.Object3D | null = null;

  // Flux station
  fluxPlate: THREE.Object3D | null = null;
  fluxPlateRotaryPivot: THREE.Object3D | null = null;
  fluxFilm: THREE.Object3D | null = null;

  // Optics
  opticsArm: THREE.Object3D | null = null;
  opticsLookupCamera: THREE.Object3D | null = null;
  opticsLookdownCamera: THREE.Object3D | null = null;

  // Die representation
  activeDie: THREE.Object3D | null = null;

  // Model hierarchy map
  hierarchyMap: Map<string, ModelNode> = new Map();
}

// ═══════════════════════════════════════════════════════════════
// BLENDER MODEL LOADER
// ═══════════════════════════════════════════════════════════════

export class BlenderModelLoader {
  private loader: GLTFLoader;
  private registry: ModelRegistry;
  private modelScale: number = 1.0;

  constructor() {
    this.loader = new GLTFLoader();
    this.registry = new ModelRegistry();
  }
  // ===== GLB-REMOVED (BlenderModelLoader.loadMainMachine - /flip_chip_bonder.glb) - re-wire the new module here. See GLB_WIRING_CONTRACT.md =====
  // 
  // /**
  // * Load main flip-chip-bonder model
  // */
  // async loadMainMachine(path: string = '/flip_chip_bonder.glb'): Promise<THREE.Group> {
  // return new Promise((resolve, reject) => {
  // this.loader.load(
  // path,
  // (gltf) => {
  // console.log('[MODEL] Flip-chip-bonder loaded');
  // 
  // const scene = gltf.scene;
  // this.inspectModelHierarchy(scene);
  // this.mapModelNodes(scene);
  // this.registry.machineRoot = scene;
  // 
          // Calibrate model scale
  // this.calibrateModelScale(scene);
  // 
  // resolve(scene);
  // },
  // (progress) => {
  // console.log(
  // `[LOADING] Flip-chip-bonder: ${(
  // (progress.loaded / progress.total) *
  // 100
  // ).toFixed(2)}%`
  // );
  // },
  // (error) => {
  // console.error('[ERROR] Failed to load flip-chip-bonder:', error);
  // reject(error);
  // }
  // );
  // });
  // }
  // ===== GLB-REMOVED (BlenderModelLoader.loadRoboticArm - /roboticarm.glb) - re-wire the new module here. See GLB_WIRING_CONTRACT.md =====
  // 
  // /**
  // * Load robotic arm model (if separate)
  // */
  // async loadRoboticArm(path: string = '/roboticarm.glb'): Promise<THREE.Group> {
  // return new Promise((resolve, reject) => {
  // this.loader.load(
  // path,
  // (gltf) => {
  // console.log('[MODEL] Robotic arm loaded');
  // const scene = gltf.scene;
  // this.inspectModelHierarchy(scene);
  // this.registry.pickRobot = scene;
  // resolve(scene);
  // },
  // undefined,
  // (error) => {
  // console.error('[ERROR] Failed to load robotic arm:', error);
  // reject(error);
  // }
  // );
  // });
  // }

  /**
   * Load wafer rack module
   */
  async loadWaferRack(path: string = '/wafer_rack_module.glb'): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      this.loader.load(
        path,
        (gltf) => {
          console.log('[MODEL] Wafer rack loaded');
          const scene = gltf.scene;
          this.inspectModelHierarchy(scene);
          this.registry.waferRack = scene;
          resolve(scene);
        },
        undefined,
        (error) => {
          console.error('[ERROR] Failed to load wafer rack:', error);
          reject(error);
        }
      );
    });
  }

  /**
   * Recursively inspect model hierarchy and log structure
   */
  private inspectModelHierarchy(
    obj: THREE.Object3D,
    indent: string = '',
    depth: number = 0
  ): void {
    if (depth > 10) return; // Prevent infinite recursion

    const info = {
      name: obj.name,
      type: obj.constructor.name,
      position: obj.position,
      rotation: obj.rotation,
      scale: obj.scale,
      visible: obj.visible,
      children: obj.children.length,
    };

    console.log(`${indent}├─ ${JSON.stringify(info)}`);

    obj.children.forEach((child) => {
      this.inspectModelHierarchy(child, indent + '│  ', depth + 1);
    });
  }

  /**
   * Create a hierarchical node map for the model
   */
  private mapModelNodes(obj: THREE.Object3D, parent: ModelNode | null = null): ModelNode {
    const node: ModelNode = {
      name: obj.name,
      object3D: obj,
      children: new Map(),
      position: obj.position.clone(),
      rotation: obj.quaternion.clone(),
      scale: obj.scale.clone(),
    };

    this.registry.hierarchyMap.set(obj.name, node);

    obj.children.forEach((child) => {
      const childNode = this.mapModelNodes(child, node);
      node.children.set(child.name, childNode);
    });

    return node;
  }

  /**
   * Calibrate model scale based on bounding box
   * Ensures model is appropriately sized for the scene
   */
  private calibrateModelScale(model: THREE.Group): void {
    const bbox = new THREE.Box3().setFromObject(model);
    const size = bbox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    console.log('[CALIBRATION] Model bounding box:', {
      size: { x: size.x.toFixed(3), y: size.y.toFixed(3), z: size.z.toFixed(3) },
      maxDim: maxDim.toFixed(3),
      center: bbox.getCenter(new THREE.Vector3()),
    });

    // Target size: approximately 1.5 units
    const targetSize = 1.5;
    this.modelScale = targetSize / maxDim;

    // Apply scale
    model.scale.multiplyScalar(this.modelScale);

    console.log('[CALIBRATION] Applied scale:', this.modelScale.toFixed(4));
  }

  /**
   * Find a node by name in the hierarchy
   */
  findNodeByName(name: string): ModelNode | undefined {
    return this.registry.hierarchyMap.get(name);
  }

  /**
   * Recursively find first child matching a condition
   */
  findNodeByCondition(
    obj: THREE.Object3D,
    condition: (obj: THREE.Object3D) => boolean
  ): THREE.Object3D | null {
    if (condition(obj)) return obj;

    for (const child of obj.children) {
      const result = this.findNodeByCondition(child, condition);
      if (result) return result;
    }

    return null;
  }

  /**
   * Get the model registry
   */
  getRegistry(): ModelRegistry {
    return this.registry;
  }

  /**
   * Get the scaling factor applied to models
   */
  getModelScale(): number {
    return this.modelScale;
  }

  /**
   * Create a test die mesh (simple cube for now)
   * This represents the silicon chip being bonded
   */
  createDieMesh(): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(0.08, 0.004, 0.08);
    const material = new THREE.MeshStandardMaterial({
      color: '#d4af37',
      metalness: 1.0,
      roughness: 0.25,
    });

    const die = new THREE.Mesh(geometry, material);
    die.name = 'ActiveDie';

    // Add bump bumps on the underside (simple spheres)
    const bumpGeometry = new THREE.SphereGeometry(0.004, 8, 8);
    const bumpMaterial = new THREE.MeshStandardMaterial({
      color: '#8a6d1f',
      metalness: 0.9,
      roughness: 0.3,
    });

    const bumps = new THREE.Group();
    bumps.name = 'DummieBumps';

    // Create a 2x2 array of bumps
    const positions = [
      [-0.025, -0.002, -0.025],
      [0.025, -0.002, -0.025],
      [-0.025, -0.002, 0.025],
      [0.025, -0.002, 0.025],
    ];

    positions.forEach(([x, y, z]) => {
      const bump = new THREE.Mesh(bumpGeometry, bumpMaterial);
      bump.position.set(x, y, z);
      bumps.add(bump);
    });

    die.add(bumps);
    this.registry.activeDie = die;

    return die;
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════

export default BlenderModelLoader;
