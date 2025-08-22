import React from 'react';
import { Button, Space, InputNumber, Tag, Tooltip } from 'antd';
import {
  LeftOutlined,
  RightOutlined,
  FastBackwardOutlined,
  FastForwardOutlined,
} from '@ant-design/icons';

interface EpisodeNavigationProps {
  currentEpisodeId: number;
  totalEpisodes: number;
  onEpisodeChange: (episodeId: number) => void;
  isPreloaded: (episodeId: number) => boolean;
}

const EpisodeNavigation: React.FC<EpisodeNavigationProps> = ({
  currentEpisodeId,
  totalEpisodes,
  onEpisodeChange,
  isPreloaded,
}) => {
  const canGoPrevious = currentEpisodeId > 0;
  const canGoNext = currentEpisodeId < totalEpisodes - 1;

  const handleJumpTo = (value: number | null) => {
    if (value !== null && value >= 0 && value < totalEpisodes) {
      onEpisodeChange(value);
    }
  };

  return (
    <div className='episode-navigation'>
      <Space direction='vertical' style={{ width: '100%' }}>
        {/* Navigation Controls */}
        <Space wrap>
          <Button
            icon={<FastBackwardOutlined />}
            onClick={() => onEpisodeChange(0)}
            disabled={!canGoPrevious}
          >
            First
          </Button>
          <Tooltip title='Press ← arrow key'>
            <Button
              icon={<LeftOutlined />}
              onClick={() => onEpisodeChange(currentEpisodeId - 1)}
              disabled={!canGoPrevious}
            >
              Previous
              {canGoPrevious && isPreloaded(currentEpisodeId - 1) && (
                <Tag color='green' style={{ marginLeft: '8px' }}>
                  Preloaded
                </Tag>
              )}
            </Button>
          </Tooltip>

          <Space align='center'>
            <span>Episode</span>
            <InputNumber
              min={0}
              max={totalEpisodes - 1}
              value={currentEpisodeId}
              onChange={handleJumpTo}
              style={{ width: '80px' }}
            />
            <span>of {totalEpisodes - 1}</span>
          </Space>

          <Tooltip title='Press → arrow key'>
            <Button
              icon={<RightOutlined />}
              onClick={() => onEpisodeChange(currentEpisodeId + 1)}
              disabled={!canGoNext}
            >
              Next
              {canGoNext && isPreloaded(currentEpisodeId + 1) && (
                <Tag color='green' style={{ marginLeft: '8px' }}>
                  Preloaded
                </Tag>
              )}
            </Button>
          </Tooltip>
          <Button
            icon={<FastForwardOutlined />}
            onClick={() => onEpisodeChange(totalEpisodes - 1)}
            disabled={!canGoNext}
          >
            Last
          </Button>
        </Space>
      </Space>
    </div>
  );
};

export default EpisodeNavigation;
