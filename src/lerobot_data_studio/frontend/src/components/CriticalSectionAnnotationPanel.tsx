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
  InputNumber,
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
import { useCriticalSectionDrafts } from '@/hooks/useCriticalSectionDrafts';
import { CriticalSection } from '@/types';

const { Text } = Typography;

const BAR_HEIGHT = 36;
const HANDLE_WIDTH = 6;
const MIN_SEGMENT_SECONDS = 0.05;
const FALLBACK_DEFAULT_WEIGHT = 5.0;

// Warm red/orange palette so critical sections visually contrast with the
// blue/green subtask palette in the panel above.
const CRITICAL_COLOR_PALETTE = [
  '#ff4d4f',
  '#fa541c',
  '#fa8c16',
  '#d4380d',
  '#cf1322',
  '#ad2102',
];

const colorForLabel = (label: string, labels: string[]): string => {
  const idx = labels.indexOf(label);
  const fallback = Math.abs(
    [...label].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  );
  const safeIdx = idx >= 0 ? idx : fallback;
  return CRITICAL_COLOR_PALETTE[safeIdx % CRITICAL_COLOR_PALETTE.length];
};

interface CriticalSectionAnnotationPanelProps {
  namespace: string;
  name: string;
  datasetId: string;
  episodeId: number;
  episodeDuration: number;
  fps: number;
  currentTime: number;
  onSeek: (time: number, options?: CriticalSectionSeekOptions) => void;
  getCurrentTime?: () => number;
}

export interface CriticalSectionSeekOptions {
  preview?: boolean;
}

export interface CriticalSectionAnnotationPanelHandle {
  setPlayhead: (time: number) => void;
}

type DragMode =
  | { kind: 'create'; startTime: number }
  | { kind: 'move'; sectionId: string; offset: number }
  | { kind: 'resize-start'; sectionId: string }
  | { kind: 'resize-end'; sectionId: string }
  | null;

interface SectionWithId extends CriticalSection {
  id: string;
}

const sectionId = (_section: CriticalSection, idx: number): string =>
  `section-${idx}`;

const withIds = (sections: CriticalSection[]): SectionWithId[] => {
  return sections.map((section, idx) => ({
    ...section,
    id: sectionId(section, idx),
  }));
};

const stripIds = (sections: SectionWithId[]): CriticalSection[] =>
  sections.map(({ id: _id, ...rest }) => rest);

function compareSections(a: CriticalSection, b: CriticalSection): number {
  if (a.start !== b.start) {
    return a.start - b.start;
  }
  if (a.end !== b.end) {
    return a.end - b.end;
  }
  return a.name.localeCompare(b.name);
}

function sortSectionsByTime<T extends CriticalSection>(sections: T[]): T[] {
  return [...sections].sort(compareSections);
}

const clampTime = (time: number, min: number, max: number): number => {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  return Math.max(safeMin, Math.min(time, safeMax));
};

