import React, { useMemo } from 'react';
import { Card, Empty, Tooltip } from 'antd';
import { SubtaskSegment } from '@/types';

interface SubtaskTimelineProps {
  subtasks: SubtaskSegment[];
  duration: number;
  currentTime?: number;
}

const PALETTE = [
  '#1f77b4',
  '#ff7f0e',
  '#2ca02c',
  '#d62728',
  '#9467bd',
  '#8c564b',
  '#e377c2',
  '#17becf',
  '#bcbd22',
  '#7f7f7f',
];

const colorForIndex = (subtaskIndex: number): string => {
  let hash = 0;
  const key = `subtask-${subtaskIndex}`;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % PALETTE.length;
  return PALETTE[idx];
};

const SubtaskTimeline: React.FC<SubtaskTimelineProps> = ({
  subtasks,
  duration,
  currentTime,
}) => {
  const totalDuration = useMemo(() => {
    if (duration && duration > 0) {
      return duration;
    }
    if (subtasks.length === 0) {
      return 0;
    }
    return subtasks[subtasks.length - 1].end_time;
  }, [duration, subtasks]);

  if (!subtasks || subtasks.length === 0) {
    return (
      <Card title='Subtasks'>
        <Empty description='No subtask information for this episode' />
      </Card>
    );
  }

  if (totalDuration <= 0) {
    return (
      <Card title='Subtasks'>
        <Empty description='Unable to compute subtask timeline (duration is zero)' />
      </Card>
    );
  }

  const playheadPercent =
    currentTime !== undefined
      ? Math.min(100, Math.max(0, (currentTime / totalDuration) * 100))
      : null;

  return (
    <Card title='Subtasks' size='small'>
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: 36,
          background: 'rgba(255, 255, 255, 0.06)',
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        {subtasks.map((seg, idx) => {
          const left = (seg.start_time / totalDuration) * 100;
          const width = Math.max(
            0,
            ((seg.end_time - seg.start_time) / totalDuration) * 100
          );
          const bg = colorForIndex(seg.subtask_index);
          return (
            <Tooltip
              key={`${seg.subtask_index}-${idx}`}
              title={
                <div>
                  <div>
                    <strong>{seg.subtask}</strong>
                  </div>
                  <div>
                    {seg.start_time.toFixed(2)}s &rarr;{' '}
                    {seg.end_time.toFixed(2)}s
                  </div>
                  <div>
                    frames {seg.start_frame} &rarr; {seg.end_frame}
                  </div>
                </div>
              }
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${left}%`,
                  width: `${width}%`,
                  background: bg,
                  borderRight: '1px solid rgba(0, 0, 0, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  padding: '0 6px',
                  cursor: 'help',
                }}
              >
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {seg.subtask}
                </span>
              </div>
            </Tooltip>
          );
        })}

        {playheadPercent !== null && (
          <div
            style={{
              position: 'absolute',
              top: -2,
              bottom: -2,
              left: `${playheadPercent}%`,
              width: 2,
              background: '#ff6b6b',
              boxShadow: '0 0 4px rgba(255, 107, 107, 0.8)',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
    </Card>
  );
};

export default SubtaskTimeline;
