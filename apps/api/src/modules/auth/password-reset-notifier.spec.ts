import { Logger } from '@nestjs/common';
import { LoggingPasswordResetNotifier } from './password-reset-notifier';

const RECIPIENT = { userId: 'user-42', email: 'awa@exemple.ml', firstName: 'Awa' };
const PATH = '/reinitialiser-mot-de-passe?token=SECRET-TOKEN-123';

function capturedLogs(nodeEnv: string | undefined): Promise<string> {
  const lines: string[] = [];
  const log = jest
    .spyOn(Logger.prototype, 'log')
    .mockImplementation((m: unknown) => void lines.push(String(m)));
  const warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation((m: unknown) => void lines.push(String(m)));
  return new LoggingPasswordResetNotifier(nodeEnv)
    .send(RECIPIENT, PATH)
    .then(() => lines.join('\n'))
    .finally(() => {
      log.mockRestore();
      warn.mockRestore();
    });
}

describe('LoggingPasswordResetNotifier', () => {
  it.each(['production', 'staging', 'test', undefined])(
    'ne journalise ni jeton, ni lien, ni e-mail hors développement (NODE_ENV=%s)',
    async (nodeEnv) => {
      const output = await capturedLogs(nodeEnv);
      expect(output).not.toContain('SECRET-TOKEN-123');
      expect(output).not.toContain('reinitialiser-mot-de-passe');
      expect(output).not.toContain(RECIPIENT.email);
      expect(output).toContain(RECIPIENT.userId);
    },
  );

  it('affiche le lien en développement local uniquement', async () => {
    expect(await capturedLogs('development')).toContain('SECRET-TOKEN-123');
  });
});
