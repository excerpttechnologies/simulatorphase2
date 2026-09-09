/**
 * FlipChipRobot — Three.js controller for flip_chip_robot_v2.glb
 *
 * Plain three.js (no R3F).  Works with the app's existing pattern:
 *   const robot = new FlipChipRobot();
 *   await robot.load('/flip_chip_robot_v2.glb');
 *   scene.add(robot.root);
 *   robot.play();                       // run the 7.5 s PickPlace_Cycle, looping
 *   ...in the render loop:  robot.update(deltaSeconds);
 *
 * Manual control (stops the clip):
 *   robot.setColumnAngle(-45);          // degrees, negative = clockwise from above
 *   robot.setLift(-0.10);               // metres, 0 = up, -0.1422 = on the base surface
 *   robot.setFlipAngle(90);             // degrees, 0 = chip face up, 180 = inverted
 *   robot.setChipVisible(true);
 *
 * Node names, axes and timing are documented in FLIP_CHIP_ROBOT_HIERARCHY.md.
 */
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type CyclePhase =
  | 'pick' | 'to-flip-zone' | 'flip' | 'to-output' | 'place' | 'return' | 'hold';

export interface FlipChipRobotNodes {
  root: THREE.Group;
  armature: THREE.Object3D;
  boneColumnRotate: THREE.Bone;
  boneArmLift: THREE.Bone;
  rotaryActuator: THREE.Object3D;
  endEffectorBody: THREE.Object3D;
  activeChip: THREE.Object3D;
  statusLED: THREE.Mesh;
  suctionCups: THREE.Object3D[];
}

const CLIP_NAME = 'PickPlace_Cycle';
const CLIP_DURATION = 7.5;               // seconds, 450 frames @ 60 fps
export const LIFT_STROKE = 0.1422;       // metres, full descent to the base surface
const FLIP_AXIS_LOCAL = new THREE.Vector3(0, 0, -1);   // relative to the actuator's rest quaternion
const UP = new THREE.Vector3(0, 1, 0);

/** Phase boundaries in seconds, matching the Blender keyframes. */
export const PHASES: Array<{ phase: CyclePhase; start: number; end: number }> = [
  { phase: 'pick',         start: 0.0, end: 1.0 },
  { phase: 'to-flip-zone', start: 1.0, end: 2.0 },
  { phase: 'flip',         start: 2.0, end: 4.0 },
  { phase: 'to-output',    start: 4.0, end: 5.0 },
  { phase: 'place',        start: 5.0, end: 6.0 },
  { phase: 'return',       start: 6.0, end: 7.0 },
  { phase: 'hold',         start: 7.0, end: 7.5 },
];

export class FlipChipRobot {
  public root: THREE.Group = new THREE.Group();
  public nodes!: FlipChipRobotNodes;
  public mixer?: THREE.AnimationMixer;
  public action?: THREE.AnimationAction;
  /** Every action of the cycle. This asset splits it across 3 clips. */
  public actions: THREE.AnimationAction[] = [];
  public clip?: THREE.AnimationClip;

  private restActuatorQuat = new THREE.Quaternion();
  private restLiftY = 0.25;
  private loaded = false;
  private _onPhaseChange?: (phase: CyclePhase, t: number) => void;
  private lastPhase?: CyclePhase;

