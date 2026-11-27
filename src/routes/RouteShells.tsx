import { KeyRound } from 'lucide-react';
import { SuperAdminLayout } from '../components/SuperAdminLayout';

export function SuperIntegrationsPage() {
  return (
    <SuperAdminLayout title="Integrations (API Keys & SSO)">
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 flex items-start gap-3 text-sm text-[#4B5563]">
        <KeyRound className="w-5 h-5 text-[#1D4ED8] shrink-0 mt-0.5" />
        <p>
          Hashed per-property External API key management and per-property SSO provider setup activate in Implementation Step 10.
        </p>
      </div>
    </SuperAdminLayout>
  );
}
