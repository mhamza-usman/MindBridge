"use client";
import React, { useState } from 'react';

interface DatasetImporterProps {
  onImport: (url: string) => void;
}

export default function DatasetImporter({ onImport }: DatasetImporterProps) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleImport = async () => {
    if (!url.trim()) {
      setError('Please enter a dataset URL');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Validate URL format
      const urlObj = new URL(url);
      if (!['github.com', 'kaggle.com', 'raw.githubusercontent.com'].includes(urlObj.hostname)) {
        throw new Error('Only GitHub and Kaggle URLs are supported');
      }

      await onImport(url);
      setUrl('');
    } catch (e: any) {
      setError(e.message || 'Invalid URL');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '16px', background: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600, color: '#111827' }}>
        Import External Dataset
      </h3>
      <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#6b7280' }}>
        Enter a GitHub or Kaggle dataset URL to fetch and connect live sensor data.
      </p>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/... or https://kaggle.com/..."
          disabled={loading}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid #d1d5db',
            fontSize: '13px',
          }}
        />
        <button
          onClick={handleImport}
          disabled={loading}
          style={{
            padding: '8px 16px',
            borderRadius: '6px',
            border: 'none',
            background: loading ? '#9ca3af' : '#3b82f6',
            color: '#ffffff',
            fontSize: '13px',
            fontWeight: 500,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Fetching...' : 'Import'}
        </button>
      </div>
      {error && (
        <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#ef4444' }}>
          {error}
        </p>
      )}
      <div style={{ marginTop: '12px', fontSize: '11px', color: '#6b7280' }}>
        <strong>Supported formats:</strong> ROS2 .db3 bags, MCAP files, JSONL sensor data
      </div>
    </div>
  );
}
