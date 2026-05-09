import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Tooltip, Typography } from 'antd';
import { RltTransitionInfo } from '@/types';
import { transitionsSpanSeconds, transitionTickX } from '@/utils/rltTimeline';

const { Text } = Typography;

interface RltTimelineProps {
  transitions: RltTransitionInfo[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  hasInferenceTs: boolean;
}

const TICK_WIDTH = 2;

const RltTimeline: React.FC<RltTimelineProps> = ({
  transitions,
  selectedIndex,
  onSelect,
  hasInferenceTs,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const totalSpan = useMemo(
    () => transitionsSpanSeconds(transitions),
    [transitions]
  );

  // When `inference_ts` is missing, transitions are evenly spaced by index
  // (t_offset_s = i). `transitionsSpanSeconds` already returns that as the
  // span so the same scaling logic works.
  const spanForLayout =
    totalSpan > 0 ? totalSpan : Math.max(transitions.length - 1, 1);

  return (
    <Card
      size='small'
      title='Timeline'
      extra={
        !hasInferenceTs && transitions.length > 0 ? (
          <Tooltip title='No inference timestamps recorded — falling back to even spacing.'>
            <Text type='warning' style={{ fontSize: 12 }}>
              fallback spacing
            </Text>
          </Tooltip>
        ) : null
      }
    >
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          height: 64,
          background: '#fafafa',
          border: '1px solid #f0f0f0',
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        {transitions.map((transition, index) => {
          const x = transitionTickX(transition, spanForLayout, width);
          const isSelected = index === selectedIndex;
          let color = '#bfbfbf';
          if (transition.is_intervention) {
            color = '#fa8c16';
          }
          if (transition.success) {
            color = '#52c41a';
          }
          if (transition.failure) {
            color = '#f5222d';
          }
          if (isSelected) {
            color = '#1890ff';
          }
          return (
            <Tooltip
              key={transition.index}
              title={
                <span>
                  #{index} @ {transition.t_offset_s.toFixed(2)}s
                  {transition.is_intervention ? ' (intv)' : ''}
                  {transition.success ? ' (success)' : ''}
                  {transition.failure ? ' (failure)' : ''}
                </span>
              }
            >
              <div
                onClick={() => onSelect(index)}
                style={{
                  position: 'absolute',
                  left: x - TICK_WIDTH / 2,
                  top: 6,
                  bottom: 6,
                  width: isSelected ? TICK_WIDTH * 2 : TICK_WIDTH,
                  background: color,
                  borderRadius: 1,
                  cursor: 'pointer',
                }}
              />
            </Tooltip>
          );
        })}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 6,
        }}
      >
        <Text type='secondary' style={{ fontSize: 11 }}>
          0.0s
        </Text>
        <Text type='secondary' style={{ fontSize: 11 }}>
          {hasInferenceTs
            ? `${spanForLayout.toFixed(2)}s`
            : `${transitions.length} transitions`}
        </Text>
      </div>
    </Card>
  );
};

export default RltTimeline;
