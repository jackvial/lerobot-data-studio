import React from 'react';
import { List, Space, Tag, Tooltip, Typography, Input } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { RltEpisodeSummary } from '@/types';

const { Title, Text } = Typography;
const { Search } = Input;

interface RltEpisodeSidebarProps {
  episodes: RltEpisodeSummary[];
  currentEpisodeId: number | undefined;
  onEpisodeClick: (episodeId: number) => void;
}

const labelPresentation = (
  label: RltEpisodeSummary['label']
): { color: string; icon: React.ReactNode; text: string } => {
  switch (label) {
    case 'success':
      return {
        color: 'green',
        icon: <CheckCircleOutlined />,
        text: 'success',
      };
    case 'failure':
      return {
        color: 'red',
        icon: <CloseCircleOutlined />,
        text: 'failure',
      };
    default:
      return {
        color: 'default',
        icon: <QuestionCircleOutlined />,
        text: 'open',
      };
  }
};

const RltEpisodeSidebar: React.FC<RltEpisodeSidebarProps> = ({
  episodes,
  currentEpisodeId,
  onEpisodeClick,
}) => {
  const [searchTerm, setSearchTerm] = React.useState('');

  const filteredEpisodes = episodes.filter((ep) =>
    ep.episode_id.toString().includes(searchTerm)
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
        <Text type='secondary' style={{ fontSize: '12px' }}>
          {episodes.length} episode{episodes.length === 1 ? '' : 's'}
        </Text>
      </Space>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <List
          dataSource={filteredEpisodes}
          renderItem={(episode) => {
            const isCurrent = episode.episode_id === currentEpisodeId;
            const presentation = labelPresentation(episode.label);
            return (
              <List.Item
                style={{
                  padding: '8px 8px',
                  cursor: 'pointer',
                  background: isCurrent
                    ? 'rgba(24, 144, 255, 0.08)'
                    : 'transparent',
                  borderRadius: '4px',
                  marginBottom: '2px',
                  border: isCurrent
                    ? '1px solid rgba(24, 144, 255, 0.25)'
                    : '1px solid transparent',
                  transition: 'all 0.2s ease',
                }}
                onClick={() => onEpisodeClick(episode.episode_id)}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                  }}
                >
                  <Text
                    style={{
                      fontSize: '13px',
                      fontWeight: isCurrent ? 500 : 400,
                      color: isCurrent ? '#1890ff' : undefined,
                      minWidth: '90px',
                    }}
                  >
                    Episode {episode.episode_id}
                  </Text>
                  <Tag
                    color={presentation.color}
                    icon={presentation.icon}
                    style={{ marginInlineEnd: 0 }}
                  >
                    {presentation.text}
                  </Tag>
                  {episode.has_intervention ? (
                    <Tooltip title='Episode contains a human intervention'>
                      <Tag
                        color='orange'
                        icon={<ExclamationCircleOutlined />}
                        style={{ marginInlineEnd: 0 }}
                      >
                        intv
                      </Tag>
                    </Tooltip>
                  ) : null}
                  <Text
                    type='secondary'
                    style={{ fontSize: '11px', marginLeft: 'auto' }}
                  >
                    {episode.num_transitions} • {episode.duration_s.toFixed(1)}s
                  </Text>
                </div>
              </List.Item>
            );
          }}
        />
      </div>
    </div>
  );
};

export default RltEpisodeSidebar;
