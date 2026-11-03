"use client";
import React, { useState, useMemo } from 'react';
import CameraView from '../telemetry/components/CameraView';
import { TelemetryBuffer } from '../telemetry/TelemetryBuffer';
import { TelemetrySource } from '../telemetry/TelemetrySource';

type Layout = '1x1' | '2x2' | '3x3' | 'focus';

interface CameraWallProps {
  sseUrl: string;
  onBack: () => void;
}

export default function CameraWall({ sseUrl, onBack }: CameraWallProps) {
  const [layout, setLayout] = useState<Layout>('2x2');
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [telemetryData, setTelemetryData] = useState<any[]>([]);
  const buffer = useMemo(() => new TelemetryBuffer(1000, 60), []);

  React.useEffect(() => {
    const source = new TelemetrySource({ sseUrl });
    source.onSnapshot((data) => {
      buffer.add(data);
      setTelemetryData(buffer.getAll());
    });
    source.start();
    return () => source.stop();
  }, [sseUrl, buffer]);

  const cameraTopics = useMemo(() => buffer.getAllCameraTopics(), [telemetryData]);
  const layoutCounts: Record<Layout, number> = { '1x1': 1, '2x2': 4, '3x3': 9, 'focus': 1 };

  const camerasToShow = useMemo(() => {
    const count = layoutCounts[layout];
    if (layout === 'focus' && selectedCamera) {
      return [selectedCamera];
    }
    return cameraTopics.slice(0, count);
  }, [layout, selectedCamera, cameraTopics]);

  return (
    <div style={{ padding: '16px', background: '#f9fafb', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#111827' }}>
            Camera Wall
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#6b7280' }}>
            REPLAY: NVIDIA r2b 2023 dataset
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onBack} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #d1d5db', background: '#ffffff', cursor: 'pointer' }}>
            ← Back
          </button>
          {['1x1', '2x2', '3x3', 'focus'].map(l => (
            <button
              key={l}
              onClick={() => setLayout(l as Layout)}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: layout === l ? '2px solid #0a66ff' : '1px solid #d1d5db',
                background: layout === l ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: layout === '1x1' ? '1fr' : layout === '2x2' ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: '16px' }}>
        {camerasToShow.map((topic, idx) => {
          const camData = buffer.getLatestCameraDataForTopic(topic) || { width: 0, height: 0, has_image: false };
          return (
            <div key={topic} onClick={() => setSelectedCamera(topic)} style={{ cursor: 'pointer' }}>
              <CameraView
                data={camData}
                width={layout === 'focus' ? 1016 : 500}
                height={layout === 'focus' ? 762 : 375}
                label={topic.replace(/_/g, ' ')}
              />
            </div>
          );
        })}
      </div>

      {layout === 'focus' && (
        <div style={{ marginTop: '16px', padding: '12px', background: '#ffffff', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
          <button onClick={() => setLayout('2x2')} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #d1d5db', background: '#ffffff', cursor: 'pointer' }}>
            ← Back to grid
          </button>
        </div>
      )}

      <div style={{ marginTop: '16px', padding: '12px', background: '#ffffff', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
        <div style={{ fontSize: '12px', color: '#6b7280' }}>
          <span style={{ fontWeight: 600, color: '#111827' }}>Cameras in dataset:</span> {cameraTopics.length} |
          <span style={{ fontWeight: 600, color: '#111827', marginLeft: '8px' }}>Layout:</span> {layout} |
          <span style={{ fontWeight: 600, color: '#111827', marginLeft: '8px' }}>Source:</span> REPLAY
        </div>
      </div>
    </div>
  );
}
