import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import LogTab from './LogTab'

const mockLogResponse = {
  lines: ['2026-03-20T00:00:00Z info Plugin loaded', '2026-03-20T00:01:00Z warn Test warning'],
  total: 2,
  source: 'journalctl',
}

vi.mock('@/lib/api', () => ({
  api: {
    getLogs: vi.fn(),
  },
}))

vi.mock('@/hooks/useEventSource', () => ({
  useSSE: () => ({
    status: 'connected',
    subscribe: vi.fn(() => () => {}),
  }),
}))

describe('LogTab', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { api } = await import('@/lib/api')
    vi.mocked(api.getLogs).mockResolvedValue(mockLogResponse)
  })

  it('renders without crash', () => {
    const { container } = render(
      <LogTab selectedSession="all" refreshKey={0} />
    )
    expect(container).toBeTruthy()
  })

  it('shows log output area', async () => {
    render(<LogTab selectedSession="all" refreshKey={0} />)

    await waitFor(() => {
      // Log content area with overflow-y-auto should be present
      const logArea = document.querySelector('.overflow-y-auto')
      expect(logArea).toBeTruthy()
    })
  })

  it('auto-scroll toggle button is present', async () => {
    render(<LogTab selectedSession="all" refreshKey={0} />)

    await waitFor(() => {
      // Auto-scroll button has a title attribute matching auto-scroll
      const btns = document.querySelectorAll('button[title]')
      const autoScrollBtn = Array.from(btns).find(b =>
        b.getAttribute('title')?.toLowerCase().includes('auto-scroll')
      )
      expect(autoScrollBtn).toBeTruthy()
    })
  })

  it('shows log level filter buttons', async () => {
    render(<LogTab selectedSession="all" refreshKey={0} />)

    // Level filter buttons present immediately (no async needed)
    const allBtns = screen.getAllByRole('button', { name: 'ALL' })
    expect(allBtns.length).toBeGreaterThan(0)
    const errorBtns = screen.getAllByRole('button', { name: 'ERROR' })
    expect(errorBtns.length).toBeGreaterThan(0)
  })

  it('clicking WARN level filter fetches filtered logs', async () => {
    const { api } = await import('@/lib/api')
    render(<LogTab selectedSession="all" refreshKey={0} />)

    const warnBtns = screen.getAllByRole('button', { name: 'WARN' })
    fireEvent.click(warnBtns[0])

    await waitFor(() => {
      expect(vi.mocked(api.getLogs)).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'warn' })
      )
    })
  })

  it('shows search input for filtering logs', async () => {
    render(<LogTab selectedSession="all" refreshKey={0} />)

    // Multiple inputs may render (jsdom quirk) — check at least one matches
    const searchInputs = screen.getAllByPlaceholderText(/search logs/i)
    expect(searchInputs.length).toBeGreaterThan(0)
  })
})
