# Live Telemetry Dashboard Implementation Plan

## Overview
Transform MindBridge from a text-based dashboard to a live engineering-focused telemetry system that visualizes real sensor data from the NVIDIA r2b dataset in real-time.

## Current State
- Text-based metrics (sensor ages, rates, confidence scores)
- Placeholder floor map
- No actual sensor data visualization
- Timing-based replay using bag timestamps only
- No camera images, LiDAR point clouds, or IMU graphs

## Target State
- Live camera feed display (10-30 FPS from bag)
- 2D bird's-eye LiDAR point cloud visualization
- 3D LiDAR point cloud visualization (optional)
- Real-time IMU telemetry graphs (acceleration, angular velocity)
- Rolling sensor age/rate/plots
- High-density engineering UI layout
- Real-time sensor fusion visualization (camera + LiDAR overlay)
- Interactive telemetry timeline with scrubbing

## Architecture

### Data Pipeline
```
ROS2 Bag → Python Converter → JSONL (with base64 images, point arrays, IMU data)
                                              ↓
SSE API Routes → Client → Real-time Rendering in React
```

### New Components
1. **Enhanced Converter** (`tools/bag_to_jsonl_enhanced.py`)
   - Extract actual camera images as base64
   - Extract LiDAR point clouds as coordinate arrays
   - Extract IMU data (acceleration, angular velocity)
   - Downsample images for bandwidth efficiency
   - Generate separate telemetry JSONL

2. **SSE API Routes**
   - `/api/telemetry/[scenario]` - Main sensor data stream
   - `/api/telemetry/[scenario]/camera` - Camera image stream (high frequency)
   - `/api/telemetry/[scenario]/lidar` - LiDAR point cloud stream
   - `/api/telemetry/[scenario]/imu` - IMU data stream

3. **React Components**
   - `CameraView.tsx` - Display camera feed with overlay
   - `Lidar2DView.tsx` - Canvas-based bird's eye point cloud
   - `Lidar3DView.tsx` - Three.js 3D point cloud (optional)
   - `IMUGraph.tsx` - Real-time IMU telemetry plots using Recharts
   - `SensorTimeline.tsx` - Rolling sensor plots (age, rate, confidence)
   - `FusionView.tsx` - Camera + LiDAR overlay visualization
   - `TelemetryLayout.tsx` - High-density engineering layout

4. **Data Management**
   - `TelemetryBuffer.ts` - Buffer for real-time sensor data
   - `TelemetrySource.ts` - SSE client for telemetry streams
   - `useTelemetry.ts` - React hook for telemetry state

## Implementation Phases

### Phase 1: Data Extraction (1-2 days)
**Goal:** Extract real sensor data from ROS2 bags

**Tasks:**
1. Install proper ROS2 message deserialization library
   - Option A: Use `rosbags` with proper type definitions
   - Option B: Use `ros2py` for full ROS2 support
   - Option C: Implement manual deserialization for required types

2. Update converter to extract:
   - Camera images (RGB, downsampled to 320x320)
   - LiDAR point clouds (X, Y, Z coordinates, intensity)
   - IMU data (linear acceleration, angular velocity)
   - TF transforms (for sensor fusion)

3. Generate telemetry JSONL with:
   - Base64 encoded images (every 10th frame to save bandwidth)
   - Point cloud arrays (100-200 points per frame)
   - IMU time series data

4. Create separate streams:
   - Full telemetry (everything, 10 Hz)
   - Camera only (images, 10-30 Hz)
   - LiDAR only (points, 10 Hz)
   - IMU only (telemetry, 50 Hz)

**Deliverables:**
- Enhanced converter working with r2b_lounge
- `r2b_telemetry.jsonl` with real sensor data
- Validation: Images decode correctly, points visualize

### Phase 2: SSE API Layer (0.5 day)
**Goal:** Expose sensor data via SSE endpoints

**Tasks:**
1. Create `/api/telemetry/[scenario]/route.ts`
   - Stream full telemetry JSONL
   - Handle multiple concurrent clients

