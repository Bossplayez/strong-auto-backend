'use client';

import { useEffect, useState, useCallback } from 'react';
import { admin } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Plus, Send, Radio } from 'lucide-react';

interface Broadcast {
  id: string;
  subject: string;
  body: string;
  channel?: string;
  targetGroup?: string;
  status: string;
  createdAt: string;
}

const statusColor: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  sent: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
  PENDING: 'bg-yellow-500/20 text-yellow-400',
  SENT: 'bg-green-500/20 text-green-400',
  FAILED: 'bg-red-500/20 text-red-400',
};

const channelColor: Record<string, string> = {
  TELEGRAM: 'bg-blue-500/20 text-blue-400',
  EMAIL: 'bg-purple-500/20 text-purple-400',
};

export default function BroadcastsPage() {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [sendConfirmId, setSendConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formChannel, setFormChannel] = useState('TELEGRAM');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await admin.getBroadcasts();
      setBroadcasts(res as Broadcast[]);
    } catch (err) {
      console.error('Failed to load broadcasts', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreateForm = () => {
    setFormTitle('');
    setFormBody('');
    setFormChannel('TELEGRAM');
    setShowForm(true);
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      await admin.createBroadcast({
        subject: formTitle,
        body: formBody,
        targetGroup: formChannel,
      });
      setShowForm(false);
      load();
    } catch (err) {
      console.error('Failed to create broadcast', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async (id: string) => {
    try {
      await admin.sendBroadcast(id);
      setSendConfirmId(null);
      load();
    } catch (err) {
      console.error('Failed to send broadcast', err);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#3b82f6] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Розсилки</h1>
        <button
          onClick={openCreateForm}
          className="flex items-center gap-2 rounded-lg bg-[#3b82f6] px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-600 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Нова розсилка
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-[#1e293b] bg-[#111827] p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Нова розсилка</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-gray-400">Тема</label>
              <input
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                className="w-full rounded-lg border border-[#1e293b] bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-[#3b82f6] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">Текст</label>
              <textarea
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                rows={6}
                className="w-full rounded-lg border border-[#1e293b] bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-[#3b82f6] focus:outline-none resize-y"
              />
            </div>
            <div className="max-w-xs">
              <label className="mb-1 block text-sm text-gray-400">Канал</label>
              <select
                value={formChannel}
                onChange={(e) => setFormChannel(e.target.value)}
                className="w-full rounded-lg border border-[#1e293b] bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-[#3b82f6] focus:outline-none"
              >
                <option value="TELEGRAM">Telegram</option>
                <option value="EMAIL">Email</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={handleCreate}
              disabled={saving || !formTitle || !formBody}
              className="rounded-lg bg-[#3b82f6] px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Створення...' : 'Створити'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-[#1e293b] px-4 py-2 text-sm font-medium text-gray-400 hover:bg-[#1e293b] transition-colors"
            >
              Скасувати
            </button>
          </div>
        </div>
      )}

      {/* Broadcasts list */}
      <div className="rounded-xl border border-[#1e293b] bg-[#111827]">
        {broadcasts.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-gray-500">
            Немає розсилок
          </div>
        ) : (
          <div className="divide-y divide-[#1e293b]">
            {broadcasts.map((b) => (
              <div key={b.id} className="flex items-center justify-between px-5 py-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <Radio className="h-4 w-4 text-gray-500" />
                    <span className="font-medium text-white">{b.subject}</span>
                    {b.channel && (
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${channelColor[b.channel] || 'bg-gray-500/20 text-gray-400'}`}>
                        {b.channel}
                      </span>
                    )}
                    {b.targetGroup && !b.channel && (
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${channelColor[b.targetGroup] || 'bg-gray-500/20 text-gray-400'}`}>
                        {b.targetGroup}
                      </span>
                    )}
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor[b.status] || 'bg-gray-500/20 text-gray-400'}`}>
                      {b.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-400">
                    {new Date(b.createdAt).toLocaleString('uk-UA')}
                  </p>
                </div>
                <button
                  onClick={() => setSendConfirmId(b.id)}
                  disabled={b.status === 'sent' || b.status === 'SENT'}
                  className="flex items-center gap-2 rounded-lg border border-[#1e293b] px-3 py-2 text-sm text-gray-300 hover:bg-[#1e293b] disabled:opacity-30 transition-colors"
                >
                  <Send className="h-4 w-4" />
                  Надіслати
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Send confirmation */}
      {sendConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-xl border border-[#1e293b] bg-[#111827] p-6">
            <h3 className="text-lg font-semibold text-white">Надіслати розсилку?</h3>
            <p className="mt-2 text-sm text-gray-400">
              Розсилка буде надіслана всім отримувачам. Цю дію неможливо скасувати.
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setSendConfirmId(null)}
                className="rounded-lg border border-[#1e293b] px-4 py-2 text-sm text-gray-400 hover:bg-[#1e293b] transition-colors"
              >
                Скасувати
              </button>
              <button
                onClick={() => handleSend(sendConfirmId)}
                className="rounded-lg bg-[#3b82f6] px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 transition-colors"
              >
                Надіслати
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
