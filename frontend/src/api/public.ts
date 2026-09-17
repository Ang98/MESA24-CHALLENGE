import { apiFetch } from './client'
import type { EntryPublic, LocationPublic } from './types'

export interface JoinQueueBody {
  name: string
  phone: string
  party_size: number
  consent: true
}

export function getLocation(slug: string): Promise<LocationPublic> {
  return apiFetch<LocationPublic>(`/api/locations/${slug}`)
}

export function joinQueue(slug: string, body: JoinQueueBody, idempotencyKey: string): Promise<EntryPublic> {
  return apiFetch<EntryPublic>(`/api/locations/${slug}/entries`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body,
  })
}

export function getEntry(token: string): Promise<EntryPublic> {
  return apiFetch<EntryPublic>(`/api/entries/${token}`)
}

export function onMyWay(token: string): Promise<EntryPublic> {
  return apiFetch<EntryPublic>(`/api/entries/${token}/on-my-way`, { method: 'POST' })
}

export function cancelEntry(token: string): Promise<EntryPublic> {
  return apiFetch<EntryPublic>(`/api/entries/${token}/cancel`, { method: 'POST' })
}
