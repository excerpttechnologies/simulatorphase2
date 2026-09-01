'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from "next/navigation";

// =============================================
// TYPES
// =============================================
interface AlarmData {
    id: string;
    name: string;
    level: 'critical' | 'warning' | 'info';
    time: string;
    params: Record<string, string>;
}
interface GaugeData {
    label: string;
    value: string;
    status: 'ok' | 'warn' | 'danger';
}
interface TroubleshootStep {
    icon: string;
    title: string;
    description: string;
    action: string;
    alertMessage: string;
}
interface RestoreAction {
    name: string;
    alertMessage: string;
    primary: boolean;
}
interface OcapFlowStep {
    title: string;
    desc: string;
    btnLabel: string;
    btnClass: string;
    alertMsg: string;
}
interface FailureMode {
    id: string;
    name: string;
    severity: string;
    fmeaScore: string;
    lotId: string;
    recipe: string;
    keyInfo: string;
    sensor: string;
    visualLogic: string;
    normalCondition: string;
    driftEvent: string;
    rtmLabel: string;
    rtmTarget: number;
    rtmUcl: number;
    rtmLcl: number;
    rtmData: number[];
    rtmUnit: string;
    spcLabel: string;
    spcSecondaryLabel: string;
    spcData: number[];
    spcRulesTriggered: string[];
    gauges: GaugeData[];
    alarms: AlarmData[];
    troubleshootingSteps: TroubleshootStep[];
    restoreActions: RestoreAction[];
    ocapFlow: OcapFlowStep[];
}

type TabType = 'rtmspc' | 'troubleshooting' | 'ocap';

type RootCauseKey =
    | 'force_actuator_drift'
    | 'regulator_wear'
    | 'solder_volume_variation'
    | 'thermode_temp_contribution'
    | 'low_peak_temperature'
    | 'insufficient_dwell_time'
    | 'surface_oxide_contamination'
    | 'local_thermal_gradient'
    | 'excessive_touchdown_velocity'
    | 'high_initial_impact_force'
    | 'warped_substrate_carrier'
    | 'misaligned_thermode_profile';

interface RootCauseOption {
    key: RootCauseKey;
    label: string;
    actions: string[];
    partialMitigation?: boolean;
}

interface RcaRow {
    id: number;
    rootCause: string;
    action: string;
    rationale: string;
}

const BOND_FORCE_RCA: RcaRow[] = [
    {
        id: 1,
        rootCause: 'Load cell calibration shift',
        action: 'Execute routine calibration checks using an external reference load cell',
        rationale: 'Recalibrating against an independent reference standard corrects a load cell that has drifted from its true force reading',
    },
    {
        id: 2,
        rootCause: 'Mechanical slide friction',
        action: 'Clean and lubricate the Z-axis slide mechanism',
        rationale: 'Cleaning and re-lubricating removes the friction source that causes force droop or an inconsistent force response as the head travels',
    },
    {
        id: 3,
        rootCause: 'Pneumatic/servo regulator wear',
        action: 'Inspect and replace worn pneumatic or servo regulator components as needed',
        rationale: 'Worn regulator components are the actuator-side cause of force overshoot/droop, and replacement directly restores consistent force delivery',
    },
];

const ROOT_CAUSE_ACTIONS: RootCauseOption[] = [
    {
        key: 'force_actuator_drift',
        label: 'Force-actuator calibration drift',
        actions: ['Recalibrate Z-Axis Load Cell', 'Replace Force Regulator'],
    },
    {
        key: 'regulator_wear',
        label: 'Pneumatic or servo regulator wear',
        actions: ['Recalibrate Z-Axis Load Cell', 'Replace Force Regulator'],
    },
    {
        key: 'solder_volume_variation',
        label: 'Incoming solder-volume variation',
        actions: ['Verify Bond-Head Parallelism'],
        partialMitigation: true,
    },
    {
        key: 'thermode_temp_contribution',
        label: 'Thermode temperature contribution',
        actions: ['Re-Validate Force-Temp Profile'],
    },
];

const THERMAL_ROOT_CAUSE_ACTIONS: RootCauseOption[] = [
    {
        key: 'low_peak_temperature',
        label: 'Low peak temperature',
        actions: ['Recalibrate Thermal Stage and Bond-Head Heater Profiles', 'Replace Degraded Heater Elements or Thermocouples'],
    },
    {
        key: 'insufficient_dwell_time',
        label: 'Insufficient dwell time',
        actions: ['Recalibrate Thermal Stage and Bond-Head Heater Profiles'],
    },
    {
        key: 'surface_oxide_contamination',
        label: 'Surface oxide contamination on bumps/pads',
        actions: ['Verify Flux or Reducing-Atmosphere Delivery Matches Process Flow'],
    },
    {
        key: 'local_thermal_gradient',
        label: 'Local thermal gradient across the die',
        actions: ['Recalibrate Multi-Zone Profile', 'Replace Degraded Heater Elements'],
    },
];

const DIE_CRACKING_ROOT_CAUSE_ACTIONS: RootCauseOption[] = [
    {
        key: 'excessive_touchdown_velocity',
        label: 'Excessive touchdown velocity',
        actions: ['Implement or Re-Tune Soft-Touch Landing Routines with Additional Velocity-Staging Steps'],
    },
    {
        key: 'high_initial_impact_force',
        label: 'High initial impact force',
        actions: ['Implement or Re-Tune Soft-Touch Landing Routines', 'Optimize Bond-Head Parallelism'],
    },
    {
        key: 'warped_substrate_carrier',
        label: 'Warped substrate/die carrier',
        actions: ['Inspect and Correct Substrate/Carrier Warpage'],
    },
    {
        key: 'misaligned_thermode_profile',
        label: 'Misaligned thermode thermal profile',
        actions: ['N/A - Not a Relevant RCA for Die Cracking'],
    },
];