const CriticalSectionAnnotationPanel = forwardRef<
  CriticalSectionAnnotationPanelHandle,
  CriticalSectionAnnotationPanelProps
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
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    start: number;
    end: number;
  } | null>(null);

  const labelsQuery = useQuery({
    queryKey: ['criticalSectionLabels'],
    queryFn: datasetApi.getCriticalSectionLabels,
    staleTime: 60 * 60 * 1000,
  });

  const annotationsQuery = useQuery({
    queryKey: ['criticalSections', namespace, name],
    queryFn: () => datasetApi.getCriticalSections(namespace, name),
    enabled: !!namespace && !!name,
    staleTime: 5 * 60 * 1000,
  });

  const labels = labelsQuery.data?.labels ?? [];
  const defaultWeight =
    labelsQuery.data?.default_weight ??
    annotationsQuery.data?.default_weight ??
    FALLBACK_DEFAULT_WEIGHT;
  const savedSections = useMemo<CriticalSection[]>(() => {
    const episode =
      annotationsQuery.data?.episodes?.[String(episodeId)];
    return episode?.sections
      ? episode.sections.map((s) => ({ ...s }))
      : [];
  }, [annotationsQuery.data, episodeId]);

  const { draft, isDirty, setDraft, resetToSaved, clearDraft } =
    useCriticalSectionDrafts({
      datasetId,
      episodeId,
      saved: savedSections,
      enabled: annotationsQuery.isSuccess,
    });

  const sectionsWithIds = useMemo(() => withIds(draft), [draft]);

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
      activeSectionId &&
      !sectionsWithIds.some((section) => section.id === activeSectionId)
    ) {
      setActiveSectionId(null);
    }
  }, [activeSectionId, sectionsWithIds]);

  // Pick a sensible default label once labels load. Prefer "critical grasp"
  // when present so single-key shortcuts land on the most common phase.
  useEffect(() => {
    if (!activeLabel && labels.length > 0) {
      const preferred = labels.find((label) => label === 'critical grasp');
      setActiveLabel(preferred ?? labels[0]);
    }
  }, [labels, activeLabel]);

  // Reset selection when the episode changes.
  useEffect(() => {
    setActiveSectionId(null);
    setDragPreview(null);
  }, [episodeId]);

  const saveMutation = useMutation({
    mutationFn: (sections: CriticalSection[]) =>
      datasetApi.saveCriticalSections(namespace, name, episodeId, {
        sections,
      }),
    onSuccess: (data) => {
      message.success(`Saved ${draft.length} critical section(s)`);
      queryClient.setQueryData(
        ['criticalSections', namespace, name],
        data
      );
      queryClient.invalidateQueries({
        queryKey: ['criticalSectionsSummary', namespace, name],
      });
      clearDraft();
    },
    onError: (error: any) => {
      const detail =
        error?.response?.data?.detail ?? error?.message ?? 'Save failed';
      message.error(`Failed to save critical sections: ${detail}`);
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

  const updateDraftSection = useCallback(
    (id: string, updater: (section: CriticalSection) => CriticalSection) => {
      setDraft((prev) => {
        const indexed = withIds(prev);
        return indexed
          .map((section) =>
            section.id === id
              ? (() => {
                  const next = updater({
                    name: section.name,
                    start: section.start,
                    end: section.end,
                    weight: section.weight,
                  });
                  return {
                    ...next,
                    id: section.id,
                  };
                })()
              : section
          )
          .map(({ id: _id, ...rest }) => rest);
      });
    },
    [setDraft]
  );

  const removeSection = useCallback(
    (id: string) => {
      const indexed = withIds(draft);
      const next = indexed.filter((section) => section.id !== id);
      setDraft(stripIds(next));
      setActiveSectionId(null);
    },
    [draft, setDraft]
  );

  const addSection = useCallback(
    (section: CriticalSection) => {
      setDraft((prev) => [...prev, section]);
    },
    [setDraft]
  );

  const handleBarPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      if (!activeLabel) {
        message.info('Select a critical-section label first');
        return;
      }
      if (episodeDuration <= 0) {
        return;
      }
      const target = event.target as HTMLElement;
      // Clicks on existing sections / handles are handled by their own listeners.
      if (target.closest('[data-section-id], [data-playhead]')) {
        return;
      }
      event.preventDefault();
      const startTime = timeFromEvent(event.clientX);
      dragModeRef.current = { kind: 'create', startTime };
      setDragPreview({ start: startTime, end: startTime });
      setActiveSectionId(null);
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    },
    [activeLabel, episodeDuration, timeFromEvent]
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
        // Critical sections are allowed to overlap, so clamp only against the
        // episode bounds rather than the surrounding gap.
        const boundedTime = clampTime(time, 0, episodeDuration);
        const start = Math.min(mode.startTime, boundedTime);
        const end = Math.max(mode.startTime, boundedTime);
        setDragPreview({ start, end });
      } else if (mode.kind === 'move') {
        const section = indexed.find((s) => s.id === mode.sectionId);
        if (!section) {
          return;
        }
        const width = section.end - section.start;
        const minStart = 0;
        const maxStart = Math.max(0, episodeDuration - width);
        let nextStart = clampTime(time - mode.offset, minStart, maxStart);
        nextStart = clampTime(snapToFrame(nextStart), minStart, maxStart);
        const nextEnd = nextStart + width;
        updateDraftSection(mode.sectionId, (s) => ({
          ...s,
          start: nextStart,
          end: nextEnd,
        }));
      } else if (mode.kind === 'resize-start') {
        const section = indexed.find((s) => s.id === mode.sectionId);
        if (!section) {
          return;
        }
        updateDraftSection(mode.sectionId, (s) => {
          const minStart = 0;
          const maxStart = section.end - MIN_SEGMENT_SECONDS;
          let nextStart = clampTime(time, minStart, maxStart);
          nextStart = clampTime(snapToFrame(nextStart), minStart, maxStart);
          return { ...s, start: nextStart };
        });
      } else if (mode.kind === 'resize-end') {
        const section = indexed.find((s) => s.id === mode.sectionId);
        if (!section) {
          return;
        }
        updateDraftSection(mode.sectionId, (s) => {
          const minEnd = section.start + MIN_SEGMENT_SECONDS;
          const maxEnd = episodeDuration;
          let nextEnd = clampTime(time, minEnd, maxEnd);
          nextEnd = clampTime(snapToFrame(nextEnd), minEnd, maxEnd);
          return { ...s, end: nextEnd };
        });
      }
    },
    [draft, episodeDuration, snapToFrame, timeFromEvent, updateDraftSection]
  );

  const finalizeDrag = useCallback(() => {
    const mode = dragModeRef.current;
    dragModeRef.current = null;
    if (mode?.kind === 'create' && dragPreview && activeLabel) {
      const start = snapToFrame(dragPreview.start);
      const end = snapToFrame(dragPreview.end);
      if (end - start >= MIN_SEGMENT_SECONDS) {
        addSection({
          name: activeLabel,
          start,
          end,
          weight: defaultWeight,
        });
      }
    }
    setDragPreview(null);
  }, [activeLabel, addSection, defaultWeight, dragPreview, snapToFrame]);

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

  const handleSectionPointerDown = useCallback(
    (
      event: React.PointerEvent<HTMLDivElement>,
      section: SectionWithId,
      part: 'body' | 'start' | 'end'
    ) => {
      if (event.button !== 0) {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      setActiveSectionId(section.id);
      const time = timeFromEvent(event.clientX);
      if (part === 'body') {
        dragModeRef.current = {
          kind: 'move',
          sectionId: section.id,
          offset: time - section.start,
        };
      } else if (part === 'start') {
        dragModeRef.current = { kind: 'resize-start', sectionId: section.id };
      } else {
        dragModeRef.current = { kind: 'resize-end', sectionId: section.id };
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

  const handleLabelChange = useCallback((event: RadioChangeEvent) => {
    setActiveLabel(event.target.value as string);
  }, []);

  const handleSave = useCallback(() => {
    saveMutation.mutate(draft);
  }, [draft, saveMutation]);

  const handleClearAll = useCallback(() => {
    setDraft([]);
    setActiveSectionId(null);
  }, [setDraft]);

  // Keyboard shortcuts: '['/']' set start/end of the active section at the
  // playhead, Delete removes the active section, 1-9 selects the corresponding
  // label. We intentionally allow gaps and overlaps here since critical
  // sections are not required to cover the whole episode.
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
        numeric <= labels.length
      ) {
        event.preventDefault();
        setActiveLabel(labels[numeric - 1]);
        return;
      }

      if (event.key === '[' || event.key === ']') {
        if (!activeLabel || episodeDuration <= 0) {
          return;
        }
        event.preventDefault();
        const playhead = snapToFrame(
          getCurrentTime ? getCurrentTime() : currentTimeRef.current
        );
        const indexed = withIds(draft);
        const active = indexed.find((s) => s.id === activeSectionId);
        if (event.key === '[') {
          if (active) {
            const minStart = 0;
            const maxStart = active.end - MIN_SEGMENT_SECONDS;
            const nextStart = clampTime(playhead, minStart, maxStart);
            updateDraftSection(active.id, (s) => ({
              ...s,
              start: nextStart,
            }));
          } else {
            const start = clampTime(playhead, 0, episodeDuration);
            const end = clampTime(
              snapToFrame(start + MIN_SEGMENT_SECONDS),
              start,
              episodeDuration
            );
            if (end - start < MIN_SEGMENT_SECONDS) {
              message.info('No room to create a section at the playhead');
              return;
            }
            const newSection: CriticalSection = {
              name: activeLabel,
              start,
              end,
              weight: defaultWeight,
            };
            addSection(newSection);
          }
        } else if (event.key === ']') {
          if (active) {
            const minEnd = active.start + MIN_SEGMENT_SECONDS;
            const maxEnd = episodeDuration;
            const nextEnd = clampTime(playhead, minEnd, maxEnd);
            updateDraftSection(active.id, (s) => ({
              ...s,
              end: nextEnd,
            }));
          }
        }
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (activeSectionId) {
          event.preventDefault();
          removeSection(activeSectionId);
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    activeSectionId,
    activeLabel,
    addSection,
    defaultWeight,
    draft,
    episodeDuration,
    getCurrentTime,
    labels,
    removeSection,
    snapToFrame,
    updateDraftSection,
  ]);

  const playheadPct = useMemo(() => {
    if (episodeDuration <= 0) {
      return null;
    }
    const ratio = (currentTime / episodeDuration) * 100;
    return Math.min(Math.max(ratio, 0), 100);
  }, [currentTime, episodeDuration]);

  const renderSections = () => {
    if (episodeDuration <= 0) {
      return null;
    }
    return sectionsWithIds.map((section) => {
      const left = (section.start / episodeDuration) * 100;
      const width = Math.max(
        ((section.end - section.start) / episodeDuration) * 100,
        0.2
      );
      const color = colorForLabel(section.name, labels);
      const isActive = section.id === activeSectionId;
      return (
        <div
          key={section.id}
          data-section-id={section.id}
          onPointerDown={(event) =>
            handleSectionPointerDown(event, section, 'body')
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
          title={`${section.name} (w=${section.weight}): ${section.start.toFixed(2)}s - ${section.end.toFixed(2)}s`}
        >
          <div
            onPointerDown={(event) =>
              handleSectionPointerDown(event, section, 'start')
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
          <span style={{ pointerEvents: 'none' }}>
            {section.name} · w={section.weight}
          </span>
          <div
            onPointerDown={(event) =>
              handleSectionPointerDown(event, section, 'end')
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
    if (!dragPreview || episodeDuration <= 0 || !activeLabel) {
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
          background: colorForLabel(activeLabel, labels),
          opacity: 0.4,
          borderRadius: 3,
          pointerEvents: 'none',
          border: '1px dashed rgba(255,255,255,0.7)',
        }}
      />
    );
  };

  const sortedSections = useMemo(
    () => sortSectionsByTime(sectionsWithIds),
    [sectionsWithIds]
  );

  return (
    <Card
      size='small'
      title={
        <Space>
          <span>Critical Sections</span>
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
          <Tooltip title='Remove all critical sections for this episode'>
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
        {labelsQuery.isError && (
          <Alert
            type='error'
            showIcon
            message='Failed to load critical-section labels'
          />
        )}
        {labels.length > 0 && (
          <Radio.Group
            value={activeLabel ?? undefined}
            onChange={handleLabelChange}
            optionType='button'
            buttonStyle='solid'
            size='small'
          >
            {labels.map((label) => (
              <Radio.Button key={label} value={label}>
                {label}
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
              backgroundColor: '#fff7e6',
              border: '1px solid #ffd591',
              borderRadius: 4,
              overflow: 'visible',
              cursor: activeLabel ? 'crosshair' : 'not-allowed',
              touchAction: 'none',
              userSelect: 'none',
            }}
          >
            {renderSections()}
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

        {sortedSections.length === 0 ? (
          <Text type='secondary' style={{ fontSize: 12 }}>
            Drag on the bar above to mark a critical section. Sections may
            overlap and need not cover the whole episode. Use [ and ] to set
            the start/end of the active section at the playhead, press 1-9 to
            switch labels, Delete removes the active section. Edit each
            section's weight (default {defaultWeight}) below for training
            reweighting/oversampling.
          </Text>
        ) : (
          <div style={{ maxHeight: 200, overflow: 'auto' }}>
            {sortedSections.map((section) => {
              const isActive = section.id === activeSectionId;
              return (
                <div
                  key={section.id}
                  onClick={() => {
                    setActiveSectionId(section.id);
                    onSeek(section.start);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 6px',
                    cursor: 'pointer',
                    borderRadius: 3,
                    background: isActive
                      ? 'rgba(255,77,79,0.12)'
                      : 'transparent',
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: colorForLabel(section.name, labels),
                    }}
                  />
                  <Text style={{ minWidth: 130 }}>{section.name}</Text>
                  <Text type='secondary' style={{ fontSize: 12 }}>
                    {section.start.toFixed(2)}s - {section.end.toFixed(2)}s (
                    {(section.end - section.start).toFixed(2)}s)
                  </Text>
                  <Tooltip title='Per-section weight for training reweighting/oversampling'>
                    <InputNumber
                      size='small'
                      min={0.1}
                      step={0.5}
                      value={section.weight}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(value) => {
                        if (value === null || value === undefined) {
                          return;
                        }
                        const numeric = Number(value);
                        if (!Number.isFinite(numeric) || numeric <= 0) {
                          return;
                        }
                        updateDraftSection(section.id, (s) => ({
                          ...s,
                          weight: numeric,
                        }));
                      }}
                      style={{ width: 80 }}
                    />
                  </Tooltip>
                  <Button
                    size='small'
                    type='text'
                    icon={<DeleteOutlined />}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeSection(section.id);
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

CriticalSectionAnnotationPanel.displayName = 'CriticalSectionAnnotationPanel';

export default CriticalSectionAnnotationPanel;
