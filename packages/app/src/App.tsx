import { HashRouter, Routes, Route } from 'react-router-dom';
import { Placeholder } from './screens/Placeholder';

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="*" element={<Placeholder />} />
      </Routes>
    </HashRouter>
  );
}
