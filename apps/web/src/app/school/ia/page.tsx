'use client';

import type { SchoolAiFeature } from '@ocall/shared';
import { useState } from 'react';
import {
  AiAnalysis,
  AiCopilot,
  AiSettings,
  AiTeaching,
  type AiStatus,
} from '@/components/school/school-ai';
import { useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

type Space = 'copilot' | 'teaching' | 'analysis' | 'settings';

const SPACE_FEATURE: Record<Exclude<Space, 'settings'>, SchoolAiFeature> = {
  copilot: 'SCHOOL_COPILOT',
  teaching: 'SCHOOL_TEACHING',
  analysis: 'SCHOOL_ANALYSIS',
};

/**
 * Ocall School AI (Sprint 8) : copilote de direction, assistant pédagogique, analyse scolaire, réglages.
 * L'écran ne propose que ce que le rôle et l'établissement permettent ; l'API revérifie tout.
 */
export default function SchoolAiPage() {
  return (
    <SchoolPage title="ai.title" description="ai.desc">
      {({ school }) => <AiSpaces key={school!.id} schoolId={school!.id} />}
    </SchoolPage>
  );
}

function AiSpaces({ schoolId }: { schoolId: string }) {
  const { t } = useSchoolText();
  const status = useApi<AiStatus>(`/school/ai/status?schoolId=${schoolId}`);
  const [space, setSpace] = useState<Space | null>(null);
  if (status.state === 'loading') return <LoadingState />;
  if (status.state === 'error') return <ErrorState error={status.error} onRetry={status.reload} />;
  const s = status.data;
  // L'espace Enseignants reste ouvert aux enseignants quand l'IA est coupée : consultation des contenus.
  const spaces = (['copilot', 'teaching', 'analysis'] as const).filter(
    (k) => s.features[SPACE_FEATURE[k]] || (k === 'teaching' && s.allowed.SCHOOL_TEACHING),
  );
  const all: Space[] = [...spaces, ...(s.canManage ? (['settings'] as const) : [])];
  const current = space && all.includes(space) ? space : all[0];
  return (
    <>
      {!s.configured && <Alert tone="info" title={t('ai.notConfigured')} />}
      {s.configured && !s.enabled && (
        <Alert tone="info" title={s.canManage ? t('ai.disabledManage') : t('ai.disabled')} />
      )}
      {s.usage.exceeded && <Alert tone="error" title={t('ai.quotaExceeded')} />}
      {!s.usage.exceeded && s.usage.alert && (
        <Alert
          tone="info"
          title={t('ai.quotaAlert', { used: s.usage.used, limit: s.usage.limit })}
        />
      )}
      <div className="flex flex-wrap items-center gap-2" role="tablist" data-testid="ai-spaces">
        {all.map((k) => (
          <Button
            key={k}
            size="sm"
            role="tab"
            aria-selected={k === current}
            variant={k === current ? 'primary' : 'secondary'}
            onClick={() => setSpace(k)}
            data-testid={`ai-space-${k}`}
          >
            {t(`ai.space.${k}`)}
          </Button>
        ))}
        {s.simulated && <Badge tone="savanna">{t('ai.simulated')}</Badge>}
        <span className="text-xs text-muted" data-testid="ai-usage">
          {t('ai.usage', { used: s.usage.used, limit: s.usage.limit })}
        </span>
      </div>
      {all.length === 0 && s.enabled && <Alert tone="info" title={t('ai.nothing')} />}
      {current === 'copilot' && <AiCopilot schoolId={schoolId} onUsed={status.reload} />}
      {current === 'teaching' && (
        <AiTeaching
          schoolId={schoolId}
          canGenerate={s.features.SCHOOL_TEACHING}
          onUsed={status.reload}
        />
      )}
      {current === 'analysis' && <AiAnalysis schoolId={schoolId} onUsed={status.reload} />}
      {current === 'settings' && <AiSettings schoolId={schoolId} onSaved={status.reload} />}
    </>
  );
}
