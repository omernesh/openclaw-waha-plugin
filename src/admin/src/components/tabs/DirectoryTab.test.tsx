import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import DirectoryTab from './DirectoryTab'

const mockDirectoryResponse = {
  contacts: [],
  total: 0,
  dms: 0,
  groups: 0,
  newsletters: 0,
}

vi.mock('@/lib/api', () => ({
  api: {
    getDirectory: vi.fn(),
  },
}))

describe('DirectoryTab', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { api } = await import('@/lib/api')
    vi.mocked(api.getDirectory).mockResolvedValue(mockDirectoryResponse)
  })

  it('renders without crash', () => {
    const { container } = render(
      <DirectoryTab selectedSession="all" refreshKey={0} />
    )
    expect(container).toBeTruthy()
  })

  it('shows search input', async () => {
    render(<DirectoryTab selectedSession="all" refreshKey={0} />)

    await waitFor(() => {
      // Multiple search inputs may render — check at least one
      const searchInputs = screen.getAllByPlaceholderText(/search/i)
      expect(searchInputs.length).toBeGreaterThan(0)
    })
  })

  it('shows tab filters (contacts/groups/channels)', async () => {
    render(<DirectoryTab selectedSession="all" refreshKey={0} />)

    await waitFor(() => {
      // Multiple tabs may match — use getAllByRole and check at least one exists
      const contactsTabs = screen.getAllByRole('tab', { name: /contacts/i })
      expect(contactsTabs.length).toBeGreaterThan(0)
      const groupsTabs = screen.getAllByRole('tab', { name: /groups/i })
      expect(groupsTabs.length).toBeGreaterThan(0)
      const channelsTabs = screen.getAllByRole('tab', { name: /channels/i })
      expect(channelsTabs.length).toBeGreaterThan(0)
    })
  })

  it('tab filters are clickable without crash', async () => {
    render(<DirectoryTab selectedSession="all" refreshKey={0} />)

    await waitFor(() => {
      expect(screen.getAllByRole('tab', { name: /groups/i }).length).toBeGreaterThan(0)
    })

    const groupsTabs = screen.getAllByRole('tab', { name: /groups/i })

    // Click should not throw
    expect(() => fireEvent.click(groupsTabs[0])).not.toThrow()

    // Channels tab click should also not throw
    const channelsTabs = screen.getAllByRole('tab', { name: /channels/i })
    expect(() => fireEvent.click(channelsTabs[0])).not.toThrow()
  })

  it('search input accepts text input', async () => {
    render(<DirectoryTab selectedSession="all" refreshKey={0} />)

    await waitFor(() => {
      expect(screen.getAllByPlaceholderText(/search/i).length).toBeGreaterThan(0)
    })

    const inputs = screen.getAllByPlaceholderText(/search/i)
    fireEvent.change(inputs[0], { target: { value: 'test query' } })

    expect((inputs[0] as HTMLInputElement).value).toBe('test query')
  })
})
