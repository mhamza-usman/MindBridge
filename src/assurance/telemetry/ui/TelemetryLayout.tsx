"use client";
import React, { useState, useEffect, useMemo } from 'react';
import IMUGraph from '../components/IMUGraph';
import SensorTimeline from '../components/SensorTimeline';
import Lidar2DView from '../components/Lidar2DView';
import CameraView from '../components/CameraView';
import { TelemetrySource, TelemetryData } from '../TelemetrySource';
import { TelemetryBuffer } from '../TelemetryBuffer';

interface TelemetryLayoutProps {
  sseUrl: string;
  onBack: () => void;
}

export default function TelemetryLayout({ sseUrl, onBack }: TelemetryLayoutProps) {
  const [telemetryData, setTelemetryData] = useState<TelemetryData[]>([]);
  const [loading, setLoading] = useState(true);
  const buffer = useMemo(() => new TelemetryBuffer(1000, 60), []);

  useEffect(() => {
    const source = new TelemetrySource({ sseUrl });

    source.onSnapshot((data) => {
      buffer.add(data);
      setTelemetryData(buffer.getAll());
      setLoading(false);
    });

    source.start();

    return () => {
      source.stop();
    };
  }, [sseUrl, buffer]);

  const latestCamera = useMemo(() => buffer.getLatestCameraData(), [telemetryData]);
  const cameraTopics = useMemo(() => buffer.getAllCameraTopics(), [telemetryData]);
  const latestLidar = useMemo(() => buffer.getLatestLidarData(), [telemetryData]);
  const imuData = useMemo(() => buffer.getIMUData(), [telemetryData]);
  const timelineData = useMemo(() => buffer.getSensorTimelineData(), [telemetryData]);

  return (
    <div style={{
      padding: '16px',
      background: '#f9fafb',
      minHeight: '100vh',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#111827' }}>
            Live Telemetry Dashboard
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#6b7280' }}>
            Real-time sensor data from NVIDIA r2b 2023 dataset
          </p>
        </div>
        <button
          onClick={onBack}
          style={{
            padding: '8px 16px',
            borderRadius: '6px',
            border: '1px solid #d1d5db',
            background: '#ffffff',
            color: '#374151',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          ← Back to Home
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
          Loading telemetry data...
        </div>
      ) : (
        <>
          {/* Engineering grid layout */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            {/* Camera Feeds - show all 3 cameras */}
            {cameraTopics.map((topic, idx) => {
              const camData = typeof latestCamera === 'object' && latestCamera[topic] 
                ? latestCamera[topic] 
                : { width: 0, height: 0, has_image: false };
              return (
                <div key={topic}>
                  <CameraView
                    data={camData}
                    width={335}
                    height={250}
                    label={topic.replace(/_/g, ' ')}
                  />
                </div>
              );
            })}

            {/* LiDAR Point Cloud - spans 2 columns */}
            <div style={{ gridColumn: '1 / 3' }}>
              <Lidar2DView
                data={latestLidar || { points: [], num_points: 0, has_lidar: false }}
                width={686}
                height={375}
              />
            </div>

            {/* IMU Telemetry - spans 1 column */}
            <div style={{ gridColumn: '3 / 4' }}>
              <IMUGraph
                data={imuData}
                width={335}
                height={375}
              />
            </div>

            {/* Sensor Timeline - spans full width */}
            <div style={{ gridColumn: '1 / -1' }}>
              <SensorTimeline
                data={timelineData}
                width={1016}
                height={200}
              />
            </div>
          </div>

          {/* Status bar */}
          <div style={{
            marginTop: '16px',
            padding: '12px',
            background: '#ffffff',
            borderRadius: '8px',
            border: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>
              <span style={{ fontWeight: 600, color: '#111827' }}>Data Points:</span> {telemetryData.length} |
              <span style={{ fontWeight: 600, color: '#111827', marginLeft: '8px' }}>Window:</span> 60s |
              <span style={{ fontWeight: 600, color: '#111827', marginLeft: '8px' }}>Source:</span> r2b_live_telemetry
            </div>
            <div style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>
              ● Streaming Active
            </div>
          </div>
        </>
      )}
    </div>
  );
}
