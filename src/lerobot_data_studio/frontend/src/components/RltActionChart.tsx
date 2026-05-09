import React, { useEffect, useMemo, useRef } from 'react';
import { Card, Empty } from 'antd';
import Dygraph from 'dygraphs';
import 'dygraphs/dist/dygraph.css';
import { RltTransitionInfo } from '@/types';

interface RltActionChartProps {
  transitions: RltTransitionInfo[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/** Per-action-dim line chart with a draggable playhead.
 *
 * One row per transition, X axis is `t_offset_s`. Mirrors `DataChart` so we
 * keep one charting library across the studio.
 */
const RltActionChart: React.FC<RltActionChartProps> = ({
  transitions,
  selectedIndex,
  onSelect,
}) => {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const dygraphRef = useRef<Dygraph | null>(null);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const { data, labels, dimCount } = useMemo(() => {
    if (!transitions || transitions.length === 0) {
      return { data: null, labels: [], dimCount: 0 };
    }
    const dim = transitions[0].action_summary?.length ?? 0;
    const rows = transitions.map((t) => {
      const row: number[] = [t.t_offset_s];
      for (let i = 0; i < dim; i += 1) {
        row.push(t.action_summary?.[i] ?? 0);
      }
      return row;
    });
    const dimLabels = ['Time', ...Array.from({ length: dim }, (_, i) => `a${i}`)];
    return { data: rows, labels: dimLabels, dimCount: dim };
  }, [transitions]);

  const updatePlayhead = () => {
    const graph = dygraphRef.current;
    const marker = playheadRef.current;
    if (!graph || !marker) {
      return;
    }
    const transition = transitions[selectedIndex];
    if (!transition) {
      marker.style.display = 'none';
      return;
    }
    const area = graph.getArea();
    const xPx = graph.toDomXCoord(transition.t_offset_s);
    if (xPx < area.x || xPx > area.x + area.w) {
      marker.style.display = 'none';
      return;
    }
    marker.style.display = 'block';
    marker.style.top = `${area.y}px`;
    marker.style.height = `${area.h}px`;
    marker.style.transform = `translateX(${xPx}px)`;
  };

  useEffect(() => {
    if (!chartRef.current || !data || data.length === 0) {
      return;
    }
    if (dygraphRef.current) {
      dygraphRef.current.destroy();
      dygraphRef.current = null;
    }
    dygraphRef.current = new Dygraph(chartRef.current, data, {
      labels,
      legend: 'always',
      animatedZooms: false,
      drawPoints: true,
      pointSize: 2,
      strokeWidth: 1.5,
      gridLineColor: '#ddd',
      axisLineColor: '#999',
      hideOverlayOnMouseOut: false,
      pointClickCallback: (_event, point) => {
        const idx = (point as { idx?: number }).idx;
        if (typeof idx === 'number') {
          onSelectRef.current(idx);
        }
      },
      drawCallback: () => {
        window.requestAnimationFrame(updatePlayhead);
      },
      axes: {
        x: {
          axisLabelFormatter: (x: number | Date) =>
            typeof x === 'number' ? `${x.toFixed(2)}s` : x.toString(),
          valueFormatter: (x: number) => `${x.toFixed(3)} s`,
        },
      },
      xlabel: 'Time (seconds)',
    });
    window.requestAnimationFrame(updatePlayhead);

    return () => {
      if (dygraphRef.current) {
        dygraphRef.current.destroy();
        dygraphRef.current = null;
      }
    };
    // We intentionally rebuild the graph when the data shape changes; the
    // playhead update effect below handles selection changes without rebuilds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, labels.join('|')]);

  useEffect(() => {
    updatePlayhead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, transitions]);

  return (
    <Card size='small' title='Action summary (mean per dim)'>
      {!data || data.length === 0 || dimCount === 0 ? (
        <Empty description='No action summary available for this episode.' />
      ) : (
        <div style={{ position: 'relative', width: '100%', height: 280 }}>
          <div ref={chartRef} style={{ width: '100%', height: '100%' }} />
          <div
            ref={playheadRef}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 2,
              height: 0,
              backgroundColor: '#ff6b6b',
              display: 'none',
              pointerEvents: 'none',
              transform: 'translateX(0)',
              zIndex: 2,
            }}
          />
        </div>
      )}
    </Card>
  );
};

export default RltActionChart;
