import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Empty,
  List,
  Space,
  Spin,
  Tag,
  Typography,
  Button,
  Alert,
} from 'antd';
import {
  ArrowRightOutlined,
  HomeOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { rltBufferApi } from '@/services/rltBufferApi';
import { RltBufferFile } from '@/types';

const { Title, Text } = Typography;

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(1)} MB`;
  }
  return `${(mb / 1024).toFixed(2)} GB`;
};

const formatMtime = (mtime: number): string => {
  return new Date(mtime * 1000).toLocaleString();
};

const RltBufferHome: React.FC = () => {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['rlt-buffer-files'],
    queryFn: rltBufferApi.listFiles,
  });

  const handleOpen = (file: RltBufferFile) => {
    navigate(`/rlt-buffer/${encodeURIComponent(file.file_token)}`);
  };

  return (
    <div style={{ padding: '32px', maxWidth: '1100px', margin: '0 auto' }}>
      <Space
        direction='vertical'
        size='large'
        style={{ width: '100%' }}
      >
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <div>
            <Title level={2} style={{ marginBottom: 0 }}>
              RLT Rollout Viewer
            </Title>
            <Text type='secondary'>
              Inspect saved RLT review buffers (.pt files) produced by the
              policy server.
            </Text>
          </div>
          <Space>
            <Button icon={<HomeOutlined />} onClick={() => navigate('/')}>
              Back home
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => refetch()}
              loading={isRefetching}
            >
              Refresh
            </Button>
          </Space>
        </Space>

        {error ? (
          <Alert
            type='error'
            showIcon
            message='Failed to load RLT buffer files'
            description={String((error as Error)?.message ?? error)}
          />
        ) : null}

        {data?.root ? (
          <Text type='secondary'>
            Scanning root: <Text code>{data.root}</Text> (override with
            <Text code> LEROBOT_RLT_BUFFER_ROOT</Text>)
          </Text>
        ) : null}

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <Spin size='large' />
          </div>
        ) : (
          <Card>
            {!data || data.files.length === 0 ? (
              <Empty description='No RLT review buffers found under the configured root.' />
            ) : (
              <List
                dataSource={data.files}
                renderItem={(file) => (
                  <List.Item
                    actions={[
                      <Button
                        key='open'
                        type='primary'
                        icon={<ArrowRightOutlined />}
                        onClick={() => handleOpen(file)}
                      >
                        Open
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      title={file.path}
                      description={
                        <Space size='middle' wrap>
                          <Tag color='blue'>{file.num_episodes} episodes</Tag>
                          <Tag>{file.num_samples} transitions</Tag>
                          <Text type='secondary'>
                            {formatBytes(file.size_bytes)}
                          </Text>
                          <Text type='secondary'>
                            modified {formatMtime(file.mtime)}
                          </Text>
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        )}
      </Space>
    </div>
  );
};

export default RltBufferHome;
