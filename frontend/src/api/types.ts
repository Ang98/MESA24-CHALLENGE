/**
 * Espejo de backend/app/schemas.py.
 *
 * `on_my_way` es un evento, no un estado (nota tecnica seccion 3): EntryPublic
 * y TabletQueueItem lo exponen como booleano calculado a partir de ese evento.
 */

export type EntryStatus = 'waiting' | 'called' | 'seated' | 'cancelled' | 'no_show' | 'removed'

export interface LocationPublic {
  slug: string
  name: string
}

export interface EntryPublic {
  public_token: string
  status: EntryStatus
  name: string
  phone: string
  party_size: number
  location: LocationPublic
  groups_ahead: number | null
  position: number | null
  wait_min: [number, number] | null
  sms_supported: boolean
  joined_at: string
  on_my_way: boolean
}

export interface TabletQueueItem {
  id: number
  name: string
  party_size: number
  status: 'waiting' | 'called'
  joined_at: string
  phone_last3: string
  on_my_way: boolean
}

export interface TabletQueueResponse {
  location: LocationPublic
  server_time: string
  entries: TabletQueueItem[]
}

export interface RecoverLinkResponse {
  url: string
}

export interface ReportResponse {
  date: string
  is_today: boolean
  joined: number
  seated: number
  left: number
  no_show: number
  unclosed: number
  in_progress: number
  removed: number
  avg_wait_min: number | null
}