// =============================================
// DATA — extracted from Flip_Chip_Bonder.pptx (Slide 7 "Alarms Module" + FMEA table
// on Slide 8 + the 5 detailed failure-mode breakdowns on Slides 9–13)
// =============================================
const FM_DATA: FailureMode[] = [
    {
        id: "FM-001",
        name: "Micro-Bump Bridging & Electrical Shorts",
        severity: "CRITICAL",
        fmeaScore: "10/10 (Severity)",
        lotId: "FCB-2026-1042",
        recipe: "TCB_CuPillar_45N_285C",
        sensor: "In-situ bond-head force-displacement load cell (Z-axis), paired with the multi-zone closed-loop thermode thermocouple array.",
        visualLogic: "Real-time force-vs-position trace overlaid on the qualified \"golden\" force-displacement reference envelope for the active recipe.",
        normalCondition: "Trace tracks within the control band of the golden curve through touchdown, force ramp, and peak-reflow hold — 45.0 N ±10% setpoint band.",
        driftEvent: "Trace deviates above the upper control band, or shows a step-change in slope during peak reflow — force output is exceeding the solder/pillar compression limit and squeeze-out risk.",
        keyInfo: `
    <strong>Micro-Bump Bridging &amp; Electrical Shorts</strong> occurs when bond force overshoots the qualified compression limit during peak-reflow hold. Excessive Solder Squeeze-Out across adjacent Cu pillars bridges neighboring bumps together.
    <br/><br/>
    <strong>Local Effect:</strong> Excessive solder squeeze-out across adjacent pillars at fine pitch.
    <br/><br/>
    <strong>System Effect:</strong> Electrical short circuits / bump bridging — a Severity-10 failure with no rework path once solder has bridged adjacent pillars.
    `,
        rtmLabel: "BOND FORCE (N) — Z-AXIS LOAD CELL",
        rtmUnit: "N",
        rtmTarget: 45.0, rtmUcl: 49.5, rtmLcl: 40.5,
        rtmData: [44.8, 45.0, 44.9, 45.1, 45.0, 44.9, 45.2, 45.6, 46.3, 47.1, 47.9, 48.5, 49.0, 49.6, 50.1, 50.4, 50.6, 50.8],
        spcLabel: "PEAK BOND FORCE (N) PER DIE — I-MR CHART",
        spcSecondaryLabel: "Post-Bond Bump-Bridging Defect Rate (ppm, AOI / Electrical Test)",
        spcData: [2, 2, 3, 2, 3, 4, 6, 10, 18, 30, 48, 65, 80, 95, 105, 112, 118, 120],
        spcRulesTriggered: [
            "Western Electric / Nelson Rule 1 — single point beyond the 3σ Upper Control Limit",
            "Rule 2 — ≥7–9 consecutive points trending on one side of the centerline",
        ],
        gauges: [
            { label: "Peak Bond Force (Hold)", value: "50.8 N (setpoint 45.0 N)", status: "danger" },
            { label: "Bond-Head Z-Position", value: "Within travel spec", status: "ok" },
            { label: "Force vs. Golden Envelope", value: "ABOVE UPPER CONTROL BAND", status: "danger" },
        ],
        alarms: [
            { id: "ALM-TCB-1042", name: "BOND FORCE EXCEEDS UPPER CONTROL LIMIT", level: "critical", time: "10:14:22", params: { "Trigger": ">110% of 45.0 N setpoint (>49.5 N)", "Sustained": ">100 ms debounce", "Phase": "Peak-reflow dwell", "Interlock": "Cycle hold / abort", "Lot": "FCB-2026-1042" } },
            { id: "ALM-TCB-1043", name: "REPEATED FORCE TRIP — E-STOP ESCALATION", level: "warning", time: "10:14:41", params: { "Consecutive Trips": "3", "Action": "Equipment E-stop" } },
        ],
        troubleshootingSteps: [
            { icon: "🔍", title: "AOI Visual Inspection", description: "Inspect the last known-good and suspect die via AOI for visible solder bridging between adjacent bumps; check thermode contact face for debris or non-planarity.", action: "RUN AOI INSPECTION", alertMessage: "AOI confirms solder bridging between adjacent bumps at fine-pitch sites. Thermode contact face clear — no debris." },
            { icon: "⚖️", title: "Force-Calibration Verification", description: "Run a force-calibration verification against a certified reference load cell / gauge block.", action: "RUN CALIBRATION CHECK", alertMessage: "Load cell reads 50.8 N against a certified 45.0 N reference — calibration drift confirmed (+12.9%)." },
            { icon: "🧬", title: "Golden-Sample Bond Cycle + C-SAT", description: "Execute a golden-sample bond cycle, compare the force-displacement curve to the qualified reference, and run C-SAT on flagged units.", action: "RUN GOLDEN-SAMPLE CYCLE", alertMessage: "Force-displacement curve diverges from golden envelope above 42 N. C-SAT confirms bridging on 3 of 5 sampled bumps." },
        ],
        restoreActions: [
            { name: "Recalibrate / Replace Z-Axis Load Cell & Force Regulator", alertMessage: "Recalibrating Z-axis load cell against external reference — force actuator response restored to setpoint.", primary: true },
            { name: "Clean & Inspect Bond-Head Slide Mechanism", alertMessage: "Inspecting pneumatic/servo force-regulator components — worn regulator seal replaced.", primary: false },
            { name: "Reload & Re-Validate Force-Temperature Profile", alertMessage: "Re-qualifying force-temperature profile and verifying bond-head parallelism / coplanarity before release.", primary: false },
        ],
        ocapFlow: [
            { title: "CONTAINMENT", desc: "Immediately place the bonder in HOLD; quarantine all die/lots bonded since the last in-control SPC sample point.", btnLabel: "HOLD BONDER — QUARANTINE LOT", btnClass: "", alertMsg: "Bonder placed in HOLD. All die bonded since last in-control sample quarantined." },
            { title: "METROLOGY VERIFICATION", desc: "Verify the force actuator / load cell against an independent, calibrated reference gauge; confirm gauge R&R before declaring a true process shift.", btnLabel: "VERIFY LOAD CELL VS REFERENCE", btnClass: "", alertMsg: "Independent reference gauge confirms true force overshoot — not a measurement-system error." },
            { title: "ROOT CAUSE ANALYSIS", desc: "Complete a structured RCA (5-Why / fishbone) covering force-actuator calibration drift, regulator wear, incoming solder-volume/pillar-height variation, and thermode contribution.", btnLabel: "FLAG RCA — FORCE ACTUATOR DRIFT", btnClass: "rca", alertMsg: "RCA Confirmed: Force-actuator calibration drift is the primary root cause." },
            { title: "HARDWARE RECOVERY", desc: "Recalibrate/replace the Z-axis load cell and force regulator; clean and inspect the bond-head slide mechanism; verify parallelism.", btnLabel: "RECALIBRATE LOAD CELL + REGULATOR", btnClass: "recovery", alertMsg: "Load cell recalibrated. Force regulator replaced. Bond-head parallelism verified." },
            { title: "DISPOSITION", desc: "100% AOI and electrical (continuity/isolation) test on all quarantined die; scrap or rework any unit with confirmed bump bridging.", btnLabel: "100% AOI + ELECTRICAL TEST", btnClass: "disposition", alertMsg: "100% inspection complete — confirmed-bridged units scrapped. Remaining lot verified short-free." },
            { title: "VALIDATION", desc: "Run 3–5 consecutive verification lots at the corrected force setpoint, confirming the SPC chart returns to and holds within control limits.", btnLabel: "RUN VERIFICATION LOTS", btnClass: "", alertMsg: "Validation complete: Peak bond force = 45.1 N, zero bridging defects → Tool status GREEN." },
        ],
    },
    {
        id: "FM-002",
        name: "Non-Wetting & Open Circuit Defects",
        severity: "CRITICAL",
        fmeaScore: "10/10 (Severity)",
        lotId: "FCB-2026-1087",
        recipe: "TCB_CuPillar_285C_Dwell1.5s",
        sensor: "Closed-loop bond-head thermocouple array (multi-zone PID) paired with a substrate-side stage RTD; wetting outcome verified post-bond via C-SAT.",
        visualLogic: "Real-time bond-head temperature trace overlaid on the qualified \"golden\" thermal ramp profile (ramp rate, peak temperature, dwell-time envelope).",
        normalCondition: "Trace tracks within the control band — peak temperature reaches the qualified reflow setpoint (285°C ±10°C) and holds for the full programmed dwell time before cooldown.",
        driftEvent: "Trace falls below the lower control band on peak temperature, or dwell time is cut short — insufficient thermal budget to fully melt the solder and form IMC at every bump.",
        keyInfo: `
    <strong>Non-Wetting &amp; Open Circuit Defects</strong> occur when peak reflow temperature or dwell time falls below the qualified thermal budget. Incomplete Intermetallic Compound (IMC) formation leaves bumps unwetted.
    <br/><br/>
    <strong>Local Effect:</strong> Incomplete IMC formation / unwetted bumps.
    <br/><br/>
    <strong>System Effect:</strong> Open circuits / high electrical resistance / joint delamination — Severity-10, no reliable rework path once IMC formation has failed.
    `,
        rtmLabel: "PEAK BOND-HEAD TEMPERATURE (°C)",
        rtmUnit: "°C",
        rtmTarget: 285, rtmUcl: 295, rtmLcl: 275,
        rtmData: [285.0, 284.8, 285.1, 284.9, 284.5, 284.0, 283.2, 282.0, 280.5, 278.8, 277.0, 275.5, 274.0, 272.8, 271.5, 270.9, 270.2, 269.8],
        spcLabel: "PEAK BOND-HEAD TEMPERATURE / DWELL TIME PER DIE — I-MR CHART",
        spcSecondaryLabel: "Post-Bond Non-Wetting / Open Defect Rate (ppm, C-SAT / Electrical Test)",
        spcData: [1, 1, 2, 1, 2, 3, 5, 9, 15, 24, 35, 45, 55, 62, 68, 72, 75, 78],
        spcRulesTriggered: [
            "Western Electric / Nelson Rule 1 — single point beyond the 3σ Lower Control Limit",
            "Rule 2 — ≥7–9 consecutive points trending on one side of the centerline",
        ],
        gauges: [
            { label: "Peak Temperature", value: "269.8°C (min spec 275°C)", status: "danger" },
            { label: "Dwell Time", value: "1.2 s (min spec 1.5 s)", status: "danger" },
            { label: "Inter-Zone Uniformity", value: "ΔT within ±5°C", status: "ok" },
        ],
        alarms: [
            { id: "ALM-TCB-1087", name: "BOND TEMPERATURE / DWELL TIME BELOW LOWER CONTROL LIMIT", level: "critical", time: "08:41:09", params: { "Trigger": "Peak temp or dwell time below recipe min limit", "Actual Peak": "269.8°C", "Setpoint": "285°C ±10°C", "Phase": "Reflow", "Lot": "FCB-2026-1087" } },
            { id: "ALM-TCB-1088", name: "INTER-ZONE THERMAL GRADIENT WATCH", level: "warning", time: "08:41:15", params: { "ΔT": "4.1°C", "Limit": "±5°C" } },
        ],
        troubleshootingSteps: [
            { icon: "🔬", title: "C-SAT Visual Inspection", description: "Inspect the last known-good and suspect die via C-SAT for voiding, delamination, or unwetted bump indications.", action: "RUN C-SAT SCAN", alertMessage: "C-SAT shows unwetted bump indications and voiding at multiple sites — incomplete IMC formation confirmed." },
            { icon: "🌡️", title: "Thermal-Profile Verification", description: "Run a thermal-profile verification using a calibrated surface thermocouple or thermal test die to confirm actual peak temperature and dwell time at the bond interface.", action: "RUN THERMAL PROFILE TEST", alertMessage: "Calibrated reference thermocouple confirms peak temperature reaches only 270°C — 15°C below setpoint." },
            { icon: "🧪", title: "Golden-Sample Cycle + Cross-Section", description: "Execute a golden-sample bond cycle and cross-section or C-SAT the result to confirm full IMC formation.", action: "RUN GOLDEN-SAMPLE CYCLE", alertMessage: "Cross-section confirms partial IMC formation only — consistent with low thermal budget." },
        ],
        restoreActions: [
            { name: "Recalibrate Thermode Heater Profile & Thermocouples", alertMessage: "Recalibrating thermode heater profile and thermocouples per PM procedure — peak temperature returning to 285°C.", primary: true },
            { name: "Replace Degraded Heater Cartridges", alertMessage: "Replacing degraded heater cartridge in affected zone.", primary: false },
            { name: "Verify Flux / Reducing-Atmosphere Delivery", alertMessage: "Verifying flux / reducing-atmosphere delivery matches qualified bump metallurgy — within spec.", primary: false },
        ],
        ocapFlow: [
            { title: "CONTAINMENT", desc: "Immediately place the bonder in HOLD; quarantine all die/lots bonded since the last in-control SPC sample point.", btnLabel: "HOLD BONDER — QUARANTINE LOT", btnClass: "", alertMsg: "Bonder placed in HOLD. Die since last in-control sample quarantined." },
            { title: "METROLOGY VERIFICATION", desc: "Verify the thermode thermocouples and stage RTD against an independent, calibrated reference thermocouple; confirm gauge R&R.", btnLabel: "VERIFY THERMOCOUPLES VS REFERENCE", btnClass: "", alertMsg: "Independent reference thermocouple confirms true thermal drift — not a measurement-system error." },
            { title: "ROOT CAUSE ANALYSIS", desc: "Complete a structured RCA covering low peak temperature, insufficient dwell time, surface oxide contamination, and local thermal gradient.", btnLabel: "FLAG RCA — LOW THERMAL BUDGET", btnClass: "rca", alertMsg: "RCA Confirmed: Degraded heater cartridge driving low peak temperature and short dwell time." },
            { title: "HARDWARE RECOVERY", desc: "Recalibrate the thermal stage and bond-head heater profiles; verify flux/reducing-atmosphere delivery; replace degraded heater elements or thermocouples.", btnLabel: "RECALIBRATE HEATER PROFILE", btnClass: "recovery", alertMsg: "Heater profile recalibrated. Degraded heater cartridge replaced. Flux delivery verified." },
            { title: "DISPOSITION", desc: "100% C-SAT and electrical (continuity/resistance) test on all quarantined die; scrap or rework any unit with confirmed unwetted bumps or open joints.", btnLabel: "100% C-SAT + ELECTRICAL TEST", btnClass: "disposition", alertMsg: "100% inspection complete — confirmed unwetted units scrapped. Remaining lot verified fully wetted." },
            { title: "VALIDATION", desc: "Run 3–5 consecutive verification lots at the corrected thermal profile, confirming SPC returns to and holds within control limits.", btnLabel: "RUN VERIFICATION LOTS", btnClass: "", alertMsg: "Validation complete: Peak temp = 285.2°C, zero non-wetting defects → Tool status GREEN." },
        ],
    },
    {
        id: "FM-003",
        name: "Die Cracking & Sub-Surface Fracture",
        severity: "CRITICAL",
        fmeaScore: "10/10 (Severity)",
        lotId: "FCB-2026-1103",
        recipe: "TCB_SoftTouch_ZVelStaged",
        sensor: "Bond-head Z-axis load cell with high-speed sampling, paired with the programmable multi-stage Z-velocity profile controller for the touchdown approach.",
        visualLogic: "Real-time force-vs-Z-position trace overlaid on the qualified \"golden\" soft-touch landing profile (velocity staging and impact-force envelope).",
        normalCondition: "Smooth, staged velocity decay through the final approach with peak touchdown force landing within the qualified impact-force band (≤2.0 N initial contact) before ramping to bond force.",
        driftEvent: "Sharp force spike at touchdown exceeding the qualified impact-force limit, or a velocity profile that skips a deceleration stage — excessive impact energy transferred into the die.",
        keyInfo: `
    <strong>Die Cracking &amp; Sub-Surface Fracture</strong> occurs when touchdown impact force exceeds the qualified soft-touch landing envelope. High Impact Mechanical Stress is transferred onto the active silicon at the moment of contact.
    <br/><br/>
    <strong>Local Effect:</strong> High impact mechanical stress on active silicon.
    <br/><br/>
    <strong>System Effect:</strong> Die cracking / low-k dielectric sub-surface cratering — Severity-10, no rework path once a crack or sub-surface fracture has occurred.
    `,
        rtmLabel: "TOUCHDOWN IMPACT FORCE (N)",
        rtmUnit: "N",
        rtmTarget: 1.0, rtmUcl: 2.0, rtmLcl: 0.3,
        rtmData: [1.0, 1.0, 1.1, 0.9, 1.0, 1.2, 1.4, 1.6, 1.8, 2.1, 2.4, 2.6, 2.3, 2.5, 2.7, 2.4, 2.6, 2.8],
        spcLabel: "PEAK TOUCHDOWN IMPACT FORCE PER DIE — I-MR CHART",
        spcSecondaryLabel: "Post-Bond Die-Crack / Sub-Surface Fracture Rate (ppm, C-SAT / Visual / AOI)",
        spcData: [0, 0, 1, 0, 1, 2, 3, 5, 9, 14, 20, 26, 22, 25, 28, 24, 26, 29],
        spcRulesTriggered: [
            "Western Electric / Nelson Rule 1 — single point beyond the 3σ Upper Control Limit",
            "Rule 2 — ≥7–9 consecutive points trending on one side of the centerline",
        ],
        gauges: [
            { label: "Peak Touchdown Force", value: "2.8 N (limit 2.0 N)", status: "danger" },
            { label: "Z-Velocity Profile", value: "Deceleration stage skipped", status: "danger" },
            { label: "Bond-Head Parallelism", value: "Within spec", status: "ok" },
        ],
        alarms: [
            { id: "ALM-TCB-1103", name: "TOUCHDOWN IMPACT FORCE EXCEEDS UPPER LIMIT", level: "critical", time: "13:02:37", params: { "Trigger": "Peak touchdown force above qualified limit", "Actual": "2.8 N", "Limit": "2.0 N", "Step": "Z-Touchdown & Force Application", "Lot": "FCB-2026-1103" } },
            { id: "ALM-TCB-1104", name: "Z-VELOCITY PROFILE DEVIATION", level: "warning", time: "13:02:35", params: { "Deviation": "Deceleration stage skipped", "Reference": "Qualified soft-touch schedule" } },
        ],
        troubleshootingSteps: [
            { icon: "🔬", title: "High-Mag / C-SAT Visual Inspection", description: "Inspect the last known-good and suspect die under high-magnification microscope or C-SAT for visible cracks, chips, or sub-surface cratering.", action: "RUN C-SAT / MICROSCOPE SCAN", alertMessage: "C-SAT reveals sub-surface cratering in the low-k dielectric at the die edge — consistent with high-impact touchdown." },
            { icon: "📉", title: "Z-Velocity Profile Verification", description: "Run a Z-axis velocity-profile verification using the tool's built-in motion diagnostics.", action: "RUN VELOCITY DIAGNOSTIC", alertMessage: "Motion diagnostics confirm the final deceleration stage was skipped — approach velocity 3x qualified soft-touch rate." },
            { icon: "🧬", title: "Golden-Sample Touchdown + Cross-Section", description: "Execute a golden-sample touchdown cycle and compare the force-vs-position curve to the qualified soft-touch reference; cross-section flagged die.", action: "RUN GOLDEN-SAMPLE TOUCHDOWN", alertMessage: "Captured curve shows a sharp impact spike at contact vs. the smooth staged reference — crack depth confirmed via cross-section." },
        ],
        restoreActions: [
            { name: "Re-Tune Soft-Touch Landing (Add Velocity-Staging Steps)", alertMessage: "Implementing additional velocity-staging steps in the soft-touch landing routine — approach speed capped at contact.", primary: true },
            { name: "Optimize Bond-Head Parallelism", alertMessage: "Optimizing bond-head parallelism to ensure uniform load distribution across the die area.", primary: false },
            { name: "Inspect & Correct Substrate / Carrier Warpage", alertMessage: "Inspecting substrate/carrier flatness — warpage corrected.", primary: false },
        ],
        ocapFlow: [
            { title: "CONTAINMENT", desc: "Immediately place the bonder in HOLD; quarantine all die/lots bonded since the last in-control SPC sample point.", btnLabel: "HOLD BONDER — QUARANTINE LOT", btnClass: "", alertMsg: "Bonder placed in HOLD. Die since last in-control sample quarantined." },
            { title: "METROLOGY VERIFICATION", desc: "Verify the Z-axis load cell against an independent, calibrated reference load cell / gauge block; confirm gauge R&R.", btnLabel: "VERIFY LOAD CELL VS REFERENCE", btnClass: "", alertMsg: "Independent reference gauge confirms true touchdown impact drift — not a measurement-system error." },
            { title: "ROOT CAUSE ANALYSIS", desc: "Complete a structured RCA covering excessive touchdown velocity, high initial impact force, and warped substrate / die carrier.", btnLabel: "FLAG RCA — EXCESSIVE TOUCHDOWN VELOCITY", btnClass: "rca", alertMsg: "RCA Confirmed: Excessive touchdown velocity — deceleration stage skipped in Z-velocity profile." },
            { title: "HARDWARE RECOVERY", desc: "Implement/re-tune soft-touch landing routines with additional velocity-staging steps; optimize bond-head parallelism; correct carrier warpage.", btnLabel: "RE-TUNE SOFT-TOUCH PROFILE", btnClass: "recovery", alertMsg: "Soft-touch landing routine re-tuned with added velocity-staging steps. Parallelism optimized." },
            { title: "DISPOSITION", desc: "100% C-SAT and visual / AOI inspection on all quarantined die; scrap or rework any unit with confirmed cracking or sub-surface cratering.", btnLabel: "100% C-SAT + AOI INSPECTION", btnClass: "disposition", alertMsg: "100% inspection complete — confirmed-cracked units scrapped. Remaining lot verified structurally intact." },
            { title: "VALIDATION", desc: "Run 3–5 consecutive verification lots at the corrected velocity profile / parallelism settings, confirming SPC holds within control limits.", btnLabel: "RUN VERIFICATION LOTS", btnClass: "", alertMsg: "Validation complete: Peak touchdown force = 1.1 N, zero cracking defects → Tool status GREEN." },
        ],
    },
    {
        id: "FM-004",
        name: "Bond Force Calibration Error",
        severity: "CRITICAL",
        fmeaScore: "10/10 (Severity)",
        lotId: "FCB-2026-1119",
        recipe: "TCB_ForceRamp_45N_DynTare",
        sensor: "Z-axis load cell with automated dynamic tare calibration, continuously cross-checked by the load cell's built-in diagnostic self-test routine.",
        visualLogic: "Real-time commanded-force vs. measured-force trace overlaid on the qualified reference response curve, captured across the full force ramp and hold.",
        normalCondition: "Measured force tracks the commanded force setpoint within the qualified tolerance band (±2% of setpoint) throughout ramp, peak hold, and release — no persistent offset or overshoot.",
        driftEvent: "Measured force diverges from commanded force — overshooting on ramp-up or drooping during hold — the load cell reading or force actuator's response no longer matches its calibrated reference.",
        keyInfo: `
    <strong>Bond Force Calibration Error</strong> occurs when measured force diverges from commanded force during ramp or hold. <strong>Overshoot</strong> risks Die Cracking; <strong>Droop</strong> risks Incomplete Bump Compression / Opens.
    <br/><br/>
    <strong>Local Effect:</strong> Bond force overshoot or droop.
    <br/><br/>
    <strong>System Effect:</strong> Die cracking or incomplete bump compression / opens — Severity-10, no reliable rework path once the compression event has occurred.
    `,
        rtmLabel: "FORCE ERROR (% of Commanded Setpoint)",
        rtmUnit: "%",
        rtmTarget: 0, rtmUcl: 5, rtmLcl: -5,
        rtmData: [0.2, 0.3, 0.1, 0.4, 0.6, 0.8, 1.2, 1.8, 2.5, 3.4, 4.5, 5.8, 7.0, 8.2, 9.5, 10.4, 11.0, 11.6],
        spcLabel: "FORCE ERROR (%) PER DIE — I-MR CHART",
        spcSecondaryLabel: "Post-Bond Die-Crack Rate + Incomplete-Compression / Open Defect Rate (ppm)",
        spcData: [1, 1, 1, 2, 2, 3, 4, 6, 9, 13, 18, 24, 30, 36, 42, 46, 49, 52],
        spcRulesTriggered: [
            "Western Electric / Nelson Rule 1 — single point beyond the 3σ control limit",
            "Rule 2 — ≥7–9 consecutive points trending on one side of the (zero-error) centerline",
        ],
        gauges: [
            { label: "Force Error", value: "+11.6% (limit ±10%)", status: "danger" },
            { label: "Load Cell Self-Test", value: "FAULT REPORTED", status: "danger" },
            { label: "Z-Axis Slide Mechanism", value: "Binding suspected", status: "warn" },
        ],
        alarms: [
            { id: "ALM-TCB-1119", name: "BOND FORCE DEVIATES FROM SETPOINT – Possible Load Cell Calibration Shift or Actuator Fault.", level: "critical", time: "15:37:52", params: { "Trigger": "Measured force exceeds ±10% of commanded setpoint during ramp or hold, or automated self-test/tare-calibration fails", "Interlock": "Bond cycle HOLD/ABORT; block further bonding until re-calibration/self-test passes; operator acknowledgment and maintenance sign-off required", "Lot": "FCB-2026-1119" } },
            { id: "ALM-TCB-1120", name: "LOAD CELL SELF-TEST / TARE-CALIBRATION FAULT", level: "warning", time: "15:37:48", params: { "Check": "Automated dynamic tare-calibration", "Result": "FAIL" } },
        ],
        troubleshootingSteps: [
            { icon: "🔍", title: "Visual Inspection — Die & Slide Mechanism", description: "Inspect the last known-good and suspect die for die cracking or incomplete compression; check the Z-axis slide mechanism for debris, binding, or lack of lubrication.", action: "INSPECT DIE + SLIDE MECHANISM", alertMessage: "Z-axis slide mechanism shows binding — insufficient lubrication detected. No visible die cracking on last known-good unit." },
            { icon: "⚖️", title: "External Reference Calibration Check", description: "Execute a calibration check against an external, independently certified reference load cell across the full production force range.", action: "RUN EXTERNAL CALIBRATION CHECK", alertMessage: "Measured force diverges from external reference by +11.6% across the ramp — calibration shift confirmed." },
            { icon: "🔁", title: "Dynamic Tare-Calibration Routine", description: "Run the automated dynamic tare-calibration routine and compare pre/post readings; cycle the Z-axis slide manually to check for friction.", action: "RUN TARE-CALIBRATION ROUTINE", alertMessage: "Tare-calibration self-test FAILS. Manual slide cycling confirms friction / binding along the Z-axis travel." },
        ],
        restoreActions: [
            { name: "Recalibrate Load Cell Against External Reference", alertMessage: "Recalibrating load cell against the external certified reference standard — force response restored to setpoint.", primary: true },
            { name: "Clean & Re-Lubricate Z-Axis Slide Mechanism", alertMessage: "Cleaning and re-lubricating the Z-axis slide mechanism — binding resolved.", primary: false },
            { name: "Inspect / Replace Worn Pneumatic or Servo Regulator", alertMessage: "Inspecting pneumatic/servo force-regulator components — worn regulator replaced.", primary: false },
        ],
        ocapFlow: [
            { title: "CONTAINMENT", desc: "Immediately place the bonder in HOLD; quarantine all die/lots bonded since the last in-control SPC sample point.", btnLabel: "HOLD BONDER — QUARANTINE LOT", btnClass: "", alertMsg: "Bonder placed in HOLD. Die since last in-control sample quarantined." },
            { title: "METROLOGY VERIFICATION", desc: "Verify the Z-axis load cell against an independent, calibrated external reference load cell across the full production force range; confirm gauge R&R.", btnLabel: "VERIFY LOAD CELL VS EXTERNAL REFERENCE", btnClass: "", alertMsg: "External reference confirms true force-error drift — not a measurement-system error." },
            { title: "ROOT CAUSE ANALYSIS", desc: "Complete a structured RCA (5-Why / fishbone) covering load cell calibration shift, mechanical slide friction, and pneumatic/servo regulator wear; document and approve the RCA before restart.", btnLabel: "RCA ROWS DISPLAYED INLINE", btnClass: "rca", alertMsg: "RCA rows are displayed inline for review and approval." },
            { title: "HARDWARE RECOVERY", desc: "Execute routine calibration checks using an external reference load cell; clean and lubricate the Z-axis slide mechanism; replace worn regulator components as needed.", btnLabel: "RECALIBRATE + LUBRICATE SLIDE", btnClass: "recovery", alertMsg: "Load cell recalibrated against external reference. Z-axis slide cleaned and re-lubricated." },
            { title: "DISPOSITION", desc: "100% AOI / electrical (continuity/isolation) test and visual crack inspection on all quarantined die; scrap any unit with confirmed cracking, incomplete compression, or opens.", btnLabel: "100% AOI + CRACK INSPECTION", btnClass: "disposition", alertMsg: "100% inspection complete — confirmed-defective units scrapped. Remaining lot verified within force-compression spec." },
            { title: "VALIDATION", desc: "Run 3–5 consecutive verification lots at the recalibrated force response, confirming SPC returns to and holds within control limits.", btnLabel: "RUN VERIFICATION LOTS", btnClass: "", alertMsg: "Validation complete: Force error within ±2% band, zero cracking/open defects → Tool status GREEN." },
        ],
    },
    {
        id: "FM-005",
        name: "Bond Head Temperature Instability",
        severity: "HIGH",
        fmeaScore: "9/10 (Severity)",
        lotId: "FCB-2026-1134",
        recipe: "TCB_MultiZone_PID_285C",
        sensor: "Multi-zone closed-loop PID thermocouple array embedded in the thermode heater block, cross-verified by an inline infrared (IR) thermal camera imaging the full die surface.",
        visualLogic: "Real-time thermal map (IR image) of the die surface overlaid on the qualified \"golden\" zone-uniformity profile, showing per-zone temperature and resulting inter-zone ΔT.",
        normalCondition: "All heater zones track their individual PID setpoints; IR thermal map shows a uniform die-surface temperature with inter-zone gradient within the qualified band (≤±5°C across the die).",
        driftEvent: "One or more heater zones deviate from setpoint, or the IR thermal map shows a localized hot/cold region — inter-zone gradient exceeds ±5°C.",
        keyInfo: `
    <strong>Bond Head Temperature Instability</strong> occurs when one or more thermode heater zones drift, producing a Temperature Gradient Across the Die Surface exceeding ±5°C.
    <br/><br/>
    <strong>Local Effect:</strong> Temperature gradient across die surface (&gt;±5°C).
    <br/><br/>
    <strong>System Effect:</strong> Localized non-wetting / uneven bump deformation / die warpage — Severity-9, no reliable rework path once affected bumps have failed to wet properly.
    `,
        rtmLabel: "MAX INTER-ZONE TEMPERATURE GRADIENT ΔT (°C)",
        rtmUnit: "°C",
        rtmTarget: 0, rtmUcl: 5, rtmLcl: -5,
        rtmData: [1.8, 2.0, 1.9, 2.2, 2.5, 2.8, 3.2, 3.6, 4.0, 4.4, 4.8, 5.2, 5.6, 5.9, 6.2, 6.5, 6.8, 7.0],
        spcLabel: "MAX INTER-ZONE ΔT (°C) PER BOND CYCLE — I-MR CHART",
        spcSecondaryLabel: "Localized Non-Wetting / Die-Warpage Defect Rate (ppm, C-SAT / AOI)",
        spcData: [2, 2, 3, 3, 4, 5, 6, 8, 10, 13, 16, 19, 22, 25, 28, 30, 32, 34],
        spcRulesTriggered: [
            "Western Electric / Nelson Rule 1 — single point beyond the 3σ Upper Control Limit",
            "Rule 2 — ≥7–9 consecutive points trending on one side of the centerline",
        ],
        gauges: [
            { label: "Max Inter-Zone ΔT", value: "7.0°C (limit ±5°C)", status: "danger" },
            { label: "IR Thermal Map", value: "Localized hot region — Zone 3", status: "danger" },
            { label: "PID Zone Setpoint Tracking", value: "Zone 3 deviating", status: "warn" },
        ],
        alarms: [
            { id: "ALM-TCB-1134", name: "DIE SURFACE TEMPERATURE GRADIENT EXCEEDS ±5°C", level: "critical", time: "11:56:14", params: { "Trigger": "Inter-zone ΔT across die > ±5°C", "Actual ΔT": "7.0°C", "Zone": "3 (hot)", "Interlock": "Site advance blocked", "Lot": "FCB-2026-1134" } },
            { id: "ALM-TCB-1135", name: "PID ZONE 3 SETPOINT DEVIATION", level: "warning", time: "11:56:10", params: { "Setpoint": "285°C", "Actual": "292.4°C", "Delta": "+7.4°C" } },
        ],
        troubleshootingSteps: [
            { icon: "📷", title: "IR Thermal Map Review", description: "Review the IR thermal map history to identify which zone(s) are drifting; inspect die via C-SAT/AOI for localized non-wetting or warpage.", action: "REVIEW IR THERMAL MAP", alertMessage: "IR thermal map history shows Zone 3 trending hot over the last 40 cycles — localized non-wetting confirmed via AOI at that zone." },
            { icon: "🌡️", title: "Calibrated Surface-Thermocouple Verification", description: "Run a thermode profile verification using calibrated surface thermocouples placed across the die footprint to independently confirm each zone's actual temperature.", action: "RUN SURFACE-THERMOCOUPLE TEST", alertMessage: "Zone 3 reads 292.4°C against a calibrated reference — 7.4°C above setpoint, confirming heater drift in that zone." },
            { icon: "🔌", title: "Thermal Contact Inspection", description: "Inspect thermal contact (grease/interface material) between the heater block and bond head; re-run IR camera calibration against a blackbody reference.", action: "INSPECT THERMAL INTERFACE", alertMessage: "Thermal interface material at Zone 3 is degraded/dried out — reduced contact confirmed as a contributing cause." },
        ],
        restoreActions: [
            { name: "Recalibrate Thermode Temperature Profiles (Weekly)", alertMessage: "Recalibrating thermode temperature profiles using calibrated surface thermocouples — Zone 3 returning to 285°C setpoint.", primary: true },
            { name: "Replace Heater Elements / Thermocouples (During PM)", alertMessage: "Replacing degraded Zone 3 heater cartridge and thermocouple.", primary: false },
            { name: "Restore Thermal Contact (Clean & Reapply Interface Material)", alertMessage: "Cleaning and reapplying thermal interface material between heater block and bond head.", primary: false },
        ],
        ocapFlow: [
            { title: "CONTAINMENT", desc: "Immediately place the bonder in HOLD; quarantine all die/lots bonded since the last in-control SPC sample point.", btnLabel: "HOLD BONDER — QUARANTINE LOT", btnClass: "", alertMsg: "Bonder placed in HOLD. Die since last in-control sample quarantined." },
            { title: "METROLOGY VERIFICATION", desc: "Verify the affected zone's thermocouple and the IR thermal camera against an independent, calibrated reference (surface thermocouple / blackbody source).", btnLabel: "VERIFY ZONE 3 VS REFERENCE", btnClass: "", alertMsg: "Independent reference confirms true Zone 3 thermal drift — not a measurement-system error." },
            { title: "ROOT CAUSE ANALYSIS", desc: "Complete a structured RCA covering heater cartridge degradation and thermocouple drift as contributing causes.", btnLabel: "FLAG RCA — HEATER CARTRIDGE DEGRADATION", btnClass: "rca", alertMsg: "RCA Confirmed: Zone 3 heater cartridge degradation, compounded by degraded thermal interface material." },
            { title: "HARDWARE RECOVERY", desc: "Recalibrate thermode temperature profiles weekly using calibrated surface thermocouples; replace heater elements during PM.", btnLabel: "RECALIBRATE ZONE PROFILES", btnClass: "recovery", alertMsg: "Zone 3 heater cartridge replaced. Thermode temperature profiles recalibrated across all zones." },
            { title: "DISPOSITION", desc: "100% C-SAT / AOI inspection on all quarantined die; scrap any unit with confirmed localized non-wetting, uneven bump deformation, or warpage.", btnLabel: "100% C-SAT + AOI INSPECTION", btnClass: "disposition", alertMsg: "100% inspection complete — confirmed-defective units scrapped. Remaining lot verified within qualified ΔT band." },
            { title: "VALIDATION", desc: "Run 3–5 consecutive verification lots at the recalibrated thermode profile, confirming SPC returns to and holds within control limits.", btnLabel: "RUN VERIFICATION LOTS", btnClass: "", alertMsg: "Validation complete: Max inter-zone ΔT = 2.1°C, zero non-wetting/warpage defects → Tool status GREEN." },
        ],
    },
];

