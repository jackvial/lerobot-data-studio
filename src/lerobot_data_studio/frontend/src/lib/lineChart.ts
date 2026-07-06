/**
 * Dependency-free canvas line chart used by the episode data view.
 * Replaces dygraphs with the subset of behavior the app needs: multi-series
 * lines over a numeric time axis, an always-visible legend that tracks the
 * hovered sample, drag-to-zoom on the x axis (double-click resets), and
 * coordinate helpers so the playhead marker can be positioned from outside.
 */

export interface ChartArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LineChartOptions {
  /** One label per series (excluding the leading time column). */
  labels: string[];
  xLabel?: string;
  /** Called after every draw (initial, resize, zoom) — reposition overlays here. */
  onDraw?: () => void;
}

export type ChartRow = readonly number[];

const PLOT_PADDING = { top: 12, right: 16, bottom: 44, left: 64 };
const AXIS_COLOR = '#999';
const GRID_COLOR = 'rgba(128, 128, 128, 0.25)';
const TEXT_COLOR = '#aaa';
const FONT = '12px sans-serif';
const MIN_ZOOM_PIXELS = 8;

export const SERIES_COLORS = [
  '#4e9de6',
  '#e6704e',
  '#5ec95e',
  '#c95ec9',
  '#e6c04e',
  '#4ec9c9',
  '#9d6be6',
  '#e64e8a',
  '#8ac94e',
  '#6b8ae6',
  '#c9884e',
  '#4ee688',
];

export const seriesColor = (index: number): string =>
  SERIES_COLORS[index % SERIES_COLORS.length];

/**
 * Round tick spacing to 1/2/5 * 10^k and return ticks covering [min, max].
 */
export const niceTicks = (
  min: number,
  max: number,
  targetCount = 5
): number[] => {
  if (!Number.isFinite(min) || !Number.isFinite(max) || targetCount < 1) {
    return [];
  }

  if (min === max) {
    return [min];
  }

  const span = max - min;
  const rawStep = span / targetCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const step =
    residual >= 5 ? 5 * magnitude : residual >= 2 ? 2 * magnitude : magnitude;

  const ticks: number[] = [];
  const firstIndex = Math.ceil(min / step - 1e-6);
  const lastIndex = Math.floor(max / step + 1e-6);
  for (let index = firstIndex; index <= lastIndex; index++) {
    // Snap away floating point drift (0.6000000000000001 -> 0.6).
    ticks.push(index === 0 ? 0 : Number((index * step).toPrecision(12)));
  }

  return ticks;
};

export interface LinearScale {
  (value: number): number;
  invert: (pixel: number) => number;
}

export const createLinearScale = (
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number
): LinearScale => {
  const domainSpan = domainMax - domainMin || 1;
  const rangeSpan = rangeMax - rangeMin;
  const scale = ((value: number): number =>
    rangeMin + ((value - domainMin) / domainSpan) * rangeSpan) as LinearScale;
  scale.invert = (pixel: number): number =>
    domainMin + ((pixel - rangeMin) / rangeSpan) * domainSpan;
  return scale;
};

/** Binary search for the row whose time is closest to `time`. */
export const findNearestRowIndex = (
  rows: readonly ChartRow[],
  time: number
): number => {
  if (rows.length === 0) {
    return -1;
  }

  let low = 0;
  let high = rows.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (rows[mid][0] < time) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  if (low > 0 && Math.abs(rows[low - 1][0] - time) <= Math.abs(rows[low][0] - time)) {
    return low - 1;
  }

  return low;
};

export interface ValueExtent {
  min: number;
  max: number;
}

/** Min/max across all series for rows within [xMin, xMax]. */
export const computeValueExtent = (
  rows: readonly ChartRow[],
  xMin: number,
  xMax: number
): ValueExtent => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    if (row[0] < xMin || row[0] > xMax) {
      continue;
    }
    for (let column = 1; column < row.length; column++) {
      const value = row[column];
      if (Number.isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
  }

  if (min > max) {
    return { min: 0, max: 1 };
  }

  if (min === max) {
    const pad = Math.abs(min) || 1;
    return { min: min - pad * 0.1, max: max + pad * 0.1 };
  }

  const pad = (max - min) * 0.05;
  return { min: min - pad, max: max + pad };
};

const formatSeconds = (value: number): string => `${value.toFixed(2)}s`;

const formatValue = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(2) : '—';

