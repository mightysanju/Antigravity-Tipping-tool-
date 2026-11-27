import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { SuperAdminLayout } from '../../components/SuperAdminLayout';
import { usePropertySwitcher } from '../../auth/PropertySwitcherContext';
import { callSuperAdmin, callSuperIntegrations, type ApiKeyScope } from '../../lib/apiClient';

interface IntegrationsData {
  propertyId: string;
  propertyName: string;
  propertyStatus: string;
  toggles: Record<string, boolean>;
  apiKeys: Array<{
    id: string;
    label: string;
    keyPrefix: string;
    scopes: ApiKeyScope[];
    revoked: boolean;
    revokedAt: string | null;
    lastUsedAt: string | null;
    createdAt: string;
  }>;
  ssoProvider: {
    id: string;
    clientId: string;
    authMode: 'server_minted' | 'partner_asymmetric';
    hasClientSecret: boolean;
    publicKeyPem: string | null;
    jwksUrl: string | null;
    allowedOrigins: string[];
    enabled: boolean;
  } | null;
}

const ALL_SCOPES: Array<{ value: ApiKeyScope; label: string }> = [
  { value: 'assignments:write', label: 'assignments:write (Push daily room assignments)' },
  { value: 'people:read', label: 'people:read (List staff & departments)' },
  { value: 'people:write', label: 'people:write (Create / update staff)' },
  { value: 'tips:read', label: 'tips:read (Read tips summary, no guest PII)' },
];

