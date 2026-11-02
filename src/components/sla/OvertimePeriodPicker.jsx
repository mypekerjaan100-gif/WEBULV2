import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'

const MONTHS = [
  { label: 'Januari', short: 'Jan' },
  { label: 'Februari', short: 'Feb' },
  { label: 'Maret', short: 'Mar' },
  { label: 'April', short: 'Apr' },
  { label: 'Mei', short: 'Mei' },
  { label: 'Juni', short: 'Jun' },
  { label: 'Juli', short: 'Jul' },
  { label: 'Agustus', short: 'Agu' },
  { label: 'September', short: 'Sep' },
  { label: 'Oktober', short: 'Okt' },
  { label: 'November', short: 'Nov' },
  { label: 'Desember', short: 'Des' },
]

function monthKey(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`
}

function periodLabel(key) {
  if (!/^\d{4}-\d{2}/.test(String(key ?? ''))) return 'Pilih periode'
  const [year, month] = key.slice(0, 7).split('-').map(Number)
  return `${MONTHS[month - 1]?.label ?? ''} ${year}`
}

export default function OvertimePeriodPicker({ periods = [], value, onChange, disabled = false }) {
  const triggerRef = useRef(null)
  const pickerRef = useRef(null)
  const monthButtonRefs = useRef({})
  const [open, setOpen] = useState(false)
  const [displayYear, setDisplayYear] = useState(() => Number(String(value ?? '').slice(0, 4)) || new Date().getFullYear())

  const availableMonths = useMemo(() => new Set(
    [...periods, value].filter(Boolean).map((period) => String(period).slice(0, 7)),
  ), [periods, value])
  const years = useMemo(() => [...new Set(
    [...availableMonths].map((period) => Number(period.slice(0, 4))).filter(Number.isFinite),
  )].sort((a, b) => a - b), [availableMonths])
  const previousYear = [...years].reverse().find((year) => year < displayYear)
  const nextYear = years.find((year) => year > displayYear)
  const selectedKey = String(value ?? '').slice(0, 7)

  useEffect(() => {
    if (!open) return undefined
    monthButtonRefs.current[selectedKey]?.focus()

    const handlePointerDown = (event) => {
      if (!pickerRef.current?.contains(event.target)) setOpen(false)
    }
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, selectedKey])

  const choosePeriod = (key) => {
    if (!availableMonths.has(key)) return
    setOpen(false)
    triggerRef.current?.focus()
    onChange?.(`${key}-01`)
  }

  return (
    <div className="lembur-period-picker" ref={pickerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="lembur-period-trigger"
        aria-label={`Periode Lembur: ${periodLabel(value)}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="lembur-period-popover"
        disabled={disabled}
        onClick={() => {
          if (!open) setDisplayYear(Number(selectedKey.slice(0, 4)) || years[years.length - 1] || new Date().getFullYear())
          setOpen((current) => !current)
        }}
      >
        <Icon name="calendar" size={18} className="lembur-period-trigger-icon" />
        <span className="lembur-period-trigger-label">{periodLabel(value)}</span>
        <Icon name="chevron-down" size={16} className={`lembur-period-trigger-chevron${open ? ' is-open' : ''}`} />
      </button>
      {open && (
        <div
          id="lembur-period-popover"
          className="lembur-period-popover"
          role="dialog"
          aria-label="Pilih periode lembur"
        >
          <div className="lembur-period-popover-heading">
            <span className="lembur-period-popover-title">Pilih periode</span>
            <div className="lembur-period-year-nav">
              <button
                type="button"
                className="lembur-period-year-button"
                aria-label="Tahun sebelumnya"
                disabled={!previousYear}
                onClick={() => setDisplayYear(previousYear)}
              >
                <Icon name="chevron-left" size={16} />
              </button>
              <strong aria-live="polite">{displayYear}</strong>
              <button
                type="button"
                className="lembur-period-year-button"
                aria-label="Tahun berikutnya"
                disabled={!nextYear}
                onClick={() => setDisplayYear(nextYear)}
              >
                <Icon name="chevron-right" size={16} />
              </button>
            </div>
          </div>
          <div className="lembur-period-month-grid" role="group" aria-label={`Bulan tahun ${displayYear}`}>
            {MONTHS.map((month, index) => {
              const key = monthKey(displayYear, index)
              const isAvailable = availableMonths.has(key)
              const isSelected = key === selectedKey
              return (
                <button
                  key={key}
                  ref={(element) => { monthButtonRefs.current[key] = element }}
                  type="button"
                  className={`lembur-period-month${isSelected ? ' is-selected' : ''}`}
                  aria-label={`${month.label} ${displayYear}`}
                  aria-pressed={isSelected}
                  disabled={!isAvailable}
                  onClick={() => choosePeriod(key)}
                >
                  {month.short}
                  {isSelected && <span className="lembur-period-month-check" aria-hidden="true">✓</span>}
                </button>
              )
            })}
          </div>
          <p className="lembur-period-popover-hint">Pilih bulan untuk melihat pengajuan Lembur.</p>
        </div>
      )}
    </div>
  )
}
