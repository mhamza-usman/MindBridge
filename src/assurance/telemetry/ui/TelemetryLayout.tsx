"use client";
import React, { useState, useEffect, useMemo } from 'react';
import IMUGraph from '../components/IMUGraph';
import SensorTimeline from '../components/SensorTimeline';
import Lidar2DView from '../components/Lidar2DView';
import CameraView from '../components/CameraView';
import FusionView from '../components/FusionView';
import { TelemetrySource, TelemetryData } from '../TelemetrySource';
import { TelemetryBuffer } from '../TelemetryBuffer';

interface TelemetryLayoutProps {
  sseUrl: string;
  onBack: () => void;
}

/** Collapsible panel wrapper: slim header bar when collapsed. */
function Panel({
  id, title, collapsed, onToggle, span, children,
}: {
  id: string; title: string; collapsed: boolean; onToggle: (id: string) => void;
  span?: string; children: React.ReactNode;
}) {
  if (collapsed) {
    return (
      <button
        onClick={() => onToggle(id)}
        style={{
          gridColumn: span,
          padding: '8px 14px',
          borderRadius: '8px',
          border: '1px dashed #d1d5db',
          background: '#f9fafb',
          color: '#6b7280',
          fontSize: '12px',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        ▸ {title} (collapsed)
      </button>
    );
  }
  return (
    <div style={{ gridColumn: span, position: 'relative' }}>
      <button
        onClick={() => onToggle(id)}
        title="Collapse panel"
        style={{
          position: 'absolute', bottom: 6, right: 6, zIndex: 2,
          width: 22, height: 22, borderRadius: 6, border: '1px solid #e5e7eb',
          background: 'rgba(255,255,255,.85)', color: '#6b7280',
          fontSize: 11, cursor: 'pointer', lineHeight: 1,
        }}
      >
        –
      </button>
      {children}
    </div>
  );
}

export default function TelemetryLayout({ sseUrl, onBack }: TelemetryLayoutProps) {
  const [telemetryData, setTelemetryData] = useState<TelemetryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [fusionMode, setFusionMode] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const togglePanel = (id: string) => setCollapsed(c => ({ ...c, [id]: !c[id] }));
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
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setFusionMode(f => !f)}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              background: fusionMode ? '#0a66ff' : '#ffffff',
              color: fusionMode ? '#ffffff' : '#374151',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {fusionMode ? 'Exit Fusion' : 'Sensor Fusion'}
          </button>
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
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
          Loading telemetry data...
        </div>
      ) : (
        <>
          {/* Engineering grid layout */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            {fusionMode ? (
              <Panel id="fusion" title="Sensor Fusion" collapsed={!!collapsed.fusion} onToggle={togglePanel} span="1 / -1">
                <FusionView
                  cameraKey="hawk_0_left_rgb_image"
                  camera={buffer.getLatestCameraDataForTopic('hawk_0_left_rgb_image')}
                  lidar={latestLidar ?? null}
                  width={1016}
                  height={420}
                  label="DERIVED: LiDAR points projected onto hawk_0_left_rgb using bag calibration (CameraInfo + tf_static). Approximate alignment."
                />
              </Panel>
            ) : (
            <>
            {/* Camera Feeds - show all 3 cameras */}
            {cameraTopics.map((topic) => {
              const camData = buffer.getLatestCameraDataForTopic(topic)
                || { width: 0, height: 0, has_image: false };
              return (
                <Panel key={topic} id={`cam-${topic}`} title={topic.replace(/_/g, ' ')} collapsed={!!collapsed[`cam-${topic}`]} onToggle={togglePanel}>
                  <CameraView
                    data={camData}
                    width={335}
                    height={250}
                    label={topic.replace(/_/g, ' ')}
                  />
                </Panel>
              );
            })}
            </>
            )}

            {/* LiDAR Point Cloud - spans 2 columns */}
            <Panel id="lidar" title="LiDAR 2D" collapsed={!!collapsed.lidar} onToggle={togglePanel} span="1 / 3">
              <Lidar2DView
                data={latestLidar || { points: [], num_points: 0, has_lidar: false }}
                width={686}
                height={375}
              />
            </Panel>

            {/* IMU Telemetry - spans 1 column */}
            <Panel id="imu" title="IMU" collapsed={!!collapsed.imu} onToggle={togglePanel} span="3 / 4">
              <IMUGraph
                data={imuData}
                width={335}
                height={375}
              />
            </Panel>

            {/* Sensor Timeline - spans full width */}
            <Panel id="timeline" title="Sensor Timeline" collapsed={!!collapsed.timeline} onToggle={togglePanel} span="1 / -1">
              <SensorTimeline
                data={timelineData}
                width={1016}
                height={200}
              />
            </Panel>
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
