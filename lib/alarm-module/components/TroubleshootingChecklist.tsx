"use client"
import { useState } from 'react';
import { AlarmEvent, ChecklistItem } from '../types';

interface TroubleshootingChecklistProps {
  alarm: AlarmEvent;
  onUpdate: (checklist: ChecklistItem[]) => void;
}

export default function TroubleshootingChecklist({ alarm, onUpdate }: TroubleshootingChecklistProps) {
  const [expandedCategories, setExpandedCategories] = useState<string[]>(['visual', 'test', 'restore']);
  const toggleCategory = (category: string) => { setExpandedCategories(prev => prev.includes(category) ? prev.filter(c => c !== category) : [...prev, category]); };
  const handleToggleItem = (itemId: string) => {
    const updatedChecklist = alarm.checklistStatus.map(item => {
      if (item.id === itemId) { return { ...item, completed: !item.completed, completedBy: !item.completed ? 'current-user' : undefined, completedAt: !item.completed ? new Date() : undefined }; }
      return item;
    });
    onUpdate(updatedChecklist);
  };
  const handleAddNote = (itemId: string, notes: string) => {
    const updatedChecklist = alarm.checklistStatus.map(item => { if (item.id === itemId) { return { ...item, notes }; } return item; });
    onUpdate(updatedChecklist);
  };
  const getCategoryTitle = (category: string) => { switch (category) { case 'visual': return '1. Visual Inspection'; case 'test': return '2. Tests to Run'; case 'restore': return '3. Actions to Restore Condition'; default: return category; } };
  const groupedItems = { visual: alarm.checklistStatus.filter(item => item.category === 'visual'), test: alarm.checklistStatus.filter(item => item.category === 'test'), restore: alarm.checklistStatus.filter(item => item.category === 'restore') };
  const allCompleted = alarm.checklistStatus.every(item => item.completed);
  const completedCount = alarm.checklistStatus.filter(item => item.completed).length;
  return (
    <div className="troubleshooting-checklist">
      <div className="checklist-header">
        <h3>Troubleshooting Checklist - {alarm.alarmId}</h3>
        <div className="checklist-progress">
          <span className="progress-text">{completedCount} / {alarm.checklistStatus.length} completed</span>
          <div className="progress-bar"><div className="progress-fill" style={{ width: `${(completedCount / alarm.checklistStatus.length) * 100}%` }} /></div>
          {allCompleted && <span className="all-complete-badge">✓ All Complete</span>}
        </div>
      </div>
      {(['visual', 'test', 'restore'] as const).map(category => (
        <div key={category} className="checklist-category">
          <button className="category-header" onClick={() => toggleCategory(category)}>
            <span className="category-title">{getCategoryTitle(category)}</span>
            <span className="category-count">{groupedItems[category].filter(i => i.completed).length} / {groupedItems[category].length}</span>
            <span className="expand-icon">{expandedCategories.includes(category) ? '▼' : '▶'}</span>
          </button>
          {expandedCategories.includes(category) && (
            <div className="checklist-items">
              {groupedItems[category].map(item => (
                <div key={item.id} className={`checklist-item ${item.completed ? 'completed' : ''}`}>
                  <div className="item-main">
                    <label className="item-checkbox">
                      <input type="checkbox" checked={item.completed} onChange={() => handleToggleItem(item.id)} className="hmi-checkbox" />
                      <span className="item-title">{item.title}</span>
                    </label>
                    {item.completed && item.completedBy && <span className="completion-info">by {item.completedBy} at {item.completedAt?.toLocaleTimeString()}</span>}
                  </div>
                  <p className="item-description">{item.description}</p>
                  <div className="item-notes">
                    <textarea placeholder="Add notes, observations, or results..." value={item.notes || ''} onChange={(e) => handleAddNote(item.id, e.target.value)} rows={2} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {!allCompleted && <div className="checklist-warning">⚠ Equipment cannot return to RUN until all checklist items are completed</div>}
    </div>
  );
}
