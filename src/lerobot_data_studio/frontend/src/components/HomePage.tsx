import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Input, Typography, Space, Spin, Button } from 'antd';
import {
  ArrowRightOutlined,
  RobotOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExperimentOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { datasetApi } from '@/services/api';

const { Title, Text } = Typography;

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');
  const [validationStatus, setValidationStatus] = useState<
    'idle' | 'validating' | 'success' | 'warning' | 'error'
  >('idle');
  const [validationMessage, setValidationMessage] = useState('');

  const { isLoading } = useQuery({
    queryKey: ['datasets'],
    queryFn: datasetApi.listDatasets,
  });

  const handleDatasetSelect = (repoId: string) => {
    const [namespace, name] = repoId.split('/');
    navigate(`/${namespace}/${name}`);
  };

  const validateDatasetFormat = (value: string): boolean => {
    // Check if it matches username/dataset-name format
    const pattern = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
    return pattern.test(value);
  };

  const validateDataset = async (value: string) => {
    if (!value) {
      setValidationStatus('idle');
      setValidationMessage('');
      return;
    }

    if (!validateDatasetFormat(value)) {
      setValidationStatus('error');
      setValidationMessage('Invalid format. Use: username/dataset-name');
      return;
    }

    setValidationStatus('validating');
    setValidationMessage('Checking dataset...');

    try {
      const [namespace, name] = value.split('/');
      const result = await datasetApi.validateDataset(namespace, name);
      if (result.exists) {
        if (result.warning) {
          setValidationStatus('warning');
          setValidationMessage(result.warning);
        } else {
          setValidationStatus('success');
          setValidationMessage(
            result.source === 'local'
              ? result.message || 'Using local dataset'
              : 'Dataset exists ✔'
          );
        }
      } else {
        setValidationStatus('error');
        setValidationMessage(result.message || 'Dataset not found on hub');
      }
    } catch {
      setValidationStatus('error');
      setValidationMessage('Error validating dataset');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    validateDataset(value);
  };

  const handleSearch = () => {
    if ((validationStatus === 'success' || validationStatus === 'warning') && inputValue) {
      handleDatasetSelect(inputValue);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && (validationStatus === 'success' || validationStatus === 'warning')) {
      handleSearch();
    }
  };

  const getValidationIcon = () => {
    switch (validationStatus) {
      case 'validating':
        return <Spin size='small' />;
      case 'success':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'warning':
        return <ExclamationCircleOutlined style={{ color: '#faad14' }} />;
      case 'error':
        return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
      default:
        return null;
    }
  };

  return (
    <div style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto' }}>
      <Space direction='vertical' size='large' style={{ width: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <RobotOutlined style={{ fontSize: '48px', marginBottom: '16px' }} />
          <Title level={1}>LeRobot Data Studio</Title>
          <Title level={4}>The Unofficial LeRobot Dataset Editor</Title>
          <Title level={2}>Edit LeRobot Datasets</Title>
        </div>

        <div>
          <Title level={2}>RLT Rollout Viewer</Title>
          <Text
            type='secondary'
            style={{ fontSize: '16px', display: 'block', marginBottom: '16px' }}
          >
            Inspect saved RLT review buffers (.pt) produced by the policy
            server.
          </Text>
          <Card>
            <Button
              type='primary'
              icon={<ExperimentOutlined />}
              onClick={() => navigate('/rlt-buffer')}
            >
              Open RLT Rollout Viewer
            </Button>
          </Card>
        </div>

        <div>
          <Title level={2}>Edit Dataset</Title>
          <Text
            type='secondary'
            style={{ fontSize: '16px', display: 'block', marginBottom: '16px' }}
          >
            Create a new dataset from selected episodes
          </Text>
          <Card>
            <Space direction='vertical' style={{ width: '100%' }} size='small'>
              <Space.Compact style={{ width: '100%' }} size='large'>
                <Input
                  placeholder='Enter dataset repository ID e.g. username/dataset-name'
                  value={inputValue}
                  onChange={handleInputChange}
                  onKeyPress={handleKeyPress}
                  suffix={getValidationIcon()}
                  status={
                    validationStatus === 'error'
                      ? 'error'
                      : validationStatus === 'warning'
                      ? 'warning'
                      : undefined
                  }
                  style={{ width: '100%' }}
                />
                <Button
                  type='primary'
                  icon={<ArrowRightOutlined />}
                  onClick={handleSearch}
                  disabled={validationStatus !== 'success' && validationStatus !== 'warning'}
                />
              </Space.Compact>
              {validationMessage && (
                <Text
                  type={
                    validationStatus === 'error'
                      ? 'danger'
                      : validationStatus === 'warning'
                      ? 'warning'
                      : validationStatus === 'success'
                      ? 'success'
                      : 'secondary'
                  }
                >
                  {validationMessage}
                </Text>
              )}
            </Space>
          </Card>
        </div>

        {isLoading && (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <Spin size='large' />
          </div>
        )}
      </Space>
    </div>
  );
};

export default HomePage;
