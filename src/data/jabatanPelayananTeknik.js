export const JABATAN_CONTRACT_ID = 'pelayanan-teknik'

export const initialJabatanPelayananTeknik = [
  {
    id: 'jab-koord-up3',
    contractId: 'pelayanan-teknik',
    name: 'Koordinator UP3',
    keterangan: '',
    status: 'Aktif',
    order: 1,
  },
  {
    id: 'jab-koord-ulp',
    contractId: 'pelayanan-teknik',
    name: 'Koordinator ULP',
    keterangan: '',
    status: 'Aktif',
    order: 2,
  },
  {
    id: 'jab-koord-k3-ulp',
    contractId: 'pelayanan-teknik',
    name: 'Koordinator K3 ULP',
    keterangan: '',
    status: 'Aktif',
    order: 3,
  },
  {
    id: 'jab-petugas-yantek',
    contractId: 'pelayanan-teknik',
    name: 'Petugas Pelayanan Teknik',
    keterangan: '',
    status: 'Aktif',
    order: 4,
  },
  {
    id: 'jab-petugas-ulc',
    contractId: 'pelayanan-teknik',
    name: 'Petugas ULC',
    keterangan: '',
    status: 'Aktif',
    order: 5,
  },
  {
    id: 'jab-petugas-var-row',
    contractId: 'pelayanan-teknik',
    name: 'Petugas Variable ROW',
    keterangan: '',
    status: 'Aktif',
    order: 6,
  },
  {
    id: 'jab-petugas-var-hardukon',
    contractId: 'pelayanan-teknik',
    name: 'Petugas Variable HARDUKON',
    keterangan: '',
    status: 'Aktif',
    order: 7,
  },
]

export function jabatanOfContract(jabatan, contractId) {
  return jabatan
    .filter((item) => item.contractId === contractId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export function jabatanOfScope(jabatan, contractId, up3Id) {
  return jabatan
    .filter(
      (item) =>
        item.contractId === contractId &&
        (item.up3Id == null || item.up3Id === up3Id),
    )
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export function initialJabatanForUp3(contractId, up3Id) {
  return initialJabatanPelayananTeknik.map((jabatan) => ({
    ...jabatan,
    contractId,
    up3Id,
  }))
}