interface LogTabProps {
  selectedSession: string
  refreshKey: number
}

export default function LogTab({ selectedSession: _selectedSession, refreshKey: _refreshKey }: LogTabProps) {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      <p>Log tab — coming in Phase 22</p>
    </div>
  )
}
