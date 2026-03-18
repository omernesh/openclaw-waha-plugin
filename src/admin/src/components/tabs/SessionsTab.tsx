interface SessionsTabProps {
  selectedSession: string
  refreshKey: number
}

export default function SessionsTab({ selectedSession, refreshKey }: SessionsTabProps) {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      <p>Sessions tab — coming in Phase 22</p>
    </div>
  )
}
