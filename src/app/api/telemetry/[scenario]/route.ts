import { NextRequest } from 'next/server';

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
    const telemetryFile = Bun.file(telemetryPath);
    if (!await telemetryFile.exists()) {
      return new Response('Telemetry file not found', { status: 404 });
    }

    const telemetryData = await telemetryFile.text();
    const lines = telemetryData.trim().split('\n');

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for (const line of lines) {
            controller.enqueue(encoder.encode(`data: ${line}\n\n`));
            await new Promise(resolve => setTimeout(resolve, 100)); // 100ms intervals
          }
          controller.close();
        } catch (error) {
          console.error('Stream error:', error);
          controller.error(error);
        }
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
