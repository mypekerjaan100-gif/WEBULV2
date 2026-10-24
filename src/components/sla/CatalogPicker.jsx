import { useEffect, useId, useMemo, useRef, useState } from 'react'

function buildGroups(equipment, categories, query) {
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const q = query.trim().toLowerCase()
  const groups = new Map()
  for (const item of equipment) {
    if (!item.isActive) continue
    const category = categoryById.get(item.categoryId)
    const haystack = `${item.code} ${item.name} ${category?.name || ''}`.toLowerCase()
    if (q && !haystack.includes(q)) continue
    const key = category?.id || '__uncategorized__'
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: category?.name || 'Tanpa Kategori',
        sortOrder: category?.sortOrder ?? Number.MAX_SAFE_INTEGER,
        items: [],
      })
    }
    groups.get(key).items.push(item)
  }
  return [...groups.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)),
    }))
}

export default function CatalogPicker({
  equipment, categories, existingIds = [], disabled = false, onSelect, triggerRef,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const panelId = useId()
  const rootRef = useRef(null)
  const searchRef = useRef(null)
  const groups = useMemo(() => buildGroups(equipment, categories, query), [equipment, categories, query])
  const flatItems = useMemo(() => groups.flatMap((group) => group.items), [groups])
  const existingSet = useMemo(() => new Set(existingIds), [existingIds])

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
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef?.current?.focus())
  }

  const choose = (item) => {
    if (!item || disabled) return
    onSelect?.(item)
    setOpen(false)
    setQuery('')
  }

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => Math.min(flatItems.length - 1, current + 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => Math.max(0, current - 1))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      choose(flatItems[activeIndex])
    }
  }

  return (
    <div ref={rootRef} className="alkes-catalog-picker">
      <button
        ref={triggerRef}
        type="button"
        className={`alkes-catalog-trigger ${open ? 'is-open' : ''}`}
        disabled={disabled}
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
        <span>Pilih alat dari katalog</span>
        <span className="alkes-catalog-chevron" aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="alkes-catalog-panel" id={panelId} role="listbox" aria-label="Pilih alat dari katalog">
          <div className="alkes-catalog-search">
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Cari nama atau kode alat..."
              aria-label="Cari alat di katalog"
              aria-controls={panelId}
              aria-activedescendant={flatItems[activeIndex] ? `${panelId}-opt-${activeIndex}` : undefined}
              autoComplete="off"
            />
          </div>
          <div className="alkes-catalog-results">
            {!flatItems.length ? (
              <p className="alkes-catalog-empty">Tidak ada alat yang cocok dengan pencarian.</p>
            ) : groups.map((group) => (
              <div key={group.key} className="alkes-catalog-group">
                <div className="alkes-catalog-group-label">{group.name}</div>
                {group.items.map((item) => {
                  const index = flatItems.findIndex((entry) => entry.id === item.id)
                  const already = existingSet.has(item.id)
                  return (
                    <button
                      key={item.id}
                      id={`${panelId}-opt-${index}`}
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      className={`alkes-catalog-option ${index === activeIndex ? 'is-active' : ''} ${already ? 'is-existing' : ''}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose(item)}
                    >
                      <span className="alkes-catalog-option-text">
                        <strong>{item.name}</strong>
                        <small>{item.code}</small>
                      </span>
                      <span className="alkes-catalog-option-meta">
                        {already ? 'Sudah ada' : item.unit}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
