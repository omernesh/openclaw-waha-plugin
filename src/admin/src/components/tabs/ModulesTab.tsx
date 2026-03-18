interface ModulesTabProps {
  selectedSession: string
  refreshKey: number
}

export default function ModulesTab({ selectedSession, refreshKey }: ModulesTabProps) {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      <p>Modules tab — coming in Phase 22</p>
    </div>
  )
}
