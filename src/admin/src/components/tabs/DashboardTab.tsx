interface DashboardTabProps {
  selectedSession: string
  refreshKey: number
}

export default function DashboardTab({ selectedSession: _selectedSession, refreshKey: _refreshKey }: DashboardTabProps) {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      <p>Dashboard tab — coming in Phase 20</p>
    </div>
  )
}
