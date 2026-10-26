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
      // Load and draw the real image from bag
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
      };
      img.src = `data:image/jpeg;base64,${data.image_base64}`;
    } else {
      // Waiting for image data
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for camera data...', width / 2, height / 2);
    }

    // Draw frame info
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(10, 10, 180, 40);
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px monospace';
    ctx.fillText(data.has_image ? `Live: ${data.original_width}x${data.original_height}` : 'No data', 15, 25);
    ctx.fillText('Source: NVIDIA r2b 2023', 15, 40);

  }, [data, width, height]);

  return (
    <div style={{ width, height, background: '#1e293b', borderRadius: '8px', padding: '12px', border: '1px solid #e5e7eb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
          Camera Feed
        </h4>
        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
          {data.has_image ? 'Live (NVIDIA r2b)' : 'No data'}
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
