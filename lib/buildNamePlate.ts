/**
 * buildNamePlate.ts
 *
 * IF (interface) nameplates ONLY — parented to the iface module groups in
 * local space. Regular module plates are handled by addPlinthNameplates.
 *
 * Placement is AUTO-DETECTED from each IF group's bounding box, so the plates
 * always sit on the real faces regardless of plinth/GLB size or position.
 */

import * as THREE from 'three';

interface ProcessStep {
  id: string;
  name: string;
  short: string;
  type: string;
  color: number;
  x: number;
  z: number;
  temp?: number | null;
  time?: number;
}

// ── IF plate FIXED placement (mirrors addPlinthNameplates — flat on the box) ──
const PLINTH_H = 3.2;                          // plinth height (match regular plinths)
const PLINTH_Y0 = -0.5;                        // plinth base Y
const PLATE_LOCAL_Y = PLINTH_Y0 + PLINTH_H * 0.5; // = 1.1, same height as regular plates

// ── Per-IF placement — tune each row independently ──
// iface_out = top row → scanner; iface_in = second/bottom row ← scanner
const IFACE_CFG: Record<string, {
  frontOffset: number; backOffset: number; width: number; height: number;
}> = {
  iface_out: { frontOffset: 1.6, backOffset: 3.1, width: 3.1, height: 1.1 }, // TOP row
  iface_in:  { frontOffset: 3.8, backOffset: 1.1, width: 3.1, height: 0.9 }, // SECOND row ← give it different dims here
};

const IFACE_IDS = new Set(['iface_in', 'iface_out']);

// ── Canvas → metal nameplate texture (same theme as addPlinthNameplates) ─────
function makePlateTexture(mod: ProcessStep): THREE.CanvasTexture {
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
  return tex;
}

function makePlateMesh(mod: ProcessStep, width: number, height: number): THREE.Mesh {
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: makePlateTexture(mod),
      transparent: false,
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    })
  );
  plate.renderOrder = 10;
  plate.userData.__namePlate = true;
  return plate;
}

/**
 * Attach metal nameplates to the IF (interface) module groups ONLY,
 * using fixed offsets that match the regular plinth plates. Idempotent.
 */
export function attachAllNamePlates(
  modObjs: Record<string, THREE.Group>,
  allSteps: ProcessStep[]
): void {
  const byId: Record<string, ProcessStep> = {};
  allSteps.forEach((s) => { byId[s.id] = s; });

  IFACE_IDS.forEach((id) => {
    const grp = modObjs[id];
    const mod = byId[id];
    if (!grp || !mod) return;

    // Remove old plates first (idempotent re-runs for slow GLB loads)
    const stale = grp.children.filter((c) => c.userData?.__namePlate);
    stale.forEach((c) => grp.remove(c));

    // ── FIXED placement, identical math to the regular plinth plates ──
    // Local space; group has no rotation (rotation lives on the GLB root inside),
    // so plates stay flat/upright on the plinth faces and never ride the model.
    const cfg = IFACE_CFG[id] ?? { frontOffset: 3.4, backOffset: 3.7, width: 3.6, height: 1.1 };

    // +Z face — plate faces +Z
    const plusZ = makePlateMesh(mod, cfg.width, cfg.height);
    plusZ.position.set(0, PLATE_LOCAL_Y, cfg.frontOffset);
    plusZ.rotation.set(0, 0, 0);
    grp.add(plusZ);

    // -Z face — plate faces -Z, pushed slightly further out
    const minusZ = makePlateMesh(mod, cfg.width, cfg.height);
    minusZ.position.set(0, PLATE_LOCAL_Y, -cfg.backOffset);
    minusZ.rotation.set(0, Math.PI, 0);
    grp.add(minusZ);

    console.log('[IFACE-PLATE]', id,
      'Y=', PLATE_LOCAL_Y.toFixed(2),
      'frontZ=', cfg.frontOffset.toFixed(2),
      'backZ=', (-cfg.backOffset).toFixed(2),
      'W=', cfg.width.toFixed(2), 'H=', cfg.height.toFixed(2));
  });
}

/** Toggle IF plate visibility. */
export function toggleNamePlates(
  modObjs: Record<string, THREE.Group>,
  visible: boolean
): void {
  IFACE_IDS.forEach((id) => {
    const grp = modObjs[id];
    if (!grp) return;
    grp.traverse((c) => {
      if (c.userData?.__namePlate) c.visible = visible;
    });
  });
}

/** No LEDs on these plates — kept as a no-op for API compatibility. */
export function tickNamePlateLEDs(
  _modObjs: Record<string, THREE.Group>,
  _busy: Record<string, number>,
  _simTime: number
): void {
  // intentionally empty
}