// =============================================
// CHART HELPER (shared canvas line-chart renderer)
// =============================================
function drawChart(
    canvas: HTMLCanvasElement,
    data: number[],
    target: number, ucl: number, lcl: number,
    label: string, height: number,
    colors: { red: string; green: string; white: string; text: string; text3: string; grid: string; bg: string; accent: string; }
) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    canvas.width = rect.width;
    canvas.height = height;
    const W = rect.width, H = height;
    const c = colors;
    const pad = { l: 46, t: 12, r: 46, b: 22 };
    const gW = W - pad.l - pad.r, gH = H - pad.t - pad.b;
    const allV = [...data, ucl, lcl, target];
    const minV = Math.min(...allV) - Math.abs(Math.min(...allV)) * 0.05 - 0.5;
    const maxV = Math.max(...allV) + Math.abs(Math.max(...allV)) * 0.05 + 0.5;
    const sx = (i: number) => pad.l + (i / (data.length - 1)) * gW;
    const sy = (v: number) => pad.t + (1 - (v - minV) / (maxV - minV)) * gH;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = c.bg; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = c.grid; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
        const y = pad.t + (gH / 5) * i;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    }
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
    ([[ucl, 'UCL'], [lcl, 'LCL']] as const).forEach(([v, lbl]) => {
        ctx.strokeStyle = c.red;
        const y = sy(v);
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
        ctx.fillStyle = c.red; ctx.font = '9px "Share Tech Mono", monospace';
        ctx.fillText(lbl, W - pad.r + 4, y + 3);
    });
    ctx.strokeStyle = c.white; ctx.setLineDash([4, 6]); ctx.lineWidth = 1.5;
    const ty = sy(target);
    ctx.beginPath(); ctx.moveTo(pad.l, ty); ctx.lineTo(W - pad.r, ty); ctx.stroke();
    ctx.fillStyle = c.white; ctx.font = '9px "Share Tech Mono", monospace';
    ctx.fillText('TARGET', W - pad.r + 4, ty - 3);
    ctx.setLineDash([]);
    ctx.beginPath();
    data.forEach((v, i) => { i === 0 ? ctx.moveTo(sx(i), sy(v)) : ctx.lineTo(sx(i), sy(v)); });
    ctx.lineTo(sx(data.length - 1), H - pad.b);
    ctx.lineTo(sx(0), H - pad.b);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
    grad.addColorStop(0, 'rgba(0,229,255,0.12)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fill();
    data.forEach((v, i) => {
        if (i === 0) return;
        const ooc = v > ucl || v < lcl;
        ctx.strokeStyle = ooc ? c.red : c.green;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx(i - 1), sy(data[i - 1])); ctx.lineTo(sx(i), sy(v)); ctx.stroke();
    });
    data.forEach((v, i) => {
        const ooc = v > ucl || v < lcl;
        ctx.beginPath(); ctx.arc(sx(i), sy(v), 3.5, 0, Math.PI * 2);
        ctx.fillStyle = ooc ? c.red : c.green; ctx.fill();
        ctx.beginPath(); ctx.arc(sx(i), sy(v), 1.8, 0, Math.PI * 2);
        ctx.fillStyle = c.bg; ctx.fill();
    });
    ctx.fillStyle = c.text; ctx.font = '9px "Share Tech Mono", monospace'; ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
        const v = minV + (maxV - minV) * i / 5;
        ctx.fillText(v.toFixed(1), pad.l - 4, sy(v) + 3);
    }
    ctx.textAlign = 'left'; ctx.fillStyle = c.text3;
    ctx.fillText(label, pad.l, H - 4);
}

