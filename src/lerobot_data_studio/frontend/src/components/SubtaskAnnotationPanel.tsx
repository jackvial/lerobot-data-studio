import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Radio,
  RadioChangeEvent,
  Space,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CloseCircleOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { datasetApi } from '@/services/api';
import {
  useSubtaskAnnotations,
} from '@/hooks/useSubtaskAnnotations';
import { SubtaskSegment } from '@/types';

const { Text } = Typography;

const BAR_HEIGHT = 36;
const HANDLE_WIDTH = 6;
const MIN_SEGMENT_SECONDS = 0.05;

const SUBTASK_COLOR_PALETTE = [
  '#1677ff',
  '#722ed1',
  '#13c2c2',
  '#52c41a',
  '#fa8c16',
  '#eb2f96',
  '#faad14',
  '#fa541c',
  '#2f54eb',
  '#a0d911',
];

const colorForTask = (task: string, tasks: string[]): string => {
  const idx = tasks.indexOf(task);
  const fallback = Math.abs(
    [...task].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  );
  const safeIdx = idx >= 0 ? idx : fallback;
  return SUBTASK_COLOR_PALETTE[safeIdx % SUBTASK_COLOR_PALETTE.length];
};

interface SubtaskAnnotationPanelProps {
  namespace: string;
  name: string;
  datasetId: string;
  episodeId: number;
  episodeDuration: number;
  fps: number;
  currentTime: number;
  onSeek: (time: number, options?: SubtaskSeekOptions) => void;
  getCurrentTime?: () => number;
}

export interface SubtaskSeekOptions {
  preview?: boolean;
}

export interface SubtaskAnnotationPanelHandle {
  setPlayhead: (time: number) => void;
}

type DragMode =
  | { kind: 'create'; startTime: number }
  | { kind: 'move'; segmentId: string; offset: number }
  | { kind: 'resize-start'; segmentId: string }
  | { kind: 'resize-end'; segmentId: string }
  | null;

interface SegmentWithId extends SubtaskSegment {
  id: string;
}

interface SegmentNeighbors {
  previous: SegmentWithId | null;
  next: SegmentWithId | null;
}

const segmentId = (_segment: SubtaskSegment, idx: number): string =>
  `segment-${idx}`;

const withIds = (segments: SubtaskSegment[]): SegmentWithId[] => {
  return segments.map((segment, idx) => ({
    ...segment,
    id: segmentId(segment, idx),
  }));
};

const stripIds = (segments: SegmentWithId[]): SubtaskSegment[] =>
  segments.map(({ id: _id, ...rest }) => rest);

function compareSegments(a: SubtaskSegment, b: SubtaskSegment): number {
  if (a.start !== b.start) {
    return a.start - b.start;
  }
  if (a.end !== b.end) {
    return a.end - b.end;
  }
  return a.name.localeCompare(b.name);
}

function sortSegmentsByTime<T extends SubtaskSegment>(segments: T[]): T[] {
  return [...segments].sort(compareSegments);
}

const clampTime = (time: number, min: number, max: number): number => {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  return Math.max(safeMin, Math.min(time, safeMax));
};

const getSegmentNeighbors = (
  segments: SegmentWithId[],
  id: string
): SegmentNeighbors => {
  const sorted = sortSegmentsByTime(segments);
  const index = sorted.findIndex((segment) => segment.id === id);
  if (index === -1) {
    return { previous: null, next: null };
  }
  return {
    previous: index > 0 ? sorted[index - 1] : null,
    next: index < sorted.length - 1 ? sorted[index + 1] : null,
  };
};

const getGapBoundsAtTime = (
  segments: SegmentWithId[],
  time: number,
  episodeDuration: number
): { start: number; end: number } | null => {
  const sorted = sortSegmentsByTime(segments);
  const containing = sorted.find(
    (segment) => time > segment.start && time < segment.end
  );
  if (containing) {
    return null;
  }

  let start = 0;
  let end = episodeDuration;

  for (const segment of sorted) {
    if (segment.end <= time) {
      start = Math.max(start, segment.end);
      continue;
    }
    if (segment.start >= time) {
      end = segment.start;
      break;
    }
  }

  return { start, end };
};

