interface QueueTabProps {
  selectedSession: string
  refreshKey: number
}

export default function QueueTab({ selectedSession: _selectedSession, refreshKey: _refreshKey }: QueueTabProps) {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      <p>Queue tab — coming in Phase 22</p>
    </div>
  )
}
