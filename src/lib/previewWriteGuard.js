// Aturan penulisan yang diblokir saat Super Admin memakai mode pratinjau.
// RPC baca (get_, list_, fetch_, resolve_) tetap diizinkan.

export const PREVIEW_WRITE_METHODS = new Set(['insert', 'update', 'delete', 'upsert'])

export const PREVIEW_STORAGE_WRITE_METHODS = new Set([
  'upload',
  'remove',
  'update',
  'move',
  'copy',
  'createSignedUploadUrl',
])

export const PREVIEW_WRITE_RPC_PATTERN = /^(?:(?:ops|admin)_)?(save|set|create|insert|update|delete|upsert|approve|reject|final_reject|resubmit|submit|import|archive|publish|assign|revoke|disable|enable|deactivate|activate|soft_delete|mark|reset|expire|reorder|rename|remove|add|link|unlink|toggle|grant|transfer|correct|apply|prepare|begin|finalize|cancel|end|duplicate|process|sync|refresh|recalculate|ensure|replace|restore|reopen|close|upload|move|copy)_/i

export function isPreviewWriteRpc(name) {
  return PREVIEW_WRITE_RPC_PATTERN.test(String(name ?? ''))
}

export function isPreviewWriteMethod(name) {
  return PREVIEW_WRITE_METHODS.has(name)
}
