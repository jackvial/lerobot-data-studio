import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Layout,
  Typography,
  Card,
  Input,
  Button,
  Space,
  Select,
  List,
  Tag,
  Alert,
  Form,
  message,
  Spin,
  Modal,
  Progress,
  Checkbox,
} from 'antd';
import {
  SearchOutlined,
  PlusOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  UserOutlined,
  MergeOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { datasetApi } from '@/services/api';

const { Header, Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

interface DatasetEntry {
  id: string;
  status: 'pending' | 'validating' | 'valid' | 'invalid';
  message?: string;
}

// Custom hook for managing dataset selection with localStorage persistence
const useSelectedDatasets = () => {
  const [selectedDatasets, setSelectedDatasets] = useState<Set<string>>(
    new Set()
  );

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('mergeDatasets_selectedDatasets');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setSelectedDatasets(new Set(parsed));
      } catch (e) {
        console.error('Failed to parse stored dataset selections:', e);
      }
    }
  }, []);

  // Save to localStorage whenever selection changes
  useEffect(() => {
    localStorage.setItem(
      'mergeDatasets_selectedDatasets',
      JSON.stringify(Array.from(selectedDatasets))
    );
  }, [selectedDatasets]);

  const toggleDataset = (datasetId: string) => {
    setSelectedDatasets((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(datasetId)) {
        newSet.delete(datasetId);
      } else {
        newSet.add(datasetId);
      }
      return newSet;
    });
  };

  const selectAll = (datasetIds: string[]) => {
    setSelectedDatasets(new Set(datasetIds));
  };

  const clearSelection = () => {
    setSelectedDatasets(new Set());
    localStorage.removeItem('mergeDatasets_selectedDatasets');
  };

  return {
    selectedDatasets,
    toggleDataset,
    selectAll,
    clearSelection,
    selectedCount: selectedDatasets.size,
  };
};

