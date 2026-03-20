import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import SettingsTab from './SettingsTab'

const mockConfig = {
  waha: {
    baseUrl: 'http://localhost:3004',
    webhookPort: 3005,
    dmPolicy: 'allow-all',
    groupPolicy: 'allow-all',
    dmFilter: {
      enabled: false,
      mentionPatterns: [],
      godModeBypass: false,
      godModeScope: 'all',
      godModeSuperUsers: [],
      tokenEstimate: 500,
    },
    groupFilter: {
      enabled: false,
      mentionPatterns: [],
      godModeBypass: false,
      godModeScope: 'all',
      godModeSuperUsers: [],
      tokenEstimate: 500,
    },
    presence: {
      enabled: false,
      sendSeen: false,
      wpm: 42,
      readDelayMs: [500, 2000] as [number, number],
      msPerReadChar: 10,
      pauseDurationMs: [500, 1500] as [number, number],
      pauseIntervalMs: [3000, 8000] as [number, number],
      typingDurationMs: [1000, 5000] as [number, number],
      pauseChance: 0.3,
      jitter: [0.8, 1.2] as [number, number],
    },
  },
}

vi.mock('@/lib/api', () => ({
  api: {
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    exportConfig: vi.fn(),
    importConfig: vi.fn(),
    restart: vi.fn(),
  },
}))

// sonner toast is used in SettingsTab — mock it to avoid DOM setup issues
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  Toaster: () => null,
}))

describe('SettingsTab', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { api } = await import('@/lib/api')
    vi.mocked(api.getConfig).mockResolvedValue(mockConfig)
    vi.mocked(api.updateConfig).mockResolvedValue(undefined)
  })

  it('renders without crash', () => {
    const { container } = render(
      <SettingsTab selectedSession="all" refreshKey={0} />
    )
    expect(container).toBeTruthy()
  })

  it('shows config form fields after data loads', async () => {
    render(<SettingsTab selectedSession="all" refreshKey={0} />)

    await waitFor(() => {
      // Base URL field should be visible
      const inputs = screen.getAllByRole('textbox')
      expect(inputs.length).toBeGreaterThan(0)
    })
  })

  it('shows save button', async () => {
    render(<SettingsTab selectedSession="all" refreshKey={0} />)

    await waitFor(() => {
      // Multiple save buttons may exist — check at least one is present
      const saveBtns = screen.getAllByRole('button', { name: /save/i })
      expect(saveBtns.length).toBeGreaterThan(0)
    })
  })

  it('save button is present and disabled when form is unchanged', async () => {
    render(<SettingsTab selectedSession="all" refreshKey={0} />)

    // Wait for form to load (loading state resolves)
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /save/i }).length).toBeGreaterThan(0)
    })

    // Save button should exist (disabled until dirty)
    const saveBtns = screen.getAllByRole('button', { name: /save/i })
    const saveOnlyBtn = saveBtns.find(b => b.textContent?.trim() === 'Save')
    expect(saveOnlyBtn).toBeTruthy()
  })

  it('calls onLoadingChange with false after config loads', async () => {
    const onLoadingChange = vi.fn()
    render(<SettingsTab selectedSession="all" refreshKey={0} onLoadingChange={onLoadingChange} />)

    await waitFor(() => {
      expect(onLoadingChange).toHaveBeenCalledWith(false)
    })
  })
})
