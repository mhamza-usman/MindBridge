"use client";
import React, { useRef, useEffect } from 'react';

interface LidarPoint {
  x: number;
  y: number;
  z: number;
  intensity?: number;
}

interface LidarData {
  points: LidarPoint[];
  num_points: number;
  has_lidar: boolean;
}

interface Lidar2DViewProps {
  data: LidarData;
  width?: number;
  height?: number;
}

export default function Lidar2DView({ data, width = 400, height = 400 }: Lidar2DViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    const gridSize = 20;
    for (let x = 0; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Center coordinate system
    const centerX = width / 2;
    const centerY = height / 2;
    const scale = 3; // pixels per meter

    // Draw robot at center
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 5, 0, 2 * Math.PI);
    ctx.fill();

    // Draw robot orientation indicator
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX, centerY - 15);
    ctx.stroke();

    // If we have real points, use them
    if (data.has_lidar && data.points.length > 0) {
      data.points.forEach(point => {
        const screenX = centerX + point.x * scale;
        const screenY = centerY - point.y * scale; // Flip Y for screen coords

        // Color by intensity or height
        const intensity = point.intensity || point.z || 0;
        const normalizedIntensity = Math.min(1, Math.max(0, (intensity + 2) / 4));
        const hue = 120 - normalizedIntensity * 120; // Green to red
        ctx.fillStyle = `hsl(${hue}, 80%, 50%)`;

        ctx.beginPath();
        ctx.arc(screenX, screenY, 2, 0, 2 * Math.PI);
        ctx.fill();
      });
    } else {
      // Generate synthetic point cloud based on sensor timing (simulated)
      // This represents what a real LiDAR scan would look like
      const numPoints = 100;
      for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * 2 * Math.PI;
        const distance = 10 + Math.random() * 15;
        const x = Math.cos(angle) * distance;
        const y = Math.sin(angle) * distance;
        const z = -1 + Math.random() * 2;

        const screenX = centerX + x * scale;
        const screenY = centerY - y * scale;

        // Color by height (z)
        const normalizedZ = (z + 1) / 2;
        const hue = 120 - normalizedZ * 120;
        ctx.fillStyle = `hsl(${hue}, 80%, 50%)`;

        ctx.beginPath();
        ctx.arc(screenX, screenY, 2, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    // Draw scale indicator
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(10, height - 20);
    ctx.lineTo(10 + 5 * scale, height - 20);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px sans-serif';
    ctx.fillText('5m', 10, height - 8);

  }, [data, width, height]);

  return (
    <div style={{ width, height, background: '#0f172a', borderRadius: '8px', padding: '12px', border: '1px solid #e5e7eb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
          LiDAR Point Cloud (Bird's Eye)
        </h4>
        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
          Points: {data.has_lidar ? data.num_points : 'simulated'}
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
