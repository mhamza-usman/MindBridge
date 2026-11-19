"use client";
import React, { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Calibration types (public/replay/r2b_calibration.json, produced by
// tools/extract_calibration.py from the bag's CameraInfo + tf_static topics)
// ---------------------------------------------------------------------------

interface CameraIntrinsics {
  frame_id: string;
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

interface RigidTransform {
  rotation: number[][];   // 3x3
  translation: number[];  // [x,y,z]
}

interface Calibration {
  lidar_frame: string;
  cameras: Record<string, CameraIntrinsics>;
  extrinsics: Record<string, { direction: string; transform: RigidTransform }>;
}

interface CameraData {
  image_base64?: string | null;
  width: number;
  height: number;
  has_image: boolean;
  original_width?: number;
  original_height?: number;
}

interface LidarData {
  points: Array<{ x: number; y: number; z: number }>;
  num_points: number;
  has_lidar: boolean;
}

interface FusionViewProps {
  cameraKey: string;          // e.g. 'hawk_0_left_rgb_image'
  camera: CameraData | null;
  lidar: LidarData | null;
  calibrationUrl?: string;
  width?: number;
  height?: number;
  label?: string;
}

function matVec(m: number[][], v: number[]): number[] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

export default function FusionView({
  cameraKey,
  camera,
  lidar,
  calibrationUrl = '/replay/r2b_calibration.json',
  width = 640,
  height = 400,
  label,
}: FusionViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [calibError, setCalibError] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const lastBase64 = useRef<string | null>(null);

  // Load calibration once
  useEffect(() => {
    let cancelled = false;
    fetch(calibrationUrl)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((c: Calibration) => { if (!cancelled) setCalibration(c); })
      .catch(e => { if (!cancelled) setCalibError(String(e)); });
    return () => { cancelled = true; };
  }, [calibrationUrl]);

  // Decode camera image when it changes
  useEffect(() => {
    if (!camera?.has_image || !camera.image_base64) {
      imageRef.current = null;
      lastBase64.current = null;
      return;
    }
    if (camera.image_base64 === lastBase64.current) return;
    lastBase64.current = camera.image_base64;
    const img = new Image();
    img.onload = () => { imageRef.current = img; };
    img.src = `data:image/jpeg;base64,${camera.image_base64}`;
  }, [camera?.image_base64, camera?.has_image]);

  // Project + draw whenever camera/lidar/calibration/image updates
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawW = canvas.width;
    const drawH = canvas.height;

    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, drawW, drawH);

    const img = imageRef.current;
    if (img) {
      // contain-fit the image
      const s = Math.min(drawW / img.width, drawH / img.height);
      const dw = img.width * s;
      const dh = img.height * s;
      const ox = (drawW - dw) / 2;
      const oy = (drawH - dh) / 2;
      ctx.drawImage(img, ox, oy, dw, dh);
    } else {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, drawW, drawH);
      ctx.fillStyle = '#64748b';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('No camera frame', drawW / 2, drawH / 2);
    }

    if (!calibration || !lidar?.has_lidar || !lidar.points?.length) return;

    const intr = calibration.cameras[cameraKey];
    const ext = calibration.extrinsics[cameraKey];
    if (!intr || !ext || ext.direction !== 'lidar_to_camera') return;

    const R = ext.transform.rotation;
    const T = ext.transform.translation;

    // Native image dims for intrinsics scaling (K is in camera native res)
    const nativeW = camera?.original_width || intr.width || img?.width || width;
    const nativeH = camera?.original_height || intr.height || img?.height || height;

    // Displayed image rect (contain-fit, same as draw above)
    const dispW = img ? img.width * Math.min(drawW / img.width, drawH / img.height) : drawW;
    const dispH = img ? img.height * Math.min(drawW / img.width, drawH / img.height) : drawH;
    const ox = (drawW - dispW) / 2;
    const oy = (drawH - dispH) / 2;

    const scaleX = dispW / nativeW;
    const scaleY = dispH / nativeH;

    let projected = 0;
    let inView = 0;
    const zMin = 0.3, zMax = 15.0;

    for (const p of lidar.points) {
      // lidar -> camera frame
      const r = matVec(R, [p.x, p.y, p.z]);
      const cx = r[0] + T[0];
      const cy = r[1] + T[1];
      const cz = r[2] + T[2];
      projected++;
      if (cz < zMin || cz > zMax) continue;

      const u = intr.fx * (cx / cz) + intr.cx;
      const v = intr.fy * (cy / cz) + intr.cy;
      const px = ox + u * scaleX;
      const py = oy + v * scaleY;
      if (px < ox || px > ox + dispW || py < oy || py > oy + dispH) continue;

      inView++;
      // depth colour: near = warm, far = cool
      const t = Math.min(1, Math.max(0, (cz - zMin) / (zMax - zMin)));
      const rr = Math.round(255 * (1 - t) + 56 * t);
      const gg = Math.round(200 * (1 - t) + 130 * t);
      const bb = Math.round(80 * (1 - t) + 220 * t);
      ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // HUD
    ctx.fillStyle = 'rgba(10,15,30,0.72)';
    ctx.fillRect(8, 8, 260, 40);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`LiDAR→cam overlay  ${inView}/${projected} pts in view`, 14, 24);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`z ${zMin.toFixed(1)}–${zMax.toFixed(1)} m   fx ${intr.fx.toFixed(0)}`, 14, 40);
  }, [camera, lidar, calibration, cameraKey, width, height]);

  return (
    <div style={{ width, height, background: '#0b1020', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
      {label && (
        <div style={{ padding: '6px 10px', fontSize: '11px', color: '#94a3b8', borderBottom: '1px solid #1e293b' }}>
          {label}
        </div>
      )}
      <canvas ref={canvasRef} width={width} height={height - (label ? 26 : 0)} style={{ display: 'block' }} />
      {calibError && (
        <div style={{ padding: '4px 10px', fontSize: '10px', color: '#f59e0b' }}>
          calibration unavailable: {calibError}
        </div>
      )}
      {!calibration && !calibError && (
        <div style={{ padding: '4px 10px', fontSize: '10px', color: '#94a3b8' }}>loading calibration…</div>
      )}
    </div>
  );
}