// =============================================
// MAIN COMPONENT
// =============================================
const Failure: React.FC = () => {
    const [currentFM, setCurrentFM] = useState<number>(0);
    const [isDark, setIsDark] = useState<boolean>(true);
    const [activeTab, setActiveTab] = useState<TabType | null>(null);
    const [isMounted, setIsMounted] = useState<boolean>(false);
    const router = useRouter();

    const rtmCanvasRef = useRef<HTMLCanvasElement>(null);
    const spcCanvasRef = useRef<HTMLCanvasElement>(null);

    const fm = FM_DATA[currentFM];

    useEffect(() => { setIsMounted(true); }, []);

    const selectFM = (idx: number) => {
        setCurrentFM(idx);
        setActiveTab(null);
        setOcapStep(1);
        setSelectedCause(null);
        setShowActionPopup(false);
    };

    const toggleTroubleshooting = () => {
        setActiveTab(activeTab === 'troubleshooting' || activeTab === 'ocap' ? null : 'troubleshooting');
    };

    const getColors = useCallback(() => ({
        red: isDark ? '#ff1744' : '#d90026',
        green: isDark ? '#00e676' : '#00a846',
        white: isDark ? '#ffffff' : '#000000',
        text: isDark ? '#7ba3c8' : '#2a4a70',
        text3: isDark ? '#4a6a8a' : '#5a7a9a',
        grid: isDark ? 'rgba(0,229,255,0.07)' : 'rgba(0,100,180,0.08)',
        bg: isDark ? '#111927' : '#f5f8ff',
        accent: isDark ? '#00e5ff' : '#0066cc',
    }), [isDark]);

    const drawRTM = useCallback(() => {
        if (!isMounted) return;
        const canvas = rtmCanvasRef.current; if (!canvas) return;
        const c = getColors();
        drawChart(canvas, fm.rtmData, fm.rtmTarget, fm.rtmUcl, fm.rtmLcl, fm.rtmLabel, 170, c);
    }, [fm, getColors, isMounted]);

    const drawSPC = useCallback(() => {
        if (!isMounted) return;
        const canvas = spcCanvasRef.current; if (!canvas) return;
        const c = getColors();
        const allV = fm.spcData;
        const mean = allV.reduce((a, b) => a + b, 0) / allV.length;
        const std = Math.sqrt(allV.reduce((a, v) => a + (v - mean) ** 2, 0) / allV.length);
        const ucl = mean + 3 * std;
        const lcl = Math.max(0, mean - 3 * std);
        drawChart(canvas, fm.spcData, mean, ucl, lcl, fm.spcSecondaryLabel, 170, c);
    }, [fm, getColors, isMounted]);

    useEffect(() => {
        if (!isMounted || activeTab !== null) return;
        const t = setTimeout(() => { drawRTM(); drawSPC(); }, 100);
        return () => clearTimeout(t);
    }, [drawRTM, drawSPC, currentFM, isDark, isMounted, activeTab]);

    useEffect(() => {
        if (!isMounted) return;
        const h = () => { if (activeTab === null) { drawRTM(); drawSPC(); } };
        window.addEventListener('resize', h);
        return () => window.removeEventListener('resize', h);
    }, [drawRTM, drawSPC, isMounted, activeTab]);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        }
    }, [isDark]);

    const getSevClass = (s: string) =>
        s === 'CRITICAL' ? 'border-l-4 border-red-600' : s === 'HIGH' ? 'border-l-4 border-yellow-500' : 'border-l-4 border-blue-500';

    // ---------------- OCAP flow state (per current FM) ----------------
    const [ocapStepByFM, setOcapStepByFM] = useState<Record<string, number>>({});
    const ocapStep = ocapStepByFM[fm.id] ?? 1;
    const setOcapStep = (step: number) => setOcapStepByFM(prev => ({ ...prev, [fm.id]: step }));

    const [validationClicksByFM, setValidationClicksByFM] = useState<Record<string, boolean>>({});
    const validationClicked = validationClicksByFM[fm.id] ?? false;
    const [selectedCause, setSelectedCause] = useState<RootCauseKey | null>(null);
    const [showActionPopup, setShowActionPopup] = useState(false);
    const [executedActionsByFM, setExecutedActionsByFM] = useState<Record<string, string[]>>({});
    const executedActions = executedActionsByFM[fm.id] ?? [];
    const rootCauseOptions = fm.id === 'FM-002'
        ? THERMAL_ROOT_CAUSE_ACTIONS
        : fm.id === 'FM-003'
            ? DIE_CRACKING_ROOT_CAUSE_ACTIONS
            : ROOT_CAUSE_ACTIONS;

    const showFlowError = (current: number, requiredStep?: number) => {
        if (current >= 6) {
            alert("✅ This process is already completed.\nPlease refresh the page to start again from Step 1.");
        } else if (requiredStep !== undefined && current > requiredStep) {
            alert("✅ This step is already completed.");
        } else {
            alert("Please follow the OCAP flow: Containment → Verification → Root Cause → Hardware Recovery → Disposition → Validation");
        }
    };

    const handleOcapClick = (requiredStep: number, successMsg: string, nextStep?: number) => {
        if (ocapStep !== requiredStep) { showFlowError(ocapStep, requiredStep); return; }
        alert(successMsg);
        if (nextStep) setOcapStep(nextStep);
    };

    const handleValidationClick = () => {
        if (ocapStep !== 6) { showFlowError(ocapStep, 6); return; }
        alert('Running verification lots...');
        setValidationClicksByFM(prev => ({ ...prev, [fm.id]: true }));
    };

    const handleSelectRootCause = (key: RootCauseKey) => {
        if (ocapStep !== 3) { showFlowError(ocapStep, 3); return; }
        setSelectedCause(key);
        setShowActionPopup(true);
    };

    const handleExecuteRcaRow = (row: RcaRow) => {
        setExecutedActionsByFM(prev => ({
            ...prev,
            [fm.id]: Array.from(new Set([...(prev[fm.id] ?? []), row.action])),
        }));
    };

    const handleExecuteRootCause = (key: RootCauseKey) => {
        const rootCause = rootCauseOptions.find(option => option.key === key);
        if (!rootCause) return;
        setExecutedActionsByFM(prev => ({
            ...prev,
            [fm.id]: Array.from(new Set([...(prev[fm.id] ?? []), ...rootCause.actions])),
        }));
        setShowActionPopup(false);
    };

    const isRecoveryActionExecuted = (index: number) => {
        if (fm.id === 'FM-002' || fm.id === 'FM-003' || fm.id === 'FM-004') return executedActions.length > 0 && index < 3;
        if (index === 0) return executedActions.includes('Recalibrate Z-Axis Load Cell') || executedActions.includes('Replace Force Regulator');
        if (index === 2) return executedActions.includes('Re-Validate Force-Temp Profile');
        return false;
    };

    if (!isMounted) {
        return (
            <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
                <div className="flex items-center justify-center min-h-screen text-gray-600 dark:text-gray-400">Loading...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200 transition-colors duration-300 overflow-x-hidden">

            {/* NAV */}
            <nav className="sticky top-0 z-50 bg-gray-100/97 dark:bg-gray-900/97 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 h-12">
                <div className="flex items-center gap-2 font-sans text-base font-black text-gray-800 dark:text-gray-200" />
                <div className="flex gap-1">
                    <button type="button" onClick={() => router.push("/")} className="font-sans text-[10px] font-bold tracking-wider px-3 py-1 rounded text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-all">HOME</button>
                    <button type="button" onClick={() => setIsDark(!isDark)} className="font-sans text-[10px] font-bold tracking-wider px-3 py-1 rounded text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-all">{isDark ? 'LIGHT' : 'DARK'}</button>
                </div>
                <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_#00a846] animate-pulse" />
                    <span className="text-xs text-gray-600 dark:text-gray-400 hidden sm:block">Connected to SMaRT Simulator</span>
                </div>
            </nav>

            {/* HEADER */}
            <div className="px-4 pt-3 pb-3 flex flex-wrap sm:flex-row flex-col justify-between border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
                <div className="font-sans text-lg font-black text-gray-800 dark:text-gray-200 mb-2">SMaRT Simulator — Flip Chip Bonder</div>
                <div className="flex items-center gap-4">
                    <div className="text-center">
                        <div className="font-sans text-lg font-bold text-blue-600 dark:text-blue-400">300mm</div>
                        <div className="text-[9px] tracking-wider text-gray-500 dark:text-gray-500 font-sans">WAFER SIZE</div>
                    </div>
                    <button
                        className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold transition-all duration-300 hover:bg-blue-700 hover:-translate-y-0.5"
                        onClick={() => router.push("/Recipe")}
                    >
                        Recipe Module
                    </button>
                </div>
            </div>

            <div className="p-3 flex flex-col gap-2.5">

                {/* FM TABS */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5 border border-gray-200 dark:border-gray-700 rounded-lg p-2 bg-white dark:bg-gray-800">
                    {FM_DATA.map((mode, idx) => (
                        <div
                            key={mode.id}
                            className={`bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3 pl-3 cursor-pointer transition-all duration-200 relative overflow-hidden min-h-14 flex items-center ${getSevClass(mode.severity)} ${currentFM === idx ? 'border-blue-500 bg-gradient-to-br from-blue-500/15 to-blue-500/5 shadow-[0_0_16px_rgba(0,102,204,0.2)]' : ''}`}
                            onClick={() => selectFM(idx)}
                        >
                            <div className="text-sm font-extrabold text-gray-800 dark:text-gray-200 leading-tight tracking-wide">{mode.name}</div>
                        </div>
                    ))}
                </div>

                {/* KEY INFO */}
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-2.5 items-stretch">
                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg flex-1 p-3">
                        <div className="flex items-center justify-between flex-wrap gap-2 mb-1.5">
                            <div className="font-mono text-base text-black dark:text-white tracking-widest">⬡ KEY INFORMATION</div>
                            <span className={`font-mono text-[10px] px-2 py-0.5 rounded border ${fm.severity === 'CRITICAL' ? 'bg-red-500/15 text-red-600 dark:text-red-500 border-red-500/30' : 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-500 border-yellow-500/30'}`}>FMEA SEVERITY: {fm.fmeaScore}</span>
                        </div>
                        <div className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed" dangerouslySetInnerHTML={{ __html: fm.keyInfo }} />
                    </div>
                    {fm.id === 'FM-001' && (
                        <div className="flex flex-col gap-2">
                            <figure className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2 flex items-center justify-center overflow-hidden flex-1">
                                <img
                                    src="/4D.%20%231%20User%20Interface.png"
                                    alt="Equipment screen showing bond-force overshoot and an active alarm"
                                    className="block w-full h-full object-contain rounded"
                                />
                            </figure>
                            <div className="flex flex-col gap-2">
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 h-8 flex items-center">
                                    <span className="font-mono text-[11px] font-bold flex items-center gap-1 whitespace-nowrap">
                                        <strong className="text-blue-600 dark:text-blue-400">LOT ID :</strong>{fm.lotId}
                                    </span>
                                </div>
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 h-8 flex items-center">
                                    <span className="font-mono text-[11px] font-bold flex items-center gap-1 whitespace-nowrap">
                                        <strong className="text-blue-600 dark:text-blue-400">RECIPE :</strong>{fm.recipe}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                    {fm.id === 'FM-002' && (
                        <div className="flex flex-col gap-2">
                            <figure className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2 flex items-center justify-center overflow-hidden flex-1">
                                <img
                                    src="/4D.%20%232%20User%20Interface.png"
                                    alt="Bond head thermal profile showing abnormal temperature and dwell alarms"
                                    className="block w-full h-full object-contain rounded"
                                />
                            </figure>
                            <div className="flex flex-col gap-2">
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 h-8 flex items-center">
                                    <span className="font-mono text-[11px] font-bold flex items-center gap-1 whitespace-nowrap">
                                        <strong className="text-blue-600 dark:text-blue-400">LOT ID :</strong>{fm.lotId}
                                    </span>
                                </div>
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 h-8 flex items-center">
                                    <span className="font-mono text-[11px] font-bold flex items-center gap-1 whitespace-nowrap">
                                        <strong className="text-blue-600 dark:text-blue-400">RECIPE :</strong>{fm.recipe}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                    {fm.id === 'FM-003' && (
                        <div className="flex flex-col gap-2">
                            <figure className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2 flex items-center justify-center overflow-hidden">
                                <img
                                    src="/4D.%20%236%20User%20Interface.png"
                                    alt="Real-time monitoring trace for touchdown impact force and Z-axis velocity"
                                    className="block w-full object-contain rounded"
                                />
                            </figure>
                            <div className="flex flex-col gap-2">
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 h-8 flex items-center">
                                    <span className="font-mono text-[11px] font-bold flex items-center gap-1 whitespace-nowrap">
                                        <strong className="text-blue-600 dark:text-blue-400">LOT ID :</strong>{fm.lotId}
                                    </span>
                                </div>
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 h-8 flex items-center">
                                    <span className="font-mono text-[11px] font-bold flex items-center gap-1 whitespace-nowrap">
                                        <strong className="text-blue-600 dark:text-blue-400">RECIPE :</strong>{fm.recipe}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                    {fm.id === 'FM-004' && (
                        <div className="flex flex-col gap-2">
                            <figure className="bg-white dark:bg-gray-800 border border-cyan-500/40 rounded-lg p-2 flex items-center justify-center overflow-hidden">
                                <img
                                    src="/4D.%20%239%20User%20Interface.png"
                                    alt="Bond force overshoot and droop calibration drift risk interface"
                                    className="block w-full object-contain rounded"
                                />
                            </figure>
                            <div className="flex flex-col gap-2">
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 h-8 flex items-center">
                                    <span className="font-mono text-[11px] font-bold flex items-center gap-1 whitespace-nowrap">
                                        <strong className="text-blue-600 dark:text-blue-400">LOT ID :</strong>{fm.lotId}
                                    </span>
                                </div>
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 h-8 flex items-center">
                                    <span className="font-mono text-[11px] font-bold flex items-center gap-1 whitespace-nowrap">
                                        <strong className="text-blue-600 dark:text-blue-400">RECIPE :</strong>{fm.recipe}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* LOT ID / RECIPE */}
                <div className={`flex flex-wrap gap-2 ${fm.id === 'FM-001' || fm.id === 'FM-002' || fm.id === 'FM-003' || fm.id === 'FM-004' ? 'hidden' : ''}`}>
                    <div className="bg-white border border-gray-200 dark:border-gray-700 rounded-lg px-3 h-8 flex items-center">
                        <span className="font-mono text-[11px] font-bold flex items-center gap-1 whitespace-nowrap">
                            <strong className="text-blue-600 dark:text-blue-400">LOT ID :</strong>{fm.lotId}
                        </span>
                    </div>
                    <div className="bg-white border border-gray-200 dark:border-gray-700 rounded-lg px-3 h-8 flex items-center">
                        <span className="font-mono text-[11px] font-bold flex items-center gap-1 whitespace-nowrap">
                            <strong className="text-blue-600 dark:text-blue-400">RECIPE :</strong>{fm.recipe}
                        </span>
                    </div>
                    <div className="bg-white border border-gray-200 dark:border-gray-700 rounded-lg px-3 h-8 flex items-center">
                        <span className="font-mono text-[11px] font-bold flex items-center gap-1 whitespace-nowrap">
                            <strong className="text-blue-600 dark:text-blue-400">SENSOR :</strong> {fm.sensor.split('.')[0]}
                        </span>
                    </div>
                </div>

                {/* ACTION BUTTONS */}
                <div className="flex flex-col sm:flex-row gap-2">
                    <button
                        className={`flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 font-sans text-base font-bold tracking-wider text-gray-600 dark:text-gray-400 cursor-pointer transition-all duration-200 text-left ${(activeTab === 'rtmspc' || activeTab === null) ? 'border-blue-500 bg-gradient-to-br from-blue-500/15 to-blue-500/5 text-blue-600 dark:text-blue-400 shadow-[0_0_10px_rgba(0,102,204,0.14)]' : ''}`}
                        onClick={() => setActiveTab(activeTab === 'rtmspc' ? null : 'rtmspc')}
                    >
                        ⬡ Equipment RTM / Process SPC chart
                    </button>
                    <button
                        className={`flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 font-sans text-base font-bold tracking-wider text-gray-600 dark:text-gray-400 cursor-pointer transition-all duration-200 text-left ${(activeTab === 'troubleshooting' || activeTab === 'ocap') ? 'border-blue-500 bg-gradient-to-br from-blue-500/15 to-blue-500/5 text-blue-600 dark:text-blue-400 shadow-[0_0_10px_rgba(0,102,204,0.14)]' : ''}`}
                        onClick={toggleTroubleshooting}
                    >
                        ⬡ Equipment troubleshooting, Process OCAP (Out of Control Action Plan)
                    </button>
                </div>

                {/* ============ RTM / SPC TAB ============ */}
                {(activeTab === null || activeTab === 'rtmspc') && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
                        {/* RTM Chart */}
                        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-2.5 flex flex-col gap-1.5 overflow-hidden hover:border-blue-500/30 transition-colors lg:col-span-2">
                            <span className="font-mono text-sm font-bold tracking-wider text-gray-500 dark:text-gray-400">⬡ RTM — {fm.rtmLabel}</span>
                            <div className="font-mono text-[11px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 leading-relaxed">
                                📡 SENSOR: {fm.sensor}
                            </div>
                            <div className="font-mono text-[10px] text-gray-500 dark:text-gray-500 leading-relaxed">
                                <span className="text-green-600 dark:text-green-400 font-bold">NORMAL:</span> {fm.normalCondition}
                            </div>
                            <div className="font-mono text-[10px] text-red-600 dark:text-red-500 leading-relaxed">
                                <span className="font-bold">DRIFT EVENT:</span> {fm.driftEvent}
                            </div>
                            <canvas ref={rtmCanvasRef} className="w-full block mt-1" height="170" />
                        </div>

                        {/* Gauges + Alarm Log */}
                        <div className="flex flex-col gap-2.5">
                            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-2.5 flex flex-col gap-1.5">
                                <span className="font-mono text-sm font-bold tracking-wider text-gray-500 dark:text-gray-400">⬡ SUPPORTING GAUGES</span>
                                {fm.gauges.map((g, i) => (
                                    <div key={i} className={`flex justify-between items-center px-2 py-1.5 rounded border text-xs font-mono ${g.status === 'danger' ? 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400' : g.status === 'warn' ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-600 dark:text-yellow-400' : 'bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400'}`}>
                                        <span>{g.label}</span>
                                        <strong>{g.value}</strong>
                                    </div>
                                ))}
                            </div>
                            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-2.5 flex flex-col gap-1.5">
                                <span className="font-mono text-sm font-bold tracking-wider text-gray-500 dark:text-gray-400">⬡ ACTIVE ALARM LOG</span>
                                {fm.alarms.map((a) => (
                                    <div key={a.id} className={`rounded border p-2 text-[10px] font-mono ${a.level === 'critical' ? 'bg-red-500/10 border-red-500/30' : 'bg-yellow-500/10 border-yellow-500/30'}`}>
                                        <div className={`font-bold mb-1 ${a.level === 'critical' ? 'text-red-600 dark:text-red-400' : 'text-yellow-600 dark:text-yellow-400'}`}>{a.id} — {a.time}</div>
                                        <div className="text-gray-700 dark:text-gray-300 mb-1">{a.name}</div>
                                        {Object.entries(a.params).map(([k, v]) => (
                                            <div key={k} className="flex justify-between text-gray-500 dark:text-gray-500">
                                                <span>{k}:</span><span className="text-gray-700 dark:text-gray-300">{v}</span>
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* SPC Chart — full width */}
                        <div className="lg:col-span-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-2.5 flex flex-col gap-1.5">
                            <span className="font-mono text-sm font-bold tracking-wider text-gray-500 dark:text-gray-400">⬡ PROCESS SPC CHART — {fm.spcLabel}</span>
                            <div className="flex flex-wrap gap-1.5">
                                <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">{fm.spcSecondaryLabel}</span>
                            </div>
                            <canvas ref={spcCanvasRef} className="w-full block mt-1" height="170" />
                            <div className="border-t border-gray-200 dark:border-gray-700 pt-2 mt-1">
                                <div className="font-mono text-[10px] tracking-wider text-gray-500 dark:text-gray-500 mb-1.5">SPC RULES TRIGGERED</div>
                                <div className="flex flex-col gap-1">
                                    {fm.spcRulesTriggered.map((r, i) => (
                                        <div key={i} className="text-xs text-gray-600 dark:text-gray-400 flex gap-1.5">
                                            <span className="text-orange-500">▸</span>{r}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ============ COMBINED TROUBLESHOOTING + OCAP WORKSPACE ============ */}
                {(activeTab === 'troubleshooting' || activeTab === 'ocap') && (
                    <div className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-col gap-4">
                        <div className="flex items-center justify-between gap-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                            <div>
                                <div className="font-mono text-[13px] font-bold tracking-wider text-blue-600 dark:text-blue-400">⬡ EQUIPMENT TROUBLESHOOTING + PROCESS OCAP</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Diagnostics, root cause, recovery, disposition, and validation in one controlled sequence.</div>
                            </div>
                            <span className="font-mono text-[11px] text-gray-500 dark:text-gray-500 tracking-wide">{fm.name}</span>
                        </div>

                        <div className="bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-col gap-0">
                            <div className="flex items-center justify-between gap-3 pb-3 border-b border-gray-200 dark:border-gray-700 mb-4">
                                <span className="font-mono text-[13px] font-bold tracking-wider text-blue-600 dark:text-blue-400">⬡ PROCESS OCAP</span>
                                <span className="font-mono text-[11px] text-gray-500 dark:text-gray-500 tracking-wide">STEP {Math.min(ocapStep, 6)} OF 6</span>
                            </div>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-5">
                                {fm.ocapFlow.map((step, idx) => {
                                    const stepNum = idx + 1;
                                    const isActive = ocapStep === stepNum;
                                    const isDone = ocapStep > stepNum;
                                    return (
                                        <div key={idx} className={`flex gap-4 bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3 pr-4 transition-all duration-200 items-start ${isActive ? 'border-l-4 border-blue-500 bg-blue-500/5' : isDone ? 'border-l-4 border-green-500 opacity-75' : ''}`}>
                                            <div className="w-8 h-8 rounded-full border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center font-mono text-[13px] font-bold text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5">{stepNum}</div>
                                            <div className="flex-1 flex flex-col gap-1">
                                                <div className="text-[13px] font-bold text-gray-800 dark:text-gray-200 tracking-wide font-mono">{step.title}</div>
                                                <div className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{step.desc}</div>
                                                {stepNum === 3 ? (
                                                    <div className="flex flex-col gap-1.5 mt-1">
                                                        {fm.id === 'FM-004' ? (
                                                            <div className="overflow-x-auto rounded border border-cyan-500/50 bg-[#111927]">
                                                                <table className="w-full min-w-[620px] border-collapse font-mono text-[10px] text-gray-200">
                                                                    <thead>
                                                                        <tr className="bg-[#29495d] text-left text-cyan-100">
                                                                            <th className="border border-cyan-900 px-2 py-1.5">#</th>
                                                                            <th className="border border-cyan-900 px-2 py-1.5">ROOT CAUSE (FROM RCA)</th>
                                                                            <th className="border border-cyan-900 px-2 py-1.5">CORRECTIVE ACTION</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {BOND_FORCE_RCA.map(row => (
                                                                            <tr key={row.id}>
                                                                                <td className="border border-cyan-900 px-2 py-1.5 align-top">{row.id}</td>
                                                                                <td className="border border-cyan-900 px-2 py-1.5 align-top">{row.rootCause}</td>
                                                                                <td className="border border-cyan-900 px-2 py-1.5 align-top">
                                                                                    <div className="flex flex-col gap-1.5">
                                                                                        <span>{row.action}</span>
                                                                                        <button type="button" className="self-start rounded border border-green-500/70 bg-green-500/10 px-2 py-1 text-[9px] font-bold text-green-300 hover:bg-green-500/20" onClick={() => handleExecuteRcaRow(row)}>EXECUTE ACTION</button>
                                                                                    </div>
                                                                                </td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <div className="text-[10px] font-mono tracking-wider text-gray-500 dark:text-gray-400">SELECT ROOT CAUSE</div>
                                                                {rootCauseOptions.map(rootCause => (
                                                                    <button
                                                                        key={rootCause.key}
                                                                        className={`self-start w-full text-left rounded px-3 py-2 text-[11px] font-mono cursor-pointer transition-all duration-200 border ${selectedCause === rootCause.key ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-500/10' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400'}`}
                                                                        onClick={() => handleSelectRootCause(rootCause.key)}
                                                                    >
                                                                        {rootCause.label.toUpperCase()}
                                                                    </button>
                                                                ))}
                                                            </>
                                                        )}
                                                    </div>
                                                ) : stepNum === 4 ? (
                                                    <div className="flex flex-col gap-1.5 mt-1">
                                                        {executedActions.length > 0 && (
                                                            <div className="mb-1 rounded border border-green-500/40 bg-green-500/10 p-2">
                                                                <div className="mb-1 font-mono text-[10px] tracking-wider text-green-700 dark:text-green-400">CONFIRMED ACTIONS</div>
                                                                {executedActions.map(action => (
                                                                    <div key={action} className="font-mono text-[11px] text-green-700 dark:text-green-400">✓ {action.toUpperCase()}</div>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {fm.restoreActions.map((r, ri) => (
                                                            <button
                                                                key={ri}
                                                                disabled={!isRecoveryActionExecuted(ri)}
                                                                className={`self-start rounded px-4 py-1.5 text-[11px] font-mono transition-all duration-200 border ${isRecoveryActionExecuted(ri) ? 'border-green-500 text-green-500 bg-green-500/10 cursor-pointer' : 'border-gray-300 dark:border-gray-700 text-gray-400 bg-gray-400/10 cursor-not-allowed'}`}
                                                                onClick={() => { if (ocapStep === 4) alert(r.alertMessage); }}
                                                            >
                                                                {isRecoveryActionExecuted(ri) && <span className="mr-1">✓</span>}{r.name}
                                                            </button>
                                                        ))}
                                                        <button
                                                            disabled={executedActions.length === 0}
                                                            className={`self-start rounded px-4 py-1.5 text-[11px] font-mono transition-all duration-200 border mt-1 ${executedActions.length > 0 ? 'border-green-500 text-green-500 bg-green-500/10 hover:bg-green-500/25 cursor-pointer' : 'border-gray-300 dark:border-gray-700 text-gray-400 bg-gray-400/10 cursor-not-allowed'}`}
                                                            onClick={() => { if (executedActions.length > 0) { alert(step.alertMsg); setOcapStep(5); } }}
                                                        >
                                                            CONFIRM HARDWARE RECOVERY COMPLETE
                                                        </button>
                                                    </div>
                                                ) : stepNum === 6 ? (
                                                    <button
                                                        className={`self-start rounded px-4 py-1.5 text-[11px] font-mono cursor-pointer transition-all duration-200 border ${validationClicked ? 'border-green-500 text-green-500 bg-green-500/10' : 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-500/10 hover:bg-blue-500/25'}`}
                                                        onClick={handleValidationClick}
                                                    >
                                                        {step.btnLabel}
                                                    </button>
                                                ) : (
                                                    <button
                                                        className={`self-start rounded px-4 py-1.5 text-[11px] font-mono cursor-pointer transition-all duration-200 border ${isActive ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-500/10 hover:bg-blue-500/25' : isDone ? 'border-green-500 text-green-500 bg-green-500/10' : 'border-gray-400 text-gray-400 bg-gray-400/10'}`}
                                                        onClick={() => handleOcapClick(stepNum, step.alertMsg, stepNum + 1)}
                                                    >
                                                        {step.btnLabel}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {showActionPopup && selectedCause && (() => {
                    const rootCause = rootCauseOptions.find(option => option.key === selectedCause);
                    if (!rootCause) return null;
                    return (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true" aria-labelledby="recovery-actions-title">
                            <div className="w-full max-w-xl rounded-lg border border-blue-500/50 bg-white p-5 shadow-2xl dark:bg-gray-900">
                                <div className="flex items-start justify-between gap-4 border-b border-gray-200 pb-3 dark:border-gray-700">
                                    <div>
                                        <h3 id="recovery-actions-title" className="font-mono text-sm font-bold tracking-wider text-blue-600 dark:text-blue-400">RECOMMENDED RECOVERY ACTIONS</h3>
                                        <p className="mt-2 font-mono text-xs text-gray-700 dark:text-gray-300">ROOT CAUSE: {rootCause.label.toUpperCase()}</p>
                                    </div>
                                    <button type="button" className="text-lg text-gray-500 hover:text-gray-900 dark:hover:text-white" onClick={() => setShowActionPopup(false)} aria-label="Close recovery actions">✕</button>
                                </div>
                                <ul className="my-4 flex flex-col gap-2">
                                    {rootCause.actions.map(action => (
                                        <li key={action} className="flex items-center justify-between gap-3 rounded border border-green-500/40 bg-green-500/10 px-3 py-2 font-mono text-xs text-green-700 dark:text-green-400">
                                            <span>{action.toUpperCase()}</span>
                                            <span className="font-bold">✓</span>
                                        </li>
                                    ))}
                                </ul>
                                {rootCause.partialMitigation && (
                                    <div className="mb-4 rounded border border-yellow-500/60 bg-yellow-500/10 px-3 py-2 font-mono text-xs font-bold text-yellow-700 dark:text-yellow-400">⚠ PARTIAL MITIGATION ONLY</div>
                                )}
                                <div className="flex justify-end gap-2">
                                    <button type="button" className="rounded border border-gray-400 px-4 py-2 font-mono text-xs text-gray-600 dark:text-gray-300" onClick={() => setShowActionPopup(false)}>CLOSE</button>
                                    <button type="button" className="rounded border border-green-500 bg-green-500/10 px-4 py-2 font-mono text-xs font-bold text-green-700 dark:text-green-400" onClick={() => handleExecuteRootCause(rootCause.key)}>EXECUTE RECOVERY ACTIONS</button>
                                </div>
                            </div>
                        </div>
                    );
                })()}
            </div>
        </div>
    );
};

export default Failure;