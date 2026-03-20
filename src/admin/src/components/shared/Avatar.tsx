// Avatar — colored circle with initials, deterministic color from name hash.
// DO NOT CHANGE: color palette and hash logic produce consistent per-name colors.
// DO NOT CHANGE: size="sm" is 28px (for participant rows), size="md" is 36px (main rows).
// Created: quick task 260320-u7x

const PALETTE = [
  '#0d9488', // teal-600
  '#2563eb', // blue-600
  '#7c3aed', // violet-600
  '#db2777', // pink-600
  '#ea580c', // orange-600
  '#16a34a', // green-600
  '#d97706', // amber-600
  '#4f46e5', // indigo-600
  '#e11d48', // rose-600
  '#0891b2', // cyan-600
  '#059669', // emerald-600
  '#c026d3', // fuchsia-600
]

// Extract up to 2 initials from a name string
export function getInitials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

// Deterministic color from name: sum of char codes mod palette length
function getColor(name: string | null): string {
  if (!name) return PALETTE[0]
  let sum = 0
  for (let i = 0; i < name.length; i++) {
    sum += name.charCodeAt(i)
  }
  return PALETTE[sum % PALETTE.length]
}

interface AvatarProps {
  name: string | null
  size?: 'sm' | 'md'
}

export function Avatar({ name, size = 'md' }: AvatarProps) {
  const px = size === 'sm' ? 28 : 36
  const fontSize = size === 'sm' ? '11px' : '13px'
  return (
    <div
      style={{
        width: px,
        height: px,
        minWidth: px,
        backgroundColor: getColor(name),
        fontSize,
        borderRadius: '9999px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontWeight: 600,
        userSelect: 'none',
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      {getInitials(name)}
    </div>
  )
}
