"use client";

import { useState, useEffect } from 'react';
import {
  EquipmentState,
  AlarmEvent,
  OCAPCase,
  ChecklistItem,
  Notification,
  UserRole,
  AlarmType,
  ALARM_SIM_CONFIGS,
} from './types';
import { generateMockAlarmEvent } from './mockData';
import { FAILURE_MODES } from '../data/failureModes';
import EquipmentScreen from './EquipmentScreen';
import ProcessScreen from './ProcessScreen';
import OCAPPanel from './components/OCAPPanel';

interface AlarmModuleProps {
  alarmType?: AlarmType;
}

export default function AlarmModule({ alarmType = 'bridging' }: AlarmModuleProps) {
  const [activeTab, setActiveTab] = useState<'rtm' | 'ocap'>('rtm');
  const [equipmentState, setEquipmentState] = useState<EquipmentState>('RUN');
  const [activeAlarms, setActiveAlarms] = useState<AlarmEvent[]>([]);
  const [ocapCases, setOcapCases] = useState<OCAPCase[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const [selectedRootCauseIndex, setSelectedRootCauseIndex] = useState(0);
  const [recoveryExecuted, setRecoveryExecuted] = useState(false);
  const [validationPassed, setValidationPassed] = useState(false);

  const [currentUser] = useState({ id: 'user-001', name: 'Operator Smith', role: 'operator' as UserRole });

  const config = ALARM_SIM_CONFIGS[alarmType];
  const failureMode = FAILURE_MODES.find(fm => fm.id === alarmType);
  const interactiveOcap = failureMode?.interactiveOcap;

  useEffect(() => {
    setSelectedRootCauseIndex(0);
    setRecoveryExecuted(false);
    setValidationPassed(false);
  }, [alarmType]);

  useEffect(() => {
    const checkInterval = setInterval(() => {
      if (equipmentState === 'E-STOP') return;

      if (equipmentState === 'RUN' && Math.random() < 0.05) {
        const newAlarm = generateMockAlarmEvent(alarmType);
        setActiveAlarms(prev => [...prev, newAlarm]);

        addNotification({
          type: 'alarm-trip',
          severity: 'critical',
          message: `Alarm ${newAlarm.alarmId} triggered on ${newAlarm.dieId}`,
          targetRoles: ['operator', 'process-engineer']
        });
      }
    }, 10000);

    return () => clearInterval(checkInterval);
  }, [equipmentState, alarmType]);

  const handleStateChange = (newState: EquipmentState) => {
    console.log(`Equipment state change: ${equipmentState} → ${newState}`);
    setEquipmentState(newState);

    addNotification({
      type: 'alarm-trip',
      severity: 'warning',
      message: `Equipment state changed to ${newState}`,
      targetRoles: ['operator', 'process-engineer', 'supervisor']
    });
  };

  const handleAlarmAcknowledge = (alarmId: string) => {
    setActiveAlarms(prev => prev.map(alarm =>
      alarm.id === alarmId
        ? {
            ...alarm,
            acknowledged: true,
            acknowledgedBy: currentUser.name,
            acknowledgedAt: new Date()
          }
        : alarm
    ));

    console.log(`Alarm ${alarmId} acknowledged by ${currentUser.name}`);
  };

  const handleChecklistUpdate = (alarmId: string, checklist: ChecklistItem[]) => {
    setActiveAlarms(prev => prev.map(alarm =>
      alarm.id === alarmId
        ? { ...alarm, checklistStatus: checklist }
        : alarm
    ));

    const allComplete = checklist.every(item => item.completed);
    if (allComplete) {
      console.log(`All checklist items completed for alarm ${alarmId}`);
    }
  };

  const handleCreateOCAPCase = (caseData: Partial<OCAPCase>) => {
    const newCase: OCAPCase = {
      id: `OCAP-${Date.now()}`,
      recipeId: caseData.recipeId || 'RCP-TCB-001',
      toolId: caseData.toolId || 'TOOL-001',
      stage: caseData.stage || 'CONTAINMENT',
      createdAt: caseData.createdAt || new Date(),
      createdBy: caseData.createdBy || currentUser.name,
      linkedAlarmIds: caseData.linkedAlarmIds || [],
      linkedSpcEventId: caseData.linkedSpcEventId || '',
      auditTrail: caseData.auditTrail || []
    };

    setOcapCases(prev => [...prev, newCase]);

    addNotification({
      type: 'spc-violation',
      severity: 'warning',
      message: `OCAP Case ${newCase.id} created due to SPC violation`,
      targetRoles: ['process-engineer', 'supervisor']
    });

    console.log('OCAP case created:', newCase.id);
  };

  const handleUpdateOCAPCase = (caseId: string, updates: Partial<OCAPCase>) => {
    setOcapCases(prev => prev.map(c =>
      c.id === caseId ? { ...c, ...updates } : c
    ));

    console.log(`OCAP case ${caseId} updated:`, updates);
  };

  const addNotification = (notification: Omit<Notification, 'id' | 'timestamp' | 'acknowledged'>) => {
    const newNotification: Notification = {
      id: `notif-${Date.now()}`,
      timestamp: new Date(),
      acknowledged: false,
      ...notification
    };

    setNotifications(prev => [newNotification, ...prev].slice(0, 50));
  };

  const handleDismissNotification = (id: string) => {
    setNotifications(prev => prev.map(n =>
      n.id === id ? { ...n, acknowledged: true } : n
    ));
  };

  const unacknowledgedCount = notifications.filter(n => !n.acknowledged).length;

  return (
    <div className="alarm-module">
      <div className="alarm-module-header">
        <div className="header-left">
          <h1>TCB Equipment Alarm & SPC/OCAP Module</h1>
          <div className={`equipment-state-pill state-${equipmentState.toLowerCase()}`}>
            {equipmentState}
          </div>
          <div className="alarm-type-badge">{config.name}</div>
        </div>

        <div className="header-right">
          <div className="user-info">
            <span className="user-name">{currentUser.name}</span>
            <span className="user-role">({currentUser.role})</span>
          </div>

          {unacknowledgedCount > 0 && (
            <div className="notification-badge">
              <span className="badge-icon">🔔</span>
              <span className="badge-count">{unacknowledgedCount}</span>
            </div>
          )}
        </div>
      </div>

      <div className="unified-tabs">
        <button
          className={`unified-tab ${activeTab === 'rtm' ? 'active' : ''}`}
          onClick={() => setActiveTab('rtm')}
        >
          <span className="tab-hex">⬡</span>
          Equipment RTM / Process SPC chart
          {activeAlarms.length > 0 && (
            <span className="tab-badge">{activeAlarms.length}</span>
          )}
        </button>

        <button
          className={`unified-tab ${activeTab === 'ocap' ? 'active' : ''}`}
          onClick={() => setActiveTab('ocap')}
        >
          <span className="tab-hex">⬡</span>
          Equipment troubleshooting, Process OCAP
          {ocapCases.filter(c => c.stage !== 'CLOSED').length > 0 && (
            <span className="tab-badge">{ocapCases.filter(c => c.stage !== 'CLOSED').length}</span>
          )}
        </button>
      </div>

      <div className="unified-panel">
        {activeTab === 'rtm' ? (
          <EquipmentScreen
            alarmType={alarmType}
            currentState={equipmentState}
            onStateChange={handleStateChange}
            activeAlarms={activeAlarms}
            onAlarmAcknowledge={handleAlarmAcknowledge}
            onChecklistUpdate={handleChecklistUpdate}
          />
        ) : (
          <div className="ocap-split-view">
            <div className="ocap-spc-side">
              <ProcessScreen
                alarmType={alarmType}
                activeOCAPCases={ocapCases}
                onCreateOCAPCase={handleCreateOCAPCase}
                onUpdateOCAPCase={handleUpdateOCAPCase}
              />
            </div>
            {interactiveOcap && (
              <div className="ocap-panel-side">
                <OCAPPanel
                  ocapData={interactiveOcap}
                  alarmType={alarmType}
                  selectedIndex={selectedRootCauseIndex}
                  onSelectRootCause={setSelectedRootCauseIndex}
                  recoveryExecuted={recoveryExecuted}
                  onExecuteRecovery={() => setRecoveryExecuted(true)}
                  validationPassed={validationPassed}
                  onValidationPass={() => setValidationPassed(true)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {unacknowledgedCount > 0 && (
        <div className="notification-panel">
          <div className="notification-header">
            <h4>Recent Notifications</h4>
            <button onClick={() => setNotifications(prev => prev.map(n => ({ ...n, acknowledged: true })))}>
              Dismiss All
            </button>
          </div>
          <div className="notification-list">
            {notifications.filter(n => !n.acknowledged).slice(0, 5).map(notif => (
              <div key={notif.id} className={`notification-item severity-${notif.severity}`}>
                <div className="notif-message">{notif.message}</div>
                <div className="notif-time">{notif.timestamp.toLocaleTimeString()}</div>
                <button onClick={() => handleDismissNotification(notif.id)} className="notif-dismiss">
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
