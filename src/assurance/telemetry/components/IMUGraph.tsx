"use client";
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface IMUData {
  t: number;
  accel_x: number;
  accel_y: number;
  accel_z: number;
  accel_mag: number;
  gyro_x: number;
  gyro_y: number;
  gyro_z: number;
  gyro_mag: number;
}

interface IMUGraphProps {
  data: IMUData[];
  width?: number;
  height?: number;
}

export default function IMUGraph({ data, width = 500, height = 250 }: IMUGraphProps) {
  const windowSize = 10; // 10 second window

  // Filter to last N seconds
  const latestTime = data.length > 0 ? data[data.length - 1].t : 0;
  const filteredData = data.filter(d => d.t >= latestTime - windowSize);

  return (
    <div style={{ width, height, background: '#ffffff', borderRadius: '8px', padding: '12px', border: '1px solid #e5e7eb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#111827' }}>
          IMU Telemetry
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
          />
          <Tooltip
            labelFormatter={(value) => `Time: ${value.toFixed(2)}s`}
            contentStyle={{ fontSize: '11px', backgroundColor: '#ffffff', border: '1px solid #e5e7eb' }}
          />
          <Legend wrapperStyle={{ fontSize: '11px' }} />
          <Line
            type="monotone"
            dataKey="accel_mag"
            stroke="#ef4444"
            strokeWidth={1.5}
            dot={false}
            name="Accel Mag (m/s²)"
          />
          <Line
            type="monotone"
            dataKey="gyro_mag"
            stroke="#3b82f6"
            strokeWidth={1.5}
            dot={false}
            name="Gyro Mag (rad/s)"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
