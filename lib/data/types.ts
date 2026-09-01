export interface RecipeStep {
  id: number;
  phase: string;
  title: string;
  sub?: string;
  duration: number;
  parameters: { name: string; target: string; tolerance: string }[];
  description: string;
  sideNote: string;
  topNote: string;
  commentary: string;
}

export interface CauseEffectRow {
  id: number;
  parameter: string;
  processStep: string;
  effects: {
    increase: string;
    decrease: string;
  };
  note: string;
}

export interface OCAPAction {
  text: string;
  status: "resolve" | "partial";
}

export interface OCAPRootCause {
  label: string;
  gaugeValue: number;
  gaugeStatus: "low" | "normal" | "high";
  diagnosisText: string;
  actions: OCAPAction[];
}

export interface OCAPData {
  containment: string;
  verificationText: string;
  rootCauses: OCAPRootCause[];
  validationSteps: string[];
  validationBadge: string;
  releaseText: string;
}

export interface FailureMode {
  id: string;
  name: string;
  severity: number;
  localEffect: string;
  systemEffect: string;
  rtm: {
    sensor: string;
    visualLogicNormal: string;
    visualLogicDrift: string;
    gaugeLogic: string;
  };
  alarm: {
    id: string;
    message: string;
    trigger: string;
    interlock: string;
  };
  troubleshooting: {
    visualInspection: string;
    testToRun: string;
    restoreActions: string;
  };
  spc: {
    metric: string;
    chartBehavior: string;
    rulesTriggered: string;
  };
  ocap: { step: string; action: string }[];
  rcaMapping: { rootCause: string; recoveryAction: string; rationale: string }[];
  interactiveOcap: OCAPData;
}
