import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LineChart,
  SERIES_COLORS,
  computeValueExtent,
  createLinearScale,
  findNearestRowIndex,
  niceTicks,
  seriesColor,
} from '../src/lib/lineChart';

describe('niceTicks', () => {
  it('produces round steps covering the domain', () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it('handles fractional domains', () => {
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  it('handles negative ranges', () => {
    expect(niceTicks(-10, 10, 4)).toEqual([-10, -5, 0, 5, 10]);
  });

  it('returns a single tick for a degenerate domain', () => {
    expect(niceTicks(3, 3)).toEqual([3]);
  });

  it('returns nothing for invalid input', () => {
    expect(niceTicks(Number.NaN, 5)).toEqual([]);
    expect(niceTicks(0, Number.POSITIVE_INFINITY)).toEqual([]);
  });
});

describe('createLinearScale', () => {
  it('maps domain to range and inverts', () => {
    const scale = createLinearScale(0, 10, 100, 200);
    expect(scale(0)).toBe(100);
    expect(scale(5)).toBe(150);
    expect(scale(10)).toBe(200);
    expect(scale.invert(150)).toBe(5);
  });

  it('supports inverted ranges (y axes)', () => {
    const scale = createLinearScale(0, 1, 300, 0);
    expect(scale(0)).toBe(300);
    expect(scale(1)).toBe(0);
    expect(scale.invert(0)).toBe(1);
  });

  it('does not divide by zero on empty domains', () => {
    const scale = createLinearScale(5, 5, 0, 100);
    expect(Number.isFinite(scale(5))).toBe(true);
  });
});

describe('findNearestRowIndex', () => {
  const rows = [[0], [1], [2.5], [4]];

  it('finds exact matches', () => {
    expect(findNearestRowIndex(rows, 2.5)).toBe(2);
  });

  it('snaps to the closest row', () => {
    expect(findNearestRowIndex(rows, 1.6)).toBe(1);
    expect(findNearestRowIndex(rows, 2.0)).toBe(2);
  });

  it('clamps outside the domain', () => {
    expect(findNearestRowIndex(rows, -5)).toBe(0);
    expect(findNearestRowIndex(rows, 99)).toBe(3);
  });

  it('returns -1 for empty data', () => {
    expect(findNearestRowIndex([], 1)).toBe(-1);
  });
});

describe('computeValueExtent', () => {
  it('spans all series within the x window with padding', () => {
    const rows = [
      [0, 1, -2],
      [1, 3, 0],
      [2, 100, 100],
    ];
    const extent = computeValueExtent(rows, 0, 1);
    expect(extent.min).toBeLessThan(-2);
    expect(extent.max).toBeGreaterThan(3);
    expect(extent.max).toBeLessThan(100);
  });

  it('ignores non-finite values', () => {
    const extent = computeValueExtent([[0, Number.NaN, 5]], 0, 1);
    expect(extent.min).toBeLessThanOrEqual(5);
    expect(extent.max).toBeGreaterThanOrEqual(5);
  });

  it('falls back to a unit range with no visible data', () => {
    expect(computeValueExtent([], 0, 1)).toEqual({ min: 0, max: 1 });
  });

  it('pads constant series so lines are visible', () => {
    const extent = computeValueExtent([[0, 7]], 0, 1);
    expect(extent.min).toBeLessThan(7);
    expect(extent.max).toBeGreaterThan(7);
  });
});

describe('seriesColor', () => {
  it('cycles through the palette', () => {
    expect(seriesColor(0)).toBe(SERIES_COLORS[0]);
    expect(seriesColor(SERIES_COLORS.length)).toBe(SERIES_COLORS[0]);
  });
});

describe('LineChart', () => {
  let container: HTMLDivElement;

  const fakeContext = () =>
    ({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
    }) as unknown as CanvasRenderingContext2D;

  beforeEach(() => {
    // Class-based stub survives vi.restoreAllMocks(), unlike the vi.fn()
    // based mock from tests/setup.ts.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
    );
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 400,
      top: 0,
      left: 0,
      right: 800,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => fakeContext() as never
    );
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const rows = [
    [0, 1, 10],
    [1, 2, 20],
    [2, 3, 30],
  ];

  it('renders legend labels and calls onDraw', () => {
    const onDraw = vi.fn();
    const chart = new LineChart(container, rows, {
      labels: ['joint_0', 'joint_1'],
      onDraw,
    });

    expect(container.textContent).toContain('joint_0');
    expect(container.textContent).toContain('joint_1');
    expect(container.querySelectorAll('canvas')).toHaveLength(2);
    expect(onDraw).toHaveBeenCalled();
    chart.destroy();
  });

  it('maps times to x pixels across the plot area', () => {
    const chart = new LineChart(container, rows, { labels: ['a', 'b'] });
    const area = chart.getArea();

    expect(area.w).toBeGreaterThan(0);
    expect(chart.toDomXCoord(0)).toBeCloseTo(area.x);
    expect(chart.toDomXCoord(2)).toBeCloseTo(area.x + area.w);
    expect(chart.toDomXCoord(1)).toBeCloseTo(area.x + area.w / 2);
    chart.destroy();
  });

  it('zooms on drag and resets on double click', () => {
    const chart = new LineChart(container, rows, { labels: ['a', 'b'] });
    const area = chart.getArea();
    const overlay = container.querySelectorAll('canvas')[1] as HTMLCanvasElement;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
    } as DOMRect);

    const midX = area.x + area.w / 2;
    overlay.dispatchEvent(
      new MouseEvent('mousedown', { clientX: area.x, button: 0 })
    );
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: midX }));

    // Domain is now [0, ~1]; time=1 maps to the right edge.
    expect(chart.toDomXCoord(1)).toBeCloseTo(area.x + area.w, 0);

    overlay.dispatchEvent(new MouseEvent('dblclick'));
    expect(chart.toDomXCoord(2)).toBeCloseTo(area.x + area.w);
    chart.destroy();
  });

  it('cleans up its DOM on destroy', () => {
    const chart = new LineChart(container, rows, { labels: ['a', 'b'] });
    chart.destroy();
    expect(container.querySelectorAll('canvas')).toHaveLength(0);
    expect(container.textContent).toBe('');
  });
});
