import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Input, Typography, Space, Row, Col, Spin, Button } from 'antd';
import {
  ArrowRightOutlined,
  RobotOutlined,
  PlusOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { datasetApi } from '@/services/api';

const { Title, Text } = Typography;

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');
  const [validationStatus, setValidationStatus] = useState<
    'idle' | 'validating' | 'success' | 'error'
  >('idle');
  const [validationMessage, setValidationMessage] = useState('');

  const { data: datasets, isLoading } = useQuery({
    queryKey: ['datasets'],
    queryFn: datasetApi.listDatasets,
  });

  const handleDatasetSelect = (repoId: string) => {
    const [namespace, name] = repoId.split('/');
    navigate(`/${namespace}/${name}`);
  };

  const validateDatasetFormat = (value: string): boolean => {
    // Check if it matches username/dataset-name format
    const pattern = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/;
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
      // Check if dataset exists in the available datasets
      const allDatasets = [
        ...(datasets?.lerobot_datasets || []),
        ...(datasets?.featured_datasets || []),
      ];
      const exists = allDatasets.some((dataset) => dataset === value);

      if (exists) {
        setValidationStatus('success');
        setValidationMessage('Dataset exists ✔');
      } else {
        // Try to validate if the dataset exists on the hub
        try {
          const [namespace, name] = value.split('/');
          const result = await datasetApi.validateDataset(namespace, name);
          if (result.exists) {
            setValidationStatus('success');
            setValidationMessage('Dataset exists ✔');
          } else {
            setValidationStatus('error');
            setValidationMessage(result.message || 'Dataset not found on hub');
          }
        } catch {
          setValidationStatus('error');
          setValidationMessage('Dataset not found on hub');
        }
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
    if (validationStatus === 'success' && inputValue) {
      handleDatasetSelect(inputValue);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && validationStatus === 'success') {
      handleSearch();
    }
  };

  const getValidationIcon = () => {
    switch (validationStatus) {
      case 'validating':
        return <Spin size='small' />;
      case 'success':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
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
          <Title level={2}>Edit and Merge LeRobot Datasets</Title>
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
                  status={validationStatus === 'error' ? 'error' : undefined}
                  style={{ width: '100%' }}
                />
                <Button
                  type='primary'
                  icon={<ArrowRightOutlined />}
                  onClick={handleSearch}
                  disabled={validationStatus !== 'success'}
                />
              </Space.Compact>
              {validationMessage && (
                <Text
                  type={
                    validationStatus === 'error'
                      ? 'danger'
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

        <div>
          <Title level={2}>Merge Datasets</Title>
          <Text
            type='secondary'
            style={{ fontSize: '16px', display: 'block', marginBottom: '16px' }}
          >
            Merge multiple datasets into a new dataset
          </Text>
          <Card style={{ textAlign: 'center', padding: '40px' }}>
            <Button
              type='primary'
              size='large'
              icon={<PlusOutlined />}
              onClick={() => navigate('/merge')}
            >
              Merge Datasets
            </Button>
          </Card>
        </div>

        <div>
          <Title level={3}>Featured Datasets</Title>
          <Row gutter={[16, 16]}>
            {datasets?.featured_datasets.map((dataset: string) => (
              <Col key={dataset} xs={24} sm={12} md={8}>
                <Card
                  hoverable
                  onClick={() => handleDatasetSelect(dataset)}
                  style={{ height: '100%' }}
                >
                  <Card.Meta
                    title={dataset.split('/')[1]}
                    description={
                      <Space direction='vertical' size='small'>
                        <Text type='secondary'>{dataset}</Text>
                      </Space>
                    }
                  />
                </Card>
              </Col>
            ))}
          </Row>
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