const snapSegmentsToCoverage = (
  segments: SegmentWithId[],
  episodeDuration: number,
  snapToFrame: (time: number) => number
): SubtaskSegment[] => {
  if (segments.length === 0) {
    return [];
  }

  const sorted = sortSegmentsByTime(segments).map((segment) => ({
    ...segment,
    start: clampTime(segment.start, 0, episodeDuration),
    end: clampTime(segment.end, 0, episodeDuration),
  }));

  sorted[0].start = 0;
  sorted[sorted.length - 1].end = episodeDuration;

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];
    if (next.start <= current.end) {
      continue;
    }

    const midpoint = clampTime(
      snapToFrame((current.end + next.start) / 2),
      current.end,
      next.start
    );
    current.end = midpoint;
    next.start = midpoint;
  }

  const snappedById = new Map(
    sorted.map(({ id, name, start, end }) => [
      id,
      {
        name,
        start: clampTime(start, 0, episodeDuration),
        end: clampTime(end, 0, episodeDuration),
      },
    ])
  );

  return segments.map((segment) => {
    return (
      snappedById.get(segment.id) ?? {
        name: segment.name,
        start: segment.start,
        end: segment.end,
      }
    );
  });
};

const SubtaskAnnotationPanel = forwardRef<
  SubtaskAnnotationPanelHandle,
  SubtaskAnnotationPanelProps
