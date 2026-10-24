import { useEffect, useId, useMemo, useRef, useState } from 'react'

export default function SearchSelect({
  options, value, onChange, placeholder = 'Pilih opsi', searchPlaceholder = 'Cari...',
  emptyText = 'Tidak ada pilihan yang cocok.', disabled = false, ariaLabel, autoFocusTrigger = false,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const panelId = useId()
  const rootRef = useRef(null)
  const searchRef = useRef(null)
  const selected = options.find((option) => option.value === value) || null
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((option) => `${option.label} ${option.description || ''}`.toLowerCase().includes(q))
  }, [options, query])

  useEffect(() => {
    if (!open) return undefined
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus())
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query, open])

  const close = (restoreFocus = false) => {
    setOpen(false)
    setQuery('')
    if (restoreFocus) window.requestAnimationFrame(() => rootRef.current?.querySelector('button')?.focus())
  }
  const choose = (option) => {
    if (!option || disabled) return
    onChange(option.value)
    close()
  }
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => Math.min(filtered.length - 1, current + 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => Math.max(0, current - 1))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      choose(filtered[activeIndex])
    }
  }

  return (
    <div ref={rootRef} className="alkes-catalog-picker alkes-search-select">
      <button
        type="button"
        className={`alkes-catalog-trigger ${open ? 'is-open' : ''} ${selected ? 'has-value' : ''}`}
        data-autofocus={autoFocusTrigger ? '' : undefined}
        disabled={disabled}
        aria-label={ariaLabel || placeholder}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          if (disabled) return
          if (open) {
            setOpen(false)
            setQuery('')
          } else {
            setOpen(true)
          }
        }}
      >
        <span className={selected ? '' : 'is-placeholder'} title={selected?.label || placeholder}>{selected?.label || placeholder}</span>
        <span className="alkes-catalog-chevron" aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="alkes-catalog-panel alkes-search-select-panel" id={panelId} role="listbox" aria-label={ariaLabel || placeholder}>
          <div className="alkes-catalog-search">
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              role="combobox"
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls={panelId}
              aria-activedescendant={filtered[activeIndex] ? `${panelId}-opt-${activeIndex}` : undefined}
              autoComplete="off"
            />
          </div>
          <div className="alkes-catalog-results">
            {!filtered.length ? (
              <p className="alkes-catalog-empty">{emptyText}</p>
            ) : filtered.map((option, index) => (
              <button
                key={option.value}
                id={`${panelId}-opt-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                title={option.description ? `${option.label} - ${option.description}` : option.label}
                className={`alkes-catalog-option ${index === activeIndex ? 'is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                <span className="alkes-catalog-option-text">
                  <strong>{option.label}</strong>
                  {option.description && <small>{option.description}</small>}
                </span>
                {option.value === value && <span className="alkes-catalog-option-meta">Dipilih</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
