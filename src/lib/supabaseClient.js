import { createClient } from '@supabase/supabase-js'
import { isViewAsActive } from './viewAsState.js'
import {
  isPreviewWriteMethod,
  isPreviewWriteRpc,
  PREVIEW_STORAGE_WRITE_METHODS,
} from './previewWriteGuard.js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
}

const client = createClient(supabaseUrl, supabaseAnonKey)

const PREVIEW_ERROR = {
  message: 'Mode pratinjau: perubahan data dinonaktifkan.',
  code: 'PREVIEW_READ_ONLY',
}

// Meniru bentuk respons Supabase agar pemanggil menerima `{ data, error }`
// tanpa melempar exception dan tanpa mengirim request ke server.
function blockedResult() {
  const result = { data: null, error: { ...PREVIEW_ERROR } }
  let proxy
  proxy = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') return (resolve) => Promise.resolve(result).then(resolve)
      if (prop === 'catch') return () => proxy
      if (prop === 'finally') return (callback) => { callback?.(); return proxy }
      return () => proxy
    },
  })
  return proxy
}

function guardBuilder(builder) {
  return new Proxy(builder, {
    get(target, prop) {
      if (isPreviewWriteMethod(prop)) return () => blockedResult()
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function guardStorage(storage) {
  return new Proxy(storage, {
    get(target, prop) {
      if (prop === 'from') {
        return (bucket) => {
          const api = target.from(bucket)
          return new Proxy(api, {
            get(apiTarget, apiProp) {
              if (PREVIEW_STORAGE_WRITE_METHODS.has(apiProp)) return () => blockedResult()
              const value = Reflect.get(apiTarget, apiProp, apiTarget)
              return typeof value === 'function' ? value.bind(apiTarget) : value
            },
          })
        }
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export const supabase = new Proxy(client, {
  get(target, prop) {
    if (prop === 'rpc') {
      return (name, params, options) => {
        if (isViewAsActive() && isPreviewWriteRpc(name)) return blockedResult()
        return target.rpc(name, params, options)
      }
    }
    if (prop === 'from') {
      return (table) => (isViewAsActive() ? guardBuilder(target.from(table)) : target.from(table))
    }
    if (prop === 'storage') return isViewAsActive() ? guardStorage(target.storage) : target.storage
    const value = Reflect.get(target, prop, target)
    return typeof value === 'function' ? value.bind(target) : value
  },
})
