interface DirectoryTabProps {
  selectedSession: string
  refreshKey: number
}

export default function DirectoryTab({ selectedSession: _selectedSession, refreshKey: _refreshKey }: DirectoryTabProps) {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      <p>Directory tab — coming in Phase 21</p>
    </div>
  )
}
