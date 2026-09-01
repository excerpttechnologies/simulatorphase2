"use client"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { SPCDataPoint, SPCControlLimits } from '../types';

interface SPCChartPanelProps {
  data: SPCDataPoint[];
  controlLimits: SPCControlLimits | null;
}

export default function SPCChartPanel({ data, controlLimits }: SPCChartPanelProps) {
  if (!controlLimits || data.length === 0) {
    return <div className="spc-loading"><p>Loading SPC data...</p></div>;
  }
  const chartData = data.map((point, idx) => ({
    index: idx + 1, peakForce: point.peakForce, bridgingPpm: point.bridgingDefectPpm || 0,
    movingRange: point.movingRange || 0, centerline: controlLimits.centerline,
    ucl: controlLimits.ucl, lcl: controlLimits.lcl, flagged: point.flagged,
    flagReason: point.flagReason, lotId: point.lotId, dieId: point.dieId
  }));
  const CustomDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (payload.flagged) {
      return (<g><circle cx={cx} cy={cy} r={6} fill="var(--accent-red)" stroke="white" strokeWidth={2} /><text x={cx} y={cy - 12} textAnchor="middle" fill="var(--accent-red)" fontSize={10}>!</text></g>);
    }
    return <circle cx={cx} cy={cy} r={4} fill="var(--accent-cyan)" />;
  };
  return (
    <div className="spc-chart-panel">
      <div className="chart-container">
        <h3>I Chart: Peak Bond Force (N)</h3>
        <div style={{ width: '100%', height: 350 }}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--panel-border)" />
              <XAxis dataKey="index" stroke="var(--dim)" label={{ value: 'Sample Number', position: 'insideBottom', offset: -10, fill: 'var(--dim)' }} />
              <YAxis stroke="var(--dim)" label={{ value: 'Force (N)', angle: -90, position: 'insideLeft', fill: 'var(--dim)' }} domain={[controlLimits.lcl - 2, controlLimits.ucl + 2]} />
              <Tooltip contentStyle={{ backgroundColor: 'var(--panel)', border: '1px solid var(--panel-border)', borderRadius: '4px', color: 'var(--text)' }} formatter={(value: number, name: string) => { if (name === 'peakForce') return [value.toFixed(3) + ' N', 'Peak Force']; return [value, name]; }} labelFormatter={(index) => `Sample ${index}`} />
              <Legend wrapperStyle={{ color: 'var(--text)' }} />
              <ReferenceLine y={controlLimits.ucl} stroke="var(--accent-red)" strokeDasharray="5 5" strokeWidth={2} label={{ value: 'UCL', position: 'right', fill: 'var(--accent-red)' }} />
              <ReferenceLine y={controlLimits.centerline} stroke="var(--accent-green)" strokeDasharray="3 3" strokeWidth={2} label={{ value: 'CL', position: 'right', fill: 'var(--accent-green)' }} />
              <ReferenceLine y={controlLimits.lcl} stroke="var(--accent-red)" strokeDasharray="5 5" strokeWidth={2} label={{ value: 'LCL', position: 'right', fill: 'var(--accent-red)' }} />
              <Line type="monotone" dataKey="peakForce" stroke="var(--accent-cyan)" strokeWidth={2} dot={<CustomDot />} name="Peak Force" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="chart-container">
        <h3>MR Chart: Moving Range</h3>
        <div style={{ width: '100%', height: 250 }}>
          <ResponsiveContainer>
            <LineChart data={chartData.slice(1)} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--panel-border)" />
              <XAxis dataKey="index" stroke="var(--dim)" label={{ value: 'Sample Number', position: 'insideBottom', offset: -10, fill: 'var(--dim)' }} />
              <YAxis stroke="var(--dim)" label={{ value: 'Moving Range', angle: -90, position: 'insideLeft', fill: 'var(--dim)' }} domain={[0, controlLimits.mrUcl + 1]} />
              <Tooltip contentStyle={{ backgroundColor: 'var(--panel)', border: '1px solid var(--panel-border)', borderRadius: '4px', color: 'var(--text)' }} />
              <Legend wrapperStyle={{ color: 'var(--text)' }} />
              <ReferenceLine y={controlLimits.mrUcl} stroke="var(--accent-red)" strokeDasharray="5 5" label={{ value: 'MR UCL', position: 'right', fill: 'var(--accent-red)' }} />
              <ReferenceLine y={controlLimits.mrCenterline} stroke="var(--accent-green)" strokeDasharray="3 3" label={{ value: 'MR̄', position: 'right', fill: 'var(--accent-green)' }} />
              <Line type="monotone" dataKey="movingRange" stroke="var(--accent-magenta)" strokeWidth={2} dot={{ fill: 'var(--accent-magenta)', r: 4 }} name="Moving Range" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="chart-container">
        <h3>Secondary Metric: Bump Bridging Defects (ppm)</h3>
        <div style={{ width: '100%', height: 250 }}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--panel-border)" />
              <XAxis dataKey="index" stroke="var(--dim)" label={{ value: 'Sample Number', position: 'insideBottom', offset: -10, fill: 'var(--dim)' }} />
              <YAxis stroke="var(--dim)" label={{ value: 'Defect Rate (ppm)', angle: -90, position: 'insideLeft', fill: 'var(--dim)' }} />
              <Tooltip contentStyle={{ backgroundColor: 'var(--panel)', border: '1px solid var(--panel-border)', borderRadius: '4px', color: 'var(--text)' }} />
              <Legend wrapperStyle={{ color: 'var(--text)' }} />
              <Line type="monotone" dataKey="bridgingPpm" stroke="var(--accent-amber)" strokeWidth={2} dot={{ fill: 'var(--accent-amber)', r: 4 }} name="Bridging Defects" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      {data.some(p => p.flagged) && (
        <div className="flagged-points-summary">
          <h4>SPC Rule Violations Detected</h4>
          <div className="violation-list">
            {data.filter(p => p.flagged).map(point => (
              <div key={point.id} className="violation-item">
                <span className="violation-sample">Sample #{data.indexOf(point) + 1}</span>
                <span className="violation-lot monospace">{point.lotId}</span>
                <span className="violation-force monospace">{point.peakForce.toFixed(3)} N</span>
                <span className="violation-reason">{point.flagReason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
