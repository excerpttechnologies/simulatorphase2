import {
  ForceTelemetry,
  SPCDataPoint,
  SPCControlLimits,
  AlarmEvent,
  ChecklistItem,
  AlarmType,
  ALARM_SIM_CONFIGS,
} from './types';

export function generateGoldenForceProfile(alarmType: AlarmType = 'bridging'): ForceTelemetry[] {
  const config = ALARM_SIM_CONFIGS[alarmType];
  const profile: ForceTelemetry[] = [];
  const setpoint = config.setpoint;
  const count = config.unit === 'N' && alarmType === 'bridging' ? 100 : 80;

  for (let i = 0; i < Math.floor(count * 0.2); i++) {
    const t = i / (count * 0.2);
    profile.push({
      timestamp: new Date(Date.now() + i * 10),
      position: t * 0.8,
      force: t * (setpoint * 0.1),
      phase: 'touchdown',
    });
  }
  for (let i = Math.floor(count * 0.2); i < Math.floor(count * 0.5); i++) {
    const t = (i - Math.floor(count * 0.2)) / (count * 0.3);
    profile.push({
      timestamp: new Date(Date.now() + i * 10),
      position: 0.8 + t * 0.5,
      force: setpoint * 0.1 + t * (setpoint * 0.9),
      phase: 'ramp',
    });
  }
  for (let i = Math.floor(count * 0.5); i < count; i++) {
    profile.push({
      timestamp: new Date(Date.now() + i * 10),
      position: 1.3 + (Math.random() - 0.5) * 0.001,
      force: setpoint + (Math.random() - 0.5) * (setpoint * 0.02),
      phase: 'peak-hold',
    });
  }
  return profile;
}

export function generateLiveForceTrace(
  alarmType: AlarmType = 'bridging',
  isDrift: boolean = false
): ForceTelemetry[] {
  const golden = generateGoldenForceProfile(alarmType);
  const config = ALARM_SIM_CONFIGS[alarmType];
  const sp = config.setpoint;
  return golden.map((point, idx) => {
    let force = point.force;
    if (isDrift && point.phase === 'peak-hold') {
      if (alarmType === 'bridging') {
        force += sp * 0.2;
      } else if (alarmType === 'non-wetting') {
        force *= 0.85;
      } else if (alarmType === 'die-cracking') {
        force *= 1.5;
      } else if (alarmType === 'temp-instability') {
        force += (Math.random() > 0.5 ? 1 : -1) * sp * 0.15;
      } else {
        force += (idx % 2 === 0 ? 1 : -1) * sp * 0.12;
      }
    } else {
      force += (Math.random() - 0.5) * (sp * 0.01);
    }
    return { ...point, force, timestamp: new Date(Date.now() + idx * 10) };
  });
}

export function generateSPCData(
  count: number,
  alarmType: AlarmType = 'bridging',
  includeOutOfControl: boolean = false
): SPCDataPoint[] {
  const config = ALARM_SIM_CONFIGS[alarmType];
  const data: SPCDataPoint[] = [];
  const setpoint = config.setpoint;
  const baseTimestamp = Date.now() - count * 3600000;

  for (let i = 0; i < count; i++) {
    let value: number;
    if (alarmType === 'force-calibration') {
      value = (Math.random() - 0.5) * 1.0;
    } else if (alarmType === 'temp-instability') {
      value = (Math.random() - 0.5) * 3.0;
    } else {
      value = setpoint + (Math.random() - 0.5) * (setpoint * 0.04);
    }

    let defectPpm = alarmType === 'bridging' ? 10 + Math.random() * 5 :
                    alarmType === 'non-wetting' ? 8 + Math.random() * 4 :
                    alarmType === 'die-cracking' ? 5 + Math.random() * 3 :
                    alarmType === 'force-calibration' ? 7 + Math.random() * 4 :
                    6 + Math.random() * 3;
    let flagged = false;
    let flagReason: string | undefined;

    if (includeOutOfControl && i >= Math.floor(count * 0.6)) {
      const shift = (i - Math.floor(count * 0.6)) * 0.3;
      if (alarmType === 'bridging' || alarmType === 'die-cracking' || alarmType === 'temp-instability') {
        value += shift;
      } else {
        value -= shift * 0.5;
      }
      defectPpm += shift * 2;
    }

    const movingRange = i > 0 ? Math.abs(value - data[i - 1].value) : 0;

    data.push({
      id: `spc-${i}`,
      timestamp: new Date(baseTimestamp + i * 3600000),
      lotId: `LOT-${Math.floor(i / 5) + 1000}`,
      dieId: `DIE-${i}`,
      recipeId: 'RCP-TCB-001',
      value: parseFloat(value.toFixed(3)),
      movingRange: parseFloat(movingRange.toFixed(3)),
      defectPpm: parseFloat(defectPpm.toFixed(2)),
      flagged,
      flagReason,
    });
  }

  const limits = calculateSPCLimits(data);
  data.forEach((point) => {
    if (point.value > limits.ucl || point.value < limits.lcl) {
      point.flagged = true;
      point.flagReason = point.value > limits.ucl ? 'Rule 1: Point beyond UCL' : 'Rule 1: Point below LCL';
    }
  });

  return data;
}

