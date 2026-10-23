"use client";
import React, { useRef, useEffect } from 'react';

interface CameraData {
  image_base64?: string | null;
  width: number;
  height: number;
  has_image: boolean;
  original_width?: number;
  original_height?: number;
}

interface CameraViewProps {
  data: CameraData;
  width?: number;
  height?: number;
}

export default function CameraView({ data, width = 400, height = 300 }: CameraViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, width, height);

    if (data.has_image && data.image_base64) {
      // Load and draw the real image
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
      };
      img.src = `data:image/jpeg;base64,${data.image_base64}`;
    } else {
      // Simulate camera feed visualization
      // Draw a simulated warehouse aisle scene
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, '#374151');
      gradient.addColorStop(0.5, '#4b5563');
      gradient.addColorStop(1, '#374151');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Draw floor grid lines (simulating warehouse floor)
      ctx.strokeStyle = '#6b7280';
      ctx.lineWidth = 1;
      for (let i = 0; i < 10; i++) {
        const y = height * 0.4 + (i * height * 0.05);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw vertical lines (aisle walls)
      ctx.strokeStyle = '#9ca3af';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(width * 0.2, 0);
      ctx.lineTo(width * 0.1, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(width * 0.8, 0);
      ctx.lineTo(width * 0.9, height);
      ctx.stroke();

      // Draw some objects (simulating boxes/pallets)
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(width * 0.3, height * 0.6, width * 0.15, height * 0.2);
      ctx.fillStyle = '#10b981';
      ctx.fillRect(width * 0.55, height * 0.65, width * 0.12, height * 0.15);

      // Draw camera frame info overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(10, 10, 180, 60);
      ctx.fillStyle = '#ffffff';
      ctx.font = '11px monospace';
      ctx.fillText('CAM FEED SIMULATION', 15, 28);
      ctx.font = '10px monospace';
      ctx.fillText(`Res: ${data.original_width || 640}x${data.original_height || 480}`, 15, 44);
      ctx.fillText('Source: Timing-based sync', 15, 58);
    }

    // Draw detection boxes overlay (simulated)
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(width * 0.25, height * 0.35, width * 0.5, height * 0.4);
    ctx.setLineDash([]);

    // Draw frame info
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(width - 110, 10, 100, 40);
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px monospace';
    ctx.fillText('FPS: 10.0', width - 105, 25);
    ctx.fillText('Latency: 50ms', width - 105, 40);

  }, [data, width, height]);

  return (
    <div style={{ width, height, background: '#1e293b', borderRadius: '8px', padding: '12px', border: '1px solid #e5e7eb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
          Camera Feed
        </h4>
        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
          {data.has_image ? 'Live' : 'Simulated'}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        width={width}
        height={height - 45}
        style={{ display: 'block' }}
      />
    </div>
  );
}