2. Create `/api/telemetry/[scenario]/camera/route.ts`
   - Stream base64 camera images
   - Higher frequency (10-30 Hz)

3. Create `/api/telemetry/[scenario]/lidar/route.ts`
   - Stream point cloud data
   - Optimize for fast updates

4. Create `/api/telemetry/[scenario]/imu/route.ts`
   - Stream IMU telemetry
   - High frequency (50 Hz)

**Deliverables:**
- Four SSE API routes working
- Curl validation showing data streaming

### Phase 3: Core Visualization Components (2-3 days)
**Goal:** Build basic visualization components

**Tasks:**
1. **CameraView.tsx**
   - Display base64 images
   - Add overlay badges (frame rate, resolution)
   - Add detection overlays (optional)
   - Performance: < 50ms render time

2. **Lidar2DView.tsx**
   - Canvas-based bird's eye view
   - Render point cloud as colored dots
   - Color by intensity or height
   - Add coordinate grid
   - Performance: < 33ms render time

3. **IMUGraph.tsx**
   - Use Recharts for real-time plots
   - Line charts for acceleration (x, y, z)
   - Line charts for angular velocity (x, y, z)
   - Rolling buffer (last 10 seconds)
   - Performance: < 33ms render time

4. **TelemetryBuffer.ts**
   - Buffer incoming SSE data
   - Time-based cleanup (remove old data)
   - Provide data access methods
   - Performance: < 5ms update time

**Deliverables:**
- Three visualization components working
- Unit tests for data structures
- Performance benchmarks

### Phase 4: High-Density Layout (1-2 days)
**Goal:** Redesign Live view for engineering density

**Tasks:**
1. Create `TelemetryLayout.tsx`
   - Grid-based layout (6-8 panels)
   - Panel: Camera (top-left, large)
   - Panel: LiDAR 2D (top-right, large)
   - Panel: IMU graphs (middle, wide)
   - Panel: Sensor timeline (bottom, wide)
   - Panel: Evidence table (side, compact)
   - Panel: Assurance state (side, compact)
   - Panel: Fusion view (overlay, conditional)

2. Update `AssuranceShell.tsx`
   - Switch to TelemetryLayout when replay active
   - Keep old layout for synthetic scenarios
   - Add telemetry state management

3. Add panel sizing controls
   - Minimize/maximize panels
   - Panel reordering (optional, Phase 6)

**Deliverables:**
- New telemetry layout component
- Updated shell with layout switching
- 8-panel engineering layout

### Phase 5: Sensor Fusion Visualization (1-2 days)
**Goal:** Visualize camera + LiDAR agreement

**Tasks:**
1. **FusionView.tsx**
   - Overlay LiDAR points on camera image
   - Project 3D points to 2D camera plane
   - Color-code by agreement status
   - Show disagreement regions
   - Add conflict markers

2. **Projection Math**
   - Implement camera projection matrix
   - Transform LiDAR points to camera frame
   - Handle coordinate system differences

3. **Conflict Detection**
   - Visualize sensor disagreement
   - Highlight regions where sensors differ
   - Add distance-based coloring

**Deliverables:**
- Fusion view component
- Working projection math
- Visual conflict detection

### Phase 6: Interactive Features (1-2 days)
**Goal:** Add engineer-focused interactivity

**Tasks:**
1. **SensorTimeline.tsx**
   - Rolling plots for sensor ages
   - Rolling plots for sensor rates
   - Rolling plots for confidence
   - Mark fault injection times
   - Scrubbing support

2. **Timeline Scrubber**
   - Replay control (play/pause/scrub)
   - Visual timeline markers
   - Keyboard shortcuts

3. **Panel Controls**
   - Minimize/maximize panels
   - Panel reordering
   - Full-screen mode

**Deliverables:**
- Interactive timeline component
- Panel controls
- Keyboard shortcuts

### Phase 7: Performance Optimization (1 day)
**Goal:** Ensure smooth 30 FPS rendering

**Tasks:**
1. Optimize image decoding
   - WebWorker for image processing
   - Canvas caching
   - RequestAnimationFrame for smooth updates

