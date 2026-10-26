import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return new Response('URL is required', { status: 400 });
    }

    // Validate URL
    try {
      const urlObj = new URL(url);
      if (!['github.com', 'kaggle.com', 'raw.githubusercontent.com'].includes(urlObj.hostname)) {
        return new Response('Only GitHub and Kaggle URLs are supported', { status: 400 });
      }
    } catch {
      return new Response('Invalid URL format', { status: 400 });
    }

    // TODO: Implement actual dataset fetching
    // For now, return a success response
    return new Response(JSON.stringify({
      success: true,
      message: 'Dataset import initiated',
      url,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Dataset import error:', error);
    return new Response('Failed to import dataset', { status: 500 });
  }
}
