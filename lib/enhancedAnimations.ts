/**
 * enhancedAnimations.ts
 * 
 * Enhanced animation systems for semiconductor fab simulation:
 * 1. Improved Rinse Animation with rotating wafer and water spray
 * 2. Hotplate Heat Shimmer effects
 * 3. Performance-optimized particle systems
 */

import * as THREE from 'three';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. RINSE ANIMATION - Realistic Water Spray Effect
// ═══════════════════════════════════════════════════════════════════════════════

export class RinseAnimator {
  private scene: THREE.Scene;
  private position: THREE.Vector3;
  private active = false;
  
  // Water spray particles
  private sprayParticles: THREE.Points;
  private sprayGeo: THREE.BufferGeometry;
  private sprayPositions: Float32Array;
  private sprayVelocities: { vx: number; vy: number; vz: number; life: number; angle: number }[];
  private particleCount = 150;
  
  // Mist particles (finer spray)
  private mistParticles: THREE.Points;
  private mistGeo: THREE.BufferGeometry;
  private mistPositions: Float32Array;
  private mistVelocities: { vx: number; vy: number; vz: number; life: number }[];
  private mistCount = 80;
  
  // Animation state
  private time = 0;
  
  constructor(scene: THREE.Scene, position: THREE.Vector3) {
    this.scene = scene;
    this.position = position.clone();
    
    // Initialize spray particles
    this.initSprayParticles();
    
    // Initialize mist particles
    this.initMistParticles();
  }
  