  /** Load the GLB. Resolves once nodes and rest poses are captured. */
  async load(url = '/flip_chip_robot_v2.glb', loader = new GLTFLoader()): Promise<this> {
    const gltf: GLTF = await loader.loadAsync(url);
    this.root.name = 'FlipChipRobot';
    this.root.add(gltf.scene);

    const get = <T extends THREE.Object3D>(name: string): T => {
      const o = gltf.scene.getObjectByName(name);
      if (!o) throw new Error(`flip_chip_robot_v2.glb: node "${name}" not found`);
      return o as T;
    };

    this.nodes = {
      root: this.root,
      armature: get('ARMA_Column_Rotation'),
      boneColumnRotate: get<THREE.Bone>('Bone_Column_Rotate'),
      boneArmLift: get<THREE.Bone>('Bone_Arm_Lift'),
      rotaryActuator: get('Rotary_Actuator'),
      endEffectorBody: get('End_Effector_Body'),
      activeChip: get('Active_Chip'),
      statusLED: get<THREE.Mesh>('Status_LED'),
      suctionCups: [0, 1, 2, 3].map(i => get(`Suction_Cup_${i}`)),
    };

    // Rest poses — must be read BEFORE the mixer ever updates.
    this.restActuatorQuat.copy(this.nodes.rotaryActuator.quaternion);   // (0.5, 0.5, 0.5, 0.5)
    this.restLiftY = this.nodes.boneArmLift.position.y;                  // 0.25

    // Skinned meshes: their bounds are computed at rest, so disable culling.
    gltf.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) m.frustumCulled = false;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });

    // ── Animation ──
    // FlipChip_Robotfinal.glb splits the cycle across THREE clips, one per
    // driven target, rather than the single "PickPlace_Cycle" that
    // flip_chip_robot_v2.glb shipped:
    //   PickPlace_Cycle_ARMA_Column_Rotation -> Bone_Column_Rotate + Bone_Arm_Lift
    //   PickPlace_Cycle_Rotary_Actuator      -> the flip
    //   PickPlace_Cycle_Active_Chip          -> chip visibility (scale track)
    // findByName('PickPlace_Cycle') misses all three, so the original fallback
    // to animations[0] would have played the column and lift with NO flip and
    // NO chip. Play every clip belonging to the cycle instead.
    const exact = THREE.AnimationClip.findByName(gltf.animations, CLIP_NAME);
    const cycleClips = exact
      ? [exact]
      : gltf.animations.filter((c) => c.name.startsWith(CLIP_NAME));
    const clips = cycleClips.length > 0 ? cycleClips : gltf.animations.slice(0, 1);

    if (clips.length > 0) {
      this.mixer = new THREE.AnimationMixer(gltf.scene);
      this.actions = clips.map((clip) => {
        const a = this.mixer!.clipAction(clip);
        a.setLoop(THREE.LoopRepeat, Infinity);
        a.clampWhenFinished = true;
        return a;
      });
      // The longest clip is the timing reference for time/phase/seek.
      this.clip = clips.reduce((a, b) => (b.duration > a.duration ? b : a));
      this.action = this.actions[clips.indexOf(this.clip)];
    }

    this.loaded = true;
    return this;
  }

  // ---------------------------------------------------------------- playback

  /** Play the full 7-step cycle (loops by default). */
  play(opts: { loop?: boolean; speed?: number; fromStart?: boolean } = {}) {
    if (this.actions.length === 0) return;
    for (const a of this.actions) {
      a.setLoop(opts.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      a.timeScale = opts.speed ?? 1;
      if (opts.fromStart) a.reset();
      a.paused = false;
      a.play();
    }
  }

  pause() { for (const a of this.actions) a.paused = true; }
  resume() { for (const a of this.actions) a.paused = false; }

  /** Stop the clip and leave the robot at its rest pose. */
  stop() {
    for (const a of this.actions) a.stop();
    this.mixer?.update(0);
    this.setColumnAngle(0); this.setLift(0); this.setFlipAngle(0); this.setChipVisible(false);
  }

  /** Scrub to a time in seconds (0–7.5). Leaves the action paused at that time. */
  seek(seconds: number) {
    if (this.actions.length === 0 || !this.mixer) return;
    const t = THREE.MathUtils.euclideanModulo(seconds, CLIP_DURATION);
    for (const a of this.actions) { a.play(); a.paused = true; a.time = t; }
    this.mixer.update(0);
  }

  /** Jump to the start of a named phase. */
  seekPhase(phase: CyclePhase) {
    const p = PHASES.find(x => x.phase === phase);
    if (p) this.seek(p.start);
  }

  setSpeed(speed: number) { for (const a of this.actions) a.timeScale = speed; }

  get time(): number { return this.action?.time ?? 0; }
  get duration(): number { return CLIP_DURATION; }
  get isPlaying(): boolean { return this.actions.some(a => a.isRunning() && !a.paused); }

  /** Which of the 7 steps the clip is in right now. */
  get phase(): CyclePhase {
    const t = THREE.MathUtils.euclideanModulo(this.time, CLIP_DURATION);
    return (PHASES.find(p => t >= p.start && t < p.end) ?? PHASES[PHASES.length - 1]).phase;
  }

  onPhaseChange(cb: (phase: CyclePhase, t: number) => void) { this._onPhaseChange = cb; }

  /** Call once per frame with the delta in seconds. */
  update(dt: number) {
    if (!this.mixer) return;
    this.mixer.update(dt);
    if (this._onPhaseChange) {
      const p = this.phase;
      if (p !== this.lastPhase) { this.lastPhase = p; this._onPhaseChange(p, this.time); }
    }
  }

  // ------------------------------------------------------- manual control
  // Each of these stops the clip first; the mixer would otherwise overwrite
  // the value on the next update().

  /** Column yaw in degrees. Negative = clockwise seen from above (matches the clip). */
  setColumnAngle(deg: number) {
    for (const a of this.actions) a.stop();
    this.nodes.boneColumnRotate.quaternion.setFromAxisAngle(UP, THREE.MathUtils.degToRad(deg));
  }

  /** Vertical stroke in metres: 0 = up (rest), -LIFT_STROKE = head on the base surface. */
  setLift(offsetMetres: number) {
    for (const a of this.actions) a.stop();
    const o = THREE.MathUtils.clamp(offsetMetres, -LIFT_STROKE, 0);
    this.nodes.boneArmLift.position.y = this.restLiftY + o;
  }

  /** Flip angle in degrees: 0 = chip face up, 90 = vertical, 180 = fully inverted. */
  setFlipAngle(deg: number) {
    for (const a of this.actions) a.stop();
    const q = new THREE.Quaternion().setFromAxisAngle(FLIP_AXIS_LOCAL, THREE.MathUtils.degToRad(deg));
    this.nodes.rotaryActuator.quaternion.copy(this.restActuatorQuat).multiply(q);
  }

  setChipVisible(visible: boolean) {
    for (const a of this.actions) a.stop();
    const s = visible ? 1 : 0;
    this.nodes.activeChip.scale.set(s, s, s);
  }

  /** Status LED colour, e.g. 0x00ff1a (vacuum on) / 0xff2200 (fault). */
  setLED(color: THREE.ColorRepresentation, intensity = 3) {
    const mat = this.nodes.statusLED.material as THREE.MeshStandardMaterial;
    mat.emissive.set(color); mat.emissiveIntensity = intensity;
  }

  /** World-space position of the chip centre (handy for camera targets / labels). */
  getChipWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.nodes.activeChip.getWorldPosition(target);
  }

  dispose() {
    for (const a of this.actions) a.stop();
    this.actions = [];
    this.mixer?.uncacheRoot(this.root);
    this.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach(mat => mat?.dispose());
      }
    });
    this.root.removeFromParent();
    this.loaded = false;
  }
}
