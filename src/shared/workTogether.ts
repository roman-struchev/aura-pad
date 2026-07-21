// Types for the "Work Together" backend contract - see
// docs/edit-together/specification.md for the full protocol these mirror.
// The backend itself is a separate, user-configured service; these types only
// describe the shapes AuraPad sends/receives over that wire.

export type WorkTogetherRole = 'host' | 'write' | 'read'
export type WorkTogetherLinkRole = 'write' | 'read'

export type WorkTogetherResult<T> = { success: true; data: T } | { success: false; error: string }

export interface WorkTogetherSession {
  sessionId: string
  hostToken: string
}

export interface WorkTogetherLink {
  linkId: string
  token: string
  url: string
  role: WorkTogetherLinkRole
  expiresAt: string
}

export interface WorkTogetherParticipant {
  connectionId: string
  role: WorkTogetherRole
  displayName: string
  joinedAt: string
}

export interface WorkTogetherLinkStatus {
  linkId: string
  role: WorkTogetherLinkRole
  expiresAt: string
  revoked: boolean
}

export interface WorkTogetherSessionStatus {
  sessionId: string
  filePath: string
  createdAt: string
  links: WorkTogetherLinkStatus[]
  participants: WorkTogetherParticipant[]
}

// A still-live session the Host was connected to when AuraPad last quit (or
// reloaded) - persisted so it can be reconnected to on next launch instead of
// dying with the process. Per specification.md §2, a session outlives the
// Host's own connection: it only ends when the Host explicitly ends it, all
// its links are revoked, or all its links expire - so the sessionId/hostToken
// minted at share time are still good to reconnect with, no re-creation
// needed. `links` is this client's own record of what it minted (§3.2's
// response, including the token/url) - the backend's status endpoint (§3.5)
// reports which are still valid but never re-exposes a link's token/url once
// minted, so that has to come from here.
export interface WorkTogetherResumableSession {
  path: string
  backendUrl: string
  sessionId: string
  hostToken: string
  links: WorkTogetherLink[]
}

export interface WorkTogetherResumeState {
  sessions: WorkTogetherResumableSession[]
}

// WebSocket close codes the backend uses to explain why a connection ended
// (specification.md §5.1) - used to pick the right message to show the user.
export const WORK_TOGETHER_CLOSE_CODES = {
  linkExpired: 4001,
  linkRevoked: 4002,
  sessionEnded: 4003,
  invalidToken: 4004
} as const
