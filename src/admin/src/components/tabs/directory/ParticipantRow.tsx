// ParticipantRow — lazy-loaded participant list for an expanded group row.
// Fetches participants once on mount. Shows bot badge for bot sessions (no controls).
// Non-bot participants get Allow in Group toggle, Allow DM toggle, and Role dropdown.
// DO NOT CHANGE: uses participantJid (not jid), allowInGroup (not allowGroup),
// displayName (not name), isBotSession to gate controls. All from ParticipantEnriched type.
// DO NOT CHANGE: bulkAllowAll sends { allowed: boolean } (not { allow: boolean }).
// Verified: Phase 21, Plan 03 (2026-03-18)

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api } from '@/lib/api'
import type { ParticipantEnriched } from '@/types'

interface ParticipantRowProps {
  groupJid: string
}

export function ParticipantRow({ groupJid }: ParticipantRowProps) {
  const [participants, setParticipants] = useState<ParticipantEnriched[]>([])
  const [allowAll, setAllowAll] = useState(false)
  const [loading, setLoading] = useState(true)

  // Lazy fetch on first render — loads participant list for this group
  useEffect(() => {
    setLoading(true)
    api.getGroupParticipants(groupJid)
      .then(r => {
        setParticipants(r.participants)
        setAllowAll(r.allowAll)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load participants:', err)
        toast.error('Failed to load participants')
        setLoading(false)
      })
  }, [groupJid])

  async function handleAllowAll(newValue: boolean) {
    try {
      // DO NOT CHANGE: sends { allowed: boolean } — server reads "allowed" not "allow"
      await api.bulkAllowAll(groupJid, { allowed: newValue })
      setAllowAll(newValue)
      toast.success(newValue ? 'All participants allowed' : 'All participants blocked')
      // Re-fetch to get updated participant states
      const r = await api.getGroupParticipants(groupJid)
      setParticipants(r.participants)
      setAllowAll(r.allowAll)
    } catch (err) {
      console.error('handleAllowAll failed:', err)
      toast.error('Failed to update participants')
    }
  }

  async function handleAllowInGroup(p: ParticipantEnriched, newValue: boolean) {
    try {
      // DO NOT CHANGE: uses participantJid (not jid) — field name from ParticipantEnriched
      await api.toggleParticipantAllowGroup(groupJid, p.participantJid, newValue)
      // Optimistic update
      setParticipants(prev =>
        prev.map(x => x.participantJid === p.participantJid ? { ...x, allowInGroup: newValue } : x)
      )
      toast.success(`${p.displayName ?? p.participantJid} ${newValue ? 'allowed in group' : 'blocked in group'}`)
    } catch (err) {
      console.error('handleAllowInGroup failed:', err)
      toast.error('Failed to update participant')
    }
  }

  async function handleAllowDm(p: ParticipantEnriched, newValue: boolean) {
    try {
      await api.toggleParticipantAllowDm(groupJid, p.participantJid, newValue)
      setParticipants(prev =>
        prev.map(x => x.participantJid === p.participantJid ? { ...x, allowDm: newValue } : x)
      )
      toast.success(`${p.displayName ?? p.participantJid} DM ${newValue ? 'allowed' : 'blocked'}`)
    } catch (err) {
      console.error('handleAllowDm failed:', err)
      toast.error('Failed to update participant')
    }
  }

  async function handleRoleChange(p: ParticipantEnriched, newRole: string) {
    try {
      await api.updateParticipantRole(groupJid, p.participantJid, { role: newRole })
      setParticipants(prev =>
        prev.map(x =>
          x.participantJid === p.participantJid
            ? { ...x, participantRole: newRole as ParticipantEnriched['participantRole'] }
            : x
        )
      )
      toast.success(`Role updated to ${newRole}`)
    } catch (err) {
      console.error('handleRoleChange failed:', err)
      toast.error('Failed to update participant role')
    }
  }

  if (loading) {
    return (
      <div className="p-4 text-sm text-muted-foreground">Loading participants...</div>
    )
  }

  return (
    <div className="border rounded-md p-4 m-2">
      {/* Allow All toggle at top */}
      <div className="flex items-center gap-3 pb-3 mb-3 border-b">
        <Switch
          id={`allow-all-${groupJid}`}
          checked={allowAll}
          onCheckedChange={handleAllowAll}
        />
        <Label htmlFor={`allow-all-${groupJid}`} className="text-sm font-medium cursor-pointer">
          Allow All Participants
        </Label>
      </div>

      {/* Participant list */}
      {participants.length === 0 ? (
        <p className="text-sm text-muted-foreground">No participants found.</p>
      ) : (
        <div>
          {participants.map((p) => (
            <div
              key={p.participantJid}
              className="flex items-center gap-3 py-2 border-b last:border-b-0"
            >
              {/* Name — resolved from server, fallback to JID */}
              <span className="text-sm font-medium min-w-[140px] truncate">
                {p.displayName ?? p.participantJid}
              </span>

              {/* Admin badge */}
              {p.isAdmin && (
                <Badge variant="outline">Admin</Badge>
              )}

              {/* Bot badge — bot sessions get no controls */}
              {p.isBotSession && (
                <Badge variant="secondary">Bot</Badge>
              )}

              {/* Controls for non-bot participants only */}
              {!p.isBotSession && (
                <div className="flex items-center gap-4 ml-auto flex-wrap">
                  {/* Allow in Group toggle */}
                  <div className="flex items-center gap-1.5">
                    <Switch
                      id={`allow-group-${p.participantJid}`}
                      checked={p.allowInGroup}
                      onCheckedChange={(v) => handleAllowInGroup(p, v)}
                    />
                    <Label
                      htmlFor={`allow-group-${p.participantJid}`}
                      className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap"
                    >
                      Allow in Group
                    </Label>
                  </div>

                  {/* Allow DM toggle */}
                  <div className="flex items-center gap-1.5">
                    <Switch
                      id={`allow-dm-${p.participantJid}`}
                      checked={p.allowDm}
                      onCheckedChange={(v) => handleAllowDm(p, v)}
                    />
                    <Label
                      htmlFor={`allow-dm-${p.participantJid}`}
                      className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap"
                    >
                      Allow DM
                    </Label>
                  </div>

                  {/* Role dropdown */}
                  <Select
                    value={p.participantRole}
                    onValueChange={(v) => handleRoleChange(p, v)}
                  >
                    <SelectTrigger className="w-[130px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="participant">Participant</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="bot_admin">Bot Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
