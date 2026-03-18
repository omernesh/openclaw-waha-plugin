import { useEffect, useState, useCallback } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import type { Module } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { TagInput } from '@/components/shared/TagInput'

interface ModulesTabProps {
  selectedSession: string
  refreshKey: number
}

interface ModuleCardState {
  module: Module
  expanded: boolean
  assignments: string[]
  resolvedNames: Record<string, string>
  assignmentsLoaded: boolean
  loadingAssignments: boolean
  toggleError: string | null
}

export default function ModulesTab({ selectedSession: _selectedSession, refreshKey }: ModulesTabProps) {
  const [cards, setCards] = useState<ModuleCardState[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    api.getModules()
      .then((res) => {
        if (controller.signal.aborted) return
        setCards(
          res.modules.map((m) => ({
            module: m,
            expanded: false,
            assignments: [],
            resolvedNames: {},
            assignmentsLoaded: false,
            loadingAssignments: false,
            toggleError: null,
          }))
        )
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Failed to load modules')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [refreshKey])

  const handleToggle = useCallback(async (moduleId: string, currentEnabled: boolean) => {
    // Optimistic update
    setCards((prev) =>
      prev
        ? prev.map((c) =>
            c.module.id === moduleId
              ? { ...c, module: { ...c.module, enabled: !currentEnabled }, toggleError: null }
              : c
          )
        : prev
    )

    try {
      if (currentEnabled) {
        await api.disableModule(moduleId)
      } else {
        await api.enableModule(moduleId)
      }
    } catch (err) {
      // Revert on error
      setCards((prev) =>
        prev
          ? prev.map((c) =>
              c.module.id === moduleId
                ? {
                    ...c,
                    module: { ...c.module, enabled: currentEnabled },
                    toggleError: err instanceof Error ? err.message : 'Toggle failed',
                  }
                : c
            )
          : prev
      )
    }
  }, [])

  const handleExpand = useCallback(async (moduleId: string, isExpanding: boolean) => {
    setCards((prev) =>
      prev
        ? prev.map((c) => (c.module.id === moduleId ? { ...c, expanded: isExpanding } : c))
        : prev
    )

    if (!isExpanding) return

    // Lazy-load assignments on first expand
    setCards((prev) => {
      if (!prev) return prev
      const card = prev.find((c) => c.module.id === moduleId)
      if (card?.assignmentsLoaded) return prev
      return prev.map((c) =>
        c.module.id === moduleId ? { ...c, loadingAssignments: true } : c
      )
    })

    try {
      const res = await api.getModuleAssignments(moduleId)
      const jids = res.assignments.map((a) => a.jid)

      let resolvedNames: Record<string, string> = {}
      if (jids.length > 0) {
        try {
          const nameRes = await api.resolveNames(jids)
          resolvedNames = nameRes.resolved
        } catch {
          // Name resolution failure is non-fatal
        }
      }

      setCards((prev) =>
        prev
          ? prev.map((c) =>
              c.module.id === moduleId
                ? {
                    ...c,
                    assignments: jids,
                    resolvedNames,
                    assignmentsLoaded: true,
                    loadingAssignments: false,
                  }
                : c
            )
          : prev
      )
    } catch (err) {
      setCards((prev) =>
        prev
          ? prev.map((c) =>
              c.module.id === moduleId
                ? {
                    ...c,
                    loadingAssignments: false,
                    assignmentsLoaded: true,
                    toggleError: err instanceof Error ? err.message : 'Failed to load assignments',
                  }
                : c
            )
          : prev
      )
    }
  }, [])

  const handleAssignmentChange = useCallback(
    async (moduleId: string, newValues: string[], prevValues: string[]) => {
      // Determine added/removed
      const added = newValues.filter((v) => !prevValues.includes(v))
      const removed = prevValues.filter((v) => !newValues.includes(v))

      // Optimistic update
      setCards((prev) =>
        prev
          ? prev.map((c) =>
              c.module.id === moduleId ? { ...c, assignments: newValues } : c
            )
          : prev
      )

      try {
        for (const jid of added) {
          await api.addModuleAssignment(moduleId, { jid })
        }
        for (const jid of removed) {
          await api.removeModuleAssignment(moduleId, jid)
        }
        // Refresh module list to update assignmentCount
        const modulesRes = await api.getModules()
        const updated = modulesRes.modules.find((m) => m.id === moduleId)
        if (updated) {
          setCards((prev) =>
            prev
              ? prev.map((c) =>
                  c.module.id === moduleId
                    ? { ...c, module: { ...c.module, assignmentCount: updated.assignmentCount } }
                    : c
                )
              : prev
          )
        }
      } catch (err) {
        // Revert
        setCards((prev) =>
          prev
            ? prev.map((c) =>
                c.module.id === moduleId
                  ? {
                      ...c,
                      assignments: prevValues,
                      toggleError: err instanceof Error ? err.message : 'Assignment update failed',
                    }
                  : c
              )
            : prev
        )
      }
    },
    []
  )

  const directorySearchFn = useCallback(
    async (query: string): Promise<Array<{ value: string; label: string }>> => {
      const res = await api.getDirectory({ search: query, limit: '10' })
      return res.contacts.map((c) => ({
        value: c.jid,
        label: c.displayName ?? c.jid,
      }))
    },
    []
  )

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p>Loading modules...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-destructive">
        <p>{error}</p>
      </div>
    )
  }

  if (!cards || cards.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p>No modules registered</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      {cards.map((cardState) => {
        const { module, expanded, assignments, resolvedNames, loadingAssignments, toggleError } = cardState
        return (
          <Card key={module.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">{module.name}</CardTitle>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`toggle-${module.id}`} className="text-xs text-muted-foreground">
                    {module.enabled ? 'Enabled' : 'Disabled'}
                  </Label>
                  <Switch
                    id={`toggle-${module.id}`}
                    checked={module.enabled}
                    onCheckedChange={() => handleToggle(module.id, module.enabled)}
                  />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {module.description ?? 'No description'}
              </p>
              {toggleError && (
                <p className="text-xs text-destructive">{toggleError}</p>
              )}
            </CardHeader>
            <CardContent className="pt-0">
              <Collapsible open={expanded} onOpenChange={(open) => handleExpand(module.id, open)}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-auto px-0 py-1 text-xs text-muted-foreground hover:text-foreground">
                    {expanded ? (
                      <ChevronDown className="mr-1 h-3 w-3" />
                    ) : (
                      <ChevronRight className="mr-1 h-3 w-3" />
                    )}
                    <Badge variant="secondary" className="mr-1 text-xs">
                      {module.assignmentCount}
                    </Badge>
                    chats assigned
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  {loadingAssignments ? (
                    <p className="text-xs text-muted-foreground">Loading assignments...</p>
                  ) : (
                    <TagInput
                      values={assignments}
                      onChange={(newValues) =>
                        handleAssignmentChange(module.id, newValues, assignments)
                      }
                      resolvedNames={resolvedNames}
                      placeholder="Assign chat..."
                      searchFn={directorySearchFn}
                    />
                  )}
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
