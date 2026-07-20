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

// WebSocket close codes the backend uses to explain why a connection ended
// (specification.md §5.1) - used to pick the right message to show the user.
export const WORK_TOGETHER_CLOSE_CODES = {
  linkExpired: 4001,
  linkRevoked: 4002,
  sessionEnded: 4003,
  invalidToken: 4004
} as const
