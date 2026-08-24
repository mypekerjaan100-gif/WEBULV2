import {
  automaticReplacementDescription,
  buildPontianakRange,
  formatDurationMinutes,
} from './overtimeReplacementL2.js'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const fractional = buildPontianakRange('2026-08-20', '08:00', '09:30')
assert(fractional.durationMinutes === 90, 'Fractional duration must use actual minutes')
assert(formatDurationMinutes(fractional.durationMinutes) === '1 jam 30 menit', 'Fractional label')

const crossMonth = buildPontianakRange('2026-08-31', '22:00', '02:00')
assert(crossMonth.durationMinutes === 240, 'Cross-midnight duration')
assert(crossMonth.endedAt.startsWith('2026-09-01'), 'Cross-month end date')
assert(buildPontianakRange('2026-08-20', '08:00', '08:00') === null, 'Equal times rejected')

const description = automaticReplacementDescription({
  type: 'REPLACEMENT_LEAVE',
  participantName: 'Julianto',
  replacedName: 'Ahmad Fauzi',
  date: '2026-08-20',
  startTime: '08:00',
  endTime: '16:00',
})
assert(
  description === 'JULIANTO menggantikan AHMAD FAUZI yang cuti pada 20 Agustus 2026 pukul 08:00–16:00.',
  'Automatic description',
)

console.log('Overtime replacement L2 domain tests passed')
