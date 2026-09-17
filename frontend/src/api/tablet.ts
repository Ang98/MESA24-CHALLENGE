import { apiFetch, authHeaders } from './client'
import type { RecoverLinkResponse, TabletQueueItem, TabletQueueResponse } from './types'

export function getQueue(token: string): Promise<TabletQueueResponse> {
  return apiFetch<TabletQueueResponse>('/api/tablet/queue', { headers: authHeaders(token) })
}

export function callEntry(token: string, id: number): Promise<TabletQueueItem> {
  return apiFetch<TabletQueueItem>(`/api/tablet/entries/${id}/call`, {
    method: 'POST',
    headers: authHeaders(token),
  })
}

export function seatEntry(token: string, id: number): Promise<TabletQueueItem> {
  return apiFetch<TabletQueueItem>(`/api/tablet/entries/${id}/seat`, {
    method: 'POST',
    headers: authHeaders(token),
  })
}

export function noShowEntry(token: string, id: number): Promise<TabletQueueItem> {
  return apiFetch<TabletQueueItem>(`/api/tablet/entries/${id}/no-show`, {
    method: 'POST',
    headers: authHeaders(token),
  })
}

export function removeEntry(token: string, id: number): Promise<TabletQueueItem> {
  return apiFetch<TabletQueueItem>(`/api/tablet/entries/${id}/remove`, {
    method: 'POST',
    headers: authHeaders(token),
  })
}

export function recoverLink(token: string, id: number): Promise<RecoverLinkResponse> {
  return apiFetch<RecoverLinkResponse>(`/api/tablet/entries/${id}/recover-link`, {
    method: 'POST',
    headers: authHeaders(token),
  })
}
