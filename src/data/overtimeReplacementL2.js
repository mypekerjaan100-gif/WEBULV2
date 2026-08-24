export const REPLACEMENT_TYPES = {
  REPLACEMENT_LEAVE: {
    label: 'Pengganti Cuti',
    word: 'cuti',
    evidence: [{ type: 'FORM_CUTI', label: 'Form Cuti' }],
  },
  REPLACEMENT_SICK: {
    label: 'Pengganti Sakit',
    word: 'sakit',
    evidence: [
      { type: 'FORM_SAKIT', label: 'Form Sakit' },
      { type: 'SURAT_SAKIT', label: 'Surat Sakit' },
    ],
  },
  REPLACEMENT_PERMISSION: {
    label: 'Pengganti Izin',
    word: 'izin',
    evidence: [
      { type: 'FORM_IZIN', label: 'Form Izin' },
      { type: 'SURAT_IZIN', label: 'Surat Izin' },
    ],
  },
}

function addDay(date) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + 1)
  return value.toISOString().slice(0, 10)
}

export function buildPontianakRange(date, startTime, endTime) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ||
      !/^\d{2}:\d{2}$/.test(startTime ?? '') ||
      !/^\d{2}:\d{2}$/.test(endTime ?? '') || startTime === endTime) return null
  const endDate = endTime > startTime ? date : addDay(date)
  const startedAt = `${date}T${startTime}:00+07:00`
  const endedAt = `${endDate}T${endTime}:00+07:00`
  return {
    startedAt,
    endedAt,
    durationMinutes: (new Date(endedAt) - new Date(startedAt)) / 60000,
  }
}

export function pontianakFormValues(startedAt, endedAt) {
  const local = (value) => new Date(new Date(value).getTime() + 7 * 60 * 60 * 1000)
    .toISOString()
  const start = local(startedAt)
  const end = local(endedAt)
  return {
    date: start.slice(0, 10),
    startTime: start.slice(11, 16),
    endTime: end.slice(11, 16),
  }
}

export function formatDurationMinutes(minutes) {
  const rounded = Math.round(Number(minutes) || 0)
  const hours = Math.floor(rounded / 60)
  const remainder = rounded % 60
  if (!remainder) return `${hours} jam`
  if (!hours) return `${remainder} menit`
  return `${hours} jam ${remainder} menit`
}

export function automaticReplacementDescription({
  type,
  participantName,
  replacedName,
  date,
  startTime,
  endTime,
}) {
  const config = REPLACEMENT_TYPES[type]
  if (!config || !participantName || !replacedName || !date || !startTime || !endTime) return ''
  const dateText = new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Pontianak',
  }).format(new Date(`${date}T12:00:00+07:00`))
  return `${participantName.toUpperCase()} menggantikan ${replacedName.toUpperCase()} yang ${config.word} pada ${dateText} pukul ${startTime}–${endTime}.`
}