>(({
  namespace,
  name,
  datasetId,
  episodeId,
  episodeDuration,
  fps,
  currentTime,
  onSeek,
  getCurrentTime,
}, ref) => {
  const queryClient = useQueryClient();
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragModeRef = useRef<DragMode>(null);
  const currentTimeRef = useRef(currentTime);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const playheadLabelRef = useRef<HTMLDivElement | null>(null);
  const isDraggingPlayheadRef = useRef(false);
  const [activeSubtask, setActiveSubtask] = useState<string | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    start: number;
    end: number;
  } | null>(null);

  const tasksQuery = useQuery({
    queryKey: ['subtaskTasks'],
    queryFn: datasetApi.getSubtaskTasks,
    staleTime: 60 * 60 * 1000,
  });

  const annotationsQuery = useQuery({
    queryKey: ['subtaskAnnotations', namespace, name],
    queryFn: () => datasetApi.getSubtaskAnnotations(namespace, name),
    enabled: !!namespace && !!name,
    staleTime: 5 * 60 * 1000,
  });

  const tasks = tasksQuery.data?.tasks ?? [];
  const savedSegments = useMemo<SubtaskSegment[]>(() => {
    const episode =
      annotationsQuery.data?.episodes?.[String(episodeId)];
    return episode?.skills ? episode.skills.map((s) => ({ ...s })) : [];
  }, [annotationsQuery.data, episodeId]);

  const { draft, isDirty, setDraft, resetToSaved, clearDraft } =
    useSubtaskAnnotations({
      datasetId,
      episodeId,
      saved: savedSegments,
      enabled: annotationsQuery.isSuccess,
    });

  const segmentsWithIds = useMemo(() => withIds(draft), [draft]);

  const paintPlayhead = useCallback(
    (time: number) => {
      currentTimeRef.current = time;
      const playhead = playheadRef.current;
      if (!playhead || episodeDuration <= 0) {
        return;
      }

      const pct = Math.min(Math.max((time / episodeDuration) * 100, 0), 100);
      playhead.style.left = `${pct}%`;

      const label = playheadLabelRef.current;
      if (label) {
        label.textContent = `${time.toFixed(2)}s`;
      }
    },
    [episodeDuration]
  );

  useImperativeHandle(
    ref,
    () => ({
      setPlayhead: paintPlayhead,
    }),
    [paintPlayhead]
  );

  useEffect(() => {
    paintPlayhead(currentTime);
  }, [currentTime, paintPlayhead]);

  useEffect(() => {
    if (
      activeSegmentId &&
      !segmentsWithIds.some((segment) => segment.id === activeSegmentId)
    ) {
      setActiveSegmentId(null);
    }
  }, [activeSegmentId, segmentsWithIds]);

  // Pick a sensible default subtask once tasks load.
  useEffect(() => {
    if (!activeSubtask && tasks.length > 0) {
      setActiveSubtask(tasks[0]);
    }
  }, [tasks, activeSubtask]);

  // Reset selection when the episode changes.
  useEffect(() => {
    setActiveSegmentId(null);
    setDragPreview(null);
  }, [episodeId]);

  const saveMutation = useMutation({
    mutationFn: (segments: SubtaskSegment[]) =>
      datasetApi.saveSubtaskAnnotations(namespace, name, episodeId, {
        skills: segments,
      }),
    onSuccess: (data) => {
      message.success(`Saved ${draft.length} subtask segment(s)`);
      queryClient.setQueryData(
        ['subtaskAnnotations', namespace, name],
        data
      );
      queryClient.invalidateQueries({
        queryKey: ['subtaskSummary', namespace, name],
      });
      clearDraft();
    },
    onError: (error: any) => {
      const detail =
        error?.response?.data?.detail ?? error?.message ?? 'Save failed';
      message.error(`Failed to save subtasks: ${detail}`);
    },
  });

  const snapToFrame = useCallback(
    (time: number): number => {
      if (!fps || fps <= 0 || !Number.isFinite(time)) {
        return Math.max(0, time);
      }
      const clamped = Math.max(0, Math.min(time, episodeDuration));
      return Math.round(clamped * fps) / fps;
    },
    [episodeDuration, fps]
  );

  const timeFromEvent = useCallback(
    (clientX: number): number => {
      const bar = barRef.current;
      if (!bar || episodeDuration <= 0) {
        return 0;
      }
      const rect = bar.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      const clamped = Math.max(0, Math.min(ratio, 1));
      return snapToFrame(clamped * episodeDuration);
    },
    [episodeDuration, snapToFrame]
  );

  const updateDraftSegment = useCallback(
    (id: string, updater: (segment: SubtaskSegment) => SubtaskSegment) => {
      setDraft((prev) => {
        const indexed = withIds(prev);
        return indexed.map((segment) =>
          segment.id === id
            ? (() => {
                const next = updater({
                  name: segment.name,
                  start: segment.start,
                  end: segment.end,
                });
                return {
                  ...next,
                  id: segment.id,
                };
              })()
            : segment
        ).map(({ id: _id, ...rest }) => rest);
      });
    },
    [setDraft]
  );

  const removeSegment = useCallback(
    (id: string) => {
      const indexed = withIds(draft);
      const next = indexed.filter((segment) => segment.id !== id);
      setDraft(stripIds(next));
      setActiveSegmentId(null);
    },
    [draft, setDraft]
  );

  const addSegment = useCallback(
    (segment: SubtaskSegment) => {
      setDraft((prev) => [...prev, segment]);
    },
    [setDraft]
  );

  const handleBarPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      if (!activeSubtask) {
        message.info('Select a subtask first');
        return;
      }
      if (episodeDuration <= 0) {
        return;
      }
      const target = event.target as HTMLElement;
      // Clicks on existing segments / handles are handled by their own listeners.
      if (target.closest('[data-segment-id], [data-playhead]')) {
        return;
      }
      event.preventDefault();
      const startTime = timeFromEvent(event.clientX);
      dragModeRef.current = { kind: 'create', startTime };
      setDragPreview({ start: startTime, end: startTime });
      setActiveSegmentId(null);
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    },
    [activeSubtask, episodeDuration, timeFromEvent]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const mode = dragModeRef.current;
      if (!mode) {
        return;
      }
      const time = timeFromEvent(event.clientX);
      const indexed = withIds(draft);
      if (mode.kind === 'create') {
        const gapBounds = getGapBoundsAtTime(
          indexed,
          mode.startTime,
          episodeDuration
        );
        if (!gapBounds) {
          setDragPreview(null);
          return;
        }
        const boundedTime = clampTime(time, gapBounds.start, gapBounds.end);
        const start = Math.min(mode.startTime, boundedTime);
        const end = Math.max(mode.startTime, boundedTime);
        setDragPreview({ start, end });
      } else if (mode.kind === 'move') {
        const segment = indexed.find((s) => s.id === mode.segmentId);
        if (!segment) {
          return;
        }
        const { previous, next } = getSegmentNeighbors(indexed, mode.segmentId);
        const width = segment.end - segment.start;
        const minStart = previous?.end ?? 0;
        const maxEnd = next?.start ?? episodeDuration;
        const maxStart = maxEnd - width;
        if (maxStart < minStart) {
          return;
        }
        let nextStart = clampTime(time - mode.offset, minStart, maxStart);
        nextStart = clampTime(snapToFrame(nextStart), minStart, maxStart);
        const nextEnd = nextStart + width;
        updateDraftSegment(mode.segmentId, (s) => ({
          ...s,
          start: nextStart,
          end: nextEnd,
        }));
      } else if (mode.kind === 'resize-start') {
        const segment = indexed.find((s) => s.id === mode.segmentId);
        if (!segment) {
          return;
        }
        const { previous } = getSegmentNeighbors(indexed, mode.segmentId);
        updateDraftSegment(mode.segmentId, (s) => {
          const minStart = previous?.end ?? 0;
          const maxStart = segment.end - MIN_SEGMENT_SECONDS;
          let nextStart = clampTime(time, minStart, maxStart);
          nextStart = clampTime(snapToFrame(nextStart), minStart, maxStart);
          return { ...s, start: nextStart };
        });
      } else if (mode.kind === 'resize-end') {
        const segment = indexed.find((s) => s.id === mode.segmentId);
        if (!segment) {
          return;
        }
        const { next } = getSegmentNeighbors(indexed, mode.segmentId);
        updateDraftSegment(mode.segmentId, (s) => {
          const minEnd = segment.start + MIN_SEGMENT_SECONDS;
          const maxEnd = next?.start ?? episodeDuration;
          let nextEnd = clampTime(time, minEnd, maxEnd);
          nextEnd = clampTime(snapToFrame(nextEnd), minEnd, maxEnd);
          return { ...s, end: nextEnd };
        });
      }
    },
    [draft, episodeDuration, snapToFrame, timeFromEvent, updateDraftSegment]
  );

  const finalizeDrag = useCallback(() => {
    const mode = dragModeRef.current;
    dragModeRef.current = null;
    if (mode?.kind === 'create' && dragPreview && activeSubtask) {
      const start = snapToFrame(dragPreview.start);
      const end = snapToFrame(dragPreview.end);
      if (end - start >= MIN_SEGMENT_SECONDS) {
        addSegment({ name: activeSubtask, start, end });
      }
    }
    setDragPreview(null);
  }, [activeSubtask, addSegment, dragPreview, snapToFrame]);

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      try {
        (event.currentTarget as HTMLElement).releasePointerCapture(
          event.pointerId
        );
      } catch {
        /* pointer was never captured */
      }
      finalizeDrag();
    },
    [finalizeDrag]
  );

  const handleSegmentPointerDown = useCallback(
    (
      event: React.PointerEvent<HTMLDivElement>,
      segment: SegmentWithId,
      part: 'body' | 'start' | 'end'
    ) => {
      if (event.button !== 0) {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      setActiveSegmentId(segment.id);
      const time = timeFromEvent(event.clientX);
      if (part === 'body') {
        dragModeRef.current = {
          kind: 'move',
          segmentId: segment.id,
          offset: time - segment.start,
        };
      } else if (part === 'start') {
        dragModeRef.current = { kind: 'resize-start', segmentId: segment.id };
      } else {
        dragModeRef.current = { kind: 'resize-end', segmentId: segment.id };
      }
      const bar = barRef.current;
      if (bar) {
        bar.setPointerCapture(event.pointerId);
      }
    },
    [timeFromEvent]
  );

  const handlePlayheadPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      isDraggingPlayheadRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      const time = timeFromEvent(event.clientX);
      paintPlayhead(time);
      onSeek(time, { preview: true });
    },
    [onSeek, paintPlayhead, timeFromEvent]
  );

  const handlePlayheadPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingPlayheadRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const time = timeFromEvent(event.clientX);
      paintPlayhead(time);
      onSeek(time, { preview: true });
    },
    [onSeek, paintPlayhead, timeFromEvent]
  );

  const handlePlayheadPointerEnd = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingPlayheadRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* pointer capture may already be released */
      }
      isDraggingPlayheadRef.current = false;
      const time = timeFromEvent(event.clientX);
      paintPlayhead(time);
      onSeek(time);
    },
    [onSeek, paintPlayhead, timeFromEvent]
  );

  const handleTaskChange = useCallback((event: RadioChangeEvent) => {
    setActiveSubtask(event.target.value as string);
  }, []);

  const handleSave = useCallback(() => {
    saveMutation.mutate(draft);
  }, [draft, saveMutation]);

  const handleClearAll = useCallback(() => {
    setDraft([]);
    setActiveSegmentId(null);
  }, [setDraft]);

  const handleSnapFill = useCallback(() => {
    setDraft((prev) =>
      snapSegmentsToCoverage(withIds(prev), episodeDuration, snapToFrame)
    );
  }, [episodeDuration, setDraft, snapToFrame]);

  // Keyboard shortcuts: '['/']' set start/end at playhead, Delete removes the
  // active segment, 1-9 selects the corresponding subtask.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      const numeric = Number(event.key);
      if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        Number.isInteger(numeric) &&
        numeric >= 1 &&
        numeric <= 9 &&
        numeric <= tasks.length
      ) {
        event.preventDefault();
        setActiveSubtask(tasks[numeric - 1]);
        return;
      }

      if (event.key === '[' || event.key === ']') {
        if (!activeSubtask || episodeDuration <= 0) {
          return;
        }
        event.preventDefault();
        const playhead = snapToFrame(
          getCurrentTime ? getCurrentTime() : currentTimeRef.current
        );
        const indexed = withIds(draft);
        const active = indexed.find((s) => s.id === activeSegmentId);
        if (event.key === '[') {
          if (active) {
            const { previous } = getSegmentNeighbors(indexed, active.id);
            const minStart = previous?.end ?? 0;
            const maxStart = active.end - MIN_SEGMENT_SECONDS;
            const nextStart = clampTime(playhead, minStart, maxStart);
            updateDraftSegment(active.id, (s) => ({
              ...s,
              start: nextStart,
            }));
          } else {
            const gapBounds = getGapBoundsAtTime(indexed, playhead, episodeDuration);
            if (!gapBounds) {
              message.info('Playhead is already inside a segment');
              return;
            }
            const start = clampTime(playhead, gapBounds.start, gapBounds.end);
            const end = clampTime(
              snapToFrame(start + MIN_SEGMENT_SECONDS),
              start,
              gapBounds.end
            );
            if (end - start < MIN_SEGMENT_SECONDS) {
              message.info('No room to create a new segment at the playhead');
              return;
            }
            const newSegment: SubtaskSegment = {
              name: activeSubtask,
              start,
              end,
            };
            addSegment(newSegment);
          }
        } else if (event.key === ']') {
          if (active) {
            const { next } = getSegmentNeighbors(indexed, active.id);
            const minEnd = active.start + MIN_SEGMENT_SECONDS;
            const maxEnd = next?.start ?? episodeDuration;
            const nextEnd = clampTime(playhead, minEnd, maxEnd);
            updateDraftSegment(active.id, (s) => ({
              ...s,
              end: nextEnd,
            }));
          }
        }
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (activeSegmentId) {
          event.preventDefault();
          removeSegment(activeSegmentId);
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    activeSegmentId,
    activeSubtask,
    addSegment,
    draft,
    episodeDuration,
    getCurrentTime,
    removeSegment,
    snapToFrame,
    tasks,
    updateDraftSegment,
  ]);

  const playheadPct = useMemo(() => {
    if (episodeDuration <= 0) {
      return null;
    }
    const ratio = (currentTime / episodeDuration) * 100;
    return Math.min(Math.max(ratio, 0), 100);
  }, [currentTime, episodeDuration]);

  const renderSegments = () => {
    if (episodeDuration <= 0) {
      return null;
    }
    return segmentsWithIds.map((segment) => {
      const left = (segment.start / episodeDuration) * 100;
      const width = Math.max(
        ((segment.end - segment.start) / episodeDuration) * 100,
        0.2
      );
      const color = colorForTask(segment.name, tasks);
      const isActive = segment.id === activeSegmentId;
      return (
        <div
          key={segment.id}
          data-segment-id={segment.id}
          onPointerDown={(event) =>
            handleSegmentPointerDown(event, segment, 'body')
          }
          onClick={(event) => event.stopPropagation()}
          style={{
            position: 'absolute',
            left: `${left}%`,
            width: `${width}%`,
            top: 2,
            bottom: 2,
            background: color,
            opacity: isActive ? 0.95 : 0.7,
            borderRadius: 3,
            cursor: 'grab',
            border: isActive ? '2px solid #fff' : '1px solid rgba(0,0,0,0.2)',
            color: '#fff',
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: HANDLE_WIDTH + 2,
            paddingRight: HANDLE_WIDTH + 2,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            userSelect: 'none',
          }}
          title={`${segment.name}: ${segment.start.toFixed(2)}s - ${segment.end.toFixed(2)}s`}
        >
          <div
            onPointerDown={(event) =>
              handleSegmentPointerDown(event, segment, 'start')
            }
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: HANDLE_WIDTH,
              cursor: 'ew-resize',
              background: 'rgba(0,0,0,0.25)',
            }}
          />
          <span style={{ pointerEvents: 'none' }}>{segment.name}</span>
          <div
            onPointerDown={(event) =>
              handleSegmentPointerDown(event, segment, 'end')
            }
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: HANDLE_WIDTH,
              cursor: 'ew-resize',
              background: 'rgba(0,0,0,0.25)',
            }}
          />
        </div>
      );
    });
  };

  const renderDragPreview = () => {
    if (!dragPreview || episodeDuration <= 0 || !activeSubtask) {
      return null;
    }
    const left = (dragPreview.start / episodeDuration) * 100;
    const width = Math.max(
      ((dragPreview.end - dragPreview.start) / episodeDuration) * 100,
      0.2
    );
    return (
      <div
        style={{
          position: 'absolute',
          left: `${left}%`,
          width: `${width}%`,
          top: 2,
          bottom: 2,
          background: colorForTask(activeSubtask, tasks),
          opacity: 0.4,
          borderRadius: 3,
          pointerEvents: 'none',
          border: '1px dashed rgba(255,255,255,0.7)',
        }}
      />
    );
  };

  const sortedSegments = useMemo(
    () => sortSegmentsByTime(segmentsWithIds),
    [segmentsWithIds]
  );

  return (
    <Card
      size='small'
      title={
        <Space>
          <span>Subtask Annotations</span>
          {isDirty && <Badge status='warning' text='Unsaved changes' />}
        </Space>
      }
      extra={
        <Space>
          <Tooltip title='Discard local changes and revert to saved version'>
            <Button
              size='small'
              icon={<ReloadOutlined />}
              onClick={resetToSaved}
              disabled={!isDirty}
            >
              Revert
            </Button>
          </Tooltip>
          <Tooltip title='Expand segments to fill gaps and snap to the episode edges'>
            <Button
              size='small'
              onClick={handleSnapFill}
              disabled={draft.length === 0 || episodeDuration <= 0}
            >
              Snap
            </Button>
          </Tooltip>
          <Tooltip title='Remove all segments for this episode'>
            <Button
              size='small'
              icon={<CloseCircleOutlined />}
              onClick={handleClearAll}
              disabled={draft.length === 0}
            >
              Clear
            </Button>
          </Tooltip>
          <Button
            size='small'
            type='primary'
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={saveMutation.isPending}
            disabled={!isDirty || saveMutation.isPending}
          >
            Save
          </Button>
        </Space>
      }
      styles={{ body: { padding: '12px 16px' } }}
    >
      <Space direction='vertical' size='middle' style={{ width: '100%' }}>
        {tasksQuery.isError && (
          <Alert
            type='error'
            showIcon
            message='Failed to load subtask list'
          />
        )}
        {tasks.length > 0 && (
          <Radio.Group
            value={activeSubtask ?? undefined}
            onChange={handleTaskChange}
            optionType='button'
            buttonStyle='solid'
            size='small'
          >
            {tasks.map((task) => (
              <Radio.Button key={task} value={task}>
                {task}
              </Radio.Button>
            ))}
          </Radio.Group>
        )}

        {episodeDuration > 0 ? (
          <div
            ref={barRef}
            onPointerDown={handleBarPointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDoubleClick={(event) => {
              const bar = barRef.current;
              if (!bar) {
                return;
              }
              const time = timeFromEvent(event.clientX);
              onSeek(time);
            }}
            style={{
              position: 'relative',
              width: '100%',
              marginTop: 18,
              height: BAR_HEIGHT,
              backgroundColor: '#f0f2f5',
              border: '1px solid #d9d9d9',
              borderRadius: 4,
              overflow: 'visible',
              cursor: activeSubtask ? 'crosshair' : 'not-allowed',
              touchAction: 'none',
              userSelect: 'none',
            }}
          >
            {renderSegments()}
            {renderDragPreview()}
            {playheadPct !== null && (
              <div
                ref={playheadRef}
                data-playhead
                onPointerDown={handlePlayheadPointerDown}
                onPointerMove={handlePlayheadPointerMove}
                onPointerUp={handlePlayheadPointerEnd}
                onPointerCancel={handlePlayheadPointerEnd}
                style={{
                  position: 'absolute',
                  left: `${playheadPct}%`,
                  top: -6,
                  bottom: -6,
                  width: 12,
                  cursor: 'ew-resize',
                  touchAction: 'none',
                  pointerEvents: 'auto',
                  transform: 'translateX(-6px)',
                  zIndex: 5,
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: 0,
                    bottom: 0,
                    width: 2,
                    backgroundColor: '#ff4d4f',
                    boxShadow: '0 0 0 1px rgba(255,255,255,0.9)',
                    pointerEvents: 'none',
                    transform: 'translateX(-1px)',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: -4,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 0,
                    height: 0,
                    borderLeft: '5px solid transparent',
                    borderRight: '5px solid transparent',
                    borderTop: '6px solid #ff4d4f',
                    filter: 'drop-shadow(0 0 1px rgba(255,255,255,0.9))',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    bottom: -4,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 0,
                    height: 0,
                    borderLeft: '5px solid transparent',
                    borderRight: '5px solid transparent',
                    borderBottom: '6px solid #ff4d4f',
                    filter: 'drop-shadow(0 0 1px rgba(255,255,255,0.9))',
                  }}
                />
                <div
                  ref={playheadLabelRef}
                  style={{
                    position: 'absolute',
                    top: -22,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    padding: '1px 6px',
                    fontSize: 11,
                    lineHeight: '14px',
                    color: '#fff',
                    backgroundColor: '#ff4d4f',
                    borderRadius: 3,
                    whiteSpace: 'nowrap',
                    boxShadow: '0 0 0 1px rgba(255,255,255,0.9)',
                  }}
                >
                  {currentTime.toFixed(2)}s
                </div>
              </div>
            )}
          </div>
        ) : (
          <Empty description='No timing data available' />
        )}

        {sortedSegments.length === 0 ? (
          <Text type='secondary' style={{ fontSize: 12 }}>
            Drag on the bar above to label a span. Segments cannot overlap. Use
            [ and ] to set the start/end of the active span at the playhead,
            press 1-9 to switch subtasks, Delete removes the active segment,
            and Snap fills any remaining gaps.
          </Text>
        ) : (
          <div style={{ maxHeight: 160, overflow: 'auto' }}>
            {sortedSegments.map((segment) => {
              const isActive = segment.id === activeSegmentId;
              return (
                <div
                  key={segment.id}
                  onClick={() => {
                    setActiveSegmentId(segment.id);
                    onSeek(segment.start);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 6px',
                    cursor: 'pointer',
                    borderRadius: 3,
                    background: isActive
                      ? 'rgba(22,119,255,0.1)'
                      : 'transparent',
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: colorForTask(segment.name, tasks),
                    }}
                  />
                  <Text style={{ minWidth: 110 }}>{segment.name}</Text>
                  <Text type='secondary' style={{ fontSize: 12 }}>
                    {segment.start.toFixed(2)}s - {segment.end.toFixed(2)}s (
                    {(segment.end - segment.start).toFixed(2)}s)
                  </Text>
                  <Button
                    size='small'
                    type='text'
                    icon={<DeleteOutlined />}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeSegment(segment.id);
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </Space>
    </Card>
  );
});

SubtaskAnnotationPanel.displayName = 'SubtaskAnnotationPanel';

export default SubtaskAnnotationPanel;
