import React from 'react';
import { Card, Empty, Typography } from 'antd';
import { rltBufferApi } from '@/services/rltBufferApi';
import { RltTransitionInfo } from '@/types';

const { Text } = Typography;

interface RltImagePaneProps {
  fileToken: string;
  transition: RltTransitionInfo | undefined;
}

const formatCameraName = (key: string): string => {
  const lastSegment = key.split('.').pop();
  return lastSegment ?? key;
};

const RltImagePane: React.FC<RltImagePaneProps> = ({
  fileToken,
  transition,
}) => {
  if (!transition) {
    return (
      <Card size='small' title='Cameras'>
        <Empty description='Select a transition to view captured frames.' />
      </Card>
    );
  }

  if (transition.image_keys.length === 0) {
    return (
      <Card size='small' title='Cameras'>
        <Empty description='This transition has no stored camera frames (legacy buffer or image-encode lag).' />
      </Card>
    );
  }

  return (
    <Card size='small' title={`Cameras — transition #${transition.index}`}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            transition.image_keys.length === 1
              ? '1fr'
              : 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 12,
        }}
      >
        {transition.image_keys.map((cameraKey) => (
          <div
            key={cameraKey}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <img
              src={rltBufferApi.imageUrl(
                fileToken,
                transition.index,
                cameraKey
              )}
              alt={cameraKey}
              style={{
                width: '100%',
                maxHeight: 360,
                objectFit: 'contain',
                background: '#000',
                borderRadius: 4,
              }}
            />
            <Text type='secondary' style={{ fontSize: 12 }}>
              {formatCameraName(cameraKey)}
            </Text>
          </div>
        ))}
      </div>
    </Card>
  );
};

export default RltImagePane;
