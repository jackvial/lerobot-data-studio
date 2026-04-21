import React from 'react';
import { Card, Empty, Tooltip, Typography } from 'antd';
import { IdleSpan } from '@/types';

const { Text } = Typography;

interface IdleTimelineProps {
  spans: IdleSpan[];
  episodeDuration: number;
  totalIdleSeconds: number;
  currentTime?: number;
  isLoading?: boolean;
}

const BAR_HEIGHT = 24;

const IdleTimeline: React.FC<IdleTimelineProps> = ({
  spans,
  episodeDuration,
  totalIdleSeconds,
  currentTime,
  isLoading,
}) => {
  const hasDuration = episodeDuration > 0;
  const playheadPct =
    hasDuration && currentTime !== undefined
      ? Math.min(Math.max((currentTime / episodeDuration) * 100, 0), 100)
      : null;
  const idlePct = hasDuration ? (totalIdleSeconds / episodeDuration) * 100 : 0;

  const renderBody = () => {
    if (!hasDuration) {
      return <Empty description='No timing data available' />;
    }
    return (
      <div>
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: BAR_HEIGHT,
            backgroundColor: '#f0f2f5',
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            overflow: 'hidden',
          }}
        >
          {spans.map((span, idx) => {
            const left = (span.start_time / episodeDuration) * 100;
            const width =
              ((span.end_time - span.start_time) / episodeDuration) * 100;
            return (
              <Tooltip
                key={`${span.start_time}-${span.end_time}-${idx}`}
                title={`Idle ${span.start_time.toFixed(2)}s - ${span.end_time.toFixed(2)}s (${(span.end_time - span.start_time).toFixed(2)}s)`}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: `${left}%`,
                    width: `${Math.max(width, 0.2)}%`,
                    top: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(255, 77, 79, 0.6)',
                  }}
                />
              </Tooltip>
            );
          })}
          {playheadPct !== null && (
            <div
              style={{
                position: 'absolute',
                left: `${playheadPct}%`,
                top: 0,
                bottom: 0,
                width: 2,
                backgroundColor: '#1677ff',
                pointerEvents: 'none',
                transform: 'translateX(-1px)',
              }}
            />
          )}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 8,
          }}
        >
          <Text type='secondary'>
            {spans.length} idle span{spans.length === 1 ? '' : 's'}
          </Text>
          <Text type='secondary'>
            {totalIdleSeconds.toFixed(2)}s idle / {episodeDuration.toFixed(2)}s
            {' '}({idlePct.toFixed(1)}%)
          </Text>
        </div>
      </div>
    );
  };

  return (
    <Card
      size='small'
      title='Idle Time'
      loading={isLoading}
      styles={{ body: { padding: '12px 16px' } }}
    >
      {renderBody()}
    </Card>
  );
};

export default IdleTimeline;
