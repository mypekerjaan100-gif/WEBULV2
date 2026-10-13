import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]
const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const POPUP_WIDTH = 320

function pad2(value) {
  return String(value).padStart(2, '0')
}

function toISO(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function localTodayISO() {
  const now = new Date()
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

export function parseISODate(value) {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const probe = new Date(year, month - 1, day)
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    return null
  }
  return { year, month, day }
}

export function formatIndonesianDate(value) {
  const parsed = parseISODate(value)
  if (!parsed) return ''
  return `${parsed.day} ${MONTH_NAMES[parsed.month - 1]} ${parsed.year}`
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

function clampView(year, month, minParsed, maxParsed) {
  let next = { year, month }
  if (minParsed && (year < minParsed.year || (year === minParsed.year && month < minParsed.month))) {
    next = { year: minParsed.year, month: minParsed.month }
  }
  if (maxParsed && (next.year > maxParsed.year || (next.year === maxParsed.year && next.month > maxParsed.month))) {
    next = { year: maxParsed.year, month: maxParsed.month }
  }
  return next
}

export default function ModernDatePicker({
  value = '',
  onChange,
  min = '',
  max = '',
  placeholder = 'Pilih tanggal',
  disabled = false,
  ariaLabel = 'Pilih tanggal',
  id,
}) {
  const [open, setOpen] = useState(false)
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0, width: POPUP_WIDTH })
  const triggerRef = useRef(null)
  const popupRef = useRef(null)
  const todayISO = useMemo(() => localTodayISO(), [])

  const minParsed = useMemo(() => parseISODate(min), [min])
  const maxParsed = useMemo(() => parseISODate(max), [max])
  const selected = useMemo(() => parseISODate(value), [value])
  const fallback = useMemo(() => parseISODate(max) ?? { year: new Date().getFullYear(), month: new Date().getMonth() + 1, day: new Date().getDate() }, [max])
  const initialView = useMemo(
    () => clampView((selected ?? fallback).year, (selected ?? fallback).month, minParsed, maxParsed),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [view, setView] = useState(initialView)

  const minYear = minParsed ? minParsed.year : (maxParsed ? maxParsed.year : new Date().getFullYear()) - 100
  const maxYear = maxParsed ? maxParsed.year : new Date().getFullYear() + 10
  const years = useMemo(() => {
    const list = []
    for (let year = maxYear; year >= minYear; year -= 1) list.push(year)
    return list
  }, [minYear, maxYear])

  const isDisabledDay = (iso) => {
    if (minParsed && iso < toISO(minParsed.year, minParsed.month, minParsed.day)) return true
    if (maxParsed && iso > toISO(maxParsed.year, maxParsed.month, maxParsed.day)) return true
    return false
  }

  const canStep = (delta) => {
    let month = view.month + delta
    let year = view.year
    if (month < 1) { month = 12; year -= 1 }
    if (month > 12) { month = 1; year += 1 }
    const clamped = clampView(year, month, minParsed, maxParsed)
    return clamped.year === year && clamped.month === month
  }

  const stepMonth = (delta) => {
    if (!canStep(delta)) return
    let month = view.month + delta
    let year = view.year
    if (month < 1) { month = 12; year -= 1 }
    if (month > 12) { month = 1; year += 1 }
    setView({ year, month })
  }

  const updatePopupPos = () => {
    const trigger = triggerRef.current
    if (!trigger || typeof window === 'undefined') return
    const rect = trigger.getBoundingClientRect()
    const popupHeight = popupRef.current?.offsetHeight ?? 420
    const width = Math.min(POPUP_WIDTH, window.innerWidth - 24)
    let left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12))
    let top = rect.bottom + 8
    if (top + popupHeight > window.innerHeight - 12) {
      top = rect.top - popupHeight - 8
    }
    if (top < 12) top = 12
    setPopupPos({ top, left, width })
  }

  useLayoutEffect(() => {
    if (open) updatePopupPos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view])

  useEffect(() => {
    if (!open) return undefined
    updatePopupPos()
    const onScroll = () => updatePopupPos()
    const onResize = () => updatePopupPos()
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointerDown = (event) => {
      const target = event.target
      if (triggerRef.current?.contains(target)) return
      if (popupRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const openPicker = () => {
    if (disabled) return
    const base = selected ?? fallback
    setView(clampView(base.year, base.month, minParsed, maxParsed))
    setOpen(true)
  }

  const chooseDay = (iso) => {
    if (isDisabledDay(iso)) return
    onChange?.(iso)
    setOpen(false)
  }

  const cells = useMemo(() => {
    const total = daysInMonth(view.year, view.month)
    const first = new Date(view.year, view.month - 1, 1).getDay()
    const leading = (first + 6) % 7
    const prevMonth = view.month === 1 ? 12 : view.month - 1
    const prevYear = view.month === 1 ? view.year - 1 : view.year
    const prevTotal = daysInMonth(prevYear, prevMonth)
    const nextMonth = view.month === 12 ? 1 : view.month + 1
    const nextYear = view.month === 12 ? view.year + 1 : view.year
    const list = []
    for (let i = leading; i > 0; i -= 1) {
      const day = prevTotal - i + 1
      list.push({ iso: toISO(prevYear, prevMonth, day), day, outside: true })
    }
    for (let day = 1; day <= total; day += 1) {
      list.push({ iso: toISO(view.year, view.month, day), day, outside: false })
    }
    let nextDay = 1
    while (list.length < 42) {
      list.push({ iso: toISO(nextYear, nextMonth, nextDay), day: nextDay, outside: true })
      nextDay += 1
    }
    return list
  }, [view])

  const display = formatIndonesianDate(value)
  const todayInRange = !isDisabledDay(todayISO)

  const popup = open && typeof document !== 'undefined' ? createPortal(
    <div
      ref={popupRef}
      className="mdp-popup"
      role="dialog"
      aria-label={ariaLabel}
      style={{ top: popupPos.top, left: popupPos.left, width: popupPos.width }}
    >
      <div className="mdp-header">
        <button type="button" className="mdp-nav-btn" aria-label="Bulan sebelumnya" disabled={!canStep(-1)} onClick={() => stepMonth(-1)}>
          ‹
        </button>
        <div className="mdp-header-selects">
          <select
            className="mdp-select"
            aria-label="Pilih bulan"
            value={view.month}
            onChange={(e) => {
              const month = Number(e.target.value)
              setView(clampView(view.year, month, minParsed, maxParsed))
            }}
          >
            {MONTH_NAMES.map((name, index) => (
              <option key={name} value={index + 1}>{name}</option>
            ))}
          </select>
          <select
            className="mdp-select mdp-year"
            aria-label="Pilih tahun"
            value={view.year}
            onChange={(e) => {
              const year = Number(e.target.value)
              setView(clampView(year, view.month, minParsed, maxParsed))
            }}
          >
            {years.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </div>
        <button type="button" className="mdp-nav-btn" aria-label="Bulan berikutnya" disabled={!canStep(1)} onClick={() => stepMonth(1)}>
          ›
        </button>
      </div>
      <div className="mdp-weekdays" aria-hidden="true">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="mdp-grid" role="grid" aria-label="Pilih tanggal">
        {cells.map((cell) => {
          const isSelected = selected && cell.iso === toISO(selected.year, selected.month, selected.day)
          const isToday = cell.iso === todayISO
          const cellDisabled = isDisabledDay(cell.iso)
          return (
            <button
              key={cell.iso}
              type="button"
              role="gridcell"
              aria-selected={isSelected ? 'true' : 'false'}
              aria-label={formatIndonesianDate(cell.iso)}
              disabled={cellDisabled}
              className={`mdp-day${cell.outside ? ' is-outside' : ''}${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`}
              onClick={() => chooseDay(cell.iso)}
            >
              {cell.day}
            </button>
          )
        })}
      </div>
      <div className="mdp-footer">
        <button type="button" className="mdp-footer-btn" disabled={!todayInRange} onClick={() => chooseDay(todayISO)}>
          Hari ini
        </button>
        {value && (
          <button
            type="button"
            className="mdp-footer-btn is-ghost"
            onClick={() => {
              onChange?.('')
              setOpen(false)
            }}
          >
            Hapus
          </button>
        )}
      </div>
    </div>,
    document.body,
  ) : null

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`mdp-trigger${display ? ' has-value' : ''}`}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open ? 'true' : 'false'}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPicker())}
      >
        <span className="mdp-trigger-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </span>
        <span className={display ? 'mdp-trigger-value' : 'mdp-trigger-placeholder'}>
          {display || placeholder}
        </span>
        {display && !disabled ? (
          <span
            className="mdp-trigger-clear"
            role="button"
            tabIndex={-1}
            aria-label="Hapus tanggal"
            onClick={(e) => {
              e.stopPropagation()
              onChange?.('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                onChange?.('')
              }
            }}
          >
            ×
          </span>
        ) : (
          <span className="mdp-trigger-caret" aria-hidden="true">▾</span>
        )}
      </button>
      {popup}
    </>
  )
}
