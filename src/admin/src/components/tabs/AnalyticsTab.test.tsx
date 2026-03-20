import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import AnalyticsTab from './AnalyticsTab'

const mockAnalyticsResponse = {
  timeseries: [],
  summary: { total: 0, inbound: 0, outbound: 0, avgResponseMs: null },
  topChats: [],
  groupBy: 'hour' as const,
  range: '24h',
}

vi.mock('@/lib/api', () => ({
  api: {
    getAnalytics: vi.fn(),
  },
}))

// recharts uses canvas/SVG which is limited in jsdom — mock the heavy chart components.
// DO NOT REMOVE: without this mock recharts throws SVG measurement errors in jsdom.
vi.mock('recharts', () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('AnalyticsTab', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { api } = await import('@/lib/api')
    vi.mocked(api.getAnalytics).mockResolvedValue(mockAnalyticsResponse)
  })

  it('renders without crash', () => {
    const { container } = render(
      <AnalyticsTab selectedSession="all" refreshKey={0} />
    )
    expect(container).toBeTruthy()
  })

  it('shows range selector buttons', async () => {
    render(<AnalyticsTab selectedSession="all" refreshKey={0} />)

    await waitFor(() => {
      expect(screen.getAllByText('Range:').length).toBeGreaterThan(0)
      expect(screen.getAllByText('24h').length).toBeGreaterThan(0)
      expect(screen.getAllByText('7d').length).toBeGreaterThan(0)
    })
  })

  it('clicking a different range triggers API call with new range', async () => {
    const { api } = await import('@/lib/api')
    render(<AnalyticsTab selectedSession="all" refreshKey={0} />)

    await waitFor(() => {
      expect(screen.getAllByText('7d').length).toBeGreaterThan(0)
    })

    const rangeBtns = screen.getAllByText('7d')
    fireEvent.click(rangeBtns[0])

    await waitFor(() => {
      expect(vi.mocked(api.getAnalytics)).toHaveBeenCalledWith('7d')
    })
  })

  it('shows summary cards after data loads', async () => {
    render(<AnalyticsTab selectedSession="all" refreshKey={0} />)

    await waitFor(() => {
      expect(screen.getAllByText(/Total Messages/i).length).toBeGreaterThan(0)
      expect(screen.getAllByText(/Inbound/i).length).toBeGreaterThan(0)
    })
  })

  it('calls onLoadingChange with false after data loads', async () => {
    const onLoadingChange = vi.fn()
    render(<AnalyticsTab selectedSession="all" refreshKey={0} onLoadingChange={onLoadingChange} />)

    await waitFor(() => {
      expect(onLoadingChange).toHaveBeenCalledWith(false)
    })
  })
})
