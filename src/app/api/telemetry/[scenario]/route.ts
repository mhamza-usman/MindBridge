import { NextRequest } from 'next/server';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

const SCENARIOS = ['r2b_telemetry'];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ scenario: string }> }
) {
  const { scenario } = await params;

  if (!SCENARIOS.includes(scenario)) {
    return new Response('Unknown telemetry scenario', { status: 404 });
  }

  const telemetryPath = `${process.cwd()}/public/replay/${scenario}.jsonl`;

  try {
    if (!existsSync(telemetryPath)) {
      return new Response('Telemetry file not found', { status: 404 });
    }

    const telemetryData = await readFile(telemetryPath, 'utf-8');
    const lines = telemetryData.trim().split('\n');

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          let idx = 0;
          // Loop continuously so the dashboard stays live
          while (true) {
            if (idx >= lines.length) {
              idx = 1; // skip t=0 startup frame on loop
            }
            controller.enqueue(encoder.encode(`data: ${lines[idx]}\n\n`));
            idx++;
            await new Promise(resolve => setTimeout(resolve, 100)); // 100ms intervals
          }
        } catch (error) {
          console.error('Stream error:', error);
          controller.error(error);
        }
      },
      cancel() {
        // client disconnected
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error serving telemetry:', error);
    return new Response('Error serving telemetry', { status: 500 });
  }
}
