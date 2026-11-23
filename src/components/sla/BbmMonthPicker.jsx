import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]
const POPUP_WIDTH = 286
const pad2 = (value) => String(value).padStart(2, '0')
const currentMonth = () => {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`
}
const yearOf = (value) => {
  const year = Number(String(value ?? '').slice(0, 4))
  return Number.isInteger(year) && year > 1900 ? year : new Date().getFullYear()
}
const labelOf = (value) => {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '')
  if (!match) return ''
  return `${MONTH_NAMES[Number(match[2]) - 1]} ${match[1]}`
}

export default function BbmMonthPicker({
  value = '',
  onChange,
  min = '',
  max = '',
  disabled = false,
  ariaLabel = 'Pilih bulan',
  id,
}) {
  const [open, setOpen] = useState(false)
  const [viewYear, setViewYear] = useState(() => yearOf(value || max || currentMonth()))
  const [position, setPosition] = useState({ top: 0, left: 0, width: POPUP_WIDTH })
  const triggerRef = useRef(null)
  const popupRef = useRef(null)
  const thisMonth = currentMonth()
  const minYear = min ? yearOf(min) : 2000
  const maxYear = max ? yearOf(max) : new Date().getFullYear() + 10
  const canGoPrev = viewYear > minYear
  const canGoNext = viewYear < maxYear
  const display = labelOf(value)

  const monthKey = (index) => `${viewYear}-${pad2(index + 1)}`
  const isDisabled = (key) => (min && key < min) || (max && key > max)

  const updatePosition = () => {
    const trigger = triggerRef.current
    if (!trigger || typeof window === 'undefined') return
    const rect = trigger.getBoundingClientRect()
    const width = Math.min(POPUP_WIDTH, window.innerWidth - 24)
    const height = popupRef.current?.offsetHeight ?? 310
    let left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12))
    let top = rect.bottom + 6
    if (top + height > window.innerHeight - 12) top = rect.top - height - 6
    setPosition({ top: Math.max(12, top), left, width })
  }

  useLayoutEffect(() => {
    if (open) updatePosition()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, viewYear])

  useEffect(() => {
    if (!open) return undefined
    updatePosition()
    const onScroll = () => updatePosition()
    const onResize = () => updatePosition()
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    const onPointerDown = (event) => {
      if (triggerRef.current?.contains(event.target) || popupRef.current?.contains(event.target)) return
      setOpen(false)
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    const frame = requestAnimationFrame(() => {
      const target = popupRef.current?.querySelector('.is-selected:not(:disabled), .is-current:not(:disabled), button:not(:disabled)')
      target?.focus()
    })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const openPicker = () => {
    if (disabled) return
    setViewYear(yearOf(value || max || currentMonth()))
    setOpen(true)
  }
  const closePicker = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const choose = (key) => {
    if (isDisabled(key)) return
    onChange?.(key)
    closePicker()
  }
  const moveFocus = (event, index) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[event.key]
    if (!step) return
    event.preventDefault()
    let next = index + step
    while (next >= 0 && next < 12 && isDisabled(monthKey(next))) next += step
    if (next >= 0 && next < 12) popupRef.current?.querySelector(`[data-month-index="${next}"]`)?.focus()
  }
  const monthButtons = useMemo(() => MONTH_NAMES.map((name, index) => {
    const key = `${viewYear}-${pad2(index + 1)}`
    return {
      key,
      name,
      index,
      selected: key === value,
      current: key === thisMonth,
      disabled: Boolean(isDisabled(key)),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [viewYear, value, min, max, thisMonth])

  const popup = open && typeof document !== 'undefined' ? createPortal(
    <div
      ref={popupRef}
      className="bbm-mp-popup"
      role="dialog"
      aria-label={ariaLabel}
      style={{ top: position.top, left: position.left, width: position.width }}
    >
      <div className="bbm-mp-head">
        <button type="button" className="bbm-mp-nav" aria-label="Tahun sebelumnya" disabled={!canGoPrev} onClick={() => setViewYear((year) => year - 1)}>‹</button>
        <strong aria-live="polite">{viewYear}</strong>
        <button type="button" className="bbm-mp-nav" aria-label="Tahun berikutnya" disabled={!canGoNext} onClick={() => setViewYear((year) => year + 1)}>›</button>
      </div>
      <div className="bbm-mp-grid" role="grid" aria-label={`Bulan ${viewYear}`}>
        {monthButtons.map((month) => (
          <button
            key={month.key}
            type="button"
            data-month-index={month.index}
            className={`bbm-mp-month${month.selected ? ' is-selected' : ''}${month.current ? ' is-current' : ''}`}
            aria-label={`${month.name} ${viewYear}`}
            aria-pressed={month.selected ? 'true' : 'false'}
            disabled={month.disabled}
            onKeyDown={(event) => moveFocus(event, month.index)}
            onClick={() => choose(month.key)}
          >
            {month.name}
          </button>
        ))}
      </div>
      <div className="bbm-mp-foot">
        <button type="button" disabled={Boolean(isDisabled(thisMonth))} onClick={() => choose(thisMonth)}>Bulan ini</button>
        <button type="button" onClick={closePicker}>Tutup</button>
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
        className={`bbm-mp-trigger${display ? ' has-value' : ''}`}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open ? 'true' : 'false'}
        disabled={disabled}
        onClick={() => (open ? closePicker() : openPicker())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            openPicker()
          }
        }}
      >
        <span>{display || 'Pilih bulan'}</span>
        <Icon name="calendar" size={15} />
      </button>
      {popup}
    </>
  )
}
