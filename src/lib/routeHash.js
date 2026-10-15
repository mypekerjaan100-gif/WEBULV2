// Navigasi berbasis hash agar refresh tidak mengembalikan ke Dashboard.
// Bentuk: #/pelayanan-teknik/lembur?periode=Oktober%202026
//   [] -> dashboard
//   [contractId] -> halaman kontrak (module+periode hanya untuk pelayanan-teknik)
//   [pengguna-akses | analisis-finansial] -> halaman khusus (+periode untuk finansial)

export function parseRouteHash() {
  const raw = String(window.location.hash ?? '').replace(/^#\/?/, '')
  const [pathPart = '', queryPart = ''] = raw.split('?')
  const segments = pathPart
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
  let periode = null
  try {
    periode = new URLSearchParams(queryPart).get('periode')
  } catch {
    periode = null
  }
  return { segments, periode: periode || null }
}

export function buildRouteHash({ segments = [], periode = null } = {}) {
  const path = segments.map((segment) => encodeURIComponent(String(segment))).join('/')
  const query = periode ? `?periode=${encodeURIComponent(String(periode))}` : ''
  return `#/${path}${query}`
}

// Tulis hash dengan menggabung state rute saat ini. push=true untuk navigasi
// antar-halaman (mendukung Back/Forward); replace untuk perubahan tab/periode.
export function writeRouteHash(next, { push = false } = {}) {
  const current = parseRouteHash()
  const segments = next.segments !== undefined ? next.segments : current.segments
  const periode = next.periode !== undefined ? next.periode : current.periode
  const hash = buildRouteHash({ segments, periode })
  if (window.location.hash === hash) return
  if (push) window.history.pushState(null, '', hash)
  else window.history.replaceState(null, '', hash)
}
