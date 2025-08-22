import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Layout,
  Spin,
  Alert,
  Space,
  Typography,
  Button,
  Modal,
  Form,
  Input,
  message,
} from 'antd';
import {
  PlusOutlined,
  QuestionCircleOutlined,
  HomeOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { datasetApi } from '@/services/api';
import { useSelectedEpisodes } from '@/hooks/useSelectedEpisodes';
import { useVideoPreloader } from '@/hooks/useVideoPreloader';
import { useTaskManagement } from '@/hooks/useTaskManagement';
import VideoPlayer from './VideoPlayer';
import DataChart from './DataChart';
import LoadingIndicator from './LoadingIndicator';
import EpisodeSidebar from './EpisodeSidebar';
import EpisodeIndexDisplay from './EpisodeIndexDisplay';
import TaskManagement from './TaskManagement';
import EpisodeNavigation from './EpisodeNavigation';
import DatasetCompletionModal from './DatasetCompletionModal';
import { createDatasetRequest } from '@/utils/createDataset';

const { Header, Content, Sider } = Layout;
const { Title, Text } = Typography;

const DatasetViewer: React.FC = () => {
  const { namespace, name, episodeId } = useParams<{
    namespace: string;
    name: string;
    episodeId?: string;
  }>();
  const navigate = useNavigate();
  const [currentEpisodeId, setCurrentEpisodeId] = useState(
    episodeId ? parseInt(episodeId) : 0
  );
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [isShortcutsModalVisible, setIsShortcutsModalVisible] = useState(false);
  const [currentVideoTime, setCurrentVideoTime] = useState(0);
  const [creationTaskId, setCreationTaskId] = useState<string | null>(null);
  const [creationStatus, setCreationStatus] = useState<any>(null);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [form] = Form.useForm();

  const datasetId = `${namespace}/${name}`;

  const {
    selectedEpisodes,
    toggleEpisode,
    clearSelection,
    selectAll,
    selectedCount,
  } = useSelectedEpisodes(datasetId);

  // Task management
  const {
    availableTasks,
    addTask,
    removeTask,
    setEpisodeTask,
    getEpisodeTask,
    getDefaultTask,
  } = useTaskManagement(datasetId);

  // Updated version to trigger auto-load
  const { data: status, isLoading: isStatusLoading } = useQuery({
    queryKey: ['datasetStatus', namespace, name],
    queryFn: async () => {
      // First check status without auto-load
      const initialStatus = await datasetApi.getDatasetStatus(
        namespace!,
        name!,
        false
      );

      // If not loaded, trigger auto-load
      if (initialStatus.status === 'not_loaded') {
        return datasetApi.getDatasetStatus(namespace!, name!, true);
      }

      return initialStatus;
    },
    enabled: !!namespace && !!name,
    refetchInterval: (query) => {
      const currentStatus = query.state.data;
      if (
        currentStatus?.status === 'loading' ||
        currentStatus?.status === 'not_loaded'
      ) {
        return 1000; // Poll every second while loading
      }
      return false; // Stop polling when ready or error
    },
  });

  // Load episode data only when dataset is ready
  const {
    data: episodeData,
    isLoading: isEpisodeLoading,
    error,
  } = useQuery({
    queryKey: ['episode', namespace, name, currentEpisodeId],
    queryFn: () => datasetApi.getEpisode(namespace!, name!, currentEpisodeId),
    enabled: !!namespace && !!name && status?.status === 'ready',
    retry: (failureCount, error: any) => {
      if (error?.response?.status === 202) {
        // Dataset is being loaded, wait for status to update
        return false; // Don't retry, wait for enabled condition
      }
      return failureCount < 2;
    },
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
  });

  // Get list of all episodes
  const { data: episodesList } = useQuery({
    queryKey: ['episodes', namespace, name],
    queryFn: () => datasetApi.listEpisodes(namespace!, name!),
    enabled: !!namespace && !!name && episodeData != null,
  });

  // Poll for creation status
  useEffect(() => {
    if (!creationTaskId) return;

    const pollStatus = async () => {
      try {
        const status = await datasetApi.getCreateStatus(creationTaskId);
        setCreationStatus(status);

        if (status.status === 'completed') {
          setCreationTaskId(null);
          setIsCreateModalVisible(false);
          form.resetFields();
          clearSelection();
          // Keep the modal open but with completed status
        } else if (status.status === 'failed') {
          setCreationTaskId(null);
          // Keep status to show the error in modal
        }
      } catch (error) {
        console.error('Error polling creation status:', error);
      }
    };

    const interval = setInterval(pollStatus, 2000); // Poll every 2 seconds
    pollStatus(); // Initial poll

    return () => clearInterval(interval);
  }, [creationTaskId, form, clearSelection]);

  // Create dataset mutation
  const createDatasetMutation = useMutation({
    mutationFn: datasetApi.createDataset,
    onSuccess: (data) => {
      if (data.task_id) {
        setCreationTaskId(data.task_id);
        setShowStatusModal(true);
        message.info('Dataset creation started. Please wait...');
      } else {
        message.success(data.message);
        setIsCreateModalVisible(false);
        form.resetFields();
        clearSelection();
      }
    },
    onError: (error: any) => {
      console.error('Create dataset error:', error);
      const errorMessage =
        error.response?.data?.detail || 'Failed to create dataset';

      // If detail is an array of validation errors, format them nicely
      if (Array.isArray(error.response?.data?.detail)) {
        const validationErrors = error.response.data.detail
          .map((err: any) => `${err.loc.join('.')}: ${err.msg}`)
          .join('\n');
        message.error(`Validation errors:\n${validationErrors}`);
      } else {
        message.error(errorMessage);
      }
    },
  });

  // Video preloading
  const getVideoUrl = useCallback(
    (episodeId: number) => {
      if (!episodeData?.videos_info?.[0]) return undefined;
      // Construct the video URL for the episode
      const videoInfo = episodeData.videos_info[0];
      const baseUrl = videoInfo.url.substring(
        0,
        videoInfo.url.lastIndexOf('/')
      );
      return `${baseUrl}/episode_${episodeId}`;
    },
    [episodeData]
  );

  const {} = useVideoPreloader(
    currentEpisodeId,
    episodeData?.dataset_info.num_episodes || 0,
    getVideoUrl
  );

  const handleEpisodeChange = (newEpisodeId: number) => {
    setCurrentEpisodeId(newEpisodeId);
  };

  // Task management handlers
  const currentEpisodeTask = getEpisodeTask(currentEpisodeId);
  const defaultTask = getDefaultTask();

  // Update URL when episode changes
  useEffect(() => {
    if (namespace && name && currentEpisodeId !== parseInt(episodeId || '0')) {
      navigate(`/${namespace}/${name}/episode/${currentEpisodeId}`, {
        replace: true,
      });
    }
  }, [currentEpisodeId, namespace, name, episodeId, navigate]);

  // Add keyboard shortcuts for navigation and selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if the target is an input element to avoid conflicts
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      // Left arrow - previous episode
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (currentEpisodeId > 0) {
          handleEpisodeChange(currentEpisodeId - 1);
        }
      }
      // Right arrow - next episode
      else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (
          episodeData &&
          currentEpisodeId < episodeData.dataset_info.num_episodes - 1
        ) {
          handleEpisodeChange(currentEpisodeId + 1);
        }
      }
      // Cmd+K (Mac) or Ctrl+K (Windows/Linux) - toggle checkbox
      else if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleEpisode(currentEpisodeId);
      }
      // Cmd+P (Mac) or Ctrl+P (Windows/Linux) - show shortcuts
      else if (e.key === 'p' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsShortcutsModalVisible(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentEpisodeId, episodeData, handleEpisodeChange, toggleEpisode]);

  const handleCreateDataset = async (values: any) => {
    if (!episodeData) {
      message.error('Episode data not loaded');
      return;
    }

    if (!selectedEpisodes || selectedEpisodes.length === 0) {
      message.error('No episodes selected');
      return;
    }

    const payload = createDatasetRequest({
      datasetId,
      newRepoId: values.new_repo_id,
      selectedEpisodes,
      getEpisodeTask,
    });

    await createDatasetMutation.mutateAsync(payload);
  };

  // Show loading if we're checking status or status is loading
  if (isStatusLoading || status?.status === 'loading') {
    const loadingMessage =
      status?.status === 'loading'
        ? status.message || 'Loading dataset...'
        : 'Checking dataset status...';
    const progress = status?.status === 'loading' ? status.progress : 0.1;

    return <LoadingIndicator message={loadingMessage} progress={progress} />;
  }

  // Show error if status is error
  if (status?.status === 'error') {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <Alert
          type='error'
          message='Failed to load dataset'
          description={status.message}
          showIcon
        />
        <Button
          type='primary'
          onClick={() => navigate('/')}
          style={{ marginTop: '16px' }}
        >
          Back to Home
        </Button>
      </div>
    );
  }

  // Show error if episode loading failed (not 202)
  if (
    error &&
    (error as any).response?.status !== 202 &&
    (error as any).message !== 'Dataset not ready'
  ) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <Alert
          type='error'
          message='Error loading episode'
          description={(error as any).message}
          showIcon
        />
      </div>
    );
  }

  return (
    <Layout style={{ height: '100vh' }}>
      <Header style={{ padding: '0 24px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              flex: 1,
              minWidth: 0,
            }}
          >
            <Button
              icon={<HomeOutlined />}
              onClick={() => navigate('/')}
              title='Back to Home'
            >
              Home
            </Button>
            <div style={{ minWidth: 0, flex: '0 0 auto' }}>
              <Title
                level={4}
                style={{
                  margin: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {datasetId}
              </Title>
            </div>
            {episodeData && (
              <>
                <div style={{ minWidth: 0, flex: '0 0 auto' }}>
                  <Text type='secondary' style={{ whiteSpace: 'nowrap' }}>
                    {episodeData.dataset_info.num_episodes} episodes •{' '}
                    {episodeData.dataset_info.fps} FPS
                  </Text>
                </div>
                <div style={{ minWidth: 0, flex: '0 0 auto' }}>
                  <EpisodeIndexDisplay
                    currentEpisodeId={currentEpisodeId}
                    actualEpisodeIndex={episodeData?.actual_episode_index}
                  />
                </div>
              </>
            )}
          </div>
          <Space>
            {selectedCount > 0 && (
              <Button
                type='primary'
                icon={<PlusOutlined />}
                onClick={() => setIsCreateModalVisible(true)}
              >
                Create Dataset ({selectedCount} episodes)
              </Button>
            )}
            <Button
              icon={<QuestionCircleOutlined />}
              onClick={() => setIsShortcutsModalVisible(true)}
              title='Keyboard Shortcuts (Cmd+P)'
            >
              Shortcuts
            </Button>
          </Space>
        </div>
      </Header>

      <Layout>
        <Sider width={300} style={{ overflow: 'auto' }}>
          {episodesList && (
            <EpisodeSidebar
              episodes={episodesList.episodes}
              selectedEpisodes={selectedEpisodes}
              currentEpisodeId={currentEpisodeId}
              onToggleEpisode={toggleEpisode}
              onSelectAll={() => selectAll(episodesList.episodes)}
              onClearSelection={clearSelection}
              onEpisodeClick={handleEpisodeChange}
              availableTasks={availableTasks}
              getEpisodeTask={getEpisodeTask}
              setEpisodeTask={setEpisodeTask}
              defaultTask={defaultTask}
            />
          )}
        </Sider>

        <Content style={{ padding: '24px', overflow: 'auto' }}>
          {(isEpisodeLoading || !episodeData) && status?.status === 'ready' ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <Spin size='large' />
              <Text style={{ display: 'block', marginTop: '16px' }}>
                Loading episode {currentEpisodeId} data...
              </Text>
            </div>
          ) : !episodeData && status?.status !== 'ready' ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <Spin size='large' />
              <Text style={{ display: 'block', marginTop: '16px' }}>
                Waiting for dataset to load...
              </Text>
            </div>
          ) : episodeData ? (
            <Space direction='vertical' size='large' style={{ width: '100%' }}>
              <TaskManagement
                availableTasks={availableTasks}
                onAddTask={addTask}
                onRemoveTask={removeTask}
              />

              <EpisodeNavigation
                currentEpisodeId={currentEpisodeId}
                totalEpisodes={episodeData.dataset_info.num_episodes}
                onEpisodeChange={handleEpisodeChange}
                isPreloaded={() => false} // Can be improved with preloader state
              />

              <VideoPlayer
                videos={episodeData.videos_info}
                episodeId={currentEpisodeId}
                tasks={
                  currentEpisodeTask
                    ? [...(episodeData.tasks || []), currentEpisodeTask]
                    : episodeData.tasks || []
                }
                onTimeUpdate={setCurrentVideoTime}
              />

              <DataChart
                episodeData={episodeData.episode_data}
                featureNames={episodeData.feature_names}
                currentTime={currentVideoTime}
              />
            </Space>
          ) : null}
        </Content>
      </Layout>

      <Modal
        title='Create New Dataset'
        open={isCreateModalVisible}
        onCancel={() => setIsCreateModalVisible(false)}
        footer={null}
      >
        <Form form={form} layout='vertical' onFinish={handleCreateDataset}>
          <Form.Item
            name='new_repo_id'
            label='New Dataset Repository ID'
            rules={[
              { required: true, message: 'Please enter a repository ID' },
              {
                pattern: /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/,
                message: 'Must be in format: namespace/dataset-name',
              },
            ]}
          >
            <Input placeholder='e.g., myusername/my-dataset' />
          </Form.Item>
          <Form.Item>
            <Text type='secondary'>
              This will create a new dataset with {selectedCount} selected
              episodes
            </Text>
          </Form.Item>
          <Form.Item>
            <Space>
              <Button onClick={() => setIsCreateModalVisible(false)}>
                Cancel
              </Button>
              <Button
                type='primary'
                htmlType='submit'
                loading={createDatasetMutation.isPending}
              >
                Create Dataset
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Keyboard Shortcuts Modal */}
      <Modal
        title='Keyboard Shortcuts'
        open={isShortcutsModalVisible}
        onCancel={() => setIsShortcutsModalVisible(false)}
        footer={[
          <Button key='close' onClick={() => setIsShortcutsModalVisible(false)}>
            Close
          </Button>,
        ]}
        width={500}
      >
        <Space direction='vertical' size='large' style={{ width: '100%' }}>
          <div>
            <Title level={5}>Navigation</Title>
            <Space direction='vertical' style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text>Previous Episode</Text>
                <Text keyboard style={{ fontSize: '2em' }}>
                  ←
                </Text>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text>Next Episode</Text>
                <Text keyboard style={{ fontSize: '2em' }}>
                  →
                </Text>
              </div>
            </Space>
          </div>

          <div>
            <Title level={5}>Video Controls</Title>
            <Space direction='vertical' style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text>Play/Pause Video</Text>
                <Text keyboard style={{ fontSize: '1.5em' }}>
                  Space
                </Text>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text>Change Playback Speed</Text>
                <Text type='secondary' style={{ fontSize: '1em' }}>
                  Use dropdown (0.5x - 3x)
                </Text>
              </div>
            </Space>
          </div>

          <div>
            <Title level={5}>Selection</Title>
            <Space direction='vertical' style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text>Toggle Episode Selection</Text>
                <Text keyboard style={{ fontSize: '1.5em' }}>
                  {navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'}+K
                </Text>
              </div>
            </Space>
          </div>

          <div>
            <Title level={5}>General</Title>
            <Space direction='vertical' style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text>Show Keyboard Shortcuts</Text>
                <Text keyboard style={{ fontSize: '1.5em' }}>
                  {navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'}+P
                </Text>
              </div>
            </Space>
          </div>
        </Space>
      </Modal>

      {/* Dataset Creation Status Modal */}
      <DatasetCompletionModal
        visible={showStatusModal}
        onClose={() => {
          setShowStatusModal(false);
          setCreationStatus(null);
        }}
        status={
          creationStatus
            ? {
                status: creationStatus.status,
                progress: creationStatus.progress,
                message: creationStatus.message,
                repo_id: creationStatus.new_repo_id,
              }
            : undefined
        }
        title='Dataset Creation Status'
        actionLabel='View New Dataset'
      />
    </Layout>
  );
};

export default DatasetViewer;
