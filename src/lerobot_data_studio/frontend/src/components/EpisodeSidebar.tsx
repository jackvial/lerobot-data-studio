import React from 'react';
import {
  List,
  Checkbox,
  Button,
  Space,
  Typography,
  Input,
} from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;
const { Search } = Input;

interface EpisodeSidebarProps {
  episodes: number[];
  selectedEpisodes: number[];
  currentEpisodeId: number;
  onToggleEpisode: (episodeId: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onEpisodeClick: (episodeId: number) => void;
}

const EpisodeSidebar: React.FC<EpisodeSidebarProps> = React.memo(({
  episodes,
  selectedEpisodes,
  currentEpisodeId,
  onToggleEpisode,
  onSelectAll,
  onClearSelection,
  onEpisodeClick,
}) => {
  const [searchTerm, setSearchTerm] = React.useState('');

  const filteredEpisodes = episodes.filter((ep) =>
    ep.toString().includes(searchTerm)
  );

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        width: '320px',
      }}
    >
      <Title level={4} style={{ marginBottom: '16px' }}>
        Episodes
      </Title>

      <Space
        direction='vertical'
        style={{ width: '100%', marginBottom: '16px' }}
      >
        <Search
          placeholder='Search episodes...'
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ width: '100%' }}
          size='small'
        />

        <Space>
          <Button
            size='small'
            onClick={onSelectAll}
            icon={<CheckCircleOutlined />}
          >
            Select All
          </Button>
          <Button
            size='small'
            onClick={onClearSelection}
            icon={<CloseCircleOutlined />}
          >
            Clear
          </Button>
        </Space>

        {selectedEpisodes.length > 0 && (
          <Text type='secondary' style={{ fontSize: '12px' }}>
            {selectedEpisodes.length} episode
            {selectedEpisodes.length === 1 ? '' : 's'} selected
          </Text>
        )}
      </Space>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <List
          dataSource={filteredEpisodes}
          renderItem={(episodeId) => {
            const isCurrentEpisode = episodeId === currentEpisodeId;

            return (
              <List.Item
                style={{
                  padding: '6px 8px',
                  cursor: 'pointer',
                  background: isCurrentEpisode
                    ? 'rgba(24, 144, 255, 0.08)'
                    : 'transparent',
                  borderRadius: '4px',
                  marginBottom: '2px',
                  border: isCurrentEpisode
                    ? '1px solid rgba(24, 144, 255, 0.25)'
                    : '1px solid transparent',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  if (!isCurrentEpisode) {
                    e.currentTarget.style.background =
                      'rgba(255, 255, 255, 0.03)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isCurrentEpisode) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                  }}
                  onClick={() => onEpisodeClick(episodeId)}
                >
                  <Checkbox
                    checked={selectedEpisodes.includes(episodeId)}
                    onChange={(e) => {
                      e.stopPropagation();
                      onToggleEpisode(episodeId);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginRight: 0 }}
                  />
                  <Text
                    style={{
                      fontSize: '13px',
                      fontWeight: isCurrentEpisode ? 500 : 400,
                      color: isCurrentEpisode ? '#1890ff' : undefined,
                      minWidth: '80px',
                    }}
                  >
                    Episode {episodeId}
                  </Text>
                </div>
              </List.Item>
            );
          }}
        />
      </div>
    </div>
  );
});

EpisodeSidebar.displayName = 'EpisodeSidebar';

export default EpisodeSidebar;
