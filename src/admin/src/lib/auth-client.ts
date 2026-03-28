// Phase 63 (AUTH-03): better-auth React client for the Chatlytics admin panel.
//
// Provides useSession(), signIn.email(), signUp.email(), signOut()
// and apiKey.create/list/delete for the API Keys tab.
//
// The client auto-discovers /api/auth/* routes relative to the current origin.
// No baseURL needed — Vite proxy (vite.admin.config.ts) forwards /api/* to :8050 in dev.
//
// DO NOT CHANGE: import path is "better-auth/react" (not "better-auth/client")
// DO NOT CHANGE: apiKeyClient import is "@better-auth/api-key/client"
// DO NOT CHANGE: plugins array order — must match server-side authConfig plugins order

import { createAuthClient } from "better-auth/react"
import { apiKeyClient } from "@better-auth/api-key/client"

export const authClient = createAuthClient({
  plugins: [apiKeyClient()],
})
