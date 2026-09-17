/**
 * Genera una Idempotency-Key: 32 bytes al azar en hex (64 caracteres).
 *
 * Se usa crypto.getRandomValues y NO crypto.randomUUID porque randomUUID solo
 * existe en contexto seguro (https o localhost) y falla al probar desde el
 * celular en http://192.168.x.x.
 */
export function generateIdempotencyKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
