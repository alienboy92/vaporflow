import { getSetupSql } from '@bali-hub-pos/core';
import { useState } from 'react';
import { usePlatform } from '../context/DbProvider';

export function CloudSetupSql({ warning }: { warning?: string | null }) {
  const platform = usePlatform();
  const [message, setMessage] = useState('');
  async function copy() {
    try {
      const sql = await getSetupSql(platform.app);
      if (!sql) throw new Error();
      await navigator.clipboard.writeText(sql);
      setMessage('Setup SQL copied. Paste it into Supabase > SQL Editor and run it.');
    } catch {
      setMessage('Could not read or copy setup.sql. Check the Windows installation and clipboard access.');
    }
  }
  return <>
    {warning && <p className="vf-card p-3 text-amber-800" role="alert">{warning}</p>}
    {platform.app?.getSetupSql && <div className="space-y-2">
      <ol className="list-decimal pl-5 text-sm">
        <li>Create a Supabase project.</li><li>Copy the setup SQL.</li>
        <li>Paste it into SQL Editor and run it.</li><li>Enter the project URL and anon key below.</li>
      </ol>
      <p className="vf-sub">Existing project? Run only the migration sections you have not applied.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="vf-btn-ghost" onClick={() => void copy()}>Copy setup SQL</button>
        <button type="button" className="vf-btn-ghost" onClick={() => void platform.app.openExternal('https://supabase.com/dashboard').catch(() => setMessage('Could not open the Supabase dashboard.'))}>Open Supabase</button>
      </div>
      {message && <p role="status" className="vf-card p-3">{message}</p>}
    </div>}
  </>;
}