  private initSprayParticles() {
    this.sprayPositions = new Float32Array(this.particleCount * 3);
    this.sprayVelocities = [];
    
    const colors = new Float32Array(this.particleCount * 3);
    const baseColor = new THREE.Color(0x66aaff); // Water blue
    
    for (let i = 0; i < this.particleCount; i++) {
      // Start all particles at origin
      this.sprayPositions[i * 3] = this.position.x;
      this.sprayPositions[i * 3 + 1] = this.position.y + 0.6;
      this.sprayPositions[i * 3 + 2] = this.position.z;
      
      // Color with slight variation
      const shade = 0.8 + Math.random() * 0.2;
      colors[i * 3] = baseColor.r * shade;
      colors[i * 3 + 1] = baseColor.g * shade;
      colors[i * 3 + 2] = baseColor.b * shade;
      
      // Circular spray pattern velocities
      const angle = (i / this.particleCount) * Math.PI * 2;
      const radius = 0.15 + Math.random() * 0.25;
      
      this.sprayVelocities.push({
        vx: Math.cos(angle) * radius,
        vy: -1.2 - Math.random() * 0.8, // Downward spray
        vz: Math.sin(angle) * radius,
        life: Math.random(),
        angle: angle
      });
    }
    
    this.sprayGeo = new THREE.BufferGeometry();
    this.sprayGeo.setAttribute('position', new THREE.BufferAttribute(this.sprayPositions, 3));
    this.sprayGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const sprayMat = new THREE.PointsMaterial({
      size: 0.04,
      transparent: true,
      opacity: 0.75,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    
    this.sprayParticles = new THREE.Points(this.sprayGeo, sprayMat);
    this.sprayParticles.visible = false;
    this.scene.add(this.sprayParticles);
  }
  
  private initMistParticles() {
    this.mistPositions = new Float32Array(this.mistCount * 3);
    this.mistVelocities = [];
    
    const colors = new Float32Array(this.mistCount * 3);
    const baseColor = new THREE.Color(0xaaccff); // Lighter mist
    
    for (let i = 0; i < this.mistCount; i++) {
      this.mistPositions[i * 3] = this.position.x;
      this.mistPositions[i * 3 + 1] = this.position.y + 0.4;
      this.mistPositions[i * 3 + 2] = this.position.z;
      
      const shade = 0.6 + Math.random() * 0.4;
      colors[i * 3] = baseColor.r * shade;
      colors[i * 3 + 1] = baseColor.g * shade;
      colors[i * 3 + 2] = baseColor.b * shade;
      
      this.mistVelocities.push({
        vx: (Math.random() - 0.5) * 0.3,
        vy: -0.4 - Math.random() * 0.3,
        vz: (Math.random() - 0.5) * 0.3,
        life: Math.random()
      });
    }
    
    this.mistGeo = new THREE.BufferGeometry();
    this.mistGeo.setAttribute('position', new THREE.BufferAttribute(this.mistPositions, 3));
    this.mistGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const mistMat = new THREE.PointsMaterial({
      size: 0.02,
      transparent: true,
      opacity: 0.5,
      vertexColors: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
    
    this.mistParticles = new THREE.Points(this.mistGeo, mistMat);
    this.mistParticles.visible = false;
    this.scene.add(this.mistParticles);
  }
  
  on() {
    this.active = true;
    this.sprayParticles.visible = true;
    this.mistParticles.visible = true;
    this.time = 0;
  }
  
  off() {
    this.active = false;
    this.sprayParticles.visible = false;
    this.mistParticles.visible = false;
  }
  
  tick(dt: number, speed: number) {
    if (!this.active) return;
    
    this.time += dt * speed;
    
    // Update spray particles (main water streams)
    for (let i = 0; i < this.particleCount; i++) {
      const v = this.sprayVelocities[i];
      v.life += dt * speed * 0.8;
      
      if (v.life > 1.0) {
        // Reset particle to nozzle position
        v.life = 0;
        this.sprayPositions[i * 3] = this.position.x + (Math.random() - 0.5) * 0.15;
        this.sprayPositions[i * 3 + 1] = this.position.y + 0.6;
        this.sprayPositions[i * 3 + 2] = this.position.z + (Math.random() - 0.5) * 0.15;
        
        // Rotating spray pattern
        const angle = v.angle + this.time * 2;
        const radius = 0.15 + Math.random() * 0.25;
        v.vx = Math.cos(angle) * radius;
        v.vz = Math.sin(angle) * radius;
        v.vy = -1.2 - Math.random() * 0.8;
      } else {
        // Move particle
        this.sprayPositions[i * 3] += v.vx * dt * speed;
        this.sprayPositions[i * 3 + 1] += v.vy * dt * speed;
        this.sprayPositions[i * 3 + 2] += v.vz * dt * speed;
        
        // Gravity effect
        v.vy -= 0.5 * dt * speed;
      }
    }
    
    // Update mist particles
    for (let i = 0; i < this.mistCount; i++) {
      const v = this.mistVelocities[i];
      v.life += dt * speed * 0.6;
      
      if (v.life > 1.0) {
        v.life = 0;
        this.mistPositions[i * 3] = this.position.x + (Math.random() - 0.5) * 0.3;
        this.mistPositions[i * 3 + 1] = this.position.y + 0.4;
        this.mistPositions[i * 3 + 2] = this.position.z + (Math.random() - 0.5) * 0.3;
        v.vx = (Math.random() - 0.5) * 0.3;
        v.vy = -0.4 - Math.random() * 0.3;
        v.vz = (Math.random() - 0.5) * 0.3;
      } else {
        this.mistPositions[i * 3] += v.vx * dt * speed;
        this.mistPositions[i * 3 + 1] += v.vy * dt * speed;
        this.mistPositions[i * 3 + 2] += v.vz * dt * speed;
      }
    }
    
    // Mark for GPU update
    this.sprayGeo.attributes.position.needsUpdate = true;
    this.mistGeo.attributes.position.needsUpdate = true;
  }
  
  dispose() {
    this.scene.remove(this.sprayParticles);
    this.scene.remove(this.mistParticles);
    this.sprayGeo.dispose();
    this.mistGeo.dispose();
    (this.sprayParticles.material as THREE.Material).dispose();
    (this.mistParticles.material as THREE.Material).dispose();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. HOTPLATE HEAT SHIMMER EFFECT
// ═══════════════════════════════════════════════════════════════════════════════

export class HeatShimmer {
  private scene: THREE.Scene;
  private position: THREE.Vector3;
  private active = false;
  private fadeActive = false;
  
  // Heat particles
  private heatParticles: THREE.Points;
  private heatGeo: THREE.BufferGeometry;
  private heatPositions: Float32Array;
  private heatVelocities: { vy: number; life: number; ox: number; oz: number }[];
  private particleCount = 60;
  
  // Heat glow light
  private glowLight: THREE.PointLight;
  
  // Animation state
  private time = 0;
  private intensity = 0;
  private targetIntensity = 0;
  
  constructor(scene: THREE.Scene, position: THREE.Vector3, color: number = 0xff4422) {
    this.scene = scene;
    this.position = position.clone();
    
    // Initialize heat particles
    this.initHeatParticles(color);
    
    // Create glow light
    this.glowLight = new THREE.PointLight(color, 0, 3.0);
    this.glowLight.position.copy(this.position);
    this.glowLight.position.y += 0.3;
    this.scene.add(this.glowLight);
  }
  
  private initHeatParticles(color: number) {
    this.heatPositions = new Float32Array(this.particleCount * 3);
    this.heatVelocities = [];
    
    const colors = new Float32Array(this.particleCount * 3);
    const baseColor = new THREE.Color(color);
    
    for (let i = 0; i < this.particleCount; i++) {
      this.heatPositions[i * 3] = this.position.x;
      this.heatPositions[i * 3 + 1] = this.position.y + 0.1;
      this.heatPositions[i * 3 + 2] = this.position.z;
      
      // Heat colors (orange to yellow)
      const shade = 0.7 + Math.random() * 0.3;
      colors[i * 3] = baseColor.r * shade;
      colors[i * 3 + 1] = baseColor.g * shade * 0.8;
      colors[i * 3 + 2] = baseColor.b * shade * 0.3;
      
      // Tight rising pattern
      this.heatVelocities.push({
        vy: 0.3 + Math.random() * 0.4,
        life: Math.random(),
        ox: (Math.random() - 0.5) * 0.15, // Tight spread
        oz: (Math.random() - 0.5) * 0.15
      });
    }
    
    this.heatGeo = new THREE.BufferGeometry();
    this.heatGeo.setAttribute('position', new THREE.BufferAttribute(this.heatPositions, 3));
    this.heatGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const heatMat = new THREE.PointsMaterial({
      size: 0.08,
      transparent: true,
      opacity: 0,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    
    this.heatParticles = new THREE.Points(this.heatGeo, heatMat);
    this.heatParticles.visible = false;
    this.scene.add(this.heatParticles);
  }
  
  on() {
    this.active = true;
    this.fadeActive = true;
    this.targetIntensity = 1.0;
    this.heatParticles.visible = true;
    this.time = 0;
  }
  
  off() {
    this.active = false;
    this.fadeActive = true;
    this.targetIntensity = 0;
  }
  
  tick(dt: number, speed: number) {
    this.time += dt * speed;
    
    // Smooth fade in/out
    if (this.fadeActive) {
      const fadeSpeed = 2.0;
      if (this.intensity < this.targetIntensity) {
        this.intensity = Math.min(this.targetIntensity, this.intensity + dt * speed * fadeSpeed);
      } else {
        this.intensity = Math.max(this.targetIntensity, this.intensity - dt * speed * fadeSpeed);
      }
      
      // Update opacity and light
      const mat = this.heatParticles.material as THREE.PointsMaterial;
      mat.opacity = this.intensity * 0.6;
      this.glowLight.intensity = this.intensity * 1.5;
      
      // Stop fading when target reached
      if (Math.abs(this.intensity - this.targetIntensity) < 0.01) {
        this.fadeActive = false;
        if (this.targetIntensity === 0) {
          this.heatParticles.visible = false;
        }
      }
    }
    
    if (!this.active && !this.fadeActive) return;
    
    // Update heat particles (rising shimmer)
    for (let i = 0; i < this.particleCount; i++) {
      const v = this.heatVelocities[i];
      v.life += dt * speed * 0.5;
      
      if (v.life > 1.0) {
        // Reset to hotplate surface
        v.life = 0;
        this.heatPositions[i * 3] = this.position.x + v.ox;
        this.heatPositions[i * 3 + 1] = this.position.y + 0.1;
        this.heatPositions[i * 3 + 2] = this.position.z + v.oz;
      } else {
        // Rise with slight waver
        const waver = Math.sin(this.time * 3 + i) * 0.02;
        this.heatPositions[i * 3] += waver * dt * speed;
        this.heatPositions[i * 3 + 1] += v.vy * dt * speed;
        this.heatPositions[i * 3 + 2] += waver * dt * speed * 0.7;
      }
    }
    
    this.heatGeo.attributes.position.needsUpdate = true;
    
    // Pulsing glow effect
    const pulse = 0.8 + 0.2 * Math.sin(this.time * 4);
    this.glowLight.intensity = this.intensity * 1.5 * pulse;
  }
  
  dispose() {
    this.scene.remove(this.heatParticles);
    this.scene.remove(this.glowLight);
    this.heatGeo.dispose();
    (this.heatParticles.material as THREE.Material).dispose();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. WAFER ROTATION ANIMATOR (for rinse/spin modules)
// ═══════════════════════════════════════════════════════════════════════════════

export class WaferRotationAnimator {
  private waferGroup: THREE.Group | null = null;
  private active = false;
  private speed = 0;
  private targetSpeed = 0;
  private acceleration = 5.0; // RPM per second^2
  
  setWafer(waferGroup: THREE.Group | null) {
    this.waferGroup = waferGroup;
  }
  
  startRotation(targetRPM: number = 1500) {
    this.active = true;
    // Convert RPM to radians per second
    this.targetSpeed = (targetRPM / 60) * Math.PI * 2;
  }
  
  stopRotation() {
    this.active = false;
    this.targetSpeed = 0;
  }
  
  tick(dt: number, simSpeed: number) {
    if (!this.waferGroup) return;
    
    // Smooth acceleration/deceleration
    if (this.active && this.speed < this.targetSpeed) {
      this.speed = Math.min(this.targetSpeed, this.speed + this.acceleration * dt * simSpeed);
    } else if (!this.active && this.speed > 0) {
      this.speed = Math.max(0, this.speed - this.acceleration * dt * simSpeed);
    }
    
    // Apply rotation
    if (this.speed > 0) {
      this.waferGroup.rotation.y += this.speed * dt * simSpeed;
    }
  }
  
  reset() {
    this.speed = 0;
    this.targetSpeed = 0;
    this.active = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export function createRinseAnimator(scene: THREE.Scene, position: THREE.Vector3): RinseAnimator {
  return new RinseAnimator(scene, position);
}

export function createHeatShimmer(scene: THREE.Scene, position: THREE.Vector3, color?: number): HeatShimmer {
  return new HeatShimmer(scene, position, color);
}

export function createWaferRotationAnimator(): WaferRotationAnimator {
  return new WaferRotationAnimator();
}
