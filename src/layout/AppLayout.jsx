import { useState } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Header from '../components/Header.jsx'

export default function AppLayout({ activeContractId, onNavigate, preview, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const closeSidebar = () => setSidebarOpen(false)

  return (
    <div className="app-shell">
      <Sidebar
        open={sidebarOpen}
        activeContractId={activeContractId}
        onNavigate={(id) => {
          onNavigate(id)
          closeSidebar()
        }}
        onClose={closeSidebar}
      />
      <div className="app-main">
        <Header
          activeContractId={activeContractId}
          onOpenSidebar={() => setSidebarOpen(true)}
          preview={preview}
        />
        <main className="app-content">{children}</main>
      </div>
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={closeSidebar} />
      )}
    </div>
  )
}