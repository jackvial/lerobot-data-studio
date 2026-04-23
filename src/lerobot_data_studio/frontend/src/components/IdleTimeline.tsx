import React from 'react';
import {
  Button,
  Card,
  Empty,
  InputNumber,
  Row,
  Col,
  Slider,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { EpisodeTrimBounds, IdleSpan } from '@/types';

const { Text } = Typography;

interface IdleTimelineProps {
  spans: IdleSpan[];
  episodeDuration: number;
  totalIdleSeconds: number;
  currentTime?: number;
  isLoading?: boolean;
  threshold: number;
  minDuration: number;
  onThresholdChange: (value: number) => void;
  onMinDurationChange: (value: number) => void;
  activeTrim?: EpisodeTrimBounds | null;
  proposedTrim?: EpisodeTrimBounds | null;
  onApplyTrim?: () => void;
  onClearTrim?: () => void;
}

const BAR_HEIGHT = 24;
// The motion signal is std-normalized per feature then L2-norm'd, so for a
// D-dim state vector typical "moving" frames sit near sqrt(D) (~2.4 for 6
// DoF) and idle frames sit near 0. The slider range needs to span past the
// motion floor to be tunable end-to-end.
const THRESHOLD_MIN = 0.0;
const THRESHOLD_MAX = 5.0;
const THRESHOLD_STEP = 0.01;
const MIN_DURATION_MIN = 0.0;
const MIN_DURATION_MAX = 5.0;
const MIN_DURATION_STEP = 0.05;

const IdleTimeline: React.FC<IdleTimelineProps> = ({
  spans,
  episodeDuration,
  totalIdleSeconds,
  currentTime,
  isLoading,
  threshold,
  minDuration,
  onThresholdChange,
  onMinDurationChange,
  activeTrim,
  proposedTrim,
  onApplyTrim,
  onClearTrim,
}) => {
  const hasDuration = episodeDuration > 0;
  const playheadPct =
    hasDuration && currentTime !== undefined
      ? Math.min(Math.max((currentTime / episodeDuration) * 100, 0), 100)
      : null;
  const idlePct = hasDuration ? (totalIdleSeconds / episodeDuration) * 100 : 0;

  const renderTimeline = () => {
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
          {activeTrim && (
            <div
              style={{
                position: 'absolute',
                left: `${(activeTrim.start_time / episodeDuration) * 100}%`,
                width: `${Math.max(((activeTrim.end_time - activeTrim.start_time) / episodeDuration) * 100, 0.4)}%`,
                top: 1,
                bottom: 1,
                border: '2px solid rgba(82, 196, 26, 0.9)',
                borderRadius: 4,
                pointerEvents: 'none',
                boxSizing: 'border-box',
              }}
            />
          )}
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

  const formatTrim = (trim: EpisodeTrimBounds) => {
    return `${trim.start_time.toFixed(2)}s - ${trim.end_time.toFixed(2)}s`;
  };

  const renderControl = (
    label: string,
    tooltip: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void
  ) => {
    const handleChange = (next: number | null) => {
      if (next === null || Number.isNaN(next)) {
        return;
      }
      const clamped = Math.min(Math.max(next, min), max);
      onChange(clamped);
    };
    return (
      <Row gutter={8} align='middle' wrap={false}>
        <Col flex='130px'>
          <Tooltip title={tooltip}>
            <Text>{label}</Text>
          </Tooltip>
        </Col>
        <Col flex='auto'>
          <Slider
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={handleChange}
            tooltip={{ formatter: (v) => (v ?? 0).toFixed(2) }}
          />
        </Col>
        <Col flex='90px'>
          <InputNumber
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={handleChange}
            size='small'
            style={{ width: '100%' }}
          />
        </Col>
      </Row>
    );
  };

  return (
    <Card
      size='small'
      title='Idle Time'
      loading={isLoading}
      styles={{ body: { padding: '12px 16px' } }}
    >
      <Space direction='vertical' size='middle' style={{ width: '100%' }}>
        {renderTimeline()}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <Space wrap>
            <Button
              type='primary'
              onClick={onApplyTrim}
              disabled={!proposedTrim || isLoading}
            >
              Trim idle time
            </Button>
            <Button onClick={onClearTrim} disabled={!activeTrim}>
              Reset trim
            </Button>
          </Space>
          {activeTrim ? (
            <Tag color='success'>Active trim: {formatTrim(activeTrim)}</Tag>
          ) : (
            <Text type='secondary'>Exporting full episode</Text>
          )}
        </div>
        {!activeTrim && proposedTrim && (
          <Text type='secondary'>
            Suggested kept window: {formatTrim(proposedTrim)}
          </Text>
        )}
        <div>
          {renderControl(
            'Motion threshold',
            'Smoothed, std-normalized motion magnitude below which a frame counts as idle. Typical "moving" frames sit near sqrt(D) (~2.4 for 6 DoF); push the slider toward that value to extend leading/trailing idle into actual motion.',
            threshold,
            THRESHOLD_MIN,
            THRESHOLD_MAX,
            THRESHOLD_STEP,
            onThresholdChange
          )}
          {renderControl(
            'Min duration (s)',
            'Minimum length of a low-motion run to be reported as idle.',
            minDuration,
            MIN_DURATION_MIN,
            MIN_DURATION_MAX,
            MIN_DURATION_STEP,
            onMinDurationChange
          )}
        </div>
      </Space>
    </Card>
  );
};

export default IdleTimeline;
