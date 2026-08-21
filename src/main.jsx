import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import AppAuth from './lib/AppAuth.jsx'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppAuth>
      <App />
    </AppAuth>
  </React.StrictMode>,
)