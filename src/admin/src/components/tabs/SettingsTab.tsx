interface SettingsTabProps {
  selectedSession: string
  refreshKey: number
}

export default function SettingsTab({ selectedSession: _selectedSession, refreshKey: _refreshKey }: SettingsTabProps) {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      <p>Settings tab — coming in Phase 20</p>
    </div>
  )
}
