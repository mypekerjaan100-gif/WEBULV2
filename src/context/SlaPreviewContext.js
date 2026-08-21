import { createContext, useContext } from 'react'

export const SlaPreviewContext = createContext(null)

export function useSlaPreview() {
  return useContext(SlaPreviewContext)
}