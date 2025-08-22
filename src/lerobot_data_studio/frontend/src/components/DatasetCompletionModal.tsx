import React from 'react';
import { Modal, Button, Space, Tag, Progress, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';

const { Text, Paragraph } = Typography;

interface DatasetCompletionModalProps {
  visible: boolean;
  onClose: () => void;
  status?: {
    status: 'pending' | 'running' | 'completed' | 'failed';
    progress?: number;
    message?: string;
    repo_id?: string;
  };
  title?: string;
  actionLabel?: string;
}

const DatasetCompletionModal: React.FC<DatasetCompletionModalProps> = ({
  visible,
  onClose,
  status,
  title = 'Dataset Operation Status',
  actionLabel = 'View Dataset',
}) => {
  const navigate = useNavigate();

  const handleViewDataset = () => {
    if (status?.repo_id) {
      const [namespace, name] = status.repo_id.split('/');
      navigate(`/${namespace}/${name}/episode/0`);
    }
    onClose();
  };

  return (
    <Modal
      title={title}
      open={visible}
      onCancel={onClose}
      footer={[
        <Button
          key='close'
          onClick={onClose}
          disabled={
            status?.status === 'running' || status?.status === 'pending'
          }
        >
          Close
        </Button>,
        status?.status === 'completed' && (
          <Button key='view' type='primary' onClick={handleViewDataset}>
            {actionLabel}
          </Button>
        ),
      ]}
    >
      {status && (
        <Space direction='vertical' style={{ width: '100%' }}>
          <Text>
            Status:{' '}
            <Tag
              color={
                status.status === 'completed'
                  ? 'success'
                  : status.status === 'failed'
                  ? 'error'
                  : 'processing'
              }
            >
              {status.status}
            </Tag>
          </Text>

          {status.progress !== undefined && (
            <Progress percent={Math.round(status.progress * 100)} />
          )}

          {status.message && <Paragraph>{status.message}</Paragraph>}

          {status.repo_id && status.status === 'completed' && (
            <Text>
              Dataset: <Text code>{status.repo_id}</Text>
            </Text>
          )}
        </Space>
      )}
    </Modal>
  );
};

export default DatasetCompletionModal;
