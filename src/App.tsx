import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { EntryScreen } from './entry/EntryScreen'
import { ViewerScreen } from './viewer/ViewerScreen'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ViewerScreen />} />
        <Route path="/entry" element={<EntryScreen />} />
      </Routes>
    </BrowserRouter>
  )
}
