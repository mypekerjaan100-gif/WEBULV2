// Penanda mode "View As" (pratinjau role oleh Super Admin).
// Dipakai lapisan data untuk menolak semua perubahan selama pratinjau.
let active = false

export function setViewAsActive(value) {
  active = value === true
}

export function isViewAsActive() {
  return active
}
