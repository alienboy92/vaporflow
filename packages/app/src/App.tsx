import { HashRouter, Routes, Route } from 'react-router-dom';
import { Placeholder } from './screens/Placeholder';
import { DbProvider } from './context/DbProvider';

export function App() {
  return (
    <DbProvider>
      <HashRouter>
        <Routes>
          <Route path="*" element={<Placeholder />} />
        </Routes>
      </HashRouter>
    </DbProvider>
  );
}
