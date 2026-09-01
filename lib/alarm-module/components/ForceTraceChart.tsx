"use client"
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Area, ComposedChart } from 'recharts';
import { ForceTelemetry } from '../types';

interface ForceTraceChartProps {
  goldenProfile: ForceTelemetry[];
  liveTrace: ForceTelemetry[];
  upperControlLimit: number;
  lowerControlLimit: number;
  setpoint: number;
}

export default function ForceTraceChart({ goldenProfile, liveTrace, upperControlLimit, lowerControlLimit, setpoint }: ForceTraceChartProps) {
  const chartData = goldenProfile.map((golden, idx) => {
    const live = liveTrace[idx];
    return { position: golden.position, goldenForce: golden.force, liveForce: live?.force || null, ucl: upperControlLimit, lcl: lowerControlLimit, phase: golden.phase };
  });
  return (
    <div style={{ width: '100%', height: 400 }}>
      <ResponsiveContainer>
        <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--panel-border)" />
          <XAxis dataKey="position" stroke="var(--dim)" label={{ value: 'Z-Position (mm)', position: 'insideBottom', offset: -10, fill: 'var(--dim)' }} domain={[0, 'dataMax']} />
          <YAxis stroke="var(--dim)" label={{ value: 'Bond Force (N)', angle: -90, position: 'insideLeft', fill: 'var(--dim)' }} domain={[0, 60]} />
          <Tooltip contentStyle={{ backgroundColor: 'var(--panel)', border: '1px solid var(--panel-border)', borderRadius: '4px', color: 'var(--text)' }} formatter={(value: number) => value?.toFixed(2) + ' N'} />
          <Legend wrapperStyle={{ color: 'var(--text)' }} />
          <Area type="monotone" dataKey="ucl" stroke="none" fill="rgba(255, 61, 61, 0.1)" name="Control Band" />
          <ReferenceLine y={upperControlLimit} stroke="var(--accent-red)" strokeDasharray="5 5" label={{ value: 'UCL', position: 'right', fill: 'var(--accent-red)' }} />
          <ReferenceLine y={setpoint} stroke="var(--accent-green)" strokeDasharray="3 3" label={{ value: 'Setpoint', position: 'right', fill: 'var(--accent-green)' }} />
          <ReferenceLine y={lowerControlLimit} stroke="var(--accent-red)" strokeDasharray="5 5" label={{ value: 'LCL', position: 'right', fill: 'var(--accent-red)' }} />
          <Line type="monotone" dataKey="goldenForce" stroke="var(--dim)" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Golden Reference" />
          <Line type="monotone" dataKey="liveForce" stroke="var(--accent-cyan)" strokeWidth={3} dot={{ fill: 'var(--accent-cyan)', r: 3 }} name="Live Force" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
