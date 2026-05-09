import React, { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Empty,
  Layout,
  message,
  Segmented,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
  Slider,
} from 'antd';
import {
  CaretRightOutlined,
  HomeOutlined,
  PauseOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rltBufferApi } from '@/services/rltBufferApi';
import { useRltEpisode } from '@/hooks/useRltEpisode';
import { RltEpisodeLabel } from '@/types';
import RltEpisodeSidebar from './RltEpisodeSidebar';
import RltTimeline from './RltTimeline';
import RltImagePane from './RltImagePane';
import RltActionChart from './RltActionChart';

const { Header, Content, Sider } = Layout;
const { Title, Text } = Typography;

const PLAYBACK_SPEEDS = [0.25, 0.5, 1.0, 2.0, 4.0];

const RltBufferViewer: React.FC = () => {
  const { fileToken: encodedToken, episodeId } = useParams<{
    fileToken: string;
    episodeId?: string;
  }>();
  const fileToken = encodedToken ? decodeURIComponent(encodedToken) : undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    data: episodesData,
    isLoading: episodesLoading,
    error: episodesError,
  } = useQuery({
    queryKey: ['rlt-buffer-episodes', fileToken],
    queryFn: () => rltBufferApi.listEpisodes(fileToken as string),
    enabled: Boolean(fileToken),
  });

  const episodes = useMemo(() => episodesData?.episodes ?? [], [episodesData]);

  const currentEpisodeId = useMemo(() => {
    if (episodeId !== undefined) {
      const parsed = parseInt(episodeId, 10);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return episodes[0]?.episode_id;
  }, [episodeId, episodes]);

  const currentEpisode = useMemo(
    () => episodes.find((episode) => episode.episode_id === currentEpisodeId),
    [episodes, currentEpisodeId]
  );

  // Bounce to the first episode when none is in the URL but we have data.
  useEffect(() => {
    if (
      episodeId === undefined &&
      episodes.length > 0 &&
      fileToken !== undefined
    ) {
      navigate(
        `/rlt-buffer/${encodeURIComponent(fileToken)}/episode/${episodes[0].episode_id}`,
        { replace: true }
      );
    }
  }, [episodeId, episodes, fileToken, navigate]);

  const {
    transitions,
    hasInferenceTs,
    isLoading: transitionsLoading,
    error: transitionsError,
    selectedIndex,
    selectedTransition,
    setSelectedIndex,
    goPrev,
    goNext,
    isPlaying,
    setPlaying,
    playbackSpeed,
    setPlaybackSpeed,
  } = useRltEpisode({ fileToken, episodeId: currentEpisodeId });

  const saveReviewMutation = useMutation({
    mutationFn: ({
      label,
      deleted,
    }: {
      label: RltEpisodeLabel;
      deleted: boolean;
    }) => {
      if (!fileToken || currentEpisodeId === undefined) {
        throw new Error('No RLT episode is selected');
      }
      return rltBufferApi.saveEpisodeReview(
        fileToken,
        currentEpisodeId,
        label,
        deleted
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['rlt-buffer-episodes', fileToken],
      });
      void queryClient.invalidateQueries({
        queryKey: ['rlt-buffer-transitions', fileToken, currentEpisodeId],
      });
      message.success('Episode review saved');
    },
    onError: (err) => {
      message.error(String((err as Error)?.message ?? err));
    },
  });

  const saveEpisodeReview = (
    next: Partial<{ label: RltEpisodeLabel; deleted: boolean }>
  ) => {
    if (!currentEpisode) {
      return;
    }
    saveReviewMutation.mutate({
      label: next.label ?? currentEpisode.label,
      deleted: next.deleted ?? currentEpisode.deleted,
    });
  };

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        e.repeat ||
        (target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable ||
            target.closest(
              "button, a, [role='button'], .ant-select, .ant-segmented, .ant-slider"
            )))
      ) {
        return;
      }
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        setPlaying(!isPlaying);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isPlaying, setPlaying]);

  const handleEpisodeClick = (newEpisodeId: number) => {
    if (!fileToken) {
      return;
    }
    navigate(
      `/rlt-buffer/${encodeURIComponent(fileToken)}/episode/${newEpisodeId}`
    );
  };

  if (!fileToken) {
    return (
      <Alert
        type='error'
        showIcon
        message='Missing file token'
        description='Open a buffer file from the RLT buffer home page.'
      />
    );
  }

  if (episodesError) {
    return (
      <Alert
        type='error'
        showIcon
        message='Failed to load episodes'
        description={String((episodesError as Error)?.message ?? episodesError)}
      />
    );
  }

  return (
    <Layout style={{ height: '100vh' }}>
      <Header
        style={{
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Space>
          <Button
            icon={<HomeOutlined />}
            onClick={() => navigate('/rlt-buffer')}
          >
            Files
          </Button>
          <Title level={4} style={{ margin: 0 }}>
            RLT Rollout Viewer
          </Title>
          {currentEpisodeId !== undefined ? (
            <Tag color='blue'>Episode {currentEpisodeId}</Tag>
          ) : null}
        </Space>
      </Header>
      <Layout>
        <Sider
          width={380}
          style={{ background: '#fff', borderRight: '1px solid #f0f0f0' }}
        >
          {episodesLoading ? (
            <div style={{ padding: 16 }}>
              <Spin />
            </div>
          ) : (
            <RltEpisodeSidebar
              episodes={episodes}
              currentEpisodeId={currentEpisodeId}
              onEpisodeClick={handleEpisodeClick}
            />
          )}
        </Sider>
        <Content style={{ padding: 16, overflow: 'auto' }}>
          {currentEpisodeId === undefined ? (
            <Empty description='This buffer has no episodes.' />
          ) : transitionsError ? (
            <Alert
              type='error'
              showIcon
              message='Failed to load transitions'
              description={String(
                (transitionsError as Error)?.message ?? transitionsError
              )}
            />
          ) : transitionsLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin size='large' />
            </div>
          ) : transitions.length === 0 ? (
            <Empty description='No transitions in this episode.' />
          ) : (
            <Space direction='vertical' size='middle' style={{ width: '100%' }}>
              <Card size='small'>
                <Space wrap style={{ marginBottom: 12 }}>
                  <Button
                    icon={<StepBackwardOutlined />}
                    onClick={goPrev}
                    disabled={selectedIndex <= 0}
                  >
                    Prev
                  </Button>
                  <Button
                    type='primary'
                    icon={
                      isPlaying ? <PauseOutlined /> : <CaretRightOutlined />
                    }
                    onClick={() => setPlaying(!isPlaying)}
                  >
                    {isPlaying ? 'Pause' : 'Play'}
                  </Button>
                  <Button
                    icon={<StepForwardOutlined />}
                    onClick={goNext}
                    disabled={selectedIndex >= transitions.length - 1}
                  >
                    Next
                  </Button>
                  <Space.Compact>
                    {PLAYBACK_SPEEDS.map((speed) => (
                      <Button
                        key={speed}
                        size='small'
                        type={playbackSpeed === speed ? 'primary' : 'default'}
                        onClick={() => setPlaybackSpeed(speed)}
                      >
                        {speed}x
                      </Button>
                    ))}
                  </Space.Compact>
                  <Text type='secondary'>
                    Transition {selectedIndex + 1} / {transitions.length}
                  </Text>
                  {selectedTransition ? (
                    <Text type='secondary'>
                      t={selectedTransition.t_offset_s.toFixed(2)}s • r=
                      {selectedTransition.reward.toFixed(3)}
                    </Text>
                  ) : null}
                </Space>
                {currentEpisode ? (
                  <Space wrap style={{ width: '100%' }}>
                    <Text strong>Outcome</Text>
                    <Segmented
                      value={currentEpisode.label}
                      disabled={saveReviewMutation.isPending}
                      options={[
                        { label: 'Success', value: 'success' },
                        { label: 'Failure', value: 'failure' },
                        { label: 'Open', value: 'open' },
                      ]}
                      onChange={(value) =>
                        saveEpisodeReview({ label: value as RltEpisodeLabel })
                      }
                    />
                    {currentEpisode.label !== currentEpisode.original_label ? (
                      <Tag color='purple'>
                        was {currentEpisode.original_label}
                      </Tag>
                    ) : null}
                    <Text strong style={{ marginLeft: 16 }}>
                      Deleted
                    </Text>
                    <Switch
                      checked={currentEpisode.deleted}
                      disabled={saveReviewMutation.isPending}
                      onChange={(checked) =>
                        saveEpisodeReview({ deleted: checked })
                      }
                    />
                    {currentEpisode.deleted ? (
                      <Text type='secondary'>
                        Soft-deleted; training can skip this episode via the
                        review sidecar.
                      </Text>
                    ) : null}
                  </Space>
                ) : null}
                <Slider
                  min={0}
                  max={Math.max(transitions.length - 1, 0)}
                  value={selectedIndex}
                  onChange={(value) => setSelectedIndex(value as number)}
                  tooltip={{
                    formatter: (value) => {
                      if (value === undefined || value === null) {
                        return '';
                      }
                      const t = transitions[value];
                      if (!t) {
                        return '';
                      }
                      return `#${value} @ ${t.t_offset_s.toFixed(2)}s`;
                    },
                  }}
                  style={{ marginTop: 12 }}
                />
              </Card>

              <RltTimeline
                transitions={transitions}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
                hasInferenceTs={hasInferenceTs}
              />

              <RltImagePane
                fileToken={fileToken}
                transition={selectedTransition}
              />

              <RltActionChart
                transitions={transitions}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
              />
            </Space>
          )}
        </Content>
      </Layout>
    </Layout>
  );
};

export default RltBufferViewer;