export function calculateSPCLimits(data: SPCDataPoint[]): SPCControlLimits {
  if (data.length === 0) {
    return {
      centerline: 0, ucl: 3, lcl: -3,
      mrCenterline: 0, mrUcl: 0,
    };
  }
  const centerline = data.reduce((sum, p) => sum + p.value, 0) / data.length;
  const movingRanges = data.slice(1).map((p, idx) => Math.abs(p.value - data[idx].value));
  const mrCenterline = movingRanges.length > 0
    ? movingRanges.reduce((sum, mr) => sum + mr, 0) / movingRanges.length
    : 0;
  const ucl = centerline + 2.66 * mrCenterline;
  const lcl = centerline - 2.66 * mrCenterline;
  const mrUcl = 3.27 * mrCenterline;

  return {
    centerline: parseFloat(centerline.toFixed(3)),
    ucl: parseFloat(ucl.toFixed(3)),
    lcl: parseFloat(lcl.toFixed(3)),
    mrCenterline: parseFloat(mrCenterline.toFixed(3)),
    mrUcl: parseFloat(mrUcl.toFixed(3)),
  };
}

export function generateAlarmChecklist(alarmType: AlarmType = 'bridging'): ChecklistItem[] {
  const checklists: Record<AlarmType, ChecklistItem[]> = {
    bridging: [
      { id: 'v1', category: 'visual', title: 'AOI Check', description: 'AOI check of last known-good and suspect die for visible solder bridging between adjacent bumps', completed: false },
      { id: 'v2', category: 'visual', title: 'Thermode Contact Face', description: 'Check thermode contact face for debris/non-planarity', completed: false },
      { id: 'v3', category: 'visual', title: 'Load Cell Calibration', description: 'Verify load cell calibration due-date sticker', completed: false },
      { id: 't1', category: 'test', title: 'Force Calibration Verification', description: 'Force-calibration verification against certified reference load cell', completed: false },
      { id: 't2', category: 'test', title: 'Golden Sample Bond Cycle', description: 'Golden-sample bond cycle vs. qualified reference force-displacement curve', completed: false },
      { id: 't3', category: 'test', title: 'C-SAT Inspection', description: 'C-SAT on flagged unit(s) for bridging detection', completed: false },
      { id: 'r1', category: 'restore', title: 'Recalibrate Load Cell', description: 'Recalibrate Z-axis load cell/force actuator per PM procedure', completed: false },
      { id: 'r2', category: 'restore', title: 'Inspect Force Regulator', description: 'Inspect/replace worn pneumatic or servo force-regulator components', completed: false },
      { id: 'r3', category: 'restore', title: 'Verify Parallelism', description: 'Verify bond-head parallelism/coplanarity', completed: false },
      { id: 'r4', category: 'restore', title: 'Re-qualify Profile', description: 'Re-qualify force-temperature profile before returning tool to production', completed: false },
    ],
    'non-wetting': [
      { id: 'v1', category: 'visual', title: 'C-SAT for Voiding', description: 'C-SAT for voiding/delamination/unwetted bumps', completed: false },
      { id: 'v2', category: 'visual', title: 'Check Heater Elements', description: 'Check thermode heater elements/thermocouples for degradation/drift', completed: false },
      { id: 'v3', category: 'visual', title: 'Surface Contamination', description: 'Inspect for surface oxide/contamination on bumps and pads', completed: false },
      { id: 't1', category: 'test', title: 'Thermal Profile Verification', description: 'Thermal-profile verification via calibrated surface thermocouple or thermal test die', completed: false },
      { id: 't2', category: 'test', title: 'Golden Sample Cross-Section', description: 'Golden-sample cycle cross-sectioned/C-SAT to confirm IMC formation', completed: false },
      { id: 'r1', category: 'restore', title: 'Recalibrate Thermode Profile', description: 'Recalibrate thermode heater profile/thermocouples per PM', completed: false },
      { id: 'r2', category: 'restore', title: 'Replace Heater Cartridges', description: 'Replace degraded heater cartridges', completed: false },
      { id: 'r3', category: 'restore', title: 'Verify Flux Delivery', description: 'Verify flux/reducing-atmosphere delivery', completed: false },
    ],
    'die-cracking': [
      { id: 'v1', category: 'visual', title: 'High-Mag Microscope', description: 'High-mag microscope or C-SAT for cracks/chips/sub-surface cratering', completed: false },
      { id: 'v2', category: 'visual', title: 'Check Warpage', description: 'Check substrate/carrier for warpage', completed: false },
      { id: 'v3', category: 'visual', title: 'Verify Parallelism', description: 'Verify bond-head parallelism unchanged', completed: false },
      { id: 't1', category: 'test', title: 'Velocity Profile Verification', description: 'Z-axis velocity-profile verification via built-in motion diagnostics', completed: false },
      { id: 't2', category: 'test', title: 'Golden Sample Touchdown', description: 'Golden-sample touchdown cycle vs. qualified soft-touch reference curve', completed: false },
      { id: 'r1', category: 'restore', title: 'Re-validate Velocity Profile', description: 'Recalibrate Z-axis load cell and re-validate multi-stage velocity profile', completed: false },
      { id: 'r2', category: 'restore', title: 'Correct Warpage', description: 'Inspect/correct substrate/carrier flatness', completed: false },
    ],
    'force-calibration': [
      { id: 'v1', category: 'visual', title: 'Check Die Cracking', description: 'Check for die cracking (overshoot case) or incomplete bump compression (droop case)', completed: false },
      { id: 'v2', category: 'visual', title: 'Check Z-Axis Slide', description: 'Check Z-axis slide mechanism for debris/binding/lubrication', completed: false },
      { id: 'v3', category: 'visual', title: 'Review Self-Test Log', description: 'Review load cell self-test fault log', completed: false },
      { id: 't1', category: 'test', title: 'Calibration vs Reference', description: 'Calibration check against external certified reference load cell across full force range', completed: false },
      { id: 't2', category: 'test', title: 'Dynamic Tare Calibration', description: 'Run automated dynamic tare-calibration and compare pre/post', completed: false },
      { id: 'r1', category: 'restore', title: 'Recalibrate Load Cell', description: 'Recalibrate load cell against external reference', completed: false },
      { id: 'r2', category: 'restore', title: 'Lubricate Z-Axis Slide', description: 'Clean/re-lubricate Z-axis slide mechanism', completed: false },
      { id: 'r3', category: 'restore', title: 'Replace Regulator', description: 'Inspect/replace worn pneumatic or servo force-regulator components', completed: false },
    ],
    'temp-instability': [
      { id: 'v1', category: 'visual', title: 'C-SAT/AOI Check', description: 'C-SAT or AOI for localized non-wetting/uneven bump deformation/die warpage', completed: false },
      { id: 'v2', category: 'visual', title: 'Review IR History', description: 'Review IR thermal map history to identify drifting zone(s)', completed: false },
      { id: 'v3', category: 'visual', title: 'Check Heater/TC', description: 'Check affected heater cartridge/thermocouple for degradation/loose contact', completed: false },
      { id: 't1', category: 'test', title: 'Thermode Profile Verification', description: 'Thermode profile verification with calibrated surface thermocouples across die footprint vs. PID setpoint', completed: false },
      { id: 't2', category: 'test', title: 'IR Camera Calibration', description: 'Re-run IR camera calibration vs. blackbody reference', completed: false },
      { id: 'r1', category: 'restore', title: 'Recalibrate Profiles', description: 'Recalibrate thermode temperature profiles per PM using calibrated surface thermocouples', completed: false },
      { id: 'r2', category: 'restore', title: 'Replace Heater/TC', description: 'Replace degraded heater cartridges or drifted thermocouples in affected zone(s)', completed: false },
      { id: 'r3', category: 'restore', title: 'Restore TIM', description: 'Restore thermal contact (clean/reapply TIM)', completed: false },
    ],
  };
  return checklists[alarmType] || checklists.bridging;
}

