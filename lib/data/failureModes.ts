import { FailureMode, OCAPData } from './types';

export const FAILURE_MODES: FailureMode[] = [
  {
    id: "bridging",
    name: "Micro-Bump Bridging & Electrical Shorts",
    severity: 10,
    localEffect: "Excessive Solder Squeeze-Out Across Adjacent Pillars",
    systemEffect: "Electrical Short Circuits / Bump Bridging",
    rtm: {
      sensor: "In-situ bond-head force-displacement load cell (Z-axis), paired with the multi-zone closed-loop thermode thermocouple array.",
      visualLogicNormal: "Real-time force-vs-position trace overlaid on the qualified 'golden' force-displacement reference envelope. Normal: trace tracks within the upper/lower control band through touchdown, force ramp, and peak-reflow hold (45.0 N ± 10% setpoint band).",
      visualLogicDrift: "Drift Event: trace deviates above the upper control band, or shows a step-change in slope during peak reflow — force exceeding the solder/pillar compression limit, squeeze-out risk.",
      gaugeLogic: "Digital bond-force gauge with peak-hold readout + bond-head Z-position gauge. Logic: amber at 90% of qualified max (~40.5 N), red/alarm at ≥110% of setpoint (~49.5 N); peak force auto-logs each cycle"
    },
    alarm: {
      id: "ALM-TCB-1042",
      message: "BOND FORCE EXCEEDS UPPER CONTROL LIMIT – Possible Solder Squeeze-Out / Bump Bridging Risk.",
      trigger: "Real-time force feedback exceeds the recipe's upper control limit (>110% of the 45.0 N setpoint) during peak-reflow dwell, sustained beyond the debounce window (typically >100 ms).",
      interlock: "Bond cycle automatically holds/aborts; head blocked from advancing to Release & Retract; equipment enters PAUSE and won't index to next site until acknowledged. Repeated consecutive trips escalate to E-stop."
    },
    troubleshooting: {
      visualInspection: "AOI for visible solder bridging on last known-good/suspect die; check thermode contact face for debris/non-planarity; confirm load-cell calibration due-date.",
      testToRun: "Force-calibration verification against certified reference; golden-sample bond cycle vs. qualified reference profile; C-SAT on flagged units.",
      restoreActions: "Recalibrate Z-axis load cell/force actuator per PM; inspect/replace worn pneumatic or servo force-regulator components; verify bond-head parallelism/coplanarity; re-qualify force-temperature profile before returning to production."
    },
    spc: {
      metric: "Peak bond force (N) per die (I-MR chart); secondary: post-bond bump-bridging defect rate (ppm) from AOI/electrical test.",
      chartBehavior: "Sustained upward shift toward UCL across consecutive lots, or step-change increase following a PM/calibration event; correlates with rising AOI-flagged bridging defects / downstream electrical open-short failures.",
      rulesTriggered: "Nelson Rule 1 (point beyond 3σ/UCL) and/or Rule 2 (≥7–9 consecutive points trending one side of centerline)."
    },
    ocap: [
      { step: "Containment", action: "HOLD the bonder; quarantine all die/lots since last in-control sample; suspend starts on affected recipe." },
      { step: "Metrology Verification", action: "Verify force actuator/load cell against independent calibrated reference; confirm gauge R&R; re-measure to rule out measurement error." },
      { step: "Root Cause Analysis", action: "Structured 5-Why/fishbone covering force-actuator calibration drift, pneumatic/servo regulator wear, incoming solder-volume/pillar-height variation, thermode temperature contribution; documented and approved before restart." },
      { step: "Hardware Recovery", action: "Recalibrate/replace Z-axis load cell and force regulator; clean/inspect bond-head slide mechanism; verify bond-head parallelism; reload/re-validate qualified force-temperature profile." },
      { step: "Disposition", action: "100% AOI and electrical (continuity/isolation) test on all quarantined die; scrap or rework any confirmed bridging; release only lots verified free of shorts (Severity-10, no rework path once bridged)." },
      { step: "Validation", action: "Run 3–5 consecutive verification lots at corrected setpoint/calibration; success = force trends within qualified band, zero AOI-flagged bridging." }
    ],
    rcaMapping: [
      {
        rootCause: "Force-actuator calibration drift",
        recoveryAction: "Recalibrate or replace the Z-axis load cell and force regulator",
        rationale: "Directly resets a drifted sensor/actuator against a known reference"
      },
      {
        rootCause: "Pneumatic or servo regulator wear",
        recoveryAction: "Recalibrate/replace load cell and regulator; clean/inspect bond-head slide mechanism",
        rationale: "Worn regulator + slide friction both degrade force accuracy; both actions jointly restore it"
      },
      {
        rootCause: "Incoming solder-volume/pillar-height variation",
        recoveryAction: "Verify bond-head parallelism (partial mitigation only)",
        rationale: "Material/incoming-inspection root cause, not equipment fault — parallelism only ensures uniform force application given the variation; true fix is tighter incoming inspection/vendor spec, outside this scope"
      },
      {
        rootCause: "Thermode temperature contribution to solder flow",
        recoveryAction: "Reload and re-validate the qualified force-temperature recipe profile",
        rationale: "Corrects thermal contribution to excess solder flow/squeeze-out"
      }
    ],
    interactiveOcap: {
      containment: "Perform Tool LOTO (Lock Out Tag Out); Hold lot, Strip & rework wafers. Suspend affected recipe starts; quarantine all die/lots since last in-control sample.",
      verificationText: "Perform wafer visual inspection and re-measure wafer Thickness uniformity. Result: Same as 1st measurement; Troubleshoot tool. Confirm force actuator/load cell against independent calibrated reference; gauge R&R verified.",
      rootCauses: [
        {
          label: "Force-actuator calibration drift",
          gaugeValue: 52.3,
          gaugeStatus: "high",
          diagnosisText: "Force-actuator calibration drift — load cell reading has drifted above calibrated reference",
          actions: [
            { text: "RECALIBRATE Z-AXIS LOAD CELL", status: "resolve" },
            { text: "REPLACE FORCE REGULATOR", status: "resolve" }
          ]
        },
        {
          label: "Pneumatic or servo regulator wear",
          gaugeValue: 49.8,
          gaugeStatus: "high",
          diagnosisText: "Pneumatic or servo regulator wear — worn regulator + slide friction degrade force accuracy",
          actions: [
            { text: "RECALIBRATE/REPLACE LOAD CELL AND REGULATOR", status: "resolve" },
            { text: "CLEAN/INSPECT BOND-HEAD SLIDE MECHANISM", status: "resolve" }
          ]
        },
        {
          label: "Incoming solder-volume variation",
          gaugeValue: 46.1,
          gaugeStatus: "normal",
          diagnosisText: "Incoming solder-volume/pillar-height variation — material root cause, not equipment fault",
          actions: [
            { text: "VERIFY BOND-HEAD PARALLELISM [PARTIAL MITIGATION ONLY]", status: "partial" }
          ]
        },
        {
          label: "Thermode temperature contribution",
          gaugeValue: 47.5,
          gaugeStatus: "normal",
          diagnosisText: "Thermode temperature contribution to solder flow — thermal profile needs re-validation",
          actions: [
            { text: "RELOAD AND RE-VALIDATE FORCE-TEMPERATURE RECIPE PROFILE", status: "resolve" }
          ]
        }
      ],
      validationSteps: [
        "Run 3 wafer thickness checks at corrected setpoint/calibration",
        "Verify wafer thickness uniformity returns to baseline (<1% variation)",
        "Confirm zero AOI-flagged bridging across all verification lots"
      ],
      validationBadge: "THICKNESS UNIFORMITY RETURNS TO <1% — SYSTEM STATUS: GREEN",
      releaseText: "Release tool for production; Record OCAP data base; Update PM schedule if drift was hardware-related."
    }
  },
  {
    id: "non-wetting",
    name: "Non-Wetting & Open Circuit Defects",
    severity: 10,
    localEffect: "Incomplete Intermetallic Compound (IMC) Formation / Unwetted Bumps",
    systemEffect: "Open Circuits / High Electrical Resistance / Joint Delamination",
    rtm: {
      sensor: "Closed-loop bond-head thermocouple array (multi-zone PID) paired with a substrate-side stage RTD (temperature sensor mounted on/near the substrate heating stage, feeding the temperature control system); wetting outcome verified post-bond via C-SAT.",
      visualLogicNormal: "Bond-head temperature trace overlaid on the golden thermal ramp profile (ramp rate, peak temperature, dwell). Normal: peak reaches qualified reflow setpoint (e.g., 285°C ±10°C) and holds full dwell before cooldown.",
      visualLogicDrift: "Drift Event: trace falls below the lower control band on peak temp, or dwell is cut short — insufficient thermal budget for full melt/IMC formation.",
      gaugeLogic: "Digital peak-temperature and dwell-time gauge + thermode zone-uniformity indicator (max inter-zone ΔT). Logic: amber if peak temp is 90–95% of qualified minimum or dwell is 90–95% of minimum; red/alarm below 90% of either."
    },
    alarm: {
      id: "ALM-TCB-1087",
      message: "BOND TEMPERATURE OR DWELL TIME BELOW LOWER CONTROL LIMIT – Possible Non-Wetting / Open Circuit Risk.",
      trigger: "Bond-head or stage temperature feedback falls below the recipe's minimum peak-temperature or dwell-time limit during reflow, or inter-zone gradient across the die exceeds ±5°C.",
      interlock: "Cycle auto-holds/flags die as suspect; blocked from advancing without a quality hold tag; escalates to PAUSE on repeated consecutive alarms."
    },
    troubleshooting: {
      visualInspection: "C-SAT for voiding/delamination/unwetted bumps; check thermode heater elements/thermocouples for degradation/drift; inspect for surface oxide/contamination on bump/pad.",
      testToRun: "Thermal-profile verification via calibrated surface thermocouple or thermal test die; golden-sample cycle + cross-section or C-SAT to confirm IMC formation.",
      restoreActions: "Recalibrate thermode heater profile/thermocouples per PM; replace degraded heater cartridges; verify flux/reducing-atmosphere delivery; re-qualify thermal profile."
    },
    spc: {
      metric: "Peak bond-head temperature and dwell time per die (I-MR chart); secondary: post-bond non-wetting/open defect rate (ppm) from C-SAT or electrical test.",
      chartBehavior: "Sustained downward shift toward LCL, or step-change decrease following a PM/heater-replacement event; correlates with rising C-SAT-flagged unwetted/voided joints and electrical opens/high-resistance failures.",
      rulesTriggered: "Nelson Rule 1 and/or Rule 2."
    },
    ocap: [
      { step: "Containment", action: "HOLD the bonder; quarantine all die/lots since last in-control sample; suspend starts on affected recipe." },
      { step: "Metrology Verification", action: "Verify thermode thermocouples/stage RTD against independent reference." },
      { step: "Root Cause Analysis", action: "5-Why covering low peak temp, insufficient dwell, surface oxide contamination, local thermal gradient." },
      { step: "Hardware Recovery", action: "Recalibrate thermal stage/bond-head heater profiles; verify flux/reducing-atmosphere delivery matches qualified metallurgy; replace degraded heater elements/thermocouples." },
      { step: "Disposition", action: "100% C-SAT and electrical continuity/resistance test; scrap/rework confirmed unwetted/open units; release only fully-wetted lots — Severity-10, no rework path." },
      { step: "Validation", action: "3–5 verification lots at corrected profile; success = temp/dwell within band, zero C-SAT-flagged non-wetting." }
    ],
    rcaMapping: [
      {
        rootCause: "Low peak temperature",
        recoveryAction: "Recalibrate thermal stage/bond-head heater profiles; replace degraded heater elements or thermocouples",
        rationale: "Points to a mis-calibrated setpoint or degraded heater/thermocouple — both resolved by recalibration + replacement"
      },
      {
        rootCause: "Insufficient dwell time",
        recoveryAction: "Recalibrate the thermal stage and bond-head heater profiles",
        rationale: "Dwell time is a programmed parameter within the thermal profile; re-establishing the qualified profile corrects it"
      },
      {
        rootCause: "Surface oxide contamination on bumps/pads",
        recoveryAction: "Verify flux or reducing-atmosphere delivery matches the qualified bump metallurgy and process flow",
        rationale: "Only action targeting the wetting chemistry itself, not thermal recalibration"
      },
      {
        rootCause: "Local thermal gradient across the die",
        recoveryAction: "Recalibrate heater profiles; replace degraded heater elements or thermocouples",
        rationale: "Gradient stems from uneven zone output or a drifted thermocouple; recalibration + swap restores uniform heating"
      }
    ],
    interactiveOcap: {
      containment: "Perform Tool LOTO (Lock Out Tag Out); Hold lot, Strip & rework wafers. Suspend affected recipe starts; quarantine all die/lots since last in-control sample.",
      verificationText: "Perform C-SAT inspection and re-measure bond temperature uniformity. Result: Same as 1st measurement; Troubleshoot tool. Verify thermode thermocouples/stage RTD against independent reference.",
      rootCauses: [
        {
          label: "Low peak temperature",
          gaugeValue: 252.0,
          gaugeStatus: "low",
          diagnosisText: "Low peak temperature — mis-calibrated setpoint or degraded heater/thermocouple",
          actions: [
            { text: "RECALIBRATE THERMAL STAGE/BOND-HEAD HEATER PROFILES", status: "resolve" },
            { text: "REPLACE DEGRADED HEATER ELEMENTS OR THERMOCOUPLES", status: "resolve" }
          ]
        },
        {
          label: "Insufficient dwell time",
          gaugeValue: 268.0,
          gaugeStatus: "low",
          diagnosisText: "Insufficient dwell time — programmed parameter within the thermal profile is short",
          actions: [
            { text: "RECALIBRATE THERMAL STAGE AND BOND-HEAD HEATER PROFILES", status: "resolve" }
          ]
        },
        {
          label: "Surface oxide contamination",
          gaugeValue: 280.0,
          gaugeStatus: "normal",
          diagnosisText: "Surface oxide contamination on bumps/pads — wetting chemistry issue, not thermal",
          actions: [
            { text: "VERIFY FLUX/REDUCING-ATMOSPHERE DELIVERY [PARTIAL MITIGATION ONLY]", status: "partial" }
          ]
        },
        {
          label: "Local thermal gradient across die",
          gaugeValue: 271.0,
          gaugeStatus: "low",
          diagnosisText: "Local thermal gradient across die — uneven zone output or drifted thermocouple",
          actions: [
            { text: "RECALIBRATE HEATER PROFILES", status: "resolve" },
            { text: "REPLACE DEGRADED HEATER ELEMENTS OR THERMOCOUPLES", status: "resolve" }
          ]
        }
      ],
      validationSteps: [
        "Run 3 C-SAT verification lots at corrected profile",
        "Verify bond temperature/dwell time returns to within band",
        "Confirm zero C-SAT-flagged non-wetting across all verification lots"
      ],
      validationBadge: "TEMPERATURE/DWELL WITHIN BAND — SYSTEM STATUS: GREEN",
      releaseText: "Release tool for production; Record OCAP data base; Update thermal profile qualification records."
    }
  },
  {
    id: "die-cracking",
    name: "Die Cracking & Sub-Surface Fracture",
    severity: 10,
    localEffect: "High Impact Mechanical Stress on Active Silicon",
    systemEffect: "Die Cracking / Low-k Dielectric Sub-Surface Cratering",
    rtm: {
      sensor: "Bond-head Z-axis load cell with high-speed sampling, paired with the programmable multi-stage Z-velocity profile controller for the touchdown approach.",
      visualLogicNormal: "Force-vs-Z-position trace overlaid on the qualified 'golden' soft-touch landing profile (velocity staging + impact-force envelope). Normal: smooth staged velocity decay, peak touchdown force within the qualified impact-force band (e.g., ≤2.0 N initial contact) before ramping to bond force.",
      visualLogicDrift: "Drift Event: sharp force spike at touchdown exceeding the limit, or a velocity profile that skips a deceleration stage.",
      gaugeLogic: "Digital peak touchdown-force gauge with high-speed capture + Z-axis velocity-profile display. Logic: amber at 90% of qualified max touchdown-force limit, red/alarm at ≥100%."
    },
    alarm: {
      id: "ALM-TCB-1103",
      message: "TOUCHDOWN IMPACT FORCE EXCEEDS UPPER LIMIT – Possible Die Cracking / Sub-Surface Fracture Risk.",
      trigger: "Peak touchdown force above the qualified impact-force limit during Z-Touchdown & Force Application, or the multi-stage velocity profile deviates from its qualified deceleration schedule.",
      interlock: "Cycle auto-holds; head retracts, die flagged for inspection hold; site blocked from advancing to bond force ramp/reflow; escalates to PAUSE on repeated alarms."
    },
    troubleshooting: {
      visualInspection: "High-mag microscope or C-SAT for cracks/chips/sub-surface cratering in low-k dielectric; check substrate/carrier for warpage; verify bond-head parallelism hasn't shifted.",
      testToRun: "Z-axis velocity-profile verification via built-in motion diagnostics; golden-sample touchdown cycle vs. qualified soft-touch reference; C-SAT/cross-section to confirm crack depth.",
      restoreActions: "Recalibrate Z-axis load cell and re-validate multi-stage velocity profile; verify bond-head parallelism across full die area; inspect/correct substrate/carrier flatness; re-qualify soft-touch landing profile."
    },
    spc: {
      metric: "Peak touchdown impact force per die (I-MR chart); secondary: post-bond die-crack/sub-surface fracture rate (ppm) from C-SAT or visual/AOI.",
      chartBehavior: "Sustained upward shift toward UCL, or step-change increase following a PM or velocity-profile change; correlates with rising C-SAT-flagged cracking/cratering and die-level electrical/visual rejects.",
      rulesTriggered: "Nelson Rule 1 and/or Rule 2."
    },
    ocap: [
      { step: "Containment", action: "HOLD the bonder; quarantine all die/lots since last in-control sample; suspend starts." },
      { step: "Metrology Verification", action: "Z-axis load cell vs. independent reference." },
      { step: "Root Cause Analysis", action: "5-Why covering excessive touchdown velocity, high initial impact force, warped substrate/die carrier." },
      { step: "Hardware Recovery", action: "Soft-touch landing routines with additional velocity-staging steps; optimize bond-head parallelism; inspect/correct substrate/carrier warpage." },
      { step: "Disposition", action: "100% C-SAT and visual/AOI inspection; scrap/rework confirmed cracking/cratering; release only structurally-intact lots — Severity-10, no rework path." },
      { step: "Validation", action: "3–5 verification lots at corrected velocity/parallelism; success = force within band, zero C-SAT-flagged cracking." }
    ],
    rcaMapping: [
      {
        rootCause: "Excessive touchdown velocity",
        recoveryAction: "Implement/re-tune soft-touch landing routines with additional velocity-staging steps",
        rationale: "Direct 1:1 — added staging caps final-approach contact speed"
      },
      {
        rootCause: "High initial impact force",
        recoveryAction: "Soft-touch velocity-staging steps; optimize bond-head parallelism for uniform load distribution",
        rationale: "Impact force driven both by speed and by how evenly it lands — an unparallel head concentrates impact on one edge"
      },
      {
        rootCause: "Warped substrate/die carrier",
        recoveryAction: "Inspect and correct substrate/carrier warpage",
        rationale: "Direct 1:1 — targets the incoming part-flatness issue itself"
      }
    ],
    interactiveOcap: {
      containment: "Perform Tool LOTO (Lock Out Tag Out); Hold lot, Strip & rework wafers. Suspend affected recipe starts; quarantine all die/lots since last in-control sample.",
      verificationText: "Perform high-mag microscope inspection for cracks/chips. Result: Same as 1st measurement; Troubleshoot tool. Verify Z-axis load cell vs. independent reference.",
      rootCauses: [
        {
          label: "Excessive touchdown velocity",
          gaugeValue: 2.8,
          gaugeStatus: "high",
          diagnosisText: "Excessive touchdown velocity — final-approach contact speed exceeds qualified limit",
          actions: [
            { text: "IMPLEMENT/RE-TUNE SOFT-TOUCH LANDING ROUTINES", status: "resolve" },
            { text: "ADD VELOCITY-STAGING STEPS", status: "resolve" }
          ]
        },
        {
          label: "High initial impact force",
          gaugeValue: 2.5,
          gaugeStatus: "high",
          diagnosisText: "High initial impact force — unparallel head concentrates impact on one edge",
          actions: [
            { text: "SOFT-TOUCH VELOCITY-STAGING STEPS", status: "resolve" },
            { text: "OPTIMIZE BOND-HEAD PARALLELISM [PARTIAL MITIGATION ONLY]", status: "partial" }
          ]
        },
        {
          label: "Warped substrate/die carrier",
          gaugeValue: 2.1,
          gaugeStatus: "normal",
          diagnosisText: "Warped substrate/die carrier — incoming part-flatness issue",
          actions: [
            { text: "INSPECT AND CORRECT SUBSTRATE/CARRIER WARPAGE", status: "resolve" }
          ]
        }
      ],
      validationSteps: [
        "Run 3 C-SAT verification lots at corrected velocity/parallelism",
        "Verify touchdown impact force returns to within qualified band",
        "Confirm zero C-SAT-flagged cracking across all verification lots"
      ],
      validationBadge: "IMPACT FORCE WITHIN BAND, ZERO CRACKING — SYSTEM STATUS: GREEN",
      releaseText: "Release tool for production; Record OCAP data base; Update velocity profile qualification records."
    }
  },
  {
    id: "force-calibration",
    name: "Bond Force Calibration Error",
    severity: 10,
    localEffect: "Bond Force Overshoot or Droop",
    systemEffect: "Die Cracking or Incomplete Bump Compression / Opens",
    rtm: {
      sensor: "Z-axis load cell with automated dynamic tare calibration, continuously cross-checked by the load cell's built-in diagnostic self-test routine.",
      visualLogicNormal: "Commanded-force vs. measured-force trace overlaid on the qualified reference response curve across the full force ramp and hold. Normal: measured tracks commanded within tolerance (e.g., ±2% of setpoint) through ramp, peak hold, and release, no persistent offset (droop) or overshoot.",
      visualLogicDrift: "Drift Event: measured force diverges from commanded — overshoot on ramp-up or droop during hold — indicating the load cell reading or actuator response no longer matches calibration.",
      gaugeLogic: "Digital force-error gauge (commanded vs. measured, N and %) + load cell self-test status indicator. Logic: amber when force error exceeds ±5% of setpoint; red/alarm when >±10% or self-test reports a fault."
    },
    alarm: {
      id: "ALM-TCB-1119",
      message: "BOND FORCE DEVIATES FROM SETPOINT – Possible Load Cell Calibration Shift or Actuator Fault.",
      trigger: "Measured force exceeds ±10% of commanded setpoint during ramp or hold, or the load cell's automated self-test/tare-calibration check fails.",
      interlock: "Cycle auto-holds/aborts before peak reflow; further bonding blocked until load cell passes re-calibration/self-test; escalates to PAUSE requiring operator acknowledgment and maintenance sign-off."
    },
    troubleshooting: {
      visualInspection: "Check for die cracking (overshoot case) or incomplete bump compression/opens (droop case); check Z-axis slide mechanism for debris/binding/lack of lubrication; review load cell self-test log.",
      testToRun: "Calibration check against external certified reference load cell across full production force range; run automated dynamic tare-calibration and compare pre/post; manually cycle Z-axis slide to check friction/binding.",
      restoreActions: "Recalibrate load cell against external reference; clean/re-lubricate Z-axis slide; inspect/replace worn pneumatic or servo force-regulator components; re-verify force response curve."
    },
    spc: {
      metric: "Force-error (commanded vs. measured, N and %) per die (I-MR chart); secondary: post-bond die-crack rate and incomplete-compression/open defect rate (ppm) from AOI/electrical test.",
      chartBehavior: "Sustained drift away from zero (toward overshoot or droop), or step-change following a PM/load-cell-swap/slide-service event; correlates with rising die-cracking (if overshoot) or incomplete-compression/open defects (if droop).",
      rulesTriggered: "Nelson Rule 1 and/or Rule 2 (relative to a zero-error centerline)."
    },
    ocap: [
      { step: "Containment", action: "HOLD the bonder; quarantine all die/lots since last in-control sample; suspend starts." },
      { step: "Metrology Verification", action: "Z-axis load cell vs. independent external reference across full force range." },
      { step: "Root Cause Analysis", action: "5-Why covering load-cell calibration shift, mechanical slide friction, pneumatic/servo regulator wear." },
      { step: "Hardware Recovery", action: "Routine calibration checks with external reference; clean/lubricate Z-axis slide; inspect/replace worn regulator components." },
      { step: "Disposition", action: "100% AOI/electrical continuity-isolation test and visual crack inspection; scrap confirmed cracking/incomplete-compression/opens; release only lots within force-compression spec — Severity-10." },
      { step: "Validation", action: "3–5 verification lots at recalibrated force response; success = ±2% band, zero confirmed cracking/opens." }
    ],
    rcaMapping: [
      {
        rootCause: "Load cell calibration shift",
        recoveryAction: "Execute routine calibration checks using an external reference load cell",
        rationale: "Recalibrating against an independent standard corrects a drifted reading"
      },
      {
        rootCause: "Mechanical slide friction",
        recoveryAction: "Clean and lubricate the Z-axis slide mechanism",
        rationale: "Removes the friction source causing force droop / inconsistent response"
      },
      {
        rootCause: "Pneumatic/servo regulator wear",
        recoveryAction: "Inspect and replace worn pneumatic or servo regulator components as needed",
        rationale: "Worn components are the actuator-side cause of overshoot/droop; replacement restores consistent delivery"
      }
    ],
    interactiveOcap: {
      containment: "Perform Tool LOTO (Lock Out Tag Out); Hold lot, Strip & rework wafers. Suspend affected recipe starts; quarantine all die/lots since last in-control sample.",
      verificationText: "Perform calibration check against external certified reference load cell. Result: Same as 1st measurement; Troubleshoot tool. Verify Z-axis load cell vs. independent external reference across full force range.",
      rootCauses: [
        {
          label: "Load cell calibration shift",
          gaugeValue: 12.4,
          gaugeStatus: "high",
          diagnosisText: "Load cell calibration shift — drifted reading no longer matches independent reference",
          actions: [
            { text: "EXECUTE ROUTINE CALIBRATION CHECKS USING EXTERNAL REFERENCE", status: "resolve" }
          ]
        },
        {
          label: "Mechanical slide friction",
          gaugeValue: 8.7,
          gaugeStatus: "high",
          diagnosisText: "Mechanical slide friction — debris/binding in Z-axis slide causing force droop",
          actions: [
            { text: "CLEAN AND LUBRICATE Z-AXIS SLIDE MECHANISM", status: "resolve" }
          ]
        },
        {
          label: "Pneumatic/servo regulator wear",
          gaugeValue: 11.2,
          gaugeStatus: "high",
          diagnosisText: "Pneumatic/servo regulator wear — worn actuator components cause overshoot/droop",
          actions: [
            { text: "INSPECT AND REPLACE WORN REGULATOR COMPONENTS", status: "resolve" }
          ]
        }
      ],
      validationSteps: [
        "Run 3 verification lots at recalibrated force response",
        "Verify force deviation returns to within ±2% band",
        "Confirm zero confirmed cracking/opens across all verification lots"
      ],
      validationBadge: "FORCE DEVIATION WITHIN ±2% — SYSTEM STATUS: GREEN",
      releaseText: "Release tool for production; Record OCAP data base; Update load cell calibration schedule."
    }
  },
  {
    id: "temp-instability",
    name: "Bond Head Temperature Instability",
    severity: 9,
    localEffect: "Temperature Gradient Across Die Surface (>±5°C)",
    systemEffect: "Localized Non-Wetting / Uneven Bump Deformation / Die Warpage",
    rtm: {
      sensor: "Multi-zone closed-loop PID thermocouple array embedded in the thermode heater block, cross-verified by an inline infrared (IR) thermal camera imaging the full die surface.",
      visualLogicNormal: "Real-time thermal map (IR image) of the die surface overlaid on the golden zone-uniformity profile, showing per-zone temperature and resulting inter-zone ΔT. Normal: all zones track their PID setpoints, IR map shows uniform die-surface temperature with gradient within band (≤±5°C across the die).",
      visualLogicDrift: "Drift Event: one or more zones deviate from setpoint, or the IR map shows a localized hot/cold region — gradient exceeding ±5°C.",
      gaugeLogic: "Per-zone digital temperature gauges + die-surface ΔT (max–min) readout from the IR map. Logic: amber when any zone deviates ±3–5°C from setpoint or ΔT reaches 80–90% of the ±5°C limit; red/alarm when a zone deviates beyond qualified tolerance or ΔT exceeds ±5°C."
    },
    alarm: {
      id: "ALM-TCB-1134",
      message: "DIE SURFACE TEMPERATURE GRADIENT EXCEEDS ±5°C – Possible Localized Non-Wetting / Uneven Bump Deformation Risk.",
      trigger: "IR thermal map or per-zone thermocouple feedback shows inter-zone ΔT exceeding ±5°C, or an individual PID zone deviates from setpoint beyond qualified tolerance during the bond cycle.",
      interlock: "Cycle auto-holds/flags die as suspect; affected zone's die sites blocked from advancing to reflow without a quality hold tag; escalates to PAUSE if the gradient persists across consecutive cycles."
    },
    troubleshooting: {
      visualInspection: "C-SAT or AOI for localized non-wetting/uneven bump deformation/die warpage; review IR thermal map history to identify drifting zone(s); check affected heater cartridge/thermocouple for degradation or loose contact.",
      testToRun: "Thermode profile verification with calibrated surface thermocouples across the die footprint vs. PID setpoint; re-run IR camera calibration against a blackbody reference; inspect thermal contact (grease/interface) between heater block and bond head.",
      restoreActions: "Recalibrate thermode temperature profiles per PM using calibrated surface thermocouples; replace degraded heater cartridges or drifted thermocouples in the affected zone(s); restore thermal contact (clean/reapply thermal interface material); re-qualify the zone-uniformity profile."
    },
    spc: {
      metric: "Maximum inter-zone temperature gradient (ΔT, °C) across the die per bond cycle (I-MR chart); secondary: localized non-wetting/die-warpage defect rate (ppm) from C-SAT or AOI.",
      chartBehavior: "Sustained upward shift toward the UCL (±5°C), or step-change following a heater-cartridge or thermocouple service event; correlates with rising C-SAT/AOI-flagged localized non-wetting, uneven bump deformation, or die-warpage defects.",
      rulesTriggered: "Nelson Rule 1 and/or Rule 2."
    },
    ocap: [
      { step: "Containment", action: "HOLD the bonder; quarantine all die/lots since last in-control sample; suspend starts." },
      { step: "Metrology Verification", action: "Affected zone's thermocouple + IR camera vs. independent calibrated reference / blackbody source." },
      { step: "Root Cause Analysis", action: "5-Why covering heater cartridge degradation and thermocouple drift." },
      { step: "Hardware Recovery", action: "Recalibrate thermode profiles weekly using calibrated surface thermocouples; replace heater elements during PM." },
      { step: "Disposition", action: "100% C-SAT/AOI inspection; scrap confirmed non-wetting/deformation/warpage; release only lots within qualified ΔT band — Severity-9, no reliable rework path." },
      { step: "Validation", action: "3–5 verification lots at recalibrated profile; success = ΔT within ±5°C band, zero flagged defects." }
    ],
    rcaMapping: [
      {
        rootCause: "Heater cartridge degradation",
        recoveryAction: "Replace heater elements during PM",
        rationale: "A degraded cartridge is corrected by physical replacement, not recalibration"
      },
      {
        rootCause: "Thermocouple drift",
        recoveryAction: "Recalibrate thermode temperature profiles weekly using calibrated surface thermocouples",
        rationale: "Recalibrating against an independent reference corrects a drifted in-situ sensor reading"
      }
    ],
    interactiveOcap: {
      containment: "Perform Tool LOTO (Lock Out Tag Out); Hold lot, Strip & rework wafers. Suspend affected recipe starts; quarantine all die/lots since last in-control sample.",
      verificationText: "Perform IR camera calibration check against blackbody reference. Result: Same as 1st measurement; Troubleshoot tool. Verify affected zone thermocouple + IR camera vs. independent calibrated reference.",
      rootCauses: [
        {
          label: "Heater cartridge degradation",
          gaugeValue: 7.2,
          gaugeStatus: "high",
          diagnosisText: "Heater cartridge degradation — degraded cartridge cannot maintain zone setpoint",
          actions: [
            { text: "REPLACE HEATER ELEMENTS DURING PM", status: "resolve" }
          ]
        },
        {
          label: "Thermocouple drift",
          gaugeValue: 6.1,
          gaugeStatus: "high",
          diagnosisText: "Thermocouple drift — in-situ sensor reading no longer matches independent reference",
          actions: [
            { text: "RECALIBRATE THERMODE TEMPERATURE PROFILES WEEKLY", status: "resolve" },
            { text: "REPLACE DRIFTED THERMOCOUPLES IN AFFECTED ZONE(S)", status: "resolve" }
          ]
        }
      ],
      validationSteps: [
        "Run 3 verification lots at recalibrated profile",
        "Verify temperature gradient returns to within ±5°C band",
        "Confirm zero flagged non-wetting/deformation defects across all verification lots"
      ],
      validationBadge: "TEMPERATURE GRADIENT WITHIN ±5°C — SYSTEM STATUS: GREEN",
      releaseText: "Release tool for production; Record OCAP data base; Update heater cartridge PM schedule."
    }
  }
];
