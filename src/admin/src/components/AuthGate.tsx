// Phase 63 (AUTH-03): AuthGate — blocks unauthenticated access to the admin panel.
//
// Uses better-auth useSession() to check if the user has an active session.
// - isPending → full-screen skeleton while session is being fetched
// - no session → render LoginPage
// - session present → render children (the full admin panel)
//
// DO NOT CHANGE: AuthGate must wrap the entire app OUTSIDE SSEProvider.
// No SSE connection is established until the user is authenticated.
// DO NOT CHANGE: useSession() comes from authClient — not from a React context.

import { Skeleton } from '@/components/ui/skeleton'
import { authClient } from '@/lib/auth-client'
import { LoginPage } from './LoginPage'

interface AuthGateProps {
  children: React.ReactNode
}

export function AuthGate({ children }: AuthGateProps) {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return (
      <div className="flex h-screen w-screen items-center justify-center p-8">
        <div className="flex flex-col gap-4 w-full max-w-md">
          <Skeleton className="h-[60px] w-full" />
          <Skeleton className="h-[300px] w-full" />
          <Skeleton className="h-[40px] w-full" />
        </div>
      </div>
    )
  }

  if (!session) {
    return <LoginPage />
  }

  return <>{children}</>
}
