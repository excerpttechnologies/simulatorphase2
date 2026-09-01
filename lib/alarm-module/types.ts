export type AlarmType = 'bridging' | 'non-wetting' | 'die-cracking' | 'force-calibration' | 'temp-instability';

export interface AlarmSimConfig {
  type: AlarmType;
  alarmId: string;
  name: string;
  unit: string;
  setpoint: number;
  controlBandPercent: number;
  amberThresholdPercent: number;
  redThresholdPercent: number;
  debounceWindowMs: number;
  spcRuleConsecutivePoints: number;
  validationLotsRequired: number;
}

export const ALARM_SIM_CONFIGS: Record<AlarmType, AlarmSimConfig> = {
  bridging: {
    type: 'bridging',
    alarmId: 'ALM-TCB-1042',
    name: 'Force Overshoot / Squeeze-Out Risk',
    unit: 'N',
    setpoint: 45.0,
    controlBandPercent: 10,
    amberThresholdPercent: 90,
    redThresholdPercent: 110,
    debounceWindowMs: 100,
    spcRuleConsecutivePoints: 7,
    validationLotsRequired: 3,
  },
  'non-wetting': {
    type: 'non-wetting',
    alarmId: 'ALM-TCB-1087',
    name: 'Incomplete Wetting / Low Thermal Budget',
    unit: '°C',
    setpoint: 285,
    controlBandPercent: 10,
    amberThresholdPercent: 90,
    redThresholdPercent: 90,
    debounceWindowMs: 100,
    spcRuleConsecutivePoints: 7,
    validationLotsRequired: 3,
  },
  'die-cracking': {
    type: 'die-cracking',
    alarmId: 'ALM-TCB-1103',
    name: 'Touchdown Impact Force Exceedance',
    unit: 'N',
    setpoint: 2.0,
    controlBandPercent: 10,
    amberThresholdPercent: 90,
    redThresholdPercent: 100,
    debounceWindowMs: 100,
    spcRuleConsecutivePoints: 7,
    validationLotsRequired: 3,
  },
  'force-calibration': {
    type: 'force-calibration',
    alarmId: 'ALM-TCB-1119',
    name: 'Bond Force Deviation / Calibration Drift',
    unit: '%',
    setpoint: 0,
    controlBandPercent: 10,
    amberThresholdPercent: 5,
    redThresholdPercent: 10,
    debounceWindowMs: 100,
    spcRuleConsecutivePoints: 7,
    validationLotsRequired: 3,
  },
  'temp-instability': {
    type: 'temp-instability',
    alarmId: 'ALM-TCB-1134',
    name: 'Bond Head Thermal Gradient Exceedance',
    unit: '°C',
    setpoint: 0,
    controlBandPercent: 100,
    amberThresholdPercent: 80,
    redThresholdPercent: 100,
    debounceWindowMs: 100,
    spcRuleConsecutivePoints: 7,
    validationLotsRequired: 3,
  },
};

export type EquipmentState = 'RUN' | 'HOLD' | 'PAUSE' | 'E-STOP';

export interface AlarmEvent {
  id: string;
  alarmId: string;
  name: string;
  message: string;
  timestamp: Date;
  dieId: string;
  siteId: string;
  recipeId: string;
  measuredValue: number;
  setpoint: number;
  unit: string;
  severity: 'Alarm';
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  equipmentState: EquipmentState;
  checklistStatus: ChecklistItem[];
  notes?: string;
}

export interface ChecklistItem {
  id: string;
  category: 'visual' | 'test' | 'restore';
  title: string;
  description: string;
  completed: boolean;
  completedBy?: string;
  completedAt?: Date;
  notes?: string;
}

export interface ForceTelemetry {
  timestamp: Date;
  position: number;
  force: number;
  phase: 'touchdown' | 'ramp' | 'peak-hold' | 'release';
}

export interface SPCDataPoint {
  id: string;
  timestamp: Date;
  lotId: string;
  dieId: string;
  recipeId: string;
  value: number;
  movingRange?: number;
  defectPpm?: number;
  flagged: boolean;
  flagReason?: string;
}

export interface SPCControlLimits {
  centerline: number;
  ucl: number;
  lcl: number;
  mrCenterline: number;
  mrUcl: number;
}

export type OCAPStage =
  | 'CONTAINMENT'
  | 'METROLOGY_VERIFICATION'
  | 'ROOT_CAUSE_ANALYSIS'
  | 'HARDWARE_RECOVERY'
  | 'DISPOSITION'
  | 'VALIDATION'
  | 'CLOSED';

export interface OCAPCase {
  id: string;
  recipeId: string;
  toolId: string;
  stage: OCAPStage;
  createdAt: Date;
  createdBy: string;
  linkedAlarmIds: string[];
  linkedSpcEventId: string;
  auditTrail: OCAPAuditEntry[];
  containment?: { holdConfirmedAt?: Date; quarantinedLotIds: string[]; suspendedRecipeIds: string[]; };
  metrologyVerification?: { verifiedAt?: Date; verifiedBy?: string; gaugeRR: number; trueProcessShiftConfirmed: boolean; notes?: string; };
  rootCauseAnalysis?: { template: 'five-why' | 'fishbone'; selectedRootCauses: RootCause[]; documentation: string; approvedBy?: string; approvedAt?: Date; };
  hardwareRecovery?: { selectedActions: RecoveryAction[]; completedAt?: Date; completedBy?: string; notes?: string; };
  disposition?: { totalUnits: number; inspectedUnits: number; passedUnits: number; scrappedUnits: number; reworkedUnits: number; completedAt?: Date; };
  validation?: { requiredLots: number; completedLots: string[]; allWithinControlBand: boolean; zeroDefects: boolean; noSpcViolations: boolean; validatedAt?: Date; validatedBy?: string; };
}

export interface OCAPAuditEntry {
  timestamp: Date;
  user: string;
  action: string;
  fromStage?: OCAPStage;
  toStage?: OCAPStage;
  details: string;
}

export type RootCause = string;

export interface RecoveryAction {
  rootCause: RootCause;
  action: string;
  rationale: string;
  isPartialMitigation?: boolean;
}

export type UserRole = 'operator' | 'process-engineer' | 'supervisor' | 'maintenance';

export interface User {
  id: string;
  name: string;
  role: UserRole;
}

export interface Notification {
  id: string;
  type: 'alarm-trip' | 'repeated-trips' | 'spc-violation' | 'rca-overdue' | 'disposition-overdue';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: Date;
  acknowledged: boolean;
  targetRoles: UserRole[];
}
