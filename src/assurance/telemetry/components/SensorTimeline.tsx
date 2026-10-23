"use client";
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface SensorTimelineData {
  t: number;
  cam_age_ms: number;
  lidar_age_ms: number;
  cam_rate: number;
  lidar_rate: number;
  perception_pct: number;
  uncertainty_pct: number;
}

interface SensorTimelineProps {
  data: SensorTimelineData[];
  width?: number;
  height?: number;
}

export default function SensorTimeline({ data, width = 500, height = 200 }: SensorTimelineProps) {
  const windowSize = 20; // 20 second window
  
  // Filter to last N seconds
  const latestTime = data.length > 0 ? data[data.length - 1].t : 0;
  const filteredData = data.filter(d => d.t >= latestTime - windowSize);

  return (
    <div style={{ width, height, background: '#ffffff', borderRadius: '8px', padding: '12px', border: '1px solid #e5e7eb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#111827' }}>
          Sensor Ages
        </h4>
        <span style={{ fontSize: '11px', color: '#6b7280' }}>
          Window: {windowSize}s | Points: {filteredData.length}
        </span>
      </div>
      <ResponsiveContainer width={width} height={height - 45}>
        <LineChart data={filteredData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis 
            dataKey="t" 
            type="number" 
            domain={['dataMin', 'dataMax']}
            tickFormatter={(t) => `${t.toFixed(1)}s`}
            stroke="#6b7280"
            style={{ fontSize: '11px' }}
          />
          <YAxis 
            stroke="#6b7280"
            style={{ fontSize: '11px' }}
            label={{ value: 'Age (ms)', angle: -90, position: 'insideLeft', style: { fontSize: '10px' } }}
          />
          <Tooltip 
            labelFormatter={(value) => `Time: ${value.toFixed(2)}s`}
            contentStyle={{ fontSize: '11px', backgroundColor: '#ffffff', border: '1px solid #e5e7eb' }}
          />
          <Legend wrapperStyle={{ fontSize: '11px' }} />
          <Line 
            type="monotone" 
            dataKey="cam_age_ms" 
            stroke="#f59e0b" 
            strokeWidth={1.5}
            dot={false}
            name="Camera Age"
          />
          <Line 
            type="monotone" 
            dataKey="lidar_age_ms" 
            stroke="#10b981" 
            strokeWidth={1.5}
            dot={false}
            name="LiDAR Age"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
