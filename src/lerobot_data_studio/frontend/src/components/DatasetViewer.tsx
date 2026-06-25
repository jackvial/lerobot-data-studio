import { useState, useEffect, useCallback, useRef } from 'react';
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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSelectedEpisodes } from '@/hooks/useSelectedEpisodes';
import { useVideoPreloader } from '@/hooks/useVideoPreloader';
import { CreateDatasetRequest } from '@/types';
import VideoPlayer, { VideoTimeUpdateOptions } from './VideoPlayer';
import DataChart, { DataChartHandle } from './DataChart';
import LoadingIndicator from './LoadingIndicator';
import EpisodeSidebar from './EpisodeSidebar';
import EpisodeIndexDisplay from './EpisodeIndexDisplay';
import EpisodeNavigation from './EpisodeNavigation';
import DatasetCompletionModal from './DatasetCompletionModal';
import {
  DatasetViewerController,
  createInitialDatasetViewerViewState,
  type DatasetViewerViewState,
} from './controllers/DatasetViewerController';

const { Header, Content, Sider } = Layout;
const { Title, Text } = Typography;

interface CreateDatasetFormValues {
  new_repo_id: string;
}

const DatasetViewer = () => {
  const { namespace, name, episodeId } = useParams<{
    namespace: string;
    name: string;
    episodeId?: string;
  }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<CreateDatasetFormValues>();
  const [viewState, setViewState] = useState<DatasetViewerViewState>(() =>
    createInitialDatasetViewerViewState(episodeId)
  );
  const controllerRef = useRef<DatasetViewerController | null>(null);

  if (controllerRef.current === null) {
    controllerRef.current = new DatasetViewerController({
      initialEpisodeId: episodeId,
      onViewStateChange: setViewState,
    });
  }

  const controller = controllerRef.current;
  const datasetId = controller.getDatasetId(namespace, name);
  const currentEpisodeId = viewState.currentEpisodeId;

  const {
    selectedEpisodes,
    toggleEpisode,
    clearSelection,
    selectAll,
    selectedCount,
  } = useSelectedEpisodes(datasetId);

  useEffect(() => {
    controller.syncRouteEpisodeId(episodeId);
  }, [controller, episodeId]);

  const { data: status, isLoading: isStatusLoading } = useQuery({
    queryKey: ['datasetStatus', namespace, name],
    queryFn: () => controller.loadDatasetStatus(namespace!, name!),
    enabled: controller.canLoadDataset(namespace, name),
    refetchInterval: (query) =>
      controller.getDatasetStatusRefetchInterval(query.state.data),
    refetchIntervalInBackground: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });

  const {
    data: episodeData,
    isLoading: isEpisodeLoading,
    error,
  } = useQuery({
    queryKey: ['episode', namespace, name, currentEpisodeId],
    queryFn: () => controller.loadEpisode(namespace!, name!, currentEpisodeId),
    enabled: controller.canLoadEpisode(namespace, name, status),
    retry: (failureCount, queryError) =>
      controller.shouldRetryEpisodeQuery(failureCount, queryError),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  useEffect(() => {
    if (
      !namespace ||
      !name ||
      !controller.shouldInvalidateDatasetStatusForEpisodeError(error)
    ) {
      return;
    }

    void queryClient.invalidateQueries({
      queryKey: ['datasetStatus', namespace, name],
    });
  }, [controller, error, name, namespace, queryClient]);

  const { data: episodesList } = useQuery({
    queryKey: ['episodes', namespace, name],
    queryFn: () => controller.listEpisodes(namespace!, name!),
    enabled: Boolean(namespace && name && episodeData),
  });

  const createDatasetMutation = useMutation({
    mutationFn: (payload: CreateDatasetRequest) =>
      controller.createDataset(payload),
    onSuccess: (data) => {
      controller.handleCreateDatasetSuccess(data, {
        resetForm: () => form.resetFields(),
        clearSelection,
        notifyInfo: message.info,
        notifySuccess: message.success,
      });
    },
    onError: (mutationError) => {
      controller.handleCreateDatasetError(mutationError, {
        notifyError: message.error,
      });
    },
  });

  useEffect(
    () =>
      controller.startCreationStatusPolling({
        resetForm: () => form.resetFields(),
        clearSelection,
        notifyWarning: message.warning,
      }),
    [clearSelection, controller, form, viewState.creationTaskId]
  );

  const getVideoUrl = useCallback(
    (nextEpisodeId: number) =>
      controller.getVideoUrl(episodeData, nextEpisodeId),
    [controller, episodeData]
  );

  useVideoPreloader(
    currentEpisodeId,
    episodeData?.dataset_info.num_episodes || 0,
    getVideoUrl
  );

  const handleEpisodeChange = useCallback(
    (newEpisodeId: number) => {
      controller.setCurrentEpisodeId(newEpisodeId);
    },
    [controller]
  );

  const handleDataChartRef = useCallback(
    (handle: DataChartHandle | null) => {
      controller.setDataChart(handle);
    },
    [controller]
  );

  const handleVideoTimeUpdate = useCallback(
    (time: number, options?: VideoTimeUpdateOptions) => {
      controller.handleVideoTimeUpdate(time, options);
    },
    [controller]
  );

  useEffect(() => {
    controller.resetPlaybackTime();
  }, [controller, currentEpisodeId]);

  useEffect(() => {
    const nextRoute = controller.getEpisodeRoute({
      namespace,
      name,
      routeEpisodeId: episodeId,
    });

    if (nextRoute) {
      navigate(nextRoute, { replace: true });
    }
  }, [controller, currentEpisodeId, episodeId, name, namespace, navigate]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      controller.handleKeyboardEvent(event, {
        episodeData,
        toggleEpisode,
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [controller, episodeData, toggleEpisode]);

  const handleCreateDataset = async (values: CreateDatasetFormValues) => {
    const { error: validationError, payload } =
      controller.prepareCreateDataset({
        values,
        datasetId,
        episodeData,
        selectedEpisodes,
      });

    if (validationError || !payload) {
      message.error(validationError || 'Failed to create dataset');
      return;
    }

    await createDatasetMutation.mutateAsync(payload);
  };

  if (isStatusLoading || status?.status === 'loading') {
    const loadingMessage =
      status?.status === 'loading'
        ? status.message || 'Loading dataset...'
        : 'Checking dataset status...';
    const progress = status?.status === 'loading' ? status.progress : 0.1;

    return <LoadingIndicator message={loadingMessage} progress={progress} />;
  }

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

  if (
    error &&
    !controller.shouldInvalidateDatasetStatusForEpisodeError(error) &&
    (!(error instanceof Error) || error.message !== 'Dataset not ready')
  ) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <Alert
          type='error'
          message='Error loading episode'
          description={error instanceof Error ? error.message : 'Unknown error'}
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
                onClick={() => controller.openCreateModal()}
              >
                Create Dataset ({selectedCount} episodes)
              </Button>
            )}
            <Button
              icon={<QuestionCircleOutlined />}
              onClick={() => controller.openShortcutsModal()}
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
              <EpisodeNavigation
                currentEpisodeId={currentEpisodeId}
                totalEpisodes={episodeData.dataset_info.num_episodes}
                onEpisodeChange={handleEpisodeChange}
                isPreloaded={() => false}
              />

              <VideoPlayer
                videos={episodeData.videos_info}
                episodeId={currentEpisodeId}
                onTimeUpdate={handleVideoTimeUpdate}
              />

              <DataChart
                ref={handleDataChartRef}
                episodeData={episodeData.episode_data}
                featureNames={episodeData.feature_names}
                currentTime={viewState.currentVideoTime}
              />
            </Space>
          ) : null}
        </Content>
      </Layout>

      <Modal
        title='Create New Dataset'
        open={viewState.isCreateModalVisible}
        onCancel={() => controller.closeCreateModal()}
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
              <Button onClick={() => controller.closeCreateModal()}>
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

      <Modal
        title='Keyboard Shortcuts'
        open={viewState.isShortcutsModalVisible}
        onCancel={() => controller.closeShortcutsModal()}
        footer={[
          <Button key='close' onClick={() => controller.closeShortcutsModal()}>
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

      <DatasetCompletionModal
        visible={viewState.showStatusModal}
        onClose={() => controller.closeStatusModal()}
        status={
          viewState.creationStatus
            ? {
                status: viewState.creationStatus.status,
                progress: viewState.creationStatus.progress,
                message: viewState.creationStatus.message,
                repo_id: viewState.creationStatus.new_repo_id,
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
