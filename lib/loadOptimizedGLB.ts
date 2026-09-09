/**
 * loadOptimizedGLB.ts
 *
 * Loads a .glb from the Next.js /public server and makes it cheap enough to put
 * in a live scene, then hands back the result. Two things it does that a bare
 * GLTFLoader.load() does not:
 *
 * 1. INSTANCING. Blender "duplicate" clouds arrive as thousands of separate
 *    nodes that all share one geometry + material. /waferrxk.glb, for example,
 *    is only 270 KB of geometry but 15,013 mesh nodes (14,602 of them named
 *    Sphere_Source). Left alone that is 15,013 Object3Ds walked by
 *    updateMatrixWorld() every frame and 15,013 draw calls. Every run of
 *    identical (geometry, material) meshes is collapsed into a single
 *    THREE.InstancedMesh, which renders the same pixels in one draw call.
 *
 * 2. NEVER THROWS. A failed fetch, a 404, a corrupt file or a parse error
 *    resolves to `null` instead of rejecting, so a missing model can never take
 *    the simulation down with it. Callers fall back to procedural geometry.
 *
 * See GLB_WIRING_CONTRACT.md for how loaded models wire into the sim.
 */

import * as THREE from 'three';

export interface LoadOptimizedOptions {
  /** Identical meshes at or above this count collapse into one InstancedMesh. */
  instanceThreshold?: number;
  /** Progress callback: fraction is 0..1, or -1 when the server sends no length. */
  onProgress?: (fraction: number, loaded: number, total: number) => void;
  /** Label used in console output. Defaults to the url. */
  label?: string;
}

export interface OptimizeStats {
  meshesBefore: number;
  meshesAfter: number;
  nodesBefore: number;
  nodesAfter: number;
  instancedGroups: number;
  drawCallsSaved: number;
}

export interface LoadOptimizedResult {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  stats: OptimizeStats;
}

/** Node names driven by an animation track — never instanced, or the clip breaks. */
function animatedNodeNames(clips: THREE.AnimationClip[]): Set<string> {
  const names = new Set<string>();
  for (const clip of clips ?? []) {
    for (const track of clip.tracks ?? []) {
      // Track names look like "EjectorRig_Ctrl.position" or "Node.001.quaternion".
      const dot = track.name.lastIndexOf('.');
      names.add(dot === -1 ? track.name : track.name.slice(0, dot));
    }
  }
  return names;
}

function countNodes(root: THREE.Object3D): number {
  let n = 0;
  root.traverse(() => { n += 1; });
  return n;
}

/**
 * Collapse runs of identical (geometry, material) meshes into InstancedMeshes.
 * Instance transforms are baked relative to `root`, so the result is visually
 * identical as long as the caller does not reparent individual clones later.
 */
export function collapseToInstances(
  root: THREE.Object3D,
  threshold: number,
  protectedNames: Set<string>
): OptimizeStats {
  const nodesBefore = countNodes(root);

  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();

  const buckets = new Map<string, THREE.Mesh[]>();
  let meshesBefore = 0;

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!(mesh as any).isMesh) return;
    meshesBefore += 1;

    // Skinned meshes carry bone bindings; instancing would discard them.
    if ((mesh as any).isSkinnedMesh) return;
    // Multi-material meshes need one InstancedMesh per group — not worth it.
    if (Array.isArray(mesh.material)) return;
    // Anything an animation drives must keep its own transform.
    if (protectedNames.has(mesh.name)) return;

    const key = `${mesh.geometry.uuid}|${(mesh.material as THREE.Material).uuid}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(mesh);
    else buckets.set(key, [mesh]);
  });

  let instancedGroups = 0;
  let drawCallsSaved = 0;

  for (const clones of buckets.values()) {
    if (clones.length < threshold) continue;

    const template = clones[0];
    const instanced = new THREE.InstancedMesh(
      template.geometry,
      template.material as THREE.Material,
      clones.length
    );

    const local = new THREE.Matrix4();
    clones.forEach((clone, i) => {
      local.multiplyMatrices(rootInverse, clone.matrixWorld);
      instanced.setMatrixAt(i, local);
    });
    instanced.instanceMatrix.needsUpdate = true;

    instanced.name = `${template.name || 'mesh'}_x${clones.length}`;
    instanced.castShadow = template.castShadow;
    instanced.receiveShadow = template.receiveShadow;
    instanced.frustumCulled = false; // bounds span every instance
    instanced.userData.instancedFrom = template.name;
    instanced.userData.instanceCount = clones.length;

    // Detach the originals, then attach the single replacement to the root.
    for (const clone of clones) clone.parent?.remove(clone);
    root.add(instanced);

    instancedGroups += 1;
    drawCallsSaved += clones.length - 1;
  }

  // Drop the empty Groups the removed clones left behind. Anything named, or
  // holding a child, or carrying userData stays put.
  const emptied: THREE.Object3D[] = [];
  root.traverse((obj) => {
    if (obj === root) return;
    if (obj.children.length > 0) return;
    if ((obj as any).isMesh || (obj as any).isInstancedMesh) return;
    if ((obj as any).isBone || (obj as any).isLight || (obj as any).isCamera) return;
    if (protectedNames.has(obj.name)) return;
    if (Object.keys(obj.userData || {}).length > 0) return;
    emptied.push(obj);
  });
  for (const obj of emptied) obj.parent?.remove(obj);

  let meshesAfter = 0;
  root.traverse((obj) => { if ((obj as any).isMesh) meshesAfter += 1; });

  return {
    meshesBefore,
    meshesAfter,
    nodesBefore,
    nodesAfter: countNodes(root),
    instancedGroups,
    drawCallsSaved,
  };
}

/**
 * Load a .glb and optimize it. Resolves to `null` on ANY failure so a bad or
 * missing model degrades to the caller's fallback instead of throwing.
 */
export async function loadOptimizedGLB(
  url: string,
  options: LoadOptimizedOptions = {}
): Promise<LoadOptimizedResult | null> {
  const { instanceThreshold = 8, onProgress, label = url } = options;

  if (typeof window === 'undefined') {
    // Server render: there is no WebGL context to put this in anyway.
    return null;
  }

  try {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();

    const gltf: any = await new Promise((resolve, reject) => {
      loader.load(
        url,
        resolve,
        (event: ProgressEvent) => {
          if (!onProgress) return;
          const total = event.total || 0;
          onProgress(total > 0 ? event.loaded / total : -1, event.loaded, total);
        },
        reject
      );
    });

    const scene = gltf.scene as THREE.Group;
    const animations = (gltf.animations ?? []) as THREE.AnimationClip[];

    const stats = collapseToInstances(
      scene,
      instanceThreshold,
      animatedNodeNames(animations)
    );

    console.log(
      `[GLB] ${label}: ${stats.meshesBefore} meshes -> ${stats.meshesAfter} ` +
      `(${stats.instancedGroups} instanced groups, ${stats.drawCallsSaved} draw calls saved, ` +
      `${stats.nodesBefore} -> ${stats.nodesAfter} nodes)`
    );

    return { scene, animations, stats };
  } catch (error) {
    // Deliberately swallowed - see the module header. Callers fall back.
    console.error(`[GLB] ${label}: load failed, falling back to procedural geometry.`, error);
    return null;
  }
}

export default loadOptimizedGLB;
