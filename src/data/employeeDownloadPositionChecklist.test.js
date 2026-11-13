import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const component = readFileSync(
  new URL('../components/sla/SLADatabasePegawai.jsx', import.meta.url),
  'utf8',
)

assert.ok(
  component.includes('const [downloadPositionIds, setDownloadPositionIds] = useState(null)'),
  'Checklist jabatan harus dimulai dengan semua jabatan terpilih',
)
assert.ok(
  component.includes('setDownloadPositionIds(null)'),
  'Membuka modal download harus mengembalikan pilihan ke semua jabatan',
)
assert.ok(
  component.includes('const toggleDownloadPosition = (positionId) =>'),
  'Checkbox jabatan membutuhkan handler toggle',
)
assert.ok(
  component.includes('selected.filter((value) => value !== positionId)'),
  'Membatalkan centang harus menghapus satu jabatan saja',
)
assert.ok(
  component.includes('...(downloadHasUnassignedPosition ? [\'__none__\'] : [])'),
  'Pilihan Belum Ditentukan harus ikut saat semua jabatan dipilih',
)
assert.ok(
  component.includes('downloadPositionIds === null || downloadPositionIds.includes(position.id)'),
  'Checkbox harus tercentang saat semua jabatan dipilih',
)
assert.ok(
  component.includes('<legend>Jabatan</legend>'),
  'Filter jabatan harus berupa checklist berlabel Jabatan',
)
assert.ok(
  component.includes('onClick={() => setDownloadPositionIds(null)}>Pilih Semua</button>'),
  'Checklist jabatan harus punya tombol Pilih Semua',
)
assert.ok(
  component.includes('onClick={() => setDownloadPositionIds([])}>Kosongkan</button>'),
  'Checklist jabatan harus punya tombol Kosongkan',
)
assert.ok(
  component.includes('{downloadHasUnassignedPosition && ('),
  'Pilihan Belum Ditentukan hanya muncul jika ada pegawai tanpa jabatan',
)
assert.ok(
  component.includes('Pilih minimal satu jabatan.'),
  'Pengguna harus diberi tahu saat semua jabatan dikosongkan',
)
assert.ok(
  component.includes('Tidak ada pegawai aktif pada jabatan terpilih.'),
  'Pengguna harus diberi tahu saat kombinasi jabatan tidak menghasilkan pegawai',
)
assert.ok(
  !component.includes('value={downloadPosition}'),
  'Dropdown jabatan tunggal harus diganti checklist',
)
assert.ok(
  !component.includes('setDownloadPosition('),
  'State jabatan tunggal tidak boleh tersisa',
)

console.log('Employee download position checklist regression tests passed')
