import { DbCheck } from './DbCheck';
export function Placeholder() {
  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="text-4xl font-bold text-gray-900">VaporFlow</h1>
        <p className="mt-3 text-lg text-gray-600">Database connected — Phase 2</p>
        <DbCheck />
      </div>
    </main>
  );
}
