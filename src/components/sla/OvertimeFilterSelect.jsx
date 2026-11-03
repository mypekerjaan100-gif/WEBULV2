import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'

export default function OvertimeFilterSelect({
  label,
  value,
  options = [],
  onChange,
  searchable = false,
  searchPlaceholder,
  statusTone = false,
}) {
  const id = useId()
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const searchRef = useRef(null)
  const optionRefs = useRef([])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const selected = options.find((option) => String(option.value) === String(value)) ?? options[0]
  const selectedIndex = options.findIndex((option) => String(option.value) === String(value))
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('id-ID')
    if (!normalizedQuery) return options
    return options.filter((option) => String(option.label).toLocaleLowerCase('id-ID').includes(normalizedQuery))
  }, [options, query])
  const listboxId = `${id}-listbox`

  useEffect(() => {
    if (!open) return undefined
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      setQuery('')
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const initialIndex = selectedIndex >= 0 ? selectedIndex : 0
    setActiveIndex(initialIndex)
    if (searchable) searchRef.current?.focus()
    else optionRefs.current[initialIndex]?.focus()
  }, [open, searchable, selectedIndex])

  useEffect(() => {
    if (open && !searchable) optionRefs.current[activeIndex]?.focus()
  }, [activeIndex, open, searchable])

  const close = () => {
    setOpen(false)
    setQuery('')
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const choose = (option) => {
    if (!option) return
    onChange?.(option.value)
    close()
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((current) => Math.max(0, Math.min(filtered.length - 1, current + direction)))
      return
    }
    if (event.key === 'Home' && open && !searchable) {
      event.preventDefault()
      setActiveIndex(0)
      return
    }
    if (event.key === 'End' && open && !searchable) {
      event.preventDefault()
      setActiveIndex(Math.max(0, filtered.length - 1))
      return
    }
    if (event.key === 'Enter' && open && searchable) {
      event.preventDefault()
      choose(filtered[activeIndex])
    }
  }

  return (
    <div ref={rootRef} className={`lembur-filter-select${open ? ' is-open' : ''}`} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="lembur-filter-select-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        onClick={() => {
          if (!open) {
            setQuery('')
            setOpen(true)
          } else {
            setOpen(false)
            setQuery('')
          }
        }}
      >
        {statusTone && selected?.tone && <span className={`lembur-filter-status-dot is-${selected.tone}`} aria-hidden="true" />}
        <span className="lembur-filter-select-value" title={selected?.label}>{selected?.label ?? 'Semua'}</span>
        <Icon name="chevron-down" size={16} className="lembur-filter-select-chevron" />
      </button>
      {open && (
        <div className={`lembur-filter-select-panel${searchable ? ' has-search' : ''}`} id={`${id}-panel`} role="dialog" aria-label={`Pilihan ${label}`}>
          {searchable && (
            <div className="lembur-filter-select-search">
              <Icon name="search" size={15} />
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder={searchPlaceholder ?? `Cari ${label.toLocaleLowerCase('id-ID')}...`}
                aria-label={`Cari ${label}`}
                role="combobox"
                aria-expanded="true"
                aria-autocomplete="list"
                aria-controls={listboxId}
                aria-activedescendant={filtered[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActiveIndex(0)
                }}
              />
            </div>
          )}
          <div className="lembur-filter-select-options" id={listboxId} role="listbox" aria-label={label}>
            {filtered.length ? filtered.map((option, index) => {
              const isSelected = String(option.value) === String(value)
              return (
                <button
                  key={option.value || '__all'}
                  ref={(element) => { optionRefs.current[index] = element }}
                  id={`${id}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`lembur-filter-select-option${index === activeIndex ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(option)}
                >
                  {statusTone && option.tone && <span className={`lembur-filter-status-dot is-${option.tone}`} aria-hidden="true" />}
                  <span className="lembur-filter-option-label">{option.label}</span>
                  {isSelected && <Icon name="check" size={15} className="lembur-filter-option-check" />}
                </button>
              )
            }) : (
              <p className="lembur-filter-select-empty">Tidak ada pilihan yang cocok.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