const MergeDatasets: React.FC = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm();

  // State
  const [selectedMethod, setSelectedMethod] = useState<
    'prefix' | 'manual' | 'user'
  >('prefix');
  const [datasets, setDatasets] = useState<DatasetEntry[]>([]);
  const [searchPrefix, setSearchPrefix] = useState('');
  const [manualRepoIds, setManualRepoIds] = useState('');
  const [selectedUsername, setSelectedUsername] = useState('');
  const [mergeTaskId, setMergeTaskId] = useState<string | null>(null);
  const [isStatusModalVisible, setIsStatusModalVisible] = useState(false);

  // Dataset selection hook
  const {
    selectedDatasets,
    toggleDataset,
    selectAll,
    clearSelection,
    selectedCount,
  } = useSelectedDatasets();

  // Get current user
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: datasetApi.getCurrentUser,
  });

  // Search datasets by prefix
  const searchMutation = useMutation({
    mutationFn: (prefix: string) => datasetApi.searchDatasets(prefix),
    onSuccess: (data) => {
      // Clear selection when new search is performed
      clearSelection();
      const datasetEntries = data.repo_ids.map((id) => ({
        id,
        status: 'valid' as const,
      }));
      setDatasets(datasetEntries);
      if (datasetEntries.length === 0) {
        message.warning('No datasets found with this prefix');
      }
    },
    onError: () => {
      message.error('Failed to search datasets');
    },
  });

  // List user datasets
  const userDatasetsMutation = useMutation({
    mutationFn: (username: string) => datasetApi.listUserDatasets(username),
    onSuccess: (data) => {
      // Clear selection when new search is performed
      clearSelection();
      const datasetEntries = data.repo_ids.map((id) => ({
        id,
        status: 'valid' as const,
      }));
      setDatasets(datasetEntries);
      if (datasetEntries.length === 0) {
        message.warning('No datasets found for this user');
      }
    },
    onError: () => {
      message.error('Failed to list user datasets');
    },
  });

  // Validate dataset
  const validateMutation = useMutation({
    mutationFn: (repoId: string) => {
      const parts = repoId.split('/');
      if (parts.length !== 2) {
        throw new Error(`Invalid repo ID format: ${repoId}`);
      }
      const [namespace, name] = parts;
      console.log('Validating dataset:', { namespace, name });
      return datasetApi.validateDataset(namespace, name);
    },
    onSuccess: (data, repoId) => {
      console.log('Validation success:', { repoId, data });
      setDatasets((prev) =>
        prev.map((d) =>
          d.id === repoId
            ? {
                ...d,
                status: data.exists ? 'valid' : 'invalid',
                message: data.message,
              }
            : d
        )
      );
    },
    onError: (error: any, repoId) => {
      console.error('Validation error:', { repoId, error });
      setDatasets((prev) =>
        prev.map((d) =>
          d.id === repoId
            ? {
                ...d,
                status: 'invalid',
                message: error.message || 'Failed to validate',
              }
            : d
        )
      );
    },
  });

  // Merge datasets
  const mergeMutation = useMutation({
    mutationFn: datasetApi.mergeDatasets,
    onSuccess: (data) => {
      setMergeTaskId(data.task_id || null);
      setIsStatusModalVisible(true);
      message.success('Merge task started!');
    },
    onError: (error: any) => {
      message.error(error.response?.data?.detail || 'Failed to start merge');
    },
  });

  // Poll merge status
  const { data: mergeStatus } = useQuery({
    queryKey: ['mergeStatus', mergeTaskId],
    queryFn: () =>
      mergeTaskId ? datasetApi.getMergeStatus(mergeTaskId) : null,
    enabled: !!mergeTaskId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'running' || status === 'pending') {
        return 2000; // Poll every 2 seconds
      }
      return false;
    },
  });

  const handleSearch = () => {
    console.log('handleSearch called', {
      selectedMethod,
      searchPrefix,
      selectedUsername,
      manualRepoIds,
    });

    if (selectedMethod === 'prefix' && searchPrefix) {
      searchMutation.mutate(searchPrefix);
    } else if (selectedMethod === 'user' && selectedUsername) {
      userDatasetsMutation.mutate(selectedUsername);
    } else if (selectedMethod === 'manual' && manualRepoIds) {
      // Clear selection when new search is performed
      clearSelection();

      // Parse manual entries - handle both newline and comma separated
      const repoIds = manualRepoIds
        .split(/[\n,]+/)
        .map((id) => id.trim())
        .filter((id) => {
          if (!id) return false;
          if (!id.includes('/')) {
            message.warning(
              `Invalid repo ID format: "${id}". Must include namespace/name`
            );
            return false;
          }
          return true;
        });

      if (repoIds.length === 0) {
        message.error(
          'No valid repository IDs found. Format should be: namespace/dataset-name'
        );
        return;
      }

      console.log('Validating repo IDs:', repoIds);

      const datasetEntries: DatasetEntry[] = repoIds.map((id) => ({
        id,
        status: 'pending' as const,
      }));

      setDatasets(datasetEntries);

      // Validate each dataset
      repoIds.forEach((id) => {
        setDatasets((prev) =>
          prev.map((d) => (d.id === id ? { ...d, status: 'validating' } : d))
        );
        validateMutation.mutate(id);
      });
    }
  };

  const handleMerge = (values: any) => {
    const selectedValidDatasets = datasets.filter(
      (d) => d.status === 'valid' && selectedDatasets.has(d.id)
    );

    if (selectedValidDatasets.length < 2) {
      message.error('At least 2 valid datasets must be selected to merge');
      return;
    }

    const outputRepoId = currentUser?.username
      ? `${currentUser.username}/${values.dataset_name}`
      : values.new_repo_id;

    mergeMutation.mutate({
      dataset_ids: selectedValidDatasets.map((d) => d.id),
      new_repo_id: outputRepoId,
      tolerance_s: 1e-4,
    });
  };

  const validDatasetCount = datasets.filter((d) => d.status === 'valid').length;
  const validDatasetIds = datasets
    .filter((d) => d.status === 'valid')
    .map((d) => d.id);
  const selectedValidCount = datasets.filter(
    (d) => d.status === 'valid' && selectedDatasets.has(d.id)
  ).length;

  // Select all checkbox state
  const isAllValidSelected =
    validDatasetIds.length > 0 &&
    validDatasetIds.every((id) => selectedDatasets.has(id));
  const isSomeValidSelected = validDatasetIds.some((id) =>
    selectedDatasets.has(id)
  );

  const handleSelectAllValid = () => {
    if (isAllValidSelected) {
      // Deselect all valid datasets
      validDatasetIds.forEach((id) => {
        if (selectedDatasets.has(id)) {
          toggleDataset(id);
        }
      });
    } else {
      // Select all valid datasets
      selectAll([...selectedDatasets, ...validDatasetIds]);
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ padding: '0 24px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: '100%',
          }}
        >
          <Space>
            <Title level={4} style={{ margin: 0, color: '#fff' }}>
              Merge Datasets
            </Title>
          </Space>
          <Button onClick={() => navigate('/')}>Back to Home</Button>
        </div>
      </Header>

      <Content
        style={{
          padding: '24px',
          maxWidth: '1200px',
          margin: '0 auto',
          width: '100%',
        }}
      >
        <Space direction='vertical' size='large' style={{ width: '100%' }}>
          {/* Method Selection */}
          <Card title='Select Method'>
            <Space direction='vertical' style={{ width: '100%' }}>
              <Select
                value={selectedMethod}
                onChange={setSelectedMethod}
                style={{ width: '100%' }}
                size='large'
                options={[
                  {
                    label: 'Find by Prefix',
                    value: 'prefix',
                    icon: <SearchOutlined />,
                  },
                  {
                    label: 'Enter Repository IDs',
                    value: 'manual',
                    icon: <PlusOutlined />,
                  },
                  {
                    label: 'List User Datasets',
                    value: 'user',
                    icon: <UserOutlined />,
                  },
                ]}
              />

              {selectedMethod === 'prefix' && (
                <Input.Search
                  placeholder='Enter dataset prefix (e.g., username/dataset_prefix_)'
                  value={searchPrefix}
                  onChange={(e) => setSearchPrefix(e.target.value)}
                  onSearch={handleSearch}
                  loading={searchMutation.isPending}
                  enterButton='Search'
                  size='large'
                />
              )}

              {selectedMethod === 'manual' && (
                <>
                  <TextArea
                    placeholder='Enter dataset repository IDs (one per line or comma-separated)&#10;e.g.:&#10;lerobot/aloha_static_cups_open&#10;lerobot/aloha_static_battery&#10;or: lerobot/dataset1, lerobot/dataset2'
                    value={manualRepoIds}
                    onChange={(e) => setManualRepoIds(e.target.value)}
                    rows={4}
                  />
                  <Button
                    type='primary'
                    onClick={handleSearch}
                    icon={<CheckCircleOutlined />}
                    disabled={!manualRepoIds.trim()}
                  >
                    Validate Datasets
                  </Button>
                </>
              )}

              {selectedMethod === 'user' && (
                <Input.Search
                  placeholder='Enter HuggingFace username'
                  value={selectedUsername}
                  onChange={(e) => setSelectedUsername(e.target.value)}
                  onSearch={handleSearch}
                  loading={userDatasetsMutation.isPending}
                  enterButton='List Datasets'
                  size='large'
                />
              )}
            </Space>
          </Card>

          {/* Dataset List */}
          {datasets.length > 0 && (
            <Card
              title={
                <Space>
                  <span>
                    Selected Datasets ({selectedValidCount}/{validDatasetCount}{' '}
                    valid selected)
                  </span>
                  {validDatasetCount > 0 && (
                    <Checkbox
                      checked={isAllValidSelected}
                      indeterminate={isSomeValidSelected && !isAllValidSelected}
                      onChange={handleSelectAllValid}
                    >
                      Select all valid
                    </Checkbox>
                  )}
                </Space>
              }
              extra={
                selectedCount > 0 && (
                  <Button size='small' onClick={clearSelection}>
                    Clear Selection
                  </Button>
                )
              }
            >
              <List
                dataSource={datasets}
                renderItem={(dataset) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={
                        <Checkbox
                          checked={selectedDatasets.has(dataset.id)}
                          onChange={() => toggleDataset(dataset.id)}
                          disabled={dataset.status !== 'valid'}
                        />
                      }
                      title={
                        <Space>
                          <Text>{dataset.id}</Text>
                          {dataset.status === 'validating' && (
                            <Spin size='small' />
                          )}
                          {dataset.status === 'valid' && (
                            <Tag icon={<CheckCircleOutlined />} color='success'>
                              Valid
                            </Tag>
                          )}
                          {dataset.status === 'invalid' && (
                            <Tag icon={<CloseCircleOutlined />} color='error'>
                              Invalid
                            </Tag>
                          )}
                        </Space>
                      }
                      description={dataset.message}
                    />
                  </List.Item>
                )}
              />
            </Card>
          )}

          {/* Merge Form */}
          {selectedValidCount >= 2 && (
            <Card title='Create Merged Dataset'>
              <Form form={form} layout='vertical' onFinish={handleMerge}>
                {currentUser?.username ? (
                  <Form.Item
                    name='dataset_name'
                    label='Dataset Name'
                    rules={[
                      {
                        required: true,
                        message: 'Please enter a dataset name',
                      },
                      {
                        pattern: /^[a-zA-Z0-9_-]+$/,
                        message:
                          'Only letters, numbers, underscores, and hyphens allowed',
                      },
                    ]}
                  >
                    <Input
                      prefix={`${currentUser.username}/`}
                      placeholder='my-merged-dataset'
                      size='large'
                    />
                  </Form.Item>
                ) : (
                  <Form.Item
                    name='new_repo_id'
                    label='Output Repository ID'
                    rules={[
                      {
                        required: true,
                        message: 'Please enter a repository ID',
                      },
                      {
                        pattern: /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/,
                        message: 'Must be in format: namespace/dataset-name',
                      },
                    ]}
                  >
                    <Input
                      placeholder='username/my-merged-dataset'
                      size='large'
                    />
                  </Form.Item>
                )}

                <Alert
                  message='Dataset Upload Requirements'
                  description="The merged dataset will be uploaded to HuggingFace Hub using your HuggingFace CLI token. Make sure you are logged in with 'huggingface-cli login'."
                  type='info'
                  showIcon
                  style={{ marginBottom: '16px' }}
                />

                <Form.Item>
                  <Button
                    type='primary'
                    htmlType='submit'
                    loading={mergeMutation.isPending}
                    icon={<MergeOutlined />}
                    size='large'
                    block
                  >
                    Merge {selectedValidCount} Selected Datasets
                  </Button>
                </Form.Item>
              </Form>
            </Card>
          )}
        </Space>
      </Content>

      {/* Merge Status Modal */}
      <Modal
        title='Merge Progress'
        open={isStatusModalVisible}
        onCancel={() => setIsStatusModalVisible(false)}
        footer={[
          <Button
            key='close'
            onClick={() => setIsStatusModalVisible(false)}
            disabled={
              mergeStatus?.status === 'running' ||
              mergeStatus?.status === 'pending'
            }
          >
            Close
          </Button>,
          mergeStatus?.status === 'completed' && (
            <Button
              key='view'
              type='primary'
              onClick={() => {
                const [namespace, name] = (mergeStatus.new_repo_id || '').split(
                  '/'
                );
                navigate(`/${namespace}/${name}`);
              }}
            >
              View Dataset
            </Button>
          ),
        ]}
      >
        {mergeStatus && (
          <Space direction='vertical' style={{ width: '100%' }}>
            <Text>
              Status:{' '}
              <Tag
                color={
                  mergeStatus.status === 'completed'
                    ? 'success'
                    : mergeStatus.status === 'failed'
                    ? 'error'
                    : 'processing'
                }
              >
                {mergeStatus.status}
              </Tag>
            </Text>

            {mergeStatus.progress !== undefined && (
              <Progress percent={Math.round(mergeStatus.progress * 100)} />
            )}

            {mergeStatus.message && (
              <Paragraph>{mergeStatus.message}</Paragraph>
            )}

            {mergeStatus.new_repo_id && (
              <Text>
                Output: <Text code>{mergeStatus.new_repo_id}</Text>
              </Text>
            )}
          </Space>
        )}
      </Modal>
    </Layout>
  );
};

export default MergeDatasets;
