import React from 'react';
import { Spin, Progress, Typography } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';

const { Title } = Typography;

interface LoadingIndicatorProps {
  message?: string;
  progress?: number;
}

const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  message,
  progress,
}) => {
  const antIcon = <LoadingOutlined style={{ fontSize: 48 }} spin />;

  return (
    <div className='loading-overlay'>
      <div style={{ textAlign: 'center' }}>
        <Spin indicator={antIcon} />
        <Title level={4} style={{ marginTop: '24px', color: '#fff' }}>
          {message || 'Loading...'}
        </Title>
        {progress !== undefined && progress > 0 && progress < 1 && (
          <Progress
            percent={Math.round(progress * 100)}
            strokeColor='#1890ff'
            style={{ maxWidth: '300px', margin: '16px auto' }}
          />
        )}
      </div>
    </div>
  );
};

export default LoadingIndicator;
