import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Input,
  Typography,
  Space,
  Row,
  Col,
  Spin,
  Button,
  Radio,
} from 'antd';
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
  const [datasetSource, setDatasetSource] = useState<'hub' | 'local'>('hub');
  const [localPath, setLocalPath] = useState('');
  const [derivedRepoId, setDerivedRepoId] = useState('');

  const { data: datasets, isLoading } = useQuery({
    queryKey: ['datasets'],
    queryFn: datasetApi.listDatasets,
  });

  const handleDatasetSelect = (repoId: string) => {
    const [namespace, name] = repoId.split('/');
    if (datasetSource === 'local' && localPath) {
      // Encode the local path as a query parameter
      navigate(
        `/${namespace}/${name}?local_path=${encodeURIComponent(localPath)}`
      );
    } else {
      navigate(`/${namespace}/${name}`);
    }
  };

  const validateDatasetFormat = (value: string): boolean => {
    if (datasetSource === 'local') {
      // For local datasets, just check basic repo_id format
      const pattern = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/;
      return pattern.test(value);
    } else {
      // Check if it matches username/dataset-name format
      const pattern = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/;
      return pattern.test(value);
    }
  };

  const validateDataset = async (value: string, path?: string) => {
    // For local datasets, path is the primary input
    if (datasetSource === 'local') {
      if (!path) {
        setValidationStatus('idle');
        setValidationMessage('');
        setDerivedRepoId('');
        return;
      }
    } else {
      // For hub datasets, value is the repo_id
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
    }

    setValidationStatus('validating');
    setValidationMessage('Checking dataset...');

    try {
      if (datasetSource === 'hub') {
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
              setValidationMessage(
                result.message || 'Dataset not found on hub'
              );
            }
          } catch {
            setValidationStatus('error');
            setValidationMessage('Dataset not found on hub');
          }
        }
      } else {
        // Validate local dataset using the new endpoint
        try {
          const result = await datasetApi.validateLocalDatasetPath(path!);
          if (result.valid && result.repo_id) {
            setValidationStatus('success');
            setValidationMessage(result.message);
            setDerivedRepoId(result.repo_id);
          } else {
            setValidationStatus('error');
            setValidationMessage(result.message);
            setDerivedRepoId('');
          }
        } catch {
          setValidationStatus('error');
          setValidationMessage('Error checking local dataset');
          setDerivedRepoId('');
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
    validateDataset(value, localPath);
  };

  const handleLocalPathChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setLocalPath(value);
    // For local datasets, validate using the path
    validateDataset('', value);
  };

  const handleSourceChange = (value: 'hub' | 'local') => {
    setDatasetSource(value);
    setValidationStatus('idle');
    setValidationMessage('');
    setDerivedRepoId('');

    if (value === 'local' && localPath) {
      // Re-validate with local path
      validateDataset('', localPath);
    } else if (value === 'hub' && inputValue) {
      // Re-validate with hub repo_id
      validateDataset(inputValue);
    }
  };

  const handleSearch = () => {
    if (validationStatus === 'success') {
      if (datasetSource === 'local' && derivedRepoId) {
        handleDatasetSelect(derivedRepoId);
      } else if (datasetSource === 'hub' && inputValue) {
        handleDatasetSelect(inputValue);
      }
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
            <Space direction='vertical' style={{ width: '100%' }} size='middle'>
              <Radio.Group
                value={datasetSource}
                onChange={(e) => handleSourceChange(e.target.value)}
                optionType='button'
                buttonStyle='solid'
              >
                <Radio.Button value='hub'>HuggingFace Hub</Radio.Button>
                <Radio.Button value='local'>Local Dataset</Radio.Button>
              </Radio.Group>

              {datasetSource === 'hub' ? (
                <Space.Compact style={{ width: '100%' }} size='large'>
                  <Input
                    placeholder='Enter dataset repository ID e.g. username/dataset-name'
                    value={inputValue}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyPress}
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
              ) : (
                <>
                  <Space.Compact style={{ width: '100%' }} size='large'>
                    <Input
                      placeholder='Enter local dataset path e.g. /home/user/.cache/huggingface/lerobot/namespace/dataset_name'
                      value={localPath}
                      onChange={handleLocalPathChange}
                      onKeyDown={handleKeyPress}
                      suffix={getValidationIcon()}
                      status={
                        validationStatus === 'error' ? 'error' : undefined
                      }
                      style={{ width: '100%' }}
                    />
                    <Button
                      type='primary'
                      icon={<ArrowRightOutlined />}
                      onClick={handleSearch}
                      disabled={validationStatus !== 'success'}
                    />
                  </Space.Compact>
                  {derivedRepoId && (
                    <Text type='secondary' style={{ fontSize: '12px' }}>
                      Derivied Dataset ID: {derivedRepoId}
                    </Text>
                  )}
                </>
              )}

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