export function SuperIntegrationsPage() {
  const { activeProperty } = usePropertySwitcher();
  const [properties, setProperties] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
  const propertyId = selectedPropertyId || activeProperty?.id || properties[0]?.id || '';

  useEffect(() => {
    void callSuperAdmin<{ properties?: Array<{ id: string; name: string }> }>({ action: 'dashboard' })
      .then((res) => setProperties(res.properties || []))
      .catch(() => {});
  }, []);

  const [data, setData] = useState<IntegrationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // API Key creation state
  const [keyLabel, setKeyLabel] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>(['assignments:write', 'people:read']);
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);

  // SSO configuration state
  const [clientId, setClientId] = useState('');
  const [authMode, setAuthMode] = useState<'server_minted' | 'partner_asymmetric'>('server_minted');
  const [clientSecret, setClientSecret] = useState('');
  const [publicKeyPem, setPublicKeyPem] = useState('');
  const [allowedOrigins, setAllowedOrigins] = useState('');
  const [ssoEnabled, setSsoEnabled] = useState(true);

  const load = useCallback(async () => {
    if (!propertyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await callSuperIntegrations<IntegrationsData>({
        action: 'get',
        propertyId,
      });
      setData(res);
      if (res.ssoProvider) {
        setClientId(res.ssoProvider.clientId);
        setAuthMode(res.ssoProvider.authMode);
        setPublicKeyPem(res.ssoProvider.publicKeyPem ?? '');
        setAllowedOrigins((res.ssoProvider.allowedOrigins ?? []).join(', '));
        setSsoEnabled(res.ssoProvider.enabled);
      } else {
        setClientId('');
        setAuthMode('server_minted');
        setPublicKeyPem('');
        setAllowedOrigins('');
        setSsoEnabled(false);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load integrations');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleScope(scope: ApiKeyScope) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  }

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    if (!propertyId || !keyLabel.trim() || scopes.length === 0) return;
    setError(null);
    setNotice(null);
    try {
      const res = await callSuperIntegrations<{ rawKey: string; label: string }>({
        action: 'create_key',
        propertyId,
        label: keyLabel.trim(),
        scopes,
      });
      setCreatedRawKey(res.rawKey);
      setKeyLabel('');
      setNotice(`Created API key "${res.label}". Copy it now — it will not be shown again.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    }
  }

  async function handleRevoke(keyId: string) {
    setError(null);
    try {
      await callSuperIntegrations({ action: 'revoke_key', keyId });
      setNotice('API key revoked.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke key');
    }
  }

  async function handleSaveSso(e: React.FormEvent) {
    e.preventDefault();
    if (!propertyId || !clientId.trim()) return;
    setError(null);
    setNotice(null);
    try {
      await callSuperIntegrations({
        action: 'upsert_sso',
        propertyId,
        clientId: clientId.trim(),
        authMode,
        clientSecret: clientSecret.trim() || null,
        publicKeyPem: publicKeyPem.trim() || null,
        allowedOrigins: allowedOrigins
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        enabled: ssoEnabled,
      });
      setClientSecret('');
      setNotice('SSO provider configuration saved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save SSO provider');
    }
  }

  return (
    <SuperAdminLayout title="Integrations (API Keys & SSO)">
      <div className="bg-white border border-[#E7DDD0] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[#1C110A]">
            {data?.propertyName || 'Select Property'}
          </h2>
          <p className="text-xs text-[#7A6859]">
            External API ({data?.toggles.external_api ? 'FT-25 Enabled' : 'FT-25 Disabled'}) · SSO (
            {data?.toggles.single_sign_on ? 'FT-26 Enabled' : 'FT-26 Disabled'})
          </p>
        </div>
        <select
          aria-label="Property"
          value={propertyId}
          onChange={(e) => setSelectedPropertyId(e.target.value)}
          className="rounded-lg border border-[#D8CBB8] bg-white px-3 py-1.5 text-xs"
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-xs text-[#B91C1C]">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-xs text-[#166534]">
          {notice}
        </div>
      )}

      {createdRawKey && (
        <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4 flex items-center justify-between gap-3">
          <div className="text-xs text-[#92400E] space-y-1">
            <div className="font-semibold">New API Key (copy now — shown once):</div>
            <code className="block font-mono text-xs bg-white px-2.5 py-1 rounded border border-[#FDE68A]">
              {createdRawKey}
            </code>
          </div>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(createdRawKey)}
            className="inline-flex items-center gap-1 rounded-lg border border-[#D8CBB8] bg-white px-3 py-1.5 text-xs font-medium"
          >
            <Copy className="w-3.5 h-3.5" /> Copy
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* External API Keys */}
        <section className="bg-white border border-[#E7DDD0] rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[#8C5E1A]" />
            <h3 className="text-sm font-semibold text-[#1C110A]">External API Keys</h3>
          </div>

          <form onSubmit={handleCreateKey} className="space-y-3">
            <label className="block text-xs text-[#5C4B3E]">
              Key label
              <input
                value={keyLabel}
                onChange={(e) => setKeyLabel(e.target.value)}
                placeholder="e.g. Opera PMS Production"
                className="mt-1 w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-xs"
              />
            </label>
            <div className="space-y-1.5">
              <div className="text-xs text-[#5C4B3E]">Scopes</div>
              {ALL_SCOPES.map((s) => (
                <label key={s.value} className="flex items-center gap-2 text-xs text-[#1C110A]">
                  <input
                    type="checkbox"
                    checked={scopes.includes(s.value)}
                    onChange={() => toggleScope(s.value)}
                  />
                  <span>{s.label}</span>
                </label>
              ))}
            </div>
            <button
              type="submit"
              disabled={loading || !keyLabel.trim() || scopes.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2A1A10] px-3 py-2 text-xs font-semibold text-white hover:bg-[#3D281B] disabled:opacity-50"
            >
              <Plus className="w-4 h-4" /> Create API Key
            </button>
          </form>

          <div className="border-t border-[#F3F4F6] pt-3 space-y-2">
            {(data?.apiKeys ?? []).length === 0 ? (
              <p className="text-xs text-[#7A6859]">No API keys created for this property.</p>
            ) : (
              data?.apiKeys.map((k) => (
                <div key={k.id} className="flex items-center justify-between gap-2 rounded-lg border border-[#E7DDD0] px-3 py-2 text-xs">
                  <div>
                    <div className="font-semibold text-[#1C110A]">
                      {k.label}{' '}
                      <code className="text-[11px] text-[#7A6859]">{k.keyPrefix}…</code>
                    </div>
                    <div className="text-[11px] text-[#7A6859]">{k.scopes.join(', ')}</div>
                  </div>
                  {k.revoked ? (
                    <span className="rounded-full bg-[#FEE2E2] px-2 py-0.5 text-[11px] text-[#991B1B]">
                      Revoked
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleRevoke(k.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#FECACA] px-2 py-1 text-[11px] text-[#B91C1C] hover:bg-[#FEF2F2]"
                    >
                      <Trash2 className="w-3 h-3" /> Revoke
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {/* Single Sign-On */}
        <section className="bg-white border border-[#E7DDD0] rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#8C5E1A]" />
            <h3 className="text-sm font-semibold text-[#1C110A]">Single Sign-On (SSO)</h3>
          </div>
          <form onSubmit={handleSaveSso} className="space-y-3">
            <label className="block text-xs text-[#5C4B3E]">
              Partner Client ID
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="pms-casa-paloma"
                className="mt-1 w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-xs"
              />
            </label>
            <label className="block text-xs text-[#5C4B3E]">
              Auth Mode
              <select
                value={authMode}
                onChange={(e) => setAuthMode(e.target.value as 'server_minted' | 'partner_asymmetric')}
                className="mt-1 w-full rounded-lg border border-[#D8CBB8] bg-white px-3 py-2 text-xs"
              >
                <option value="server_minted">Server-Minted Token (Client Secret)</option>
                <option value="partner_asymmetric">Partner-Signed JWT (RS256 / EdDSA Public Key)</option>
              </select>
            </label>
            {authMode === 'server_minted' ? (
              <label className="block text-xs text-[#5C4B3E]">
                Client Secret {data?.ssoProvider?.hasClientSecret ? '(leave blank to keep existing)' : ''}
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="Enter shared partner secret"
                  className="mt-1 w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-xs"
                />
              </label>
            ) : (
              <label className="block text-xs text-[#5C4B3E]">
                Public Key (PEM)
                <textarea
                  rows={4}
                  value={publicKeyPem}
                  onChange={(e) => setPublicKeyPem(e.target.value)}
                  placeholder="-----BEGIN PUBLIC KEY-----"
                  className="mt-1 w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-xs font-mono"
                />
              </label>
            )}
            <label className="block text-xs text-[#5C4B3E]">
              Allowed Origins (comma-separated)
              <input
                value={allowedOrigins}
                onChange={(e) => setAllowedOrigins(e.target.value)}
                placeholder="https://pms.example.com"
                className="mt-1 w-full rounded-lg border border-[#D8CBB8] px-3 py-2 text-xs"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-[#1C110A]">
              <input
                type="checkbox"
                checked={ssoEnabled}
                onChange={(e) => setSsoEnabled(e.target.checked)}
              />
              <span>Enable SSO for this property</span>
            </label>
            <button
              type="submit"
              disabled={loading || !clientId.trim()}
              className="rounded-lg bg-[#2A1A10] px-3 py-2 text-xs font-semibold text-white hover:bg-[#3D281B] disabled:opacity-50"
            >
              Save SSO Settings
            </button>
          </form>
        </section>
      </div>
    </SuperAdminLayout>
  );
}