2. Optimize LiDAR rendering
   - Canvas batching
   - Skip frames if needed
   - Spatial indexing

3. Optimize SSE
   - Separate connections per sensor type
   - Backpressure handling
   - Reconnection logic

4. Performance monitoring
   - FPS counter
   - Memory usage
   - Network latency

**Deliverables:**
- Performance profiling
- 30 FPS target achieved
- Memory usage < 500MB

### Phase 8: Testing & Deployment (0.5 day)
**Goal:** Validate and deploy

**Tasks:**
1. Testing
   - Unit tests for converters
   - Integration tests for SSE
   - E2E tests for visualization
   - Performance tests

2. Deployment
   - Cloud Run deployment
   - Verification on live URL
   - Browser compatibility check

**Deliverables:**
- All tests passing
- Successfully deployed
- Browser-verified

## Technical Challenges

### ROS2 Message Deserialization
**Challenge:** Properly parsing ROS2 message types without full ROS2 installation
**Solutions:**
- Use `rosbags` library with type definitions
- Implement manual binary parsing for known message types
- Or use `ros2py` in Python (requires ROS2 environment)

### Bandwidth Management
**Challenge:** Streaming high-frequency sensor data
**Solutions:**
- Downsample images (320x320, JPEG quality 70)
- Limit point cloud points (100-200 per frame)
- Separate SSE streams per sensor type
- Client-side buffering

### Rendering Performance
**Challenge:** 30 FPS with multiple canvases and charts
**Solutions:**
- RequestAnimationFrame for synchronized updates
- Canvas batching
- Chart data throttling
- WebWorkers for heavy computation

### Memory Management
**Challenge:** Buffering time-series data
**Solutions:**
- Rolling buffer (keep last 10 seconds)
- Cleanup old data
- Efficient data structures

## Dependencies

### New Packages
- `ros2py` (optional, for proper ROS2 support)
- `numpy` (already installed)
- `opencv-python` (already installed)
- `recharts` (already installed)
- `three.js` (for 3D LiDAR, optional Phase 4)

### File Structure
```
src/assurance/
  telemetry/
    buffer.ts           # Data buffering
    TelemetrySource.ts  # SSE client
    useTelemetry.ts      # React hook
    components/
      CameraView.tsx
      Lidar2DView.tsx
      Lidar3DView.tsx
      IMUGraph.tsx
      SensorTimeline.tsx
      FusionView.tsx
    ui/
      TelemetryLayout.tsx
tools/
  bag_to_jsonl_enhanced.py
public/replay/
  r2b_telemetry.jsonl
src/app/api/
  telemetry/
    [scenario]/route.ts
    [scenario]/camera/route.ts
    [scenario]/lidar/route.ts
    [scenario]/imu/route.ts
```

## Timeline Estimate
- Phase 1: 1-2 days
- Phase 2: 0.5 day
- Phase 3: 2-3 days
- Phase 4: 1-2 days
- Phase 5: 1-2 days
- Phase 6: 1-2 days
- Phase 7: 1 day
- Phase 8: 0.5 day

**Total: 8-12 days**

## Success Criteria
1. Camera feed displays actual images from bag at 10-30 FPS
2. LiDAR 2D view shows real point cloud with correct coordinates
3. IMU graphs show real acceleration/angular velocity
4. All visualizations update smoothly at 30 FPS
5. Timeline scrubbing works for replay
6. Sensor fusion view shows camera + LiDAR overlay
7. Memory usage < 500MB
8. Browser compatibility (Chrome, Firefox, Safari)
9. Successfully deployed to Cloud Run
10. All tests passing

## Risks & Mitigations

### Risk: ROS2 deserialization complexity
**Mitigation:** Start with simplified binary parsing, upgrade to proper library if needed

### Risk: Performance bottleneck
**Mitigation:** Early performance profiling, optimization in Phase 7

### Risk: Dataset limitations
**Mitigation:** Use r2b_lounge (10s) with looping to 90s, validates with other sequences

### Risk: Browser compatibility
**Mitigation:** Test on Chrome, Firefox, Safari, use standard Web APIs
