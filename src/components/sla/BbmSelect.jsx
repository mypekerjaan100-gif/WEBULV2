import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'

const MIN_WIDTH = 240
const MAX_WIDTH = 520

export default function BbmSelect({
  value = '',
  onChange,
  options = [],
  placeholder = 'Pilih',
  disabled = false,
  ariaLabel = 'Pilih',
  searchable = false,
  searchLabel = 'Cari pilihan',
  id,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const [position, setPosition] = useState({ top: 0, left: 0, width: MIN_WIDTH })
  const triggerRef = useRef(null)
  const popupRef = useRef(null)
  const searchRef = useRef(null)
  const selected = options.find((option) => option.value === value)
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return term ? options.filter((option) => String(option.label).toLowerCase().includes(term)) : options
  }, [options, query])

  const updatePosition = () => {
    const trigger = triggerRef.current
    if (!trigger || typeof window === 'undefined') return
    const rect = trigger.getBoundingClientRect()
    const width = Math.min(Math.max(rect.width, MIN_WIDTH), MAX_WIDTH, window.innerWidth - 24)
    const height = popupRef.current?.offsetHeight ?? 280
    let left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12))
    let top = rect.bottom + 6
    if (top + height > window.innerHeight - 12) top = rect.top - height - 6
    setPosition({ top: Math.max(12, top), left, width })
  }

  useLayoutEffect(() => {
    if (open) updatePosition()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filtered.length])

  useEffect(() => {
    if (open) popupRef.current?.querySelector('.bbm-cs-option.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  useEffect(() => {
    if (!open) return undefined
    updatePosition()
    const onScroll = () => updatePosition()
    const onResize = () => updatePosition()
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSelect()
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
      if (searchable) searchRef.current?.focus()
      else popupRef.current?.querySelector('.bbm-cs-option.is-active')?.focus()
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

  const openSelect = () => {
    if (disabled) return
    setQuery('')
    const index = options.findIndex((option) => option.value === value)
    setActive(index >= 0 ? index : 0)
    setOpen(true)
  }
  const closeSelect = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const choose = (option) => {
    if (option.disabled) return
    onChange?.(option.value)
    closeSelect()
  }
  const moveActive = (step) => {
    if (filtered.length === 0) return
    let next = active
    for (let count = 0; count < filtered.length; count += 1) {
      next = (next + step + filtered.length) % filtered.length
      if (!filtered[next]?.disabled) break
    }
    setActive(next)
  }
  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveActive(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Enter') {
      const option = filtered[active]
      if (option && !option.disabled) {
        event.preventDefault()
        choose(option)
      }
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActive(filtered.length - 1)
    }
  }

  const popup = open && typeof document !== 'undefined' ? createPortal(
    <div
      ref={popupRef}
      className="bbm-cs-popup"
      role="dialog"
      aria-label={ariaLabel}
      style={{ top: position.top, left: position.left, width: position.width }}
    >
      {searchable && (
        <label className="bbm-cs-search">
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            type="text"
            value={query}
            aria-label={searchLabel}
            placeholder={searchLabel}
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={handleKeyDown}
          />
        </label>
      )}
      <div className="bbm-cs-list" role="listbox" aria-label={ariaLabel} onKeyDown={handleKeyDown}>
        {filtered.length === 0 ? <p className="bbm-cs-empty">Tidak ada pilihan.</p> : filtered.map((option, index) => (
          <button
            key={String(option.value)}
            type="button"
            role="option"
            aria-selected={option.value === value ? 'true' : 'false'}
            className={`bbm-cs-option${index === active ? ' is-active' : ''}`}
            disabled={option.disabled}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(option)}
          >
            <span>{option.label}</span>
            {option.value === value && <Icon name="check" size={14} />}
          </button>
        ))}
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
        className={`bbm-cs-trigger${selected ? ' has-value' : ''}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open ? 'true' : 'false'}
        disabled={disabled}
        title={selected ? selected.label : placeholder}
        onClick={() => (open ? closeSelect() : openSelect())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            openSelect()
          }
        }}
      >
        <span className="bbm-cs-value">{selected ? selected.label : placeholder}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      {popup}
    </>
  )
}