export class LineChart {
  private readonly container: HTMLElement;
  private readonly rows: readonly ChartRow[];
  private readonly options: LineChartOptions;
  private readonly plotCanvas: HTMLCanvasElement;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly legend: HTMLDivElement;
  private readonly legendValueCells: HTMLSpanElement[] = [];
  private readonly legendTimeCell: HTMLDivElement;
  private readonly resizeObserver: ResizeObserver | null = null;
  private readonly fullXDomain: readonly [number, number];
  private xDomain: readonly [number, number];
  private width = 0;
  private height = 0;
  private dragStartX: number | null = null;
  private dragCurrentX: number | null = null;
  private disposed = false;

  private readonly handleMouseMove = (event: MouseEvent): void => {
    const position = this.toLocalX(event);
    if (this.dragStartX !== null) {
      this.dragCurrentX = position;
      this.drawOverlay(position);
      return;
    }
    this.drawOverlay(position);
  };

  private readonly handleMouseLeave = (): void => {
    if (this.dragStartX === null) {
      this.drawOverlay(null);
    }
  };

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return;
    }
    this.dragStartX = this.toLocalX(event);
    this.dragCurrentX = this.dragStartX;
    event.preventDefault();
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (this.dragStartX === null) {
      return;
    }

    const start = this.dragStartX;
    const end = this.toLocalX(event);
    this.dragStartX = null;
    this.dragCurrentX = null;

    if (Math.abs(end - start) >= MIN_ZOOM_PIXELS) {
      const scale = this.createXScale();
      const from = scale.invert(Math.min(start, end));
      const to = scale.invert(Math.max(start, end));
      this.xDomain = [
        Math.max(from, this.fullXDomain[0]),
        Math.min(to, this.fullXDomain[1]),
      ];
      this.draw();
    }

    this.drawOverlay(this.toLocalX(event));
  };

  private readonly handleDoubleClick = (): void => {
    this.xDomain = this.fullXDomain;
    this.draw();
  };

  constructor(
    container: HTMLElement,
    rows: readonly ChartRow[],
    options: LineChartOptions
  ) {
    this.container = container;
    this.rows = rows;
    this.options = options;

    const first = rows[0]?.[0] ?? 0;
    const last = rows[rows.length - 1]?.[0] ?? 1;
    this.fullXDomain = [first, last > first ? last : first + 1];
    this.xDomain = this.fullXDomain;

    container.style.position = 'relative';

    this.plotCanvas = document.createElement('canvas');
    this.overlayCanvas = document.createElement('canvas');
    for (const canvas of [this.plotCanvas, this.overlayCanvas]) {
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      container.appendChild(canvas);
    }

    this.legend = document.createElement('div');
    this.legend.style.cssText = [
      'position: absolute',
      'top: 8px',
      'right: 8px',
      'padding: 6px 10px',
      'background: rgba(0, 0, 0, 0.65)',
      'border-radius: 4px',
      'font: 12px sans-serif',
      'line-height: 1.5',
      'pointer-events: none',
      'z-index: 3',
      'max-height: calc(100% - 16px)',
      'overflow: hidden',
    ].join(';');

    this.legendTimeCell = document.createElement('div');
    this.legendTimeCell.style.color = '#fff';
    this.legend.appendChild(this.legendTimeCell);

    options.labels.forEach((label, index) => {
      const row = document.createElement('div');
      row.style.color = seriesColor(index);
      const name = document.createElement('span');
      name.textContent = label;
      const value = document.createElement('span');
      value.style.marginLeft = '8px';
      row.appendChild(name);
      row.appendChild(value);
      this.legend.appendChild(row);
      this.legendValueCells.push(value);
    });
    container.appendChild(this.legend);

    this.overlayCanvas.addEventListener('mousemove', this.handleMouseMove);
    this.overlayCanvas.addEventListener('mouseleave', this.handleMouseLeave);
    this.overlayCanvas.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    this.overlayCanvas.addEventListener('dblclick', this.handleDoubleClick);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }

    this.resize();
  }

  destroy(): void {
    this.disposed = true;
    this.resizeObserver?.disconnect();
    window.removeEventListener('mouseup', this.handleMouseUp);
    this.plotCanvas.remove();
    this.overlayCanvas.remove();
    this.legend.remove();
  }

  getArea(): ChartArea {
    return {
      x: PLOT_PADDING.left,
      y: PLOT_PADDING.top,
      w: Math.max(this.width - PLOT_PADDING.left - PLOT_PADDING.right, 0),
      h: Math.max(this.height - PLOT_PADDING.top - PLOT_PADDING.bottom, 0),
    };
  }

  toDomXCoord(time: number): number {
    return this.createXScale()(time);
  }

  private resize(): void {
    if (this.disposed) {
      return;
    }

    const rect = this.container.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;

    const pixelRatio = window.devicePixelRatio || 1;
    for (const canvas of [this.plotCanvas, this.overlayCanvas]) {
      canvas.width = Math.max(Math.round(this.width * pixelRatio), 1);
      canvas.height = Math.max(Math.round(this.height * pixelRatio), 1);
      const context = canvas.getContext('2d');
      context?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    this.draw();
  }

  private createXScale(): LinearScale {
    const area = this.getArea();
    return createLinearScale(
      this.xDomain[0],
      this.xDomain[1],
      area.x,
      area.x + area.w
    );
  }

  private draw(): void {
    const context = this.plotCanvas.getContext('2d');
    if (!context || this.disposed) {
      return;
    }

    const area = this.getArea();
    context.clearRect(0, 0, this.width, this.height);
    if (area.w <= 0 || area.h <= 0) {
      return;
    }

    const xScale = this.createXScale();
    const extent = computeValueExtent(
      this.rows,
      this.xDomain[0],
      this.xDomain[1]
    );
    const yScale = createLinearScale(
      extent.min,
      extent.max,
      area.y + area.h,
      area.y
    );

    context.font = FONT;
    context.fillStyle = TEXT_COLOR;
    context.strokeStyle = GRID_COLOR;
    context.lineWidth = 1;

    for (const tick of niceTicks(extent.min, extent.max, 5)) {
      const y = yScale(tick);
      context.beginPath();
      context.moveTo(area.x, y);
      context.lineTo(area.x + area.w, y);
      context.stroke();
      context.textAlign = 'right';
      context.textBaseline = 'middle';
      context.fillText(formatValue(tick), area.x - 6, y);
    }

    for (const tick of niceTicks(this.xDomain[0], this.xDomain[1], 6)) {
      const x = xScale(tick);
      context.beginPath();
      context.moveTo(x, area.y);
      context.lineTo(x, area.y + area.h);
      context.stroke();
      context.textAlign = 'center';
      context.textBaseline = 'top';
      context.fillText(formatSeconds(tick), x, area.y + area.h + 6);
    }

    if (this.options.xLabel) {
      context.textAlign = 'center';
      context.textBaseline = 'bottom';
      context.fillText(
        this.options.xLabel,
        area.x + area.w / 2,
        this.height - 4
      );
    }

    context.strokeStyle = AXIS_COLOR;
    context.strokeRect(area.x, area.y, area.w, area.h);

    context.save();
    context.beginPath();
    context.rect(area.x, area.y, area.w, area.h);
    context.clip();
    context.lineWidth = 1.5;

    const seriesCount = this.options.labels.length;
    for (let series = 0; series < seriesCount; series++) {
      context.strokeStyle = seriesColor(series);
      context.beginPath();
      let penDown = false;
      for (const row of this.rows) {
        const value = row[series + 1];
        if (!Number.isFinite(value)) {
          penDown = false;
          continue;
        }
        const x = xScale(row[0]);
        const y = yScale(value);
        if (penDown) {
          context.lineTo(x, y);
        } else {
          context.moveTo(x, y);
          penDown = true;
        }
      }
      context.stroke();
    }
    context.restore();

    this.updateLegend(null);
    this.options.onDraw?.();
  }

  private drawOverlay(localX: number | null): void {
    const context = this.overlayCanvas.getContext('2d');
    if (!context || this.disposed) {
      return;
    }

    context.clearRect(0, 0, this.width, this.height);
    const area = this.getArea();

    if (this.dragStartX !== null && this.dragCurrentX !== null) {
      const from = Math.min(this.dragStartX, this.dragCurrentX);
      const to = Math.max(this.dragStartX, this.dragCurrentX);
      context.fillStyle = 'rgba(78, 157, 230, 0.2)';
      context.fillRect(from, area.y, to - from, area.h);
    }

    if (localX === null || localX < area.x || localX > area.x + area.w) {
      this.updateLegend(null);
      return;
    }

    const time = this.createXScale().invert(localX);
    const rowIndex = findNearestRowIndex(this.rows, time);
    if (rowIndex < 0) {
      return;
    }

    const snappedX = this.createXScale()(this.rows[rowIndex][0]);
    context.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(snappedX, area.y);
    context.lineTo(snappedX, area.y + area.h);
    context.stroke();

    this.updateLegend(rowIndex);
  }

  private updateLegend(rowIndex: number | null): void {
    const row = rowIndex !== null ? this.rows[rowIndex] : undefined;
    this.legendTimeCell.textContent = row
      ? `${row[0].toFixed(3)} seconds`
      : '';

    this.legendValueCells.forEach((cell, index) => {
      cell.textContent = row ? formatValue(row[index + 1]) : '';
    });
  }

  private toLocalX(event: MouseEvent): number {
    const rect = this.overlayCanvas.getBoundingClientRect();
    return event.clientX - rect.left;
  }
}