export function generateMockAlarmEvent(alarmType: AlarmType = 'bridging'): AlarmEvent {
  const config = ALARM_SIM_CONFIGS[alarmType];
  return {
    id: `alarm-${Date.now()}`,
    alarmId: config.alarmId,
    name: config.name,
    message: config.alarmId === 'ALM-TCB-1042'
      ? 'BOND FORCE EXCEEDS UPPER CONTROL LIMIT – Possible Solder Squeeze-Out / Bump Bridging Risk.'
      : config.alarmId === 'ALM-TCB-1087'
      ? 'BOND TEMPERATURE OR DWELL TIME BELOW LOWER CONTROL LIMIT – Possible Non-Wetting / Open Circuit Risk.'
      : config.alarmId === 'ALM-TCB-1103'
      ? 'TOUCHDOWN IMPACT FORCE EXCEEDS UPPER LIMIT – Possible Die Cracking / Sub-Surface Fracture Risk.'
      : config.alarmId === 'ALM-TCB-1119'
      ? 'BOND FORCE DEVIATES FROM SETPOINT – Possible Load Cell Calibration Shift or Actuator Fault.'
      : 'DIE SURFACE TEMPERATURE GRADIENT EXCEEDS ±5°C – Possible Localized Non-Wetting / Uneven Bump Deformation Risk.',
    timestamp: new Date(),
    dieId: `D-${Math.floor(Math.random() * 9000) + 1000}`,
    siteId: `S${Math.floor(Math.random() * 4) + 1}`,
    recipeId: 'RCP-TCB-001',
    measuredValue: config.setpoint * (config.redThresholdPercent / 100) * (1 + Math.random() * 0.05),
    setpoint: config.setpoint,
    unit: config.unit,
    severity: 'Alarm',
    acknowledged: false,
    equipmentState: 'PAUSE',
    checklistStatus: generateAlarmChecklist(alarmType),
  };
}

export function getAlarmMessageType(alarmType: AlarmType): string {
  const messages: Record<AlarmType, string> = {
    bridging: 'BOND FORCE EXCEEDS UPPER CONTROL LIMIT – Possible Solder Squeeze-Out / Bump Bridging Risk.',
    'non-wetting': 'BOND TEMPERATURE OR DWELL TIME BELOW LOWER CONTROL LIMIT – Possible Non-Wetting / Open Circuit Risk.',
    'die-cracking': 'TOUCHDOWN IMPACT FORCE EXCEEDS UPPER LIMIT – Possible Die Cracking / Sub-Surface Fracture Risk.',
    'force-calibration': 'BOND FORCE DEVIATES FROM SETPOINT – Possible Load Cell Calibration Shift or Actuator Fault.',
    'temp-instability': 'DIE SURFACE TEMPERATURE GRADIENT EXCEEDS ±5°C – Possible Localized Non-Wetting / Uneven Bump Deformation Risk.',
  };
  return messages[alarmType];
}